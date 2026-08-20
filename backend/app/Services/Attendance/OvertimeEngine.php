<?php

namespace App\Services\Attendance;

use App\Models\AttendanceHoliday;
use App\Models\EmployeeOvertimePolicy;
use App\Models\OvertimePolicy;
use App\Models\OvertimePolicyScope;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;

/**
 * What one day of work was worth in overtime.
 *
 * shifts.overtime_multiplier answered "what is an extra hour worth" and nothing
 * else, which is one of six decisions this has to make:
 *
 *   1. WHICH CLOCK.   Gross hours (clock-in to clock-out) or effective hours
 *                     (net of breaks). The same day is two different numbers
 *                     and the policy chooses.
 *   2. WHAT KIND OF DAY. Working day, weekly off, or public holiday. These are
 *                     three independent scopes; a holiday is not "a weekly off
 *                     with a nicer name".
 *   3. HOW MUCH IS IGNORED. minimum_minutes_before_accrual. Under it, nothing
 *                     accrues — but the raw minutes are still reported, because
 *                     "you worked it, it did not accrue" is the answer the
 *                     employee is owed.
 *   4. HOW IT ROUNDS. up, down or nearest, in rounding_increment_minutes.
 *   5. PAY OR TIME.   Each scope chooses Pay or Comp-Off on its own.
 *   6. WHETHER IT COUNTS YET. "Only approved hours will be considered." With
 *                     requires_approval on, unapproved overtime is reported
 *                     SEPARATELY as pending and never folded into a total.
 *
 * ORDER MATTERS, and it is: scope -> basis -> raw -> threshold -> rounding ->
 * rate. The rate is picked last because the extended-OT tier depends on how
 * much overtime there turned out to be, and the rounding rule is a property of
 * the policy rather than of the tier.
 *
 * THE BASELINE IS NEVER INVENTED. On a working day overtime is the excess over
 * the rostered shift; with no shift rostered there is no length to exceed, so
 * the assessment reports expectedMinutes = null and accrues nothing. Guessing
 * eight hours here would manufacture overtime out of an unconfigured roster —
 * the exact assumption ShiftResolver was built to stop spreading. On a weekly
 * off or a holiday the baseline is zero: nobody was due in, so every minute is
 * overtime.
 *
 * FALLBACK. With no policy assigned and no organization default, the shift's
 * own overtime_multiplier still answers, at no threshold, no rounding and no
 * approval gate — those are policy concepts and a bare column carries none of
 * them. That keeps every organization that has configured nothing working
 * exactly as it did before the split.
 *
 * TENANCY. Every read is pinned with forOrganization($user->organization_id).
 * The global scope is deliberately a no-op with nothing authenticated, which is
 * precisely the state a queued payroll job runs in — unpinned, this would be
 * free to read another tenant's holiday calendar and pay the holiday rate.
 */
class OvertimeEngine
{
    public function __construct(
        private readonly ShiftResolver $shifts,
        private readonly WeeklyOffResolver $weeklyOffs,
    ) {
    }

