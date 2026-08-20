<?php

namespace Tests\Unit;

use App\Models\AttendanceRecord;
use App\Models\EmployeePenalisationPolicy;
use App\Models\EmployeeShift;
use App\Models\Organization;
use App\Models\PenalisationHalfDayRule;
use App\Models\PenalisationPolicy;
use App\Models\Shift;
use App\Models\User;
use App\Services\Attendance\PenalisationEngine;
use App\Services\Attendance\PenalisationOutcome;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The penalisation engine decides what a day COSTS, and has to be able to say
 * why in a sentence a manager can put in front of the person it happened to.
 *
 * Every boundary in here is a decision, not an accident, and each one is pinned
 * by a test that sits exactly on it:
 *
 *   - Arriving exactly ON the grace minute is NOT late. The documented wording
 *     is "minutes before penalisation starts", so penalisation starts after it.
 *   - Working exactly the rung percentage does NOT trigger that rung. The rule
 *     is "the first band the day falls BELOW", so 50.00% of an 8h shift is a
 *     full day, and 49.99% is the half.
 *   - Working exactly the no-show hours is NOT a no-show, for the same reason:
 *     "less than X hours".
 *
 * The other half is that a bare boolean is useless. A day that comes back
 * "half day" without "worked 3h12m of 8h00m, 40.00%, below the 50% rung" cannot
 * be argued with, and attendance penalties are argued with constantly.
 */
class PenalisationEngineTest extends TestCase
{
    use RefreshDatabase;

    private const TZ = 'Asia/Kolkata';

    private function engine(): PenalisationEngine
    {
        return app(PenalisationEngine::class);
    }

    private function organization(string $name, string $slug): Organization
    {
        return Organization::create(['name' => $name, 'slug' => $slug]);
    }

