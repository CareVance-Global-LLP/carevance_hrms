<?php

namespace App\Services\Attendance;

use App\Models\AttendanceRecord;
use App\Models\EmployeePenalisationPolicy;
use App\Models\PenalisationHalfDayRule;
use App\Models\PenalisationPolicy;
use App\Models\Shift;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;

/**
 * What one attendance day COSTS, under the penalisation policy in force.
 *
 * The five rules it runs, in the order they interact:
 *
 *   1. GRACE          Was the arrival past grace_period_minutes? The policy's
 *                     value when one is assigned, shifts.grace_period_minutes
 *                     otherwise — the shift columns were never dropped and are
 *                     still the answer for an org that has configured nothing.
 *   2. THE LATE RULE  Either INCIDENT-based (N late arrivals per cycle) or
 *                     HOURS-based (N hours of accumulated lateness per cycle),
 *                     counted within a weekly or monthly cycle, with the first
 *                     exemptions_per_cycle late arrivals waived.
 *   3. THE ESCAPE     "Ignore late arrival penalty when the employee completes
 *                     the desired hours in a day." Checked BEFORE exemptions,
 *                     so a late-but-complete day costs nothing AND does not
 *                     burn an exemption the person may need later in the cycle.
 *   4. NO SHOW        Worked less than no_show_below_hours: the day is treated
 *                     as not having happened at all.
 *   5. THE LADDER     Otherwise, hours worked as a percentage of the shift is
 *                     walked up an ordered ruleset of (percent -> leaves) and
 *                     the FIRST rung the day falls below is the one that
 *                     applies.
 *
 * Then treat_penalties_as_lop decides whether the resulting leave quantity
 * comes off the leave balance or is loss of pay.
 *
 * BOUNDARIES, DECIDED RATHER THAN INHERITED
 * -----------------------------------------
 * Every threshold here is EXCLUSIVE — meeting the bar exactly passes it. That
 * is one rule applied three times, so nobody has to remember three:
 *
 *   - Grace is documented as "minutes before penalisation starts", so
 *     penalisation starts AFTER it. Arriving at exactly 09:15:00 against a
 *     09:00 start and a fifteen minute grace is NOT late; 09:15:01 is.
 *   - The half-day rule is "the first band the day falls BELOW". Working
 *     exactly 50.00% of the shift is therefore a FULL day, not a half day.
 *     One second under is the half.
 *   - No-show is documented as "working less than X hours", so exactly X hours
 *     is not a no-show.
 *
 * Comparisons are integer, not float. Percentages are carried as hundredths of
 * a percent (4000 = 40.00%) and hour thresholds as whole seconds, so the 50.00%
 * boundary above is decided by 5000 < 5000 rather than by 0.5 < 0.5 on values
 * that arrived through a decimal cast. Leaves are formatted to a decimal string
 * exactly once, at the boundary, from those integers.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not write anything, and it is deliberately NOT wired into payroll.
 * The LOP figure it produces is a statement about a day, not a payroll
 * instruction; turning `lopDays` into a payroll_items line is a separate and
 * far riskier piece of work that has to decide re-run behaviour, approval and
 * regularisation overrides first.
 *
 * TENANCY
 * -------
 * Every read is pinned with forOrganization($user->organization_id) rather than
 * leaning on the ambient global scope, which is deliberately a no-op when
 * nothing is authenticated. A scheduled sweep or a queued job asking about one
 * employee would otherwise be free to resolve another tenant's policy.
 */
class PenalisationEngine
{
    /**
     * The week starts on Monday.
     *
     * Keka's documentation names a "weekly cycle" without saying which day
     * opens it. ISO-8601 says Monday, Carbon's default agrees, and the
     * alternative — Sunday, which plenty of Indian payroll calendars use —
     * would move every incident count by one day with nothing to reveal it. The
     * choice is named here so it can be moved to configuration deliberately
     * rather than discovered in a dispute.
     */
    public const WEEK_STARTS_ON = Carbon::MONDAY;

