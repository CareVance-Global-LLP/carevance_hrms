<?php

namespace Tests\Unit;

use App\Models\AttendanceHoliday;
use App\Models\EmployeeOvertimePolicy;
use App\Models\EmployeeShift;
use App\Models\EmployeeWeeklyOffPolicy;
use App\Models\Organization;
use App\Models\OvertimePolicy;
use App\Models\OvertimePolicyScope;
use App\Models\Shift;
use App\Models\User;
use App\Models\WeeklyOffPolicy;
use App\Services\Attendance\OvertimeAssessment;
use App\Services\Attendance\OvertimeEngine;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Overtime is not one multiplier.
 *
 * shifts.overtime_multiplier answers "what is an extra hour worth" and nothing
 * else. It cannot say which clock the hour was measured on, how much excess is
 * ignored before anything accrues, that a weekly off and a public holiday are
 * separate kinds of day with their own rates, that one of them hands back
 * comp-off rather than money, or that unapproved overtime must not be counted.
 * Those are six independent decisions and the engine has to make all of them.
 *
 * The dates here are real calendar dates and are hand-checked:
 *   2026-08-19 is a WEDNESDAY  — an ordinary working day.
 *   2026-08-16 is a SUNDAY     — the weekly off in these fixtures.
 * No test infers a weekday from a name; they are pinned in the fixtures.
 */
class OvertimeEngineTest extends TestCase
{
    use RefreshDatabase;

    private const WEDNESDAY = '2026-08-19';
    private const SUNDAY = '2026-08-16';

    private function engine(): OvertimeEngine
    {
        return app(OvertimeEngine::class);
    }

    private function organization(string $name, string $slug, ?array $settings = null): Organization
    {
        return Organization::create(array_filter([
            'name' => $name,
            'slug' => $slug,
            'settings' => $settings,
        ], fn ($value) => $value !== null));
    }

    private function employee(Organization $organization, string $email, ?array $settings = null): User
    {
        return User::create([
            'name' => 'Employee',
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
            'settings' => $settings,
        ]);
    }