    private function employee(Organization $organization, string $email): User
    {
        return User::create([
            'name' => 'Employee',
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);
    }

    /**
     * A 09:00–18:00 shift with a one-hour break: nine hours gross, eight hours
     * effective. Every percentage in this file is against that eight.
     *
     * @param array<string, mixed> $attributes
     */
    private function shift(Organization $organization, array $attributes = []): Shift
    {
        return Shift::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $organization->id,
            'name' => 'General',
            'code' => 'GEN'.$organization->id,
            'type' => 'general',
            'start_time' => '09:00:00',
            'end_time' => '18:00:00',
            'duration_minutes' => 540,
            'break_duration_minutes' => 60,
            'grace_period_minutes' => 0,
            'is_active' => true,
        ], $attributes));
    }

    private function assignShift(User $user, Shift $shift): EmployeeShift
    {
        return EmployeeShift::withoutOrganizationScope()->create([
            'organization_id' => $shift->organization_id,
            'user_id' => $user->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-01-01',
            'effective_to' => null,
            'is_active' => true,
        ]);
    }

    /** @param array<string, mixed> $attributes */
    private function policy(Organization $organization, array $attributes = []): PenalisationPolicy
    {
        return PenalisationPolicy::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $organization->id,
            'name' => 'Standard '.uniqid(),
            'grace_period_minutes' => 15,
            'late_rule_type' => PenalisationPolicy::LATE_RULE_INCIDENT,
            'late_threshold' => 3,
            'exemptions_per_cycle' => 0,
            'cycle' => PenalisationPolicy::CYCLE_MONTHLY,
            'ignore_late_when_hours_met' => false,
            'hours_basis' => PenalisationPolicy::BASIS_EFFECTIVE,
            'no_show_below_hours' => null,
            'treat_penalties_as_lop' => false,
            'is_active' => true,
        ], $attributes));
    }

    private function assignPolicy(User $user, PenalisationPolicy $policy): EmployeePenalisationPolicy
    {
        return EmployeePenalisationPolicy::withoutOrganizationScope()->create([
            'organization_id' => $policy->organization_id,
            'user_id' => $user->id,
            'penalisation_policy_id' => $policy->id,
            'effective_from' => '2026-01-01',
            'effective_to' => null,
            'is_active' => true,
        ]);
    }

    /** @param array<string, mixed> $rungs percent => leaves */
    private function ladder(PenalisationPolicy $policy, array $rungs): void
    {
        $order = 0;

        foreach ($rungs as $percent => $leaves) {
            PenalisationHalfDayRule::withoutOrganizationScope()->create([
                'organization_id' => $policy->organization_id,
                'penalisation_policy_id' => $policy->id,
                'sort_order' => $order++,
                'percent_of_shift_hours' => $percent,
                'leaves_deducted' => $leaves,
            ]);
        }
    }

    /**
     * A day of attendance. $checkIn is a wall-clock string read in the
     * employee's zone; $workedSeconds is the effective clock (breaks already
     * out), matching what AttendanceService writes.
     */
    private function record(
        User $user,
        string $date,
        ?string $checkIn = null,
        int $workedSeconds = 0,
        ?string $checkOut = null,
    ): AttendanceRecord {
        return AttendanceRecord::withoutOrganizationScope()->create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'attendance_date' => $date,
            'check_in_at' => $checkIn ? Carbon::parse($date.' '.$checkIn, self::TZ) : null,
            'check_out_at' => $checkOut ? Carbon::parse($date.' '.$checkOut, self::TZ) : null,
            'worked_seconds' => $workedSeconds,
            'status' => 'present',
        ]);
    }

    // -----------------------------------------------------------------
    // Grace
    // -----------------------------------------------------------------

    public function test_arriving_exactly_on_the_grace_minute_is_not_late(): void
    {
        $org = $this->organization('Grace', 'grace');
        $user = $this->employee($org, 'grace@example.com');
        $this->assignShift($user, $this->shift($org));
        $this->assignPolicy($user, $this->policy($org, ['grace_period_minutes' => 15]));

        // 09:15:00 on the nose against a 09:00 start and a 15 minute grace.
        $this->record($user, '2026-08-19', '09:15:00', 28800, '18:15:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame(900, $outcome->lateSeconds);
        $this->assertFalse($outcome->isLate, 'Exactly on the grace minute must not be late.');
        $this->assertSame(PenalisationOutcome::STATUS_CLEAR, $outcome->status);
    }

    public function test_one_second_past_the_grace_minute_is_late(): void
    {
        $org = $this->organization('Grace2', 'grace2');
        $user = $this->employee($org, 'grace2@example.com');
        $this->assignShift($user, $this->shift($org));
        $this->assignPolicy($user, $this->policy($org, ['grace_period_minutes' => 15]));

        $this->record($user, '2026-08-19', '09:15:01', 28800, '18:15:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame(901, $outcome->lateSeconds);
        $this->assertTrue($outcome->isLate);
    }

    public function test_with_no_policy_assigned_grace_falls_back_to_the_shift_column(): void
    {
        $org = $this->organization('Fallback', 'fallback');
        $user = $this->employee($org, 'fallback@example.com');
        $this->assignShift($user, $this->shift($org, ['grace_period_minutes' => 10]));

        $this->record($user, '2026-08-19', '09:12:00', 28800, '18:12:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame(PenalisationOutcome::SOURCE_SHIFT_COLUMNS, $outcome->policySource);
        $this->assertSame('shift', $outcome->graceSource);
        $this->assertSame(10, $outcome->gracePeriodMinutes);
        $this->assertTrue($outcome->isLate);

        // A shift column can say someone was late. It cannot say what that
        // costs — there is no threshold, no ladder and no LOP switch on a
        // shift — so nothing is ever penalised on the fallback path.
        $this->assertFalse($outcome->latePenaltyApplies);
        $this->assertSame('0.00', $outcome->leavesDeducted);
        $this->assertFalse($outcome->isLop);
    }

    public function test_an_assigned_policy_overrides_the_shift_grace_column(): void
    {
        $org = $this->organization('Override', 'override');
        $user = $this->employee($org, 'override@example.com');
        $this->assignShift($user, $this->shift($org, ['grace_period_minutes' => 60]));
        $this->assignPolicy($user, $this->policy($org, ['grace_period_minutes' => 5]));

        $this->record($user, '2026-08-19', '09:30:00', 28800, '18:30:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame('policy', $outcome->graceSource);
        $this->assertSame(5, $outcome->gracePeriodMinutes);
        $this->assertTrue($outcome->isLate, 'The shift would have forgiven this; the policy does not.');
    }

    // -----------------------------------------------------------------
    // The half-day ladder
    // -----------------------------------------------------------------

    public function test_the_ladder_deducts_a_half_day_on_the_fifty_percent_rung(): void
    {
        $org = $this->organization('Ladder', 'ladder');
        $user = $this->employee($org, 'ladder@example.com');
        $this->assignShift($user, $this->shift($org));
        $policy = $this->policy($org);
        $this->ladder($policy, ['25.00' => '1.00', '50.00' => '0.50']);
        $this->assignPolicy($user, $policy);

        // 3h12m of an 8h effective shift = 40.00%.
        $this->record($user, '2026-08-19', '09:00:00', 11520, '12:12:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame('40.00', $outcome->percentOfShiftWorked);
        $this->assertSame('50.00', $outcome->halfDayRungPercent);
        $this->assertSame('0.50', $outcome->leavesDeducted);
        $this->assertSame(PenalisationOutcome::STATUS_HALF_DAY, $outcome->status);
    }

    public function test_the_ladder_deducts_a_full_day_on_the_lowest_rung(): void
    {
        $org = $this->organization('Ladder2', 'ladder2');
        $user = $this->employee($org, 'ladder2@example.com');
        $this->assignShift($user, $this->shift($org));
        $policy = $this->policy($org);
        $this->ladder($policy, ['25.00' => '1.00', '50.00' => '0.50']);
        $this->assignPolicy($user, $policy);

        // One hour of eight = 12.50%, under the 25% rung.
        $this->record($user, '2026-08-19', '09:00:00', 3600, '10:00:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame('12.50', $outcome->percentOfShiftWorked);
        $this->assertSame('25.00', $outcome->halfDayRungPercent);
        $this->assertSame('1.00', $outcome->leavesDeducted);
        $this->assertSame(PenalisationOutcome::STATUS_FULL_DAY, $outcome->status);
    }

    public function test_working_exactly_the_rung_percentage_is_a_full_day(): void
    {
        $org = $this->organization('Ladder3', 'ladder3');
        $user = $this->employee($org, 'ladder3@example.com');
        $this->assignShift($user, $this->shift($org));
        $policy = $this->policy($org);
        $this->ladder($policy, ['25.00' => '1.00', '50.00' => '0.50']);
        $this->assignPolicy($user, $policy);

        // Exactly four hours of eight = 50.00%. The rule is "the first band the
        // day falls BELOW", and 50.00 is not below 50.00.
        $this->record($user, '2026-08-19', '09:00:00', 14400, '13:00:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame('50.00', $outcome->percentOfShiftWorked);
        $this->assertNull($outcome->halfDayRungPercent);
        $this->assertSame('0.00', $outcome->leavesDeducted);
        $this->assertSame(PenalisationOutcome::STATUS_CLEAR, $outcome->status);
    }

    public function test_one_second_under_the_rung_percentage_is_a_half_day(): void
    {
        $org = $this->organization('Ladder4', 'ladder4');
        $user = $this->employee($org, 'ladder4@example.com');
        $this->assignShift($user, $this->shift($org));
        $policy = $this->policy($org);
        $this->ladder($policy, ['25.00' => '1.00', '50.00' => '0.50']);
        $this->assignPolicy($user, $policy);

        $this->record($user, '2026-08-19', '09:00:00', 14399, '13:00:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame('50.00', $outcome->halfDayRungPercent);
        $this->assertSame('0.50', $outcome->leavesDeducted);
    }

    public function test_a_full_shift_climbs_no_rung_at_all(): void
    {
        $org = $this->organization('Ladder5', 'ladder5');
        $user = $this->employee($org, 'ladder5@example.com');
        $this->assignShift($user, $this->shift($org));
        $policy = $this->policy($org);
        $this->ladder($policy, ['25.00' => '1.00', '50.00' => '0.50']);
        $this->assignPolicy($user, $policy);

        $this->record($user, '2026-08-19', '09:00:00', 28800, '18:00:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame('100.00', $outcome->percentOfShiftWorked);
        $this->assertNull($outcome->halfDayRuleId);
        $this->assertSame('0.00', $outcome->leavesDeducted);
    }

    public function test_the_gross_basis_measures_against_the_shift_span_including_the_break(): void
    {
        $org = $this->organization('Gross', 'gross');
        $user = $this->employee($org, 'gross@example.com');
        $this->assignShift($user, $this->shift($org));
        $policy = $this->policy($org, ['hours_basis' => PenalisationPolicy::BASIS_GROSS]);
        $this->ladder($policy, ['50.00' => '0.50']);
        $this->assignPolicy($user, $policy);

        // Present 09:00–14:24, five hours 24 minutes of a NINE hour span = 60%.
        // On the effective basis the same day would be 5h24m of eight = 67.5%;
        // both are above their own rung, but the required denominator has to be
        // the one the policy asked for.
        $this->record($user, '2026-08-19', '09:00:00', 19440, '14:24:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame(32400, $outcome->requiredSeconds, 'Gross basis measures the whole span.');
        $this->assertSame('60.00', $outcome->percentOfShiftWorked);
    }

    // -----------------------------------------------------------------
    // No show
    // -----------------------------------------------------------------

    public function test_no_show_when_worked_hours_fall_below_the_threshold(): void
    {
        $org = $this->organization('NoShow', 'noshow');
        $user = $this->employee($org, 'noshow@example.com');
        $this->assignShift($user, $this->shift($org));
        $policy = $this->policy($org, ['no_show_below_hours' => '4.00', 'treat_penalties_as_lop' => true]);
        $this->assignPolicy($user, $policy);

        $this->record($user, '2026-08-19', '09:00:00', 10800, '12:00:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertTrue($outcome->isNoShow);
        $this->assertSame(PenalisationOutcome::STATUS_NO_SHOW, $outcome->status);
        $this->assertSame('1.00', $outcome->leavesDeducted);
        $this->assertTrue($outcome->isLop);
        $this->assertSame('1.00', $outcome->lopDays);
    }

    public function test_working_exactly_the_no_show_hours_is_not_a_no_show(): void
    {
        $org = $this->organization('NoShow2', 'noshow2');
        $user = $this->employee($org, 'noshow2@example.com');
        $this->assignShift($user, $this->shift($org));
        $this->assignPolicy($user, $this->policy($org, ['no_show_below_hours' => '4.00']));

        $this->record($user, '2026-08-19', '09:00:00', 14400, '13:00:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertFalse($outcome->isNoShow, '"less than X hours" — exactly X is not less than X.');
    }

    public function test_a_null_no_show_threshold_means_the_rule_is_not_run_at_all(): void
    {
        $org = $this->organization('NoShow3', 'noshow3');
        $user = $this->employee($org, 'noshow3@example.com');
        $this->assignShift($user, $this->shift($org));
        $this->assignPolicy($user, $this->policy($org, ['no_show_below_hours' => null]));

        // Zero hours worked. With no threshold configured this is still not a
        // no-show — "not configured" is a different fact from "a threshold of
        // zero", which is why the column is nullable.
        $this->record($user, '2026-08-19', null, 0, null);

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertFalse($outcome->isNoShow);
        $this->assertNull($outcome->noShowBelowHours);
    }

    // -----------------------------------------------------------------
    // Late rules, exemptions and the cycle
    // -----------------------------------------------------------------

    public function test_an_incident_rule_penalises_only_once_the_threshold_is_reached(): void
    {
        $org = $this->organization('Incident', 'incident');
        $user = $this->employee($org, 'incident@example.com');
        $this->assignShift($user, $this->shift($org));
        $this->assignPolicy($user, $this->policy($org, [
            'grace_period_minutes' => 10,
            'late_rule_type' => PenalisationPolicy::LATE_RULE_INCIDENT,
            'late_threshold' => 3,
            'exemptions_per_cycle' => 0,
        ]));

        $this->record($user, '2026-08-03', '09:30:00', 28800, '18:30:00');
        $this->record($user, '2026-08-04', '09:30:00', 28800, '18:30:00');
        $this->record($user, '2026-08-05', '09:30:00', 28800, '18:30:00');

        $first = $this->engine()->evaluate($user, '2026-08-03');
        $second = $this->engine()->evaluate($user, '2026-08-04');
        $third = $this->engine()->evaluate($user, '2026-08-05');

        $this->assertTrue($first->isLate);
        $this->assertFalse($first->latePenaltyApplies);
        $this->assertSame(1, $first->countableLateIncidentsInCycle);

        $this->assertFalse($second->latePenaltyApplies);
        $this->assertSame(2, $second->countableLateIncidentsInCycle);

        $this->assertTrue($third->latePenaltyApplies, 'The third late arrival reaches a threshold of 3.');
        $this->assertSame(3, $third->countableLateIncidentsInCycle);
    }

    public function test_the_exemption_count_resets_at_the_cycle_boundary(): void
    {
        $org = $this->organization('Cycle', 'cycle');
        $user = $this->employee($org, 'cycle@example.com');
        $this->assignShift($user, $this->shift($org));
        $this->assignPolicy($user, $this->policy($org, [
            'grace_period_minutes' => 10,
            'late_rule_type' => PenalisationPolicy::LATE_RULE_INCIDENT,
            'late_threshold' => 1,
            'exemptions_per_cycle' => 1,
            'cycle' => PenalisationPolicy::CYCLE_MONTHLY,
        ]));

        $this->record($user, '2026-08-03', '09:30:00', 28800, '18:30:00');
        $this->record($user, '2026-08-04', '09:30:00', 28800, '18:30:00');
        $this->record($user, '2026-09-01', '09:30:00', 28800, '18:30:00');

        $augustFirstLate = $this->engine()->evaluate($user, '2026-08-03');
        $augustSecondLate = $this->engine()->evaluate($user, '2026-08-04');
        $septemberFirstLate = $this->engine()->evaluate($user, '2026-09-01');

        $this->assertTrue($augustFirstLate->isLate);
        $this->assertSame('cycle_exemption', $augustFirstLate->lateWaivedBy);
        $this->assertFalse($augustFirstLate->latePenaltyApplies);

        $this->assertNull($augustSecondLate->lateWaivedBy);
        $this->assertTrue($augustSecondLate->latePenaltyApplies);

        // New month, fresh allowance — the September late is the first of its
        // own cycle and August's two are not in the window at all.
        $this->assertSame('2026-09-01', $septemberFirstLate->cycleStart);
        $this->assertSame('cycle_exemption', $septemberFirstLate->lateWaivedBy);
        $this->assertFalse($septemberFirstLate->latePenaltyApplies);
    }

    /**
     * An exemption is a WAIVED incident, and a waived incident must not also be
     * counted toward the threshold — otherwise the allowance is a delay rather
     * than a forgiveness, and a policy of "two free lates, penalise on two
     * countable ones" would fire on the third late instead of the fourth.
     *
     * Threshold and exemptions are deliberately BOTH 2 here. Every test above
     * that touches exemptions uses a threshold of 1, where the exempt days
     * being counted or not makes no difference to the verdict — this is the
     * shape that separates them.
     */
    public function test_exempt_late_arrivals_do_not_count_toward_the_incident_threshold(): void
    {
        $org = $this->organization('Allowance', 'allowance');
        $user = $this->employee($org, 'allowance@example.com');
        $this->assignShift($user, $this->shift($org));
        $this->assignPolicy($user, $this->policy($org, [
            'grace_period_minutes' => 10,
            'late_rule_type' => PenalisationPolicy::LATE_RULE_INCIDENT,
            'late_threshold' => 2,
            'exemptions_per_cycle' => 2,
            'cycle' => PenalisationPolicy::CYCLE_MONTHLY,
        ]));

        foreach (['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'] as $date) {
            $this->record($user, $date, '09:30:00', 28800, '18:30:00');
        }

        $first = $this->engine()->evaluate($user, '2026-08-03');
        $second = $this->engine()->evaluate($user, '2026-08-04');
        $third = $this->engine()->evaluate($user, '2026-08-05');
        $fourth = $this->engine()->evaluate($user, '2026-08-06');

        // The two exempt days are late, waived, and contribute nothing.
        $this->assertSame('cycle_exemption', $first->lateWaivedBy);
        $this->assertSame(0, $first->countableLateIncidentsInCycle);
        $this->assertSame('cycle_exemption', $second->lateWaivedBy);
        $this->assertSame(0, $second->countableLateIncidentsInCycle);

        // The third late is the FIRST countable one — one of a threshold of two.
        $this->assertNull($third->lateWaivedBy);
        $this->assertSame(
            1,
            $third->countableLateIncidentsInCycle,
            'The two exempt arrivals are spent, not counted.',
        );
        $this->assertFalse(
            $third->latePenaltyApplies,
            'One countable late does not reach a threshold of two.',
        );

        // The fourth is the second countable one, and reaches it.
        $this->assertSame(2, $fourth->countableLateIncidentsInCycle);
        $this->assertTrue($fourth->latePenaltyApplies);
        $this->assertSame(2, $fourth->exemptionsUsedInCycle);
    }

    /**
     * The same subtraction on the hours-based rule: the minutes lost on an
     * exempt day are forgiven too, not merely uncharged on the day itself.
     */
    public function test_exempt_late_arrivals_do_not_accumulate_toward_the_hours_threshold(): void
    {
        $org = $this->organization('Accrual', 'accrual');
        $user = $this->employee($org, 'accrual@example.com');
        $this->assignShift($user, $this->shift($org));
        $this->assignPolicy($user, $this->policy($org, [
            'grace_period_minutes' => 10,
            'late_rule_type' => PenalisationPolicy::LATE_RULE_HOURS,
            'late_threshold' => 1,
            'exemptions_per_cycle' => 2,
            'cycle' => PenalisationPolicy::CYCLE_MONTHLY,
        ]));

        // Half an hour late, four days running.
        foreach (['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'] as $date) {
            $this->record($user, $date, '09:30:00', 28800, '18:30:00');
        }

        $second = $this->engine()->evaluate($user, '2026-08-04');
        $third = $this->engine()->evaluate($user, '2026-08-05');
        $fourth = $this->engine()->evaluate($user, '2026-08-06');

        $this->assertSame(0, $second->countableLateSecondsInCycle);

        $this->assertSame(
            1800,
            $third->countableLateSecondsInCycle,
            'Only the third late arrival accumulates; the first two were exempt.',
        );
        $this->assertFalse($third->latePenaltyApplies, '30 minutes is under the one hour threshold.');

        $this->assertSame(3600, $fourth->countableLateSecondsInCycle);
        $this->assertTrue($fourth->latePenaltyApplies, 'Two countable half hours reach one hour.');
    }

    public function test_a_weekly_cycle_starts_on_monday_and_does_not_see_the_previous_week(): void
    {
        $org = $this->organization('Weekly', 'weekly');
        $user = $this->employee($org, 'weekly@example.com');
        $this->assignShift($user, $this->shift($org));
        $this->assignPolicy($user, $this->policy($org, [
            'grace_period_minutes' => 10,
            'late_threshold' => 2,
            'exemptions_per_cycle' => 0,
            'cycle' => PenalisationPolicy::CYCLE_WEEKLY,
        ]));

        // Sunday 16 Aug 2026 closes one week; Monday 17 Aug opens the next.
        $this->record($user, '2026-08-16', '09:30:00', 28800, '18:30:00');
        $this->record($user, '2026-08-17', '09:30:00', 28800, '18:30:00');

        $monday = $this->engine()->evaluate($user, '2026-08-17');

        $this->assertSame('2026-08-17', $monday->cycleStart);
        $this->assertSame('2026-08-23', $monday->cycleEnd);
        $this->assertSame(1, $monday->countableLateIncidentsInCycle, "Sunday belongs to the previous week.");
        $this->assertFalse($monday->latePenaltyApplies);
    }

    public function test_the_hours_met_escape_hatch_suppresses_the_late_penalty(): void
    {
        $org = $this->organization('Hatch', 'hatch');
        $user = $this->employee($org, 'hatch@example.com');
        $this->assignShift($user, $this->shift($org));
        $this->assignPolicy($user, $this->policy($org, [
            'grace_period_minutes' => 10,
            'late_threshold' => 1,
            'exemptions_per_cycle' => 0,
            'ignore_late_when_hours_met' => true,
        ]));

        // Half an hour late but stayed to finish the full eight hours.
        $this->record($user, '2026-08-19', '09:30:00', 28800, '18:30:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertTrue($outcome->isLate, 'The arrival was still late; the penalty is what is waived.');
        $this->assertSame('hours_met', $outcome->lateWaivedBy);
        $this->assertFalse($outcome->latePenaltyApplies);
    }

    public function test_the_hours_met_escape_hatch_does_not_burn_a_cycle_exemption(): void
    {
        $org = $this->organization('Hatch2', 'hatch2');
        $user = $this->employee($org, 'hatch2@example.com');
        $this->assignShift($user, $this->shift($org));
        $this->assignPolicy($user, $this->policy($org, [
            'grace_period_minutes' => 10,
            'late_threshold' => 1,
            'exemptions_per_cycle' => 1,
            'ignore_late_when_hours_met' => true,
        ]));

        // Late but complete — waived by the hours rule, and it must not consume
        // the one exemption the cycle allows.
        $this->record($user, '2026-08-03', '09:30:00', 28800, '18:30:00');
        // Late and short.
        $this->record($user, '2026-08-04', '09:30:00', 25200, '17:30:00');
        $this->record($user, '2026-08-05', '09:30:00', 25200, '17:30:00');

        $second = $this->engine()->evaluate($user, '2026-08-04');
        $third = $this->engine()->evaluate($user, '2026-08-05');

        $this->assertSame('cycle_exemption', $second->lateWaivedBy);
        $this->assertFalse($second->latePenaltyApplies);
        $this->assertTrue($third->latePenaltyApplies);
    }

    public function test_an_hours_based_late_rule_accumulates_lateness_across_the_cycle(): void
    {
        $org = $this->organization('Hours', 'hours');
        $user = $this->employee($org, 'hours@example.com');
        $this->assignShift($user, $this->shift($org));
        $this->assignPolicy($user, $this->policy($org, [
            'grace_period_minutes' => 0,
            'late_rule_type' => PenalisationPolicy::LATE_RULE_HOURS,
            'late_threshold' => '1.50',
            'exemptions_per_cycle' => 0,
        ]));

        // 40 + 40 = 80 minutes, still under 90. The third pushes it to 120.
        $this->record($user, '2026-08-03', '09:40:00', 28800, '18:40:00');
        $this->record($user, '2026-08-04', '09:40:00', 28800, '18:40:00');
        $this->record($user, '2026-08-05', '09:40:00', 28800, '18:40:00');

        $second = $this->engine()->evaluate($user, '2026-08-04');
        $third = $this->engine()->evaluate($user, '2026-08-05');

        $this->assertSame(4800, $second->countableLateSecondsInCycle);
        $this->assertFalse($second->latePenaltyApplies);

        $this->assertSame(7200, $third->countableLateSecondsInCycle);
        $this->assertTrue($third->latePenaltyApplies);
    }

    // -----------------------------------------------------------------
    // LOP
    // -----------------------------------------------------------------

    public function test_a_deduction_is_loss_of_pay_only_when_the_policy_says_so(): void
    {
        $org = $this->organization('Lop', 'lop');
        $user = $this->employee($org, 'lop@example.com');
        $this->assignShift($user, $this->shift($org));
        $policy = $this->policy($org, ['treat_penalties_as_lop' => false]);
        $this->ladder($policy, ['50.00' => '0.50']);
        $this->assignPolicy($user, $policy);

        $this->record($user, '2026-08-19', '09:00:00', 11520, '12:12:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame('0.50', $outcome->leavesDeducted);
        $this->assertFalse($outcome->isLop);
        $this->assertSame('0.00', $outcome->lopDays);
        $this->assertSame(PenalisationOutcome::DEDUCT_FROM_LEAVE_BALANCE, $outcome->deductionSource);
    }

    public function test_the_lop_switch_moves_the_same_deduction_off_the_leave_balance(): void
    {
        $org = $this->organization('Lop2', 'lop2');
        $user = $this->employee($org, 'lop2@example.com');
        $this->assignShift($user, $this->shift($org));
        $policy = $this->policy($org, ['treat_penalties_as_lop' => true]);
        $this->ladder($policy, ['50.00' => '0.50']);
        $this->assignPolicy($user, $policy);

        $this->record($user, '2026-08-19', '09:00:00', 11520, '12:12:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertTrue($outcome->isLop);
        $this->assertSame('0.50', $outcome->lopDays);
        $this->assertSame(PenalisationOutcome::DEDUCT_FROM_LOP, $outcome->deductionSource);
    }

    public function test_a_clear_day_deducts_from_nothing(): void
    {
        $org = $this->organization('Clear', 'clear');
        $user = $this->employee($org, 'clear@example.com');
        $this->assignShift($user, $this->shift($org));
        $policy = $this->policy($org, ['treat_penalties_as_lop' => true]);
        $this->ladder($policy, ['50.00' => '0.50']);
        $this->assignPolicy($user, $policy);

        $this->record($user, '2026-08-19', '09:00:00', 28800, '18:00:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame(PenalisationOutcome::DEDUCT_FROM_NOTHING, $outcome->deductionSource);
        $this->assertFalse($outcome->isLop);
    }

    // -----------------------------------------------------------------
    // Policy resolution
    // -----------------------------------------------------------------

    public function test_the_organization_default_applies_when_nobody_assigned_one(): void
    {
        $org = $this->organization('Default', 'default');
        $user = $this->employee($org, 'default@example.com');
        $this->assignShift($user, $this->shift($org, ['grace_period_minutes' => 60]));
        $this->policy($org, ['grace_period_minutes' => 5, 'is_default' => true]);

        $this->record($user, '2026-08-19', '09:30:00', 28800, '18:30:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame(PenalisationOutcome::SOURCE_ORGANIZATION_DEFAULT, $outcome->policySource);
        $this->assertSame(5, $outcome->gracePeriodMinutes);
    }

    public function test_the_assignment_in_force_on_the_date_is_the_one_that_applies(): void
    {
        $org = $this->organization('Effective', 'effective');
        $user = $this->employee($org, 'effective@example.com');
        $this->assignShift($user, $this->shift($org));

        $lenient = $this->policy($org, ['name' => 'Lenient', 'grace_period_minutes' => 45]);
        $strict = $this->policy($org, ['name' => 'Strict', 'grace_period_minutes' => 5]);

        EmployeePenalisationPolicy::withoutOrganizationScope()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'penalisation_policy_id' => $lenient->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);
        EmployeePenalisationPolicy::withoutOrganizationScope()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'penalisation_policy_id' => $strict->id,
            'effective_from' => '2026-08-15',
            'is_active' => true,
        ]);

        $this->record($user, '2026-08-10', '09:30:00', 28800, '18:30:00');
        $this->record($user, '2026-08-19', '09:30:00', 28800, '18:30:00');

        $before = $this->engine()->evaluate($user, '2026-08-10');
        $after = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame($lenient->id, $before->policyId);
        $this->assertFalse($before->isLate);

        $this->assertSame($strict->id, $after->policyId);
        $this->assertTrue($after->isLate);
    }

    public function test_a_policy_belonging_to_another_organization_is_never_resolved(): void
    {
        $mine = $this->organization('Mine', 'mine');
        $theirs = $this->organization('Theirs', 'theirs');

        $user = $this->employee($mine, 'mine@example.com');
        $this->assignShift($user, $this->shift($mine, ['grace_period_minutes' => 60]));

        // Another tenant's default, and another tenant's assignment naming this
        // user's id. Neither may reach across.
        $foreign = $this->policy($theirs, ['grace_period_minutes' => 0, 'is_default' => true]);
        EmployeePenalisationPolicy::withoutOrganizationScope()->create([
            'organization_id' => $theirs->id,
            'user_id' => $user->id,
            'penalisation_policy_id' => $foreign->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);

        $this->record($user, '2026-08-19', '09:30:00', 28800, '18:30:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertNull($outcome->policyId);
        $this->assertSame(PenalisationOutcome::SOURCE_SHIFT_COLUMNS, $outcome->policySource);
        $this->assertSame(60, $outcome->gracePeriodMinutes);
        $this->assertFalse($outcome->isLate);
    }

    // -----------------------------------------------------------------
    // Saying why
    // -----------------------------------------------------------------

    public function test_the_outcome_explains_itself_in_words(): void
    {
        $org = $this->organization('Explain', 'explain');
        $user = $this->employee($org, 'explain@example.com');
        $this->assignShift($user, $this->shift($org));
        $policy = $this->policy($org, ['treat_penalties_as_lop' => true]);
        $this->ladder($policy, ['25.00' => '1.00', '50.00' => '0.50']);
        $this->assignPolicy($user, $policy);

        $this->record($user, '2026-08-19', '09:00:00', 11520, '12:12:00');

        $outcome = $this->engine()->evaluate($user, '2026-08-19');
        $explanation = $outcome->explain();

        $this->assertStringContainsString('3h 12m', $explanation);
        $this->assertStringContainsString('8h 00m', $explanation);
        $this->assertStringContainsString('40.00%', $explanation);
        $this->assertStringContainsString('50.00%', $explanation);
        $this->assertStringContainsString('0.50', $explanation);
        $this->assertNotEmpty($outcome->reasons);
        $this->assertContains('half_day_rung', array_column($outcome->reasons, 'code'));
    }

    public function test_nothing_is_evaluated_when_no_shift_runs_on_the_date(): void
    {
        $org = $this->organization('NoShift', 'noshift');
        $user = $this->employee($org, 'noshift@example.com');
        $this->assignPolicy($user, $this->policy($org, ['no_show_below_hours' => '4.00']));

        $this->record($user, '2026-08-19', null, 0, null);

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame(PenalisationOutcome::STATUS_NOT_EVALUATED, $outcome->status);
        $this->assertFalse($outcome->isNoShow);
        $this->assertSame('0.00', $outcome->leavesDeducted);
        $this->assertContains('no_shift_resolved', array_column($outcome->reasons, 'code'));
    }

    public function test_a_day_the_shift_does_not_run_on_is_not_penalised(): void
    {
        $org = $this->organization('Weekend', 'weekend');
        $user = $this->employee($org, 'weekend@example.com');
        // Monday to Friday only. 2026-08-22 is a Saturday.
        $this->assignShift($user, $this->shift($org, [
            'applicable_days' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        ]));
        $policy = $this->policy($org, ['no_show_below_hours' => '4.00']);
        $this->ladder($policy, ['50.00' => '0.50']);
        $this->assignPolicy($user, $policy);

        $outcome = $this->engine()->evaluate($user, '2026-08-22');

        $this->assertSame(PenalisationOutcome::STATUS_NOT_EVALUATED, $outcome->status);
        $this->assertSame('0.00', $outcome->leavesDeducted);
    }

    public function test_a_missing_attendance_record_is_zero_hours_not_an_error(): void
    {
        $org = $this->organization('Missing', 'missing');
        $user = $this->employee($org, 'missing@example.com');
        $this->assignShift($user, $this->shift($org));
        $policy = $this->policy($org, ['no_show_below_hours' => '4.00', 'treat_penalties_as_lop' => true]);
        $this->assignPolicy($user, $policy);

        $outcome = $this->engine()->evaluate($user, '2026-08-19');

        $this->assertSame(0, $outcome->workedSeconds);
        $this->assertTrue($outcome->isNoShow);
        $this->assertSame('1.00', $outcome->lopDays);
        $this->assertFalse($outcome->isLate, 'Never arriving is an absence, not a late arrival.');
    }
}