    public function __construct(
        private readonly ShiftResolver $shifts,
        private readonly UserTimezoneResolver $timezones,
    ) {
    }

    /**
     * Evaluate one person on one calendar date.
     *
     * $date is read as a calendar date in the employee's own timezone. A Carbon
     * passed here contributes only its Y-m-d.
     */
    public function evaluate(?User $user, Carbon|string|null $date = null): PenalisationOutcome
    {
        $timezone = $this->timezones->forUser($user);
        $on = $this->normalizeDate($date, $timezone);

        if (! $user || ! $user->organization_id) {
            return $this->notEvaluated($on, $timezone, 'no_user', 'No employee in scope, so nothing can be judged.');
        }

        $occurrence = $this->shifts->occurrenceFor($user, $on->toDateString());

        $policy = $this->policyFor($user, $on);
        $policySource = $this->policySourceFor($user, $policy, $occurrence?->shift);

        if (! $occurrence) {
            // No shift ran on this date — a weekly off, a day the pattern does
            // not apply to, or an employee with nothing rostered. Being late
            // for a shift that does not exist is not a fact, and neither is
            // falling short of its hours.
            return $this->notEvaluated(
                $on,
                $timezone,
                'no_shift_resolved',
                'No shift runs for this employee on '.$on->toDateString().', so no penalisation rule applies.',
                $policy,
                $policySource,
            );
        }

        $basis = $this->basisFor($policy);
        $record = $this->recordFor($user, $on);

        [$workedSeconds, $workedSource] = $this->workedSecondsFor($record, $basis);
        $requiredSeconds = $this->requiredSecondsFor($occurrence, $basis);
        $hoursMet = $requiredSeconds !== null && $requiredSeconds > 0 && $workedSeconds >= $requiredSeconds;

        $percentHundredths = ($requiredSeconds !== null && $requiredSeconds > 0)
            ? intdiv($workedSeconds * 10000, $requiredSeconds)
            : null;

        // ---- 1. grace ------------------------------------------------
        [$graceMinutes, $graceSource] = $this->graceFor($policy, $occurrence->shift);
        $arrivedAt = $record?->check_in_at;
        $lateSeconds = $this->lateSecondsFor($occurrence, $arrivedAt);
        $isLate = $lateSeconds > $graceMinutes * 60;

        $reasons = [];

        // ---- 2 & 3. the late rule, its escape hatch and its exemptions --
        $lateWaivedBy = null;
        $latePenaltyApplies = false;
        $cycleStart = null;
        $cycleEnd = null;
        $exemptionsPerCycle = 0;
        $exemptionsUsed = 0;
        $countableIncidents = 0;
        $countableSeconds = 0;

        if ($policy) {
            $exemptionsPerCycle = max(0, (int) $policy->exemptions_per_cycle);
            [$cycleStart, $cycleEnd] = $this->cycleWindow($policy, $on);

            $candidates = $this->lateCandidatesInCycle(
                $user,
                $policy,
                $graceMinutes,
                $basis,
                $cycleStart,
                $on->toDateString(),
                $occurrence,
            );

            $exemptionsUsed = min($exemptionsPerCycle, count($candidates));
            $countable = array_slice($candidates, $exemptionsPerCycle);
            $countableIncidents = count($countable);
            $countableSeconds = (int) array_sum(array_column($countable, 'late_seconds'));

            $todayIndex = null;
            foreach ($candidates as $index => $candidate) {
                if ($candidate['date'] === $on->toDateString()) {
                    $todayIndex = $index;
                }
            }

            if ($isLate && $todayIndex === null) {
                // Late, but the walk did not count it — the only thing that
                // removes a late day from the walk is the hours escape hatch.
                $lateWaivedBy = PenalisationOutcome::WAIVED_HOURS_MET;
            } elseif ($todayIndex !== null && $todayIndex < $exemptionsPerCycle) {
                $lateWaivedBy = PenalisationOutcome::WAIVED_CYCLE_EXEMPTION;
            } elseif ($todayIndex !== null) {
                $latePenaltyApplies = $this->lateRuleBreached($policy, $countableIncidents, $countableSeconds);
            }
        }

        if ($isLate) {
            $reasons[] = [
                'code' => 'late_arrival',
                'message' => sprintf(
                    'Arrived %s, %s past the %s start and beyond the %d minute grace (%s).',
                    $arrivedAt?->copy()->setTimezone($timezone)->format('H:i:s') ?? 'unknown',
                    PenalisationOutcome::humanSeconds($lateSeconds),
                    $occurrence->shiftStartAt->format('H:i'),
                    $graceMinutes,
                    $graceSource === 'policy' ? 'policy grace' : 'shift grace',
                ),
            ];
        }

        if ($lateWaivedBy === PenalisationOutcome::WAIVED_HOURS_MET) {
            $reasons[] = [
                'code' => 'late_waived_hours_met',
                'message' => sprintf(
                    'Late penalty waived: completed the required %s of %s hours.',
                    PenalisationOutcome::humanSeconds($requiredSeconds),
                    $basis,
                ),
            ];
        } elseif ($lateWaivedBy === PenalisationOutcome::WAIVED_CYCLE_EXEMPTION) {
            $reasons[] = [
                'code' => 'late_waived_cycle_exemption',
                'message' => sprintf(
                    'Late penalty waived: exemption %d of %d for the %s cycle %s to %s.',
                    $exemptionsUsed,
                    $exemptionsPerCycle,
                    (string) $policy?->cycle,
                    (string) $cycleStart,
                    (string) $cycleEnd,
                ),
            ];
        } elseif ($latePenaltyApplies && $policy) {
            $reasons[] = [
                'code' => 'late_penalty',
                'message' => $policy->late_rule_type === PenalisationPolicy::LATE_RULE_HOURS
                    ? sprintf(
                        '%s of countable lateness this %s cycle reaches the %s hour threshold.',
                        PenalisationOutcome::humanSeconds($countableSeconds),
                        (string) $policy->cycle,
                        $this->decimalString((int) round((float) $policy->late_threshold * 100)),
                    )
                    : sprintf(
                        '%d countable late arrivals this %s cycle reaches the threshold of %d.',
                        $countableIncidents,
                        (string) $policy->cycle,
                        (int) round((float) $policy->late_threshold),
                    ),
            ];
        }

        // ---- 4. no show -----------------------------------------------
        $noShowBelowHours = $policy?->no_show_below_hours !== null
            ? $this->decimalString((int) round((float) $policy->no_show_below_hours * 100))
            : null;

        $isNoShow = false;
        if ($policy && $policy->no_show_below_hours !== null) {
            $bar = (int) round((float) $policy->no_show_below_hours * 3600);
            $isNoShow = $workedSeconds < $bar;
        }

        // ---- 5. the ladder ---------------------------------------------
        $halfDayRule = null;
        $leavesHundredths = 0;

        if ($isNoShow) {
            // A no-show is the assertion that the day did not happen, so the
            // ladder — which describes how much of a day DID happen — is not
            // consulted. A full day is deducted.
            $leavesHundredths = 100;
            $reasons[] = [
                'code' => 'no_show',
                'message' => sprintf(
                    'Worked %s, below the %s hour no-show bar — the day is treated as a no show, 1.00 day deducted.',
                    PenalisationOutcome::humanSeconds($workedSeconds),
                    (string) $noShowBelowHours,
                ),
            ];
        } elseif ($policy && $percentHundredths !== null) {
            $halfDayRule = $this->rungFor($policy, $percentHundredths);

            if ($halfDayRule) {
                $leavesHundredths = (int) round((float) $halfDayRule->leaves_deducted * 100);
                $reasons[] = [
                    'code' => 'half_day_rung',
                    'message' => sprintf(
                        'Worked %s of a %s shift (%s%%), below the %s%% rung — %s day deducted.',
                        PenalisationOutcome::humanSeconds($workedSeconds),
                        PenalisationOutcome::humanSeconds($requiredSeconds),
                        $this->decimalString($percentHundredths),
                        $this->decimalString((int) round((float) $halfDayRule->percent_of_shift_hours * 100)),
                        $this->decimalString($leavesHundredths),
                    ),
                ];
            }
        }

        // ---- LOP --------------------------------------------------------
        $isLop = (bool) ($policy?->treat_penalties_as_lop) && $leavesHundredths > 0;
        $deductionSource = $leavesHundredths === 0
            ? PenalisationOutcome::DEDUCT_FROM_NOTHING
            : ($isLop ? PenalisationOutcome::DEDUCT_FROM_LOP : PenalisationOutcome::DEDUCT_FROM_LEAVE_BALANCE);

        if ($leavesHundredths > 0) {
            $reasons[] = [
                'code' => $isLop ? 'loss_of_pay' : 'leave_balance',
                'message' => $isLop
                    ? 'The policy treats penalties as loss of pay, so this is deducted from pay.'
                    : 'The policy does not treat penalties as loss of pay, so this comes off the leave balance.',
            ];
        }

        if ($reasons === []) {
            $reasons[] = [
                'code' => 'clear',
                'message' => sprintf(
                    'Worked %s of a %s shift with no penalty.',
                    PenalisationOutcome::humanSeconds($workedSeconds),
                    PenalisationOutcome::humanSeconds($requiredSeconds),
                ),
            ];
        }

        return new PenalisationOutcome(
            attendanceDate: $on,
            timezone: $timezone,
            status: $this->statusFor($isNoShow, $leavesHundredths, $isLate),
            policySource: $policySource,
            policyId: $policy?->id,
            policyName: $policy?->name,
            hoursBasis: $basis,
            gracePeriodMinutes: $graceMinutes,
            graceSource: $graceSource,
            shiftStartAt: $occurrence->shiftStartAt,
            arrivedAt: $arrivedAt,
            lateSeconds: $lateSeconds,
            isLate: $isLate,
            lateWaivedBy: $lateWaivedBy,
            latePenaltyApplies: $latePenaltyApplies,
            lateRuleType: $policy?->late_rule_type,
            lateThreshold: $policy ? $this->decimalString((int) round((float) $policy->late_threshold * 100)) : null,
            cycle: $policy?->cycle,
            cycleStart: $cycleStart,
            cycleEnd: $cycleEnd,
            exemptionsPerCycle: $exemptionsPerCycle,
            exemptionsUsedInCycle: $exemptionsUsed,
            countableLateIncidentsInCycle: $countableIncidents,
            countableLateSecondsInCycle: $countableSeconds,
            workedSeconds: $workedSeconds,
            workedSecondsSource: $workedSource,
            requiredSeconds: $requiredSeconds,
            percentOfShiftWorked: $percentHundredths !== null ? $this->decimalString($percentHundredths) : null,
            hoursMet: $hoursMet,
            isNoShow: $isNoShow,
            noShowBelowHours: $noShowBelowHours,
            halfDayRuleId: $halfDayRule?->id,
            halfDayRungPercent: $halfDayRule
                ? $this->decimalString((int) round((float) $halfDayRule->percent_of_shift_hours * 100))
                : null,
            leavesDeducted: $this->decimalString($leavesHundredths),
            isLop: $isLop,
            lopDays: $this->decimalString($isLop ? $leavesHundredths : 0),
            deductionSource: $deductionSource,
            reasons: $reasons,
        );
    }