    /**
     * A 09:00–18:00 shift with a one-hour break: 540 gross minutes, 480
     * effective. The two numbers differing is the whole point of the basis
     * choice, so every fixture keeps them apart.
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
            'overtime_multiplier' => 1.25,
            'is_active' => true,
        ], $attributes));
    }

    private function rosterOn(User $user, Shift $shift): EmployeeShift
    {
        return EmployeeShift::withoutOrganizationScope()->create([
            'organization_id' => $shift->organization_id,
            'user_id' => $user->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);
    }

    /** @param array<string, mixed> $attributes */
    private function overtimePolicy(Organization $organization, array $attributes = []): OvertimePolicy
    {
        return OvertimePolicy::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $organization->id,
            'name' => 'OT '.$organization->id.'-'.fake()->unique()->numberBetween(1, 999999),
            'hours_basis' => OvertimePolicy::BASIS_EFFECTIVE,
            'minimum_minutes_before_accrual' => 0,
            'rounding' => OvertimePolicy::ROUNDING_NEAREST,
            'rounding_increment_minutes' => 15,
            'requires_approval' => false,
            'is_active' => true,
        ], $attributes));
    }

    /** @param array<string, mixed> $attributes */
    private function rate(OvertimePolicy $policy, string $scope, array $attributes = []): OvertimePolicyScope
    {
        return OvertimePolicyScope::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $policy->organization_id,
            'overtime_policy_id' => $policy->id,
            'scope' => $scope,
            'treatment' => OvertimePolicyScope::TREATMENT_PAY,
            'multiplier' => 1.50,
            'applies_after_minutes' => 0,
        ], $attributes));
    }

    private function assignOvertime(User $user, OvertimePolicy $policy, string $from = '2026-01-01'): EmployeeOvertimePolicy
    {
        return EmployeeOvertimePolicy::withoutOrganizationScope()->create([
            'organization_id' => $policy->organization_id,
            'user_id' => $user->id,
            'overtime_policy_id' => $policy->id,
            'effective_from' => $from,
            'is_active' => true,
        ]);
    }

    /** Sundays off, every week. */
    private function assignSundaysOff(User $user, Organization $organization): WeeklyOffPolicy
    {
        $policy = WeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'name' => 'Sundays '.$organization->id,
            'day_rules' => ['sunday' => 'every'],
            'is_active' => true,
        ]);

        EmployeeWeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'user_id' => $user->id,
            'weekly_off_policy_id' => $policy->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);

        return $policy;
    }

    private function holiday(Organization $organization, string $date, string $country = 'ALL'): AttendanceHoliday
    {
        return AttendanceHoliday::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'holiday_date' => $date,
            'country' => $country,
            'title' => 'Independence Day',
        ]);
    }

    // ------------------------------------------------------------------
    // The three scopes
    // ------------------------------------------------------------------

    public function test_a_working_day_pays_only_the_excess_over_the_shift(): void
    {
        $org = $this->organization('Acme', 'acme');
        $user = $this->employee($org, 'working@example.com');
        $this->rosterOn($user, $this->shift($org));

        $policy = $this->overtimePolicy($org);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY, ['multiplier' => 1.50]);
        $this->assignOvertime($user, $policy);

        // 480 effective minutes are the shift itself; 540 means an hour over.
        $assessment = $this->engine()->evaluate($user, self::WEDNESDAY, grossMinutes: 600, effectiveMinutes: 540);

        $this->assertSame(OvertimePolicyScope::SCOPE_WORKING_DAY, $assessment->scope);
        $this->assertSame(480, $assessment->expectedMinutes);
        $this->assertSame(60, $assessment->rawMinutes);
        $this->assertSame(60, $assessment->roundedMinutes);
        $this->assertSame(60, $assessment->payableMinutes());
        $this->assertSame('1.50', $assessment->multiplier);
        $this->assertSame(OvertimePolicyScope::TREATMENT_PAY, $assessment->treatment);
    }

    public function test_a_weekly_off_makes_the_whole_day_overtime_at_its_own_rate(): void
    {
        $org = $this->organization('Acme', 'acme');
        $user = $this->employee($org, 'weeklyoff@example.com');
        $this->rosterOn($user, $this->shift($org));
        $this->assignSundaysOff($user, $org);

        $policy = $this->overtimePolicy($org);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY, ['multiplier' => 1.50]);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WEEKLY_OFF, ['multiplier' => 2.00]);
        $this->assignOvertime($user, $policy);

        // Four hours on a Sunday. None of it is "the shift" — the person was
        // not due in at all, so every minute is overtime.
        $assessment = $this->engine()->evaluate($user, self::SUNDAY, grossMinutes: 260, effectiveMinutes: 240);

        $this->assertSame(OvertimePolicyScope::SCOPE_WEEKLY_OFF, $assessment->scope);
        $this->assertSame(0, $assessment->expectedMinutes);
        $this->assertSame(240, $assessment->rawMinutes);
        $this->assertSame(240, $assessment->payableMinutes());
        $this->assertSame('2.00', $assessment->multiplier);
    }

    public function test_a_public_holiday_is_its_own_scope_on_an_ordinary_weekday(): void
    {
        $org = $this->organization('Acme', 'acme', ['timezone' => 'Asia/Kolkata']);
        $user = $this->employee($org, 'holiday@example.com', ['timezone' => 'Asia/Kolkata']);
        $this->rosterOn($user, $this->shift($org));
        $this->holiday($org, self::WEDNESDAY);

        $policy = $this->overtimePolicy($org);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY, ['multiplier' => 1.50]);
        $this->rate($policy, OvertimePolicyScope::SCOPE_HOLIDAY, ['multiplier' => 3.00]);
        $this->assignOvertime($user, $policy);

        $assessment = $this->engine()->evaluate($user, self::WEDNESDAY, grossMinutes: 200, effectiveMinutes: 180);

        $this->assertSame(OvertimePolicyScope::SCOPE_HOLIDAY, $assessment->scope);
        $this->assertSame(180, $assessment->rawMinutes);
        $this->assertSame('3.00', $assessment->multiplier);
    }

    public function test_a_holiday_recorded_for_another_country_does_not_apply(): void
    {
        // The holiday table is shared across regions and carries a country per
        // row. An India employee reading a USA holiday would have a full
        // working day silently reclassified and paid at the holiday rate.
        $org = $this->organization('Acme', 'acme', ['timezone' => 'Asia/Kolkata']);
        $user = $this->employee($org, 'india@example.com', ['timezone' => 'Asia/Kolkata']);
        $this->rosterOn($user, $this->shift($org));
        $this->holiday($org, self::WEDNESDAY, 'USA');

        $policy = $this->overtimePolicy($org);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY, ['multiplier' => 1.50]);
        $this->rate($policy, OvertimePolicyScope::SCOPE_HOLIDAY, ['multiplier' => 3.00]);
        $this->assignOvertime($user, $policy);

        $assessment = $this->engine()->evaluate($user, self::WEDNESDAY, grossMinutes: 600, effectiveMinutes: 540);

        $this->assertSame(OvertimePolicyScope::SCOPE_WORKING_DAY, $assessment->scope);
        $this->assertSame('1.50', $assessment->multiplier);
    }

    public function test_a_holiday_falling_on_a_weekly_off_is_read_as_a_holiday(): void
    {
        $org = $this->organization('Acme', 'acme');
        $user = $this->employee($org, 'both@example.com');
        $this->rosterOn($user, $this->shift($org));
        $this->assignSundaysOff($user, $org);
        $this->holiday($org, self::SUNDAY);

        $policy = $this->overtimePolicy($org);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WEEKLY_OFF, ['multiplier' => 2.00]);
        $this->rate($policy, OvertimePolicyScope::SCOPE_HOLIDAY, ['multiplier' => 3.00]);
        $this->assignOvertime($user, $policy);

        $assessment = $this->engine()->evaluate($user, self::SUNDAY, grossMinutes: 130, effectiveMinutes: 120);

        $this->assertSame(OvertimePolicyScope::SCOPE_HOLIDAY, $assessment->scope);
        $this->assertSame('3.00', $assessment->multiplier);
    }

    // ------------------------------------------------------------------
    // Basis
    // ------------------------------------------------------------------

    public function test_the_basis_decides_which_clock_the_overtime_is_measured_on(): void
    {
        $org = $this->organization('Acme', 'acme');
        $user = $this->employee($org, 'basis@example.com');
        $this->rosterOn($user, $this->shift($org));

        $effectivePolicy = $this->overtimePolicy($org, [
            'name' => 'Effective basis',
            'hours_basis' => OvertimePolicy::BASIS_EFFECTIVE,
            'rounding_increment_minutes' => 1,
        ]);
        $this->rate($effectivePolicy, OvertimePolicyScope::SCOPE_WORKING_DAY);
        $this->assignOvertime($user, $effectivePolicy);

        // 600 gross / 540 effective against a 540 gross / 480 effective shift:
        // an hour over on either clock, but the two clocks are different
        // numbers and reading the wrong one is a silent hour of overtime.
        $onEffective = $this->engine()->evaluate($user, self::WEDNESDAY, grossMinutes: 600, effectiveMinutes: 500);
        $this->assertSame(OvertimePolicy::BASIS_EFFECTIVE, $onEffective->basis);
        $this->assertSame(480, $onEffective->expectedMinutes);
        $this->assertSame(20, $onEffective->rawMinutes);

        $grossOrg = $this->organization('Gross', 'gross');
        $grossUser = $this->employee($grossOrg, 'gross@example.com');
        $this->rosterOn($grossUser, $this->shift($grossOrg));
        $grossPolicy = $this->overtimePolicy($grossOrg, [
            'name' => 'Gross basis',
            'hours_basis' => OvertimePolicy::BASIS_GROSS,
            'rounding_increment_minutes' => 1,
        ]);
        $this->rate($grossPolicy, OvertimePolicyScope::SCOPE_WORKING_DAY);
        $this->assignOvertime($grossUser, $grossPolicy);

        $onGross = $this->engine()->evaluate($grossUser, self::WEDNESDAY, grossMinutes: 600, effectiveMinutes: 500);
        $this->assertSame(OvertimePolicy::BASIS_GROSS, $onGross->basis);
        $this->assertSame(540, $onGross->expectedMinutes);
        $this->assertSame(60, $onGross->rawMinutes);
    }

    // ------------------------------------------------------------------
    // Threshold and rounding
    // ------------------------------------------------------------------

    public function test_overtime_below_the_minimum_threshold_accrues_nothing(): void
    {
        $org = $this->organization('Acme', 'acme');
        $user = $this->employee($org, 'threshold@example.com');
        $this->rosterOn($user, $this->shift($org));

        $policy = $this->overtimePolicy($org, ['minimum_minutes_before_accrual' => 30]);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY);
        $this->assignOvertime($user, $policy);

        $under = $this->engine()->evaluate($user, self::WEDNESDAY, grossMinutes: 560, effectiveMinutes: 500);
        $this->assertSame(20, $under->rawMinutes, 'The raw excess is still reported.');
        $this->assertSame(0, $under->qualifyingMinutes);
        $this->assertSame(0, $under->roundedMinutes);
        $this->assertSame(0, $under->payableMinutes());

        // Exactly on the threshold qualifies: "minimum before accrual" is a
        // floor to reach, not one to beat.
        $on = $this->engine()->evaluate($user, self::WEDNESDAY, grossMinutes: 570, effectiveMinutes: 510);
        $this->assertSame(30, $on->qualifyingMinutes);
        $this->assertSame(30, $on->roundedMinutes);
    }

    public function test_rounding_up_down_and_nearest_including_a_value_exactly_on_the_increment(): void
    {
        $org = $this->organization('Acme', 'acme');

        $cases = [
            // rounding                          worked  raw  expected rounding
            [OvertimePolicy::ROUNDING_UP, 517, 37, 45],
            [OvertimePolicy::ROUNDING_DOWN, 517, 37, 30],
            [OvertimePolicy::ROUNDING_NEAREST, 517, 37, 30],
            [OvertimePolicy::ROUNDING_NEAREST, 518, 38, 45],
            // Exactly on the increment must not move in ANY direction. This is
            // the case a ceil()/floor() mix-up passes half the time.
            [OvertimePolicy::ROUNDING_UP, 510, 30, 30],
            [OvertimePolicy::ROUNDING_DOWN, 510, 30, 30],
            [OvertimePolicy::ROUNDING_NEAREST, 510, 30, 30],
        ];

        foreach ($cases as $index => [$rounding, $worked, $raw, $expected]) {
            $user = $this->employee($org, "rounding{$index}@example.com");
            $this->rosterOn($user, $this->shift($org, ['name' => "Shift {$index}", 'code' => "R{$index}"]));

            $policy = $this->overtimePolicy($org, [
                'name' => "Rounding {$index}",
                'rounding' => $rounding,
                'rounding_increment_minutes' => 15,
            ]);
            $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY);
            $this->assignOvertime($user, $policy);

            $assessment = $this->engine()->evaluate(
                $user,
                self::WEDNESDAY,
                grossMinutes: $worked + 60,
                effectiveMinutes: $worked,
            );

            $this->assertSame($raw, $assessment->rawMinutes, "Case {$index}: raw minutes.");
            $this->assertSame(
                $expected,
                $assessment->roundedMinutes,
                "Case {$index}: {$raw} minutes rounded {$rounding} to the nearest 15."
            );
        }
    }

    // ------------------------------------------------------------------
    // Approval
    // ------------------------------------------------------------------

    public function test_unapproved_overtime_is_reported_as_pending_and_never_counted(): void
    {
        $org = $this->organization('Acme', 'acme');
        $user = $this->employee($org, 'approval@example.com');
        $this->rosterOn($user, $this->shift($org));

        $policy = $this->overtimePolicy($org, ['requires_approval' => true]);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY, ['multiplier' => 2.00]);
        $this->assignOvertime($user, $policy);

        $pending = $this->engine()->evaluate($user, self::WEDNESDAY, grossMinutes: 600, effectiveMinutes: 540);

        $this->assertSame(OvertimeAssessment::APPROVAL_PENDING, $pending->approvalState);
        $this->assertSame(60, $pending->roundedMinutes, 'The hours are still measured.');
        $this->assertSame(60, $pending->pendingMinutes(), 'And reported separately as pending.');
        $this->assertSame(0, $pending->countedMinutes());
        $this->assertSame(0, $pending->payableMinutes());
        $this->assertSame('0.00', $pending->amountForHourlyRate('200.00'));

        $approved = $this->engine()->evaluate(
            $user,
            self::WEDNESDAY,
            grossMinutes: 600,
            effectiveMinutes: 540,
            approved: true,
        );

        $this->assertSame(OvertimeAssessment::APPROVAL_APPROVED, $approved->approvalState);
        $this->assertSame(0, $approved->pendingMinutes());
        $this->assertSame(60, $approved->payableMinutes());
        $this->assertSame('400.00', $approved->amountForHourlyRate('200.00'));
    }

    public function test_a_policy_that_does_not_require_approval_counts_the_hours_as_they_are(): void
    {
        $org = $this->organization('Acme', 'acme');
        $user = $this->employee($org, 'noapproval@example.com');
        $this->rosterOn($user, $this->shift($org));

        $policy = $this->overtimePolicy($org, ['requires_approval' => false]);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY);
        $this->assignOvertime($user, $policy);

        $assessment = $this->engine()->evaluate($user, self::WEDNESDAY, grossMinutes: 600, effectiveMinutes: 540);

        $this->assertSame(OvertimeAssessment::APPROVAL_NOT_REQUIRED, $assessment->approvalState);
        $this->assertSame(60, $assessment->countedMinutes());
        $this->assertSame(0, $assessment->pendingMinutes());
    }

    // ------------------------------------------------------------------
    // Comp-off versus pay
    // ------------------------------------------------------------------

    public function test_comp_off_accrues_time_and_pays_no_money(): void
    {
        $org = $this->organization('Acme', 'acme');
        $user = $this->employee($org, 'compoff@example.com');
        $this->rosterOn($user, $this->shift($org));
        $this->assignSundaysOff($user, $org);

        $policy = $this->overtimePolicy($org);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WEEKLY_OFF, [
            'treatment' => OvertimePolicyScope::TREATMENT_COMP_OFF,
            'multiplier' => 1.00,
        ]);
        $this->assignOvertime($user, $policy);

        $assessment = $this->engine()->evaluate($user, self::SUNDAY, grossMinutes: 260, effectiveMinutes: 240);

        $this->assertSame(OvertimePolicyScope::TREATMENT_COMP_OFF, $assessment->treatment);
        $this->assertSame(240, $assessment->compOffMinutes());
        $this->assertSame(0, $assessment->payableMinutes());
        $this->assertSame('0.00', $assessment->amountForHourlyRate('200.00'));
    }

    // ------------------------------------------------------------------
    // Extended tiers
    // ------------------------------------------------------------------

    public function test_an_extended_tier_takes_over_once_the_overtime_passes_its_threshold(): void
    {
        $org = $this->organization('Acme', 'acme');
        $user = $this->employee($org, 'tiers@example.com');
        $this->rosterOn($user, $this->shift($org));

        $policy = $this->overtimePolicy($org, ['rounding_increment_minutes' => 1]);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY, ['multiplier' => 1.50]);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY, [
            'multiplier' => 2.00,
            'applies_after_minutes' => 120,
        ]);
        $this->assignOvertime($user, $policy);

        $base = $this->engine()->evaluate($user, self::WEDNESDAY, grossMinutes: 620, effectiveMinutes: 540);
        $this->assertSame('1.50', $base->multiplier);

        $extended = $this->engine()->evaluate($user, self::WEDNESDAY, grossMinutes: 720, effectiveMinutes: 660);
        $this->assertSame(180, $extended->rawMinutes);
        $this->assertSame('2.00', $extended->multiplier);
    }

    public function test_a_rate_outside_its_validity_window_is_not_used(): void
    {
        $org = $this->organization('Acme', 'acme');
        $user = $this->employee($org, 'window@example.com');
        $this->rosterOn($user, $this->shift($org));

        $policy = $this->overtimePolicy($org);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY, ['multiplier' => 1.50]);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY, [
            'multiplier' => 2.50,
            'effective_from' => '2026-10-01',
            'effective_to' => '2026-10-31',
        ]);
        $this->assignOvertime($user, $policy);

        // 19 August is outside the October window; the festive rate must not
        // leak into it.
        $assessment = $this->engine()->evaluate($user, self::WEDNESDAY, grossMinutes: 600, effectiveMinutes: 540);

        $this->assertSame('1.50', $assessment->multiplier);
    }

    // ------------------------------------------------------------------
    // Fallback
    // ------------------------------------------------------------------

    public function test_with_no_policy_assigned_the_shift_multiplier_is_used(): void
    {
        $org = $this->organization('Acme', 'acme');
        $user = $this->employee($org, 'fallback@example.com');
        $this->rosterOn($user, $this->shift($org, ['overtime_multiplier' => 1.75]));

        $assessment = $this->engine()->evaluate($user, self::WEDNESDAY, grossMinutes: 600, effectiveMinutes: 540);

        $this->assertSame(OvertimeAssessment::SOURCE_SHIFT, $assessment->source);
        $this->assertSame('1.75', $assessment->multiplier);
        $this->assertSame(60, $assessment->rawMinutes);
        $this->assertSame(60, $assessment->roundedMinutes, 'No policy means no rounding rule to apply.');
        $this->assertSame(OvertimeAssessment::APPROVAL_NOT_REQUIRED, $assessment->approvalState);
        $this->assertSame(60, $assessment->payableMinutes());
    }

    public function test_an_organization_default_policy_applies_to_an_unassigned_employee(): void
    {
        $org = $this->organization('Acme', 'acme');
        $user = $this->employee($org, 'default@example.com');
        $this->rosterOn($user, $this->shift($org));

        $policy = $this->overtimePolicy($org, ['is_default' => true]);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY, ['multiplier' => 1.90]);

        $assessment = $this->engine()->evaluate($user, self::WEDNESDAY, grossMinutes: 600, effectiveMinutes: 540);

        $this->assertSame(OvertimeAssessment::SOURCE_POLICY, $assessment->source);
        $this->assertSame((int) $policy->id, $assessment->policyId);
        $this->assertSame('1.90', $assessment->multiplier);
    }

    public function test_no_shift_length_means_no_working_day_overtime_is_invented(): void
    {
        // The shift domain deliberately never invents an eight-hour day. With
        // nothing rostered there is no length to exceed, so claiming overtime
        // here would be inventing the baseline it was measured against.
        $org = $this->organization('Acme', 'acme');
        $user = $this->employee($org, 'noshift@example.com');

        $policy = $this->overtimePolicy($org);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY);
        $this->assignOvertime($user, $policy);

        $assessment = $this->engine()->evaluate($user, self::WEDNESDAY, grossMinutes: 700, effectiveMinutes: 640);

        $this->assertNull($assessment->expectedMinutes);
        $this->assertSame(0, $assessment->rawMinutes);
        $this->assertSame(0, $assessment->payableMinutes());
    }

    // ------------------------------------------------------------------
    // Money
    // ------------------------------------------------------------------

    public function test_the_amount_is_decimal_and_never_a_float(): void
    {
        $org = $this->organization('Acme', 'acme');
        $user = $this->employee($org, 'money@example.com');
        $this->rosterOn($user, $this->shift($org));

        $policy = $this->overtimePolicy($org, ['rounding_increment_minutes' => 1]);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY, ['multiplier' => 1.50]);
        $this->assignOvertime($user, $policy);

        // 70 minutes at 133.33/hour and 1.5x = 233.3275, which is exactly the
        // shape that drifts when it is carried as a float.
        $assessment = $this->engine()->evaluate($user, self::WEDNESDAY, grossMinutes: 610, effectiveMinutes: 550);

        $this->assertSame(70, $assessment->payableMinutes());

        $amount = $assessment->amountForHourlyRate('133.33');
        $this->assertIsString($amount, 'Money is a decimal string, never a float.');
        $this->assertSame('233.33', $amount);
    }

    // ------------------------------------------------------------------
    // Tenancy
    // ------------------------------------------------------------------

    public function test_policies_holidays_and_weekly_offs_never_cross_tenants(): void
    {
        // Nobody is authenticated here on purpose: BelongsToOrganization's
        // global scope is a deliberate no-op without a user, which is exactly
        // the state a queued payroll job runs in. Every read has to be pinned.
        $acme = $this->organization('Acme', 'acme');
        $rival = $this->organization('Rival', 'rival');

        $acmeUser = $this->employee($acme, 'acme@example.com');
        $rivalUser = $this->employee($rival, 'rival@example.com');

        $this->rosterOn($acmeUser, $this->shift($acme, ['overtime_multiplier' => 1.25]));
        $this->rosterOn($rivalUser, $this->shift($rival, ['overtime_multiplier' => 1.25]));

        // The rival configures generously, and marks the day a holiday.
        $rivalPolicy = $this->overtimePolicy($rival, ['name' => 'Rival OT', 'is_default' => true]);
        $this->rate($rivalPolicy, OvertimePolicyScope::SCOPE_WORKING_DAY, ['multiplier' => 3.00]);
        $this->rate($rivalPolicy, OvertimePolicyScope::SCOPE_HOLIDAY, ['multiplier' => 4.00]);
        $this->assignOvertime($rivalUser, $rivalPolicy);
        $this->holiday($rival, self::WEDNESDAY);
        $this->assignSundaysOff($rivalUser, $rival);

        $mine = $this->engine()->evaluate($acmeUser, self::WEDNESDAY, grossMinutes: 600, effectiveMinutes: 540);
        $this->assertSame(OvertimeAssessment::SOURCE_SHIFT, $mine->source, "Acme picked up the rival's policy.");
        $this->assertSame(OvertimePolicyScope::SCOPE_WORKING_DAY, $mine->scope, "Acme picked up the rival's holiday.");
        $this->assertSame('1.25', $mine->multiplier);

        // And the rival's own fixtures are live, so the assertion above is
        // about isolation rather than about nothing having been created.
        $theirs = $this->engine()->evaluate($rivalUser, self::WEDNESDAY, grossMinutes: 600, effectiveMinutes: 540);
        $this->assertSame(OvertimePolicyScope::SCOPE_HOLIDAY, $theirs->scope);
        $this->assertSame('4.00', $theirs->multiplier);

        // Weekly off is resolved per tenant too: Acme never assigned one, so
        // its employee's Sunday is not an off day and stays a working day.
        $acmeSunday = $this->engine()->evaluate($acmeUser, self::SUNDAY, grossMinutes: 600, effectiveMinutes: 540);
        $this->assertSame(OvertimePolicyScope::SCOPE_WORKING_DAY, $acmeSunday->scope);
    }

    public function test_the_assessment_serialises_every_number_a_reviewer_needs(): void
    {
        $org = $this->organization('Acme', 'acme');
        $user = $this->employee($org, 'array@example.com');
        $this->rosterOn($user, $this->shift($org));

        $policy = $this->overtimePolicy($org, ['requires_approval' => true]);
        $this->rate($policy, OvertimePolicyScope::SCOPE_WORKING_DAY, ['multiplier' => 1.50]);
        $this->assignOvertime($user, $policy);

        $payload = $this->engine()
            ->evaluate($user, self::WEDNESDAY, grossMinutes: 600, effectiveMinutes: 540)
            ->toArray();

        // Pending minutes are a separate key from counted minutes. Folding them
        // together is how unapproved overtime reaches a payslip.
        $this->assertSame(60, $payload['rounded_minutes']);
        $this->assertSame(0, $payload['counted_minutes']);
        $this->assertSame(60, $payload['pending_minutes']);
        $this->assertSame(OvertimeAssessment::APPROVAL_PENDING, $payload['approval_state']);
        $this->assertSame(self::WEDNESDAY, $payload['attendance_date']);
        $this->assertSame('1.50', $payload['multiplier']);
    }
}