    /**
     * Assess one person's overtime on one attendance date.
     *
     * $grossMinutes and $effectiveMinutes are the two clocks for the day, as
     * measured by whatever produced the attendance record. Only the one the
     * policy asks for is read; the other is carried for the record. When
     * effective minutes were never measured, gross stands in for them — an
     * under-measured clock is a wrong answer, but inventing a break length to
     * subtract would be a wrong answer nobody could see.
     *
     * $expectedMinutes overrides the rostered baseline for a caller that has
     * already resolved one (a payroll run walking a month it has occurrences
     * for). It is ignored on a weekly off or a holiday, where the baseline is
     * zero by definition.
     *
     * $approved is the approval decision that was actually recorded. It only
     * matters when the policy requires approval.
     */
    public function evaluate(
        ?User $user,
        Carbon|string|null $date = null,
        int $grossMinutes = 0,
        ?int $effectiveMinutes = null,
        bool $approved = false,
        ?int $expectedMinutes = null,
    ): OvertimeAssessment {
        $on = $this->normalizeDate($date);

        if (! $user || ! $user->organization_id) {
            return $this->nothing($on, $grossMinutes);
        }

        $policy = $this->policyFor($user, $on);
        $basis = $this->basisFor($policy);
        $scope = $this->scopeFor($user, $on);

        $worked = max(0, $basis === OvertimePolicy::BASIS_EFFECTIVE
            ? ($effectiveMinutes ?? $grossMinutes)
            : $grossMinutes);

        $expected = $scope === OvertimePolicyScope::SCOPE_WORKING_DAY
            // A negative override is meaningless; treat it as unset rather than
            // as a baseline that manufactures overtime.
            ? (($expectedMinutes !== null && $expectedMinutes >= 0)
                ? $expectedMinutes
                : $this->expectedMinutesFor($user, $on, $basis))
            : 0;

        $raw = $expected === null ? 0 : max(0, $worked - $expected);

        $minimum = max(0, (int) ($policy?->minimum_minutes_before_accrual ?? 0));
        $qualifying = ($raw > 0 && $raw >= $minimum) ? $raw : 0;

        $rounded = $policy
            ? $this->round($qualifying, (string) $policy->rounding, (int) $policy->rounding_increment_minutes)
            : $qualifying;

        $rate = $policy ? $this->rateFor($user, $policy, $scope, $on, $rounded) : null;
        $shiftMultiplier = $this->shiftMultiplierFor($user, $on);

        [$multiplier, $multiplierSource] = match (true) {
            $rate !== null => [
                $this->decimal((string) $rate->multiplier),
                OvertimeAssessment::MULTIPLIER_FROM_POLICY_SCOPE,
            ],
            $shiftMultiplier !== null => [$shiftMultiplier, OvertimeAssessment::MULTIPLIER_FROM_SHIFT],
            default => ['1.00', OvertimeAssessment::MULTIPLIER_FROM_DEFAULT],
        };

        return new OvertimeAssessment(
            attendanceDate: $on,
            scope: $scope,
            treatment: $rate?->treatment ?? OvertimePolicyScope::TREATMENT_PAY,
            multiplier: $multiplier,
            basis: $basis,
            workedMinutes: $worked,
            expectedMinutes: $expected,
            rawMinutes: $raw,
            qualifyingMinutes: $qualifying,
            roundedMinutes: $rounded,
            approvalState: $this->approvalState($policy, $approved),
            source: match (true) {
                $policy !== null => OvertimeAssessment::SOURCE_POLICY,
                $shiftMultiplier !== null => OvertimeAssessment::SOURCE_SHIFT,
                default => OvertimeAssessment::SOURCE_NONE,
            },
            policyId: $policy?->id !== null ? (int) $policy->id : null,
            scopeRateId: $rate?->id !== null ? (int) $rate->id : null,
            multiplierSource: $multiplierSource,
        );
    }

    /**
     * Which kind of day this is, for this person.
     *
     * A holiday outranks a weekly off. When a public holiday lands on a Sunday
     * the day is still the holiday — that is the rate an employer publishes and
     * the one an employee expects, and it is the higher of the two often enough
     * that resolving it the other way would quietly underpay.
     */
    public function scopeFor(?User $user, Carbon|string|null $date = null): string
    {
        $on = $this->normalizeDate($date);

        if ($this->isHoliday($user, $on)) {
            return OvertimePolicyScope::SCOPE_HOLIDAY;
        }

        if ($this->weeklyOffs->isWeeklyOff($user, $on)) {
            return OvertimePolicyScope::SCOPE_WEEKLY_OFF;
        }

        return OvertimePolicyScope::SCOPE_WORKING_DAY;
    }

    /**
     * The overtime policy in force for this person on this date.
     *
     * Assignment first (effective-dated, latest window wins), then the
     * organization's default, then null — the same order as every other
     * working-time policy, and the same order as ShiftResolver.
     */
    public function policyFor(?User $user, Carbon|string|null $date = null): ?OvertimePolicy
    {
        if (! $user || ! $user->organization_id) {
            return null;
        }

        $organizationId = (int) $user->organization_id;
        $assignment = $this->assignmentFor($user, $date);

        if ($assignment) {
            $policy = OvertimePolicy::forOrganization($organizationId)
                ->where('is_active', true)
                ->find($assignment->overtime_policy_id);

            if ($policy) {
                return $policy;
            }
        }

        return OvertimePolicy::forOrganization($organizationId)
            ->where('is_active', true)
            ->where('is_default', true)
            ->orderByDesc('id')
            ->first();
    }