    /**
     * The penalisation policy in force for this person on this date.
     *
     * Assignment first — effective-dated, latest effective_from wins when
     * windows overlap, exactly as ShiftResolver reads employee_shifts — then
     * the organization's default. Null when neither exists, which is the signal
     * to fall back to the shift's own columns.
     */
    public function policyFor(?User $user, Carbon|string|null $date = null): ?PenalisationPolicy
    {
        if (! $user || ! $user->organization_id) {
            return null;
        }

        $organizationId = (int) $user->organization_id;
        $on = $this->normalizeDate($date, $this->timezones->forUser($user))->toDateString();

        $assignment = EmployeePenalisationPolicy::forOrganization($organizationId)
            ->where('user_id', $user->id)
            ->where('is_active', true)
            ->whereDate('effective_from', '<=', $on)
            ->where(function (Builder $window) use ($on) {
                $window->whereNull('effective_to')
                    ->orWhereDate('effective_to', '>=', $on);
            })
            ->orderByDesc('effective_from')
            ->orderByDesc('id')
            ->first();

        if ($assignment) {
            $assigned = PenalisationPolicy::forOrganization($organizationId)
                ->where('is_active', true)
                ->find($assignment->penalisation_policy_id);

            if ($assigned) {
                return $assigned;
            }
        }

        return PenalisationPolicy::forOrganization($organizationId)
            ->where('is_active', true)
            ->where('is_default', true)
            ->orderByDesc('id')
            ->first();
    }

    // ------------------------------------------------------------------
    // Rule pieces
    // ------------------------------------------------------------------

    /**
     * Every late arrival in the cycle that is eligible to be COUNTED, in date
     * order — the list exemptions are spent against.
     *
     * A day drops out here for exactly two reasons: it was inside grace, or the
     * hours escape hatch covered it. The second is why this filter runs before
     * exemptions rather than after: a late-but-complete day must not consume an
     * allowance the person may need for a genuinely short one later in the
     * cycle.
     *
     * Each day is resolved against ITS OWN shift occurrence, because a roster
     * change mid-cycle moves the start time and with it what counts as late.
     *
     * @return list<array{date: string, late_seconds: int}>
     */
    private function lateCandidatesInCycle(
        User $user,
        PenalisationPolicy $policy,
        int $graceMinutes,
        string $basis,
        string $cycleStart,
        string $upToDate,
        ShiftOccurrence $todayOccurrence,
    ): array {
        $records = AttendanceRecord::forOrganization((int) $user->organization_id)
            ->where('user_id', $user->id)
            ->whereBetween('attendance_date', [$cycleStart, $upToDate])
            ->orderBy('attendance_date')
            ->orderBy('id')
            ->get();

        $candidates = [];

        foreach ($records as $record) {
            $date = $record->attendance_date instanceof Carbon
                ? $record->attendance_date->toDateString()
                : (string) $record->attendance_date;

            $occurrence = $date === $upToDate
                ? $todayOccurrence
                : $this->shifts->occurrenceFor($user, $date);

            if (! $occurrence) {
                continue;
            }

            $lateSeconds = $this->lateSecondsFor($occurrence, $record->check_in_at);

            if ($lateSeconds <= $graceMinutes * 60) {
                continue;
            }

            if ($policy->ignore_late_when_hours_met) {
                [$worked] = $this->workedSecondsFor($record, $basis);
                $required = $this->requiredSecondsFor($occurrence, $basis);

                if ($required !== null && $required > 0 && $worked >= $required) {
                    continue;
                }
            }

            $candidates[] = ['date' => $date, 'late_seconds' => $lateSeconds];
        }

        return $candidates;
    }