    /** The assignment row in force on the date, policy usable or not. */
    public function assignmentFor(User $user, Carbon|string|null $date = null): ?EmployeeOvertimePolicy
    {
        if (! $user->organization_id) {
            return null;
        }

        $on = $this->normalizeDate($date)->toDateString();

        return EmployeeOvertimePolicy::forOrganization((int) $user->organization_id)
            ->where('user_id', $user->id)
            ->where('is_active', true)
            ->whereDate('effective_from', '<=', $on)
            ->where(function (Builder $window) use ($on) {
                $window->whereNull('effective_to')
                    ->orWhereDate('effective_to', '>=', $on);
            })
            // Latest window wins; id breaks a same-day tie deterministically.
            ->orderByDesc('effective_from')
            ->orderByDesc('id')
            ->first();
    }

    /**
     * The rate row for this scope, at this quantity of overtime, on this date.
     *
     * Three filters, and each one is a separate real rule:
     *   scope                  working day / weekly off / holiday.
     *   applies_after_minutes  the extended-OT tier. The highest tier the
     *                          overtime has actually reached wins; 0 is the
     *                          base tier.
     *   effective_from/to      a validity window for a seasonal rate. Null on
     *                          either end is open, and a window that does not
     *                          contain the date must not leak into it.
     */
    public function rateFor(
        User $user,
        OvertimePolicy $policy,
        string $scope,
        Carbon|string|null $date = null,
        int $overtimeMinutes = 0,
    ): ?OvertimePolicyScope {
        $on = $this->normalizeDate($date)->toDateString();

        return OvertimePolicyScope::forOrganization((int) $user->organization_id)
            ->where('overtime_policy_id', $policy->id)
            ->where('scope', $scope)
            ->where('applies_after_minutes', '<=', max(0, $overtimeMinutes))
            ->where(function (Builder $window) use ($on) {
                $window->whereNull('effective_from')
                    ->orWhereDate('effective_from', '<=', $on);
            })
            ->where(function (Builder $window) use ($on) {
                $window->whereNull('effective_to')
                    ->orWhereDate('effective_to', '>=', $on);
            })
            ->orderByDesc('applies_after_minutes')
            ->orderByDesc('id')
            ->first();
    }

    /**
     * Rounding, in whole minutes and integer arithmetic.
     *
     * A value already sitting exactly on the increment must not move in ANY
     * direction — that is the case a ceil()/floor() mix-up passes half the
     * time. "nearest" breaks a tie upward, the convention every payroll rounding
     * rule in this market uses.
     *
     * An increment of one or less is the identity, which is what a policy
     * configured not to round means.
     */
    public function round(int $minutes, string $rounding, int $increment): int
    {
        if ($minutes <= 0 || $increment <= 1) {
            return max(0, $minutes);
        }

        $whole = intdiv($minutes, $increment);
        $remainder = $minutes % $increment;

        if ($remainder === 0) {
            return $minutes;
        }

        return match (strtolower(trim($rounding))) {
            OvertimePolicy::ROUNDING_UP => ($whole + 1) * $increment,
            OvertimePolicy::ROUNDING_DOWN => $whole * $increment,
            // Half up: 37 of 15 stays 30, 38 becomes 45.
            default => ($remainder * 2 >= $increment) ? ($whole + 1) * $increment : $whole * $increment,
        };
    }