    /**
     * Has the late rule been breached, counting only what survived exemptions?
     *
     * Reached only when today itself is a countable incident, so the counts are
     * always at least one and a threshold of zero cannot fire on a clean day.
     */
    private function lateRuleBreached(PenalisationPolicy $policy, int $incidents, int $seconds): bool
    {
        if ($policy->late_rule_type === PenalisationPolicy::LATE_RULE_HOURS) {
            return $seconds >= (int) round((float) $policy->late_threshold * 3600);
        }

        return $incidents >= (int) round((float) $policy->late_threshold);
    }

    /**
     * The first rung the day falls BELOW, or null when it cleared them all.
     *
     * halfDayRules() is ordered by sort_order then percent, so the lowest band
     * is tested first and the harshest applicable rung wins — [{25, 1.00},
     * {50, 0.50}] gives a full day under a quarter and a half under a half.
     */
    private function rungFor(PenalisationPolicy $policy, int $percentHundredths): ?PenalisationHalfDayRule
    {
        foreach ($policy->halfDayRules()->get() as $rule) {
            $rung = (int) round((float) $rule->percent_of_shift_hours * 100);

            if ($percentHundredths < $rung) {
                return $rule;
            }
        }

        return null;
    }

    /** @return array{0: int, 1: string} minutes, and where they came from */
    private function graceFor(?PenalisationPolicy $policy, ?Shift $shift): array
    {
        if ($policy) {
            return [max(0, (int) $policy->grace_period_minutes), 'policy'];
        }

        if ($shift) {
            return [max(0, (int) ($shift->grace_period_minutes ?? 0)), 'shift'];
        }

        return [0, 'none'];
    }

    private function lateSecondsFor(ShiftOccurrence $occurrence, ?Carbon $arrivedAt): int
    {
        if (! $arrivedAt) {
            // Never arriving is an absence, not a late arrival. The hours rules
            // are what have something to say about it.
            return 0;
        }

        return max(0, (int) $occurrence->shiftStartAt->diffInSeconds($arrivedAt, false));
    }

    /**
     * Hours worked on the policy's basis.
     *
     * EFFECTIVE is the work clock: worked_seconds plus any manual adjustment,
     * which is what AttendanceService writes and already excludes breaks.
     * GROSS is the span from first punch-in to last punch-out, breaks included.
     *
     * A day with no punch-out has no span to measure, so the gross reading
     * falls back to the effective clock and says so in workedSecondsSource
     * rather than silently reporting zero hours for someone still at work.
     *
     * @return array{0: int, 1: string}
     */
    private function workedSecondsFor(?AttendanceRecord $record, string $basis): array
    {
        if (! $record) {
            return [0, 'effective_clock'];
        }

        $effective = max(0, (int) ($record->worked_seconds ?? 0) + (int) ($record->manual_adjustment_seconds ?? 0));

        if ($basis !== PenalisationPolicy::BASIS_GROSS) {
            return [$effective, 'effective_clock'];
        }

        if ($record->check_in_at && $record->check_out_at) {
            return [max(0, (int) $record->check_in_at->diffInSeconds($record->check_out_at, false)), 'gross_span'];
        }

        return [$effective, 'effective_clock'];
    }

    /**
     * The denominator: how long this shift was supposed to be, on the same
     * basis the numerator was measured on.
     *
     * The two genuinely differ — a 09:00–18:00 shift with an hour's break is
     * nine gross hours and eight effective ones — and mixing them turns a full
     * day into an 88% day. Null when no shift pattern is resolved, because
     * inventing a length is the exact failure ShiftResolver refuses to make.
     */
    private function requiredSecondsFor(ShiftOccurrence $occurrence, string $basis): ?int
    {
        $shift = $occurrence->shift;

        if (! $shift) {
            return $occurrence->expectedSeconds;
        }

        return $basis === PenalisationPolicy::BASIS_GROSS
            ? $shift->spanMinutes() * 60
            : $shift->expectedWorkSeconds();
    }

    /** @return array{0: string, 1: string} cycle start and end, Y-m-d */
    private function cycleWindow(PenalisationPolicy $policy, Carbon $on): array
    {
        if ($policy->cycle === PenalisationPolicy::CYCLE_WEEKLY) {
            return [
                $on->copy()->startOfWeek(self::WEEK_STARTS_ON)->toDateString(),
                $on->copy()->endOfWeek(self::WEEK_STARTS_ON === Carbon::MONDAY ? Carbon::SUNDAY : Carbon::SATURDAY)
                    ->toDateString(),
            ];
        }

        return [
            $on->copy()->startOfMonth()->toDateString(),
            $on->copy()->endOfMonth()->toDateString(),
        ];
    }

    private function basisFor(?PenalisationPolicy $policy): string
    {
        $basis = $policy?->hours_basis;

        return $basis === PenalisationPolicy::BASIS_GROSS
            ? PenalisationPolicy::BASIS_GROSS
            : PenalisationPolicy::BASIS_EFFECTIVE;
    }