    /**
     * The rostered baseline for a working day, on the requested clock.
     *
     * Gross reads the shift's whole span; effective reads the span less the
     * unpaid break. Null when nothing is rostered — see the class docblock on
     * why that is not silently turned into eight hours.
     */
    private function expectedMinutesFor(User $user, Carbon $on, string $basis): ?int
    {
        $resolved = $this->shifts->resolve($user, $on->toDateString());

        if (! $resolved) {
            return null;
        }

        if ($basis === OvertimePolicy::BASIS_GROSS) {
            return $resolved->shift?->spanMinutes();
        }

        return $resolved->expectedSeconds !== null
            ? intdiv($resolved->expectedSeconds, 60)
            : null;
    }

    /**
     * shifts.overtime_multiplier, as a decimal string, or null when no shift is
     * rostered on the date.
     */
    private function shiftMultiplierFor(User $user, Carbon $on): ?string
    {
        $multiplier = $this->shifts->resolve($user, $on->toDateString())?->shift?->overtime_multiplier;

        return $multiplier === null ? null : $this->decimal((string) $multiplier);
    }

    /**
     * Is this a public holiday for this person?
     *
     * Country matters: attendance_holidays is shared across regions and carries
     * a country per row, so an India employee must not read a USA holiday and
     * have an ordinary working day reclassified. 'ALL' rows apply to everyone.
     * The employee's own settings decide first, then the organization's — the
     * same order the attendance calendar uses.
     */
    private function isHoliday(?User $user, Carbon $on): bool
    {
        if (! $user || ! $user->organization_id) {
            return false;
        }

        $country = AttendanceHoliday::countryForSettings(
            is_array($user->settings) ? $user->settings : []
        );

        if ($country === 'ALL') {
            $country = AttendanceHoliday::countryForSettings(
                is_array($user->organization?->settings) ? $user->organization->settings : []
            );
        }

        return AttendanceHoliday::forOrganization((int) $user->organization_id)
            ->whereDate('holiday_date', $on->toDateString())
            ->whereIn('country', array_unique(['ALL', $country]))
            ->exists();
    }

    private function basisFor(?OvertimePolicy $policy): string
    {
        $basis = strtolower(trim((string) ($policy?->hours_basis ?? '')));

        return $basis === OvertimePolicy::BASIS_EFFECTIVE
            ? OvertimePolicy::BASIS_EFFECTIVE
            // Gross is the fallback because it is the only clock a shift column
            // can speak for: a bare multiplier says nothing about breaks.
            : OvertimePolicy::BASIS_GROSS;
    }

    private function approvalState(?OvertimePolicy $policy, bool $approved): string
    {
        if (! $policy || ! $policy->requires_approval) {
            return OvertimeAssessment::APPROVAL_NOT_REQUIRED;
        }

        return $approved
            ? OvertimeAssessment::APPROVAL_APPROVED
            : OvertimeAssessment::APPROVAL_PENDING;
    }

    /** An assessment for someone the engine cannot place: zero, and honest about it. */
    private function nothing(Carbon $on, int $grossMinutes): OvertimeAssessment
    {
        return new OvertimeAssessment(
            attendanceDate: $on,
            scope: OvertimePolicyScope::SCOPE_WORKING_DAY,
            treatment: OvertimePolicyScope::TREATMENT_PAY,
            multiplier: '1.00',
            basis: OvertimePolicy::BASIS_GROSS,
            workedMinutes: max(0, $grossMinutes),
            expectedMinutes: null,
            rawMinutes: 0,
            qualifyingMinutes: 0,
            roundedMinutes: 0,
            approvalState: OvertimeAssessment::APPROVAL_NOT_REQUIRED,
            source: OvertimeAssessment::SOURCE_NONE,
        );
    }

    /** Two decimal places, as a string. Rates never become floats here. */
    private function decimal(string $value): string
    {
        $trimmed = trim($value);

        return is_numeric($trimmed) ? bcadd($trimmed, '0', 2) : '1.00';
    }

    private function normalizeDate(Carbon|string|null $date): Carbon
    {
        if ($date instanceof Carbon) {
            // Y-m-d only: "the 19th" must not become the 18th because the
            // caller's clock was behind the employee's.
            return Carbon::parse($date->toDateString())->startOfDay();
        }

        if (is_string($date) && trim($date) !== '') {
            return Carbon::parse($date)->startOfDay();
        }

        return Carbon::now()->startOfDay();
    }
}