    private function policySourceFor(?User $user, ?PenalisationPolicy $policy, ?Shift $shift): string
    {
        if ($policy) {
            $assigned = EmployeePenalisationPolicy::forOrganization((int) $user->organization_id)
                ->where('user_id', $user->id)
                ->where('penalisation_policy_id', $policy->id)
                ->where('is_active', true)
                ->exists();

            return $assigned
                ? PenalisationOutcome::SOURCE_ASSIGNMENT
                : PenalisationOutcome::SOURCE_ORGANIZATION_DEFAULT;
        }

        return $shift ? PenalisationOutcome::SOURCE_SHIFT_COLUMNS : PenalisationOutcome::SOURCE_NONE;
    }

    private function statusFor(bool $isNoShow, int $leavesHundredths, bool $isLate): string
    {
        if ($isNoShow) {
            return PenalisationOutcome::STATUS_NO_SHOW;
        }

        if ($leavesHundredths >= 100) {
            return PenalisationOutcome::STATUS_FULL_DAY;
        }

        if ($leavesHundredths > 0) {
            return PenalisationOutcome::STATUS_HALF_DAY;
        }

        return $isLate ? PenalisationOutcome::STATUS_LATE : PenalisationOutcome::STATUS_CLEAR;
    }

    private function recordFor(User $user, Carbon $on): ?AttendanceRecord
    {
        return AttendanceRecord::forOrganization((int) $user->organization_id)
            ->where('user_id', $user->id)
            ->whereDate('attendance_date', $on->toDateString())
            ->first();
    }

    /** Hundredths to a two-place decimal string, with no float in the middle. */
    private function decimalString(int $hundredths): string
    {
        $sign = $hundredths < 0 ? '-' : '';
        $hundredths = abs($hundredths);

        return sprintf('%s%d.%02d', $sign, intdiv($hundredths, 100), $hundredths % 100);
    }

    private function notEvaluated(
        Carbon $on,
        string $timezone,
        string $code,
        string $message,
        ?PenalisationPolicy $policy = null,
        ?string $policySource = null,
    ): PenalisationOutcome {
        return new PenalisationOutcome(
            attendanceDate: $on,
            timezone: $timezone,
            status: PenalisationOutcome::STATUS_NOT_EVALUATED,
            policySource: $policySource ?? PenalisationOutcome::SOURCE_NONE,
            policyId: $policy?->id,
            policyName: $policy?->name,
            hoursBasis: $this->basisFor($policy),
            gracePeriodMinutes: 0,
            graceSource: 'none',
            shiftStartAt: null,
            arrivedAt: null,
            lateSeconds: 0,
            isLate: false,
            lateWaivedBy: null,
            latePenaltyApplies: false,
            lateRuleType: $policy?->late_rule_type,
            lateThreshold: null,
            cycle: $policy?->cycle,
            cycleStart: null,
            cycleEnd: null,
            exemptionsPerCycle: 0,
            exemptionsUsedInCycle: 0,
            countableLateIncidentsInCycle: 0,
            countableLateSecondsInCycle: 0,
            workedSeconds: 0,
            workedSecondsSource: 'effective_clock',
            requiredSeconds: null,
            percentOfShiftWorked: null,
            hoursMet: false,
            isNoShow: false,
            noShowBelowHours: null,
            halfDayRuleId: null,
            halfDayRungPercent: null,
            leavesDeducted: '0.00',
            isLop: false,
            lopDays: '0.00',
            deductionSource: PenalisationOutcome::DEDUCT_FROM_NOTHING,
            reasons: [['code' => $code, 'message' => $message]],
        );
    }

    private function normalizeDate(Carbon|string|null $date, string $timezone): Carbon
    {
        if ($date instanceof Carbon) {
            return Carbon::parse($date->toDateString(), $timezone)->startOfDay();
        }

        if (is_string($date) && trim($date) !== '') {
            return Carbon::parse($date, $timezone)->startOfDay();
        }

        return Carbon::now($timezone)->startOfDay();
    }
}
