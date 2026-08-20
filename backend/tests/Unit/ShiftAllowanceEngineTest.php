<?php

namespace Tests\Unit;

use App\Models\EmployeeShift;
use App\Models\EmployeeShiftAllowancePolicy;
use App\Models\EmployeeWeeklyOffPolicy;
use App\Models\Organization;
use App\Models\Shift;
use App\Models\ShiftAllowancePolicy;
use App\Models\User;
use App\Models\WeeklyOffPolicy;
use App\Services\Attendance\ShiftAllowanceEngine;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * What a night or a weekend is worth, for one person on one date.
 *
 * The engine answers a question that used to be six columns on the shift row,
 * and the split only pays for itself if three things hold:
 *
 *  - The premium is earned by the OVERLAP between the shift and the policy's
 *    night window, not by the shift being labelled "night". A 18:00→02:00 shift
 *    against a 22:00→06:00 window earns four hours of night, not eight and not
 *    zero, and the policy's minimum decides whether four is enough.
 *  - An organization that has configured no policy keeps being paid exactly
 *    what the shift columns already say. Nothing in this split is allowed to
 *    silently zero a differential that is being paid today.
 *  - Money is decimal end to end. Every amount here is a string with two
 *    decimal places, rounded once, at the boundary.
 */
class ShiftAllowanceEngineTest extends TestCase
{
    use RefreshDatabase;

    private function engine(): ShiftAllowanceEngine
    {
        return app(ShiftAllowanceEngine::class);
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

    /** @param array<string, mixed> $attributes */
    private function shift(Organization $organization, array $attributes = []): Shift
    {
        static $sequence = 0;
        $sequence++;

        return Shift::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $organization->id,
            'name' => 'Night '.$sequence,
            'code' => 'N'.$sequence,
            'type' => 'night',
            'start_time' => '22:00:00',
            'end_time' => '06:00:00',
            'duration_minutes' => 480,
            'break_duration_minutes' => 0,
            'is_night_shift' => true,
            'is_active' => true,
        ], $attributes));
    }

    private function roster(User $user, Shift $shift, string $from = '2026-01-01', array $extra = []): EmployeeShift
    {
        return EmployeeShift::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'shift_id' => $shift->id,
            'effective_from' => $from,
            'is_active' => true,
        ], $extra));
    }

    /** @param array<string, mixed> $attributes */
    private function policy(Organization $organization, array $attributes = []): ShiftAllowancePolicy
    {
        static $sequence = 0;
        $sequence++;

        return ShiftAllowancePolicy::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $organization->id,
            'name' => 'Allowance '.$sequence,
            'night_allowance_type' => ShiftAllowancePolicy::TYPE_PERCENTAGE,
            'night_percentage' => '15.00',
            'night_fixed' => '0.00',
            'night_window_start' => '22:00:00',
            'night_window_end' => '06:00:00',
            'night_minimum_minutes_in_window' => 0,
            'weekend_allowance_type' => ShiftAllowancePolicy::TYPE_NONE,
            'is_active' => true,
        ], $attributes));
    }

    private function assign(User $user, ShiftAllowancePolicy $policy, string $from = '2026-01-01'): EmployeeShiftAllowancePolicy
    {
        return EmployeeShiftAllowancePolicy::withoutOrganizationScope()->create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'shift_allowance_policy_id' => $policy->id,
            'effective_from' => $from,
            'is_active' => true,
        ]);
    }

    // ---- the night window ---------------------------------------------------

    public function test_a_night_shift_inside_the_window_earns_the_policy_percentage(): void
    {
        $organization = $this->organization('Acme', 'acme-allow-1');
        $user = $this->employee($organization, 'night@example.com');
        $this->roster($user, $this->shift($organization));
        $this->assign($user, $this->policy($organization));

        // 2026-08-19 is a Wednesday, so nothing weekend-shaped can leak in.
        $breakdown = $this->engine()->computeFor($user, '2026-08-19', '1000.00');

        $this->assertTrue($breakdown->nightApplies);
        $this->assertSame(480, $breakdown->nightMinutesInWindow);
        $this->assertSame('150.00', $breakdown->nightAmount);
        $this->assertSame('150.00', $breakdown->totalAmount);
        $this->assertSame('assignment', $breakdown->source);
    }

    public function test_a_day_shift_earns_nothing_from_a_night_policy(): void
    {
        $organization = $this->organization('Acme', 'acme-allow-2');
        $user = $this->employee($organization, 'day@example.com');
        $this->roster($user, $this->shift($organization, [
            'type' => 'general',
            'start_time' => '09:00:00',
            'end_time' => '18:00:00',
            'duration_minutes' => 540,
            'is_night_shift' => false,
        ]));
        $this->assign($user, $this->policy($organization));

        $breakdown = $this->engine()->computeFor($user, '2026-08-19', '1000.00');

        $this->assertFalse($breakdown->nightApplies);
        $this->assertSame(0, $breakdown->nightMinutesInWindow);
        $this->assertSame('0.00', $breakdown->totalAmount);
    }

    public function test_a_partial_overlap_is_measured_and_the_minimum_decides_whether_it_pays(): void
    {
        $organization = $this->organization('Acme', 'acme-allow-3');
        $user = $this->employee($organization, 'evening@example.com');
        // 18:00 -> 02:00 against a 22:00 -> 06:00 window is four hours of night.
        $this->roster($user, $this->shift($organization, [
            'start_time' => '18:00:00',
            'end_time' => '02:00:00',
            'duration_minutes' => 480,
        ]));
        $strict = $this->policy($organization, ['night_minimum_minutes_in_window' => 300]);
        $this->assign($user, $strict);

        $breakdown = $this->engine()->computeFor($user, '2026-08-19', '1000.00');

        // The overlap is reported either way — "not enough night" and "no night
        // at all" are different facts and a payslip query has to tell them apart.
        $this->assertSame(240, $breakdown->nightMinutesInWindow);
        $this->assertFalse($breakdown->nightApplies);
        $this->assertSame('0.00', $breakdown->nightAmount);

        $strict->update(['night_minimum_minutes_in_window' => 120]);

        $relaxed = $this->engine()->computeFor($user, '2026-08-19', '1000.00');
        $this->assertTrue($relaxed->nightApplies);
        $this->assertSame('150.00', $relaxed->nightAmount);
    }

    public function test_a_fixed_night_allowance_ignores_the_base_amount(): void
    {
        $organization = $this->organization('Acme', 'acme-allow-4');
        $user = $this->employee($organization, 'fixed@example.com');
        $this->roster($user, $this->shift($organization));
        $this->assign($user, $this->policy($organization, [
            'night_allowance_type' => ShiftAllowancePolicy::TYPE_FIXED,
            'night_percentage' => '0.00',
            'night_fixed' => '250.00',
        ]));

        $withBase = $this->engine()->computeFor($user, '2026-08-19', '1000.00');
        $withoutBase = $this->engine()->computeFor($user, '2026-08-19');

        $this->assertSame('250.00', $withBase->nightAmount);
        $this->assertSame('250.00', $withoutBase->nightAmount);
    }

    public function test_a_percentage_with_no_base_reports_the_rate_and_pays_nothing(): void
    {
        $organization = $this->organization('Acme', 'acme-allow-5');
        $user = $this->employee($organization, 'norate@example.com');
        $this->roster($user, $this->shift($organization));
        $this->assign($user, $this->policy($organization));

        $breakdown = $this->engine()->computeFor($user, '2026-08-19');

        // Inventing a base would be inventing money. The premium is earned and
        // says so; only the caller knows what it bites on.
        $this->assertTrue($breakdown->nightApplies);
        $this->assertSame('15.00', $breakdown->nightRate);
        $this->assertNull($breakdown->nightAmount);
        $this->assertNull($breakdown->totalAmount);
    }

    // ---- the weekend --------------------------------------------------------

    public function test_the_weekend_premium_follows_the_assigned_weekly_off_policy_not_the_calendar(): void
    {
        $organization = $this->organization('Acme', 'acme-allow-6');
        $user = $this->employee($organization, 'weekly@example.com');
        $this->roster($user, $this->shift($organization, [
            'type' => 'general',
            'start_time' => '09:00:00',
            'end_time' => '18:00:00',
            'duration_minutes' => 540,
            'is_night_shift' => false,
        ]));
        $this->assign($user, $this->policy($organization, [
            'night_allowance_type' => ShiftAllowancePolicy::TYPE_NONE,
            'weekend_allowance_type' => ShiftAllowancePolicy::TYPE_PERCENTAGE,
            'weekend_percentage' => '20.00',
        ]));

        // This organization's week off is Tuesday, not Sunday. A calendar-shaped
        // "weekend" would pay the wrong day in both directions.
        $weeklyOff = WeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'name' => 'Tuesday off',
            'day_rules' => ['tuesday' => 'every'],
            'is_active' => true,
        ]);
        EmployeeWeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'user_id' => $user->id,
            'weekly_off_policy_id' => $weeklyOff->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);

        $tuesday = $this->engine()->computeFor($user, '2026-08-18', '1000.00');
        $sunday = $this->engine()->computeFor($user, '2026-08-23', '1000.00');

        $this->assertTrue($tuesday->weekendApplies);
        $this->assertSame('200.00', $tuesday->weekendAmount);
        $this->assertFalse($sunday->weekendApplies);
        $this->assertSame('0.00', $sunday->weekendAmount);
    }

    public function test_night_and_weekend_stack_on_the_same_date(): void
    {
        $organization = $this->organization('Acme', 'acme-allow-7');
        $user = $this->employee($organization, 'both@example.com');
        $this->roster($user, $this->shift($organization));
        $this->assign($user, $this->policy($organization, [
            'weekend_allowance_type' => ShiftAllowancePolicy::TYPE_FIXED,
            'weekend_fixed' => '300.00',
        ]));

        // 2026-08-22 is a Saturday, and with no weekly-off policy configured the
        // engine falls back to the calendar weekend.
        $breakdown = $this->engine()->computeFor($user, '2026-08-22', '1000.00');

        $this->assertTrue($breakdown->nightApplies);
        $this->assertTrue($breakdown->weekendApplies);
        $this->assertSame('150.00', $breakdown->nightAmount);
        $this->assertSame('300.00', $breakdown->weekendAmount);
        $this->assertSame('450.00', $breakdown->totalAmount);
    }

    // ---- the fallback that must not break -----------------------------------

    public function test_with_no_policy_assigned_the_shift_differential_columns_still_pay(): void
    {
        $organization = $this->organization('Acme', 'acme-allow-8');
        $user = $this->employee($organization, 'legacy@example.com');
        $this->roster($user, $this->shift($organization, [
            'has_shift_differential' => true,
            'differential_percentage' => '10.00',
            'night_shift_start' => '22:00:00',
            'night_shift_end' => '06:00:00',
        ]));

        $breakdown = $this->engine()->computeFor($user, '2026-08-19', '1000.00');

        $this->assertSame('shift', $breakdown->source);
        $this->assertTrue($breakdown->nightApplies);
        $this->assertSame('100.00', $breakdown->nightAmount);
    }

    public function test_the_rosters_custom_differential_rate_overrides_the_shift_percentage(): void
    {
        $organization = $this->organization('Acme', 'acme-allow-9');
        $user = $this->employee($organization, 'custom@example.com');
        $this->roster($user, $this->shift($organization, [
            'has_shift_differential' => true,
            'differential_percentage' => '10.00',
        ]), '2026-01-01', ['custom_differential_rate' => '12.50']);

        $breakdown = $this->engine()->computeFor($user, '2026-08-19', '1000.00');

        $this->assertSame('125.00', $breakdown->nightAmount);
    }

    public function test_an_assigned_policy_wins_over_the_shift_columns(): void
    {
        $organization = $this->organization('Acme', 'acme-allow-10');
        $user = $this->employee($organization, 'wins@example.com');
        $this->roster($user, $this->shift($organization, [
            'has_shift_differential' => true,
            'differential_percentage' => '10.00',
        ]));
        $this->assign($user, $this->policy($organization));

        $breakdown = $this->engine()->computeFor($user, '2026-08-19', '1000.00');

        $this->assertSame('assignment', $breakdown->source);
        $this->assertSame('150.00', $breakdown->nightAmount);
    }

    public function test_an_organization_default_policy_covers_an_employee_with_no_assignment(): void
    {
        $organization = $this->organization('Acme', 'acme-allow-11');
        $user = $this->employee($organization, 'default@example.com');
        $this->roster($user, $this->shift($organization));
        $this->policy($organization, ['is_default' => true, 'night_percentage' => '18.00']);

        $breakdown = $this->engine()->computeFor($user, '2026-08-19', '1000.00');

        $this->assertSame('default', $breakdown->source);
        $this->assertSame('180.00', $breakdown->nightAmount);
    }

    public function test_the_assignment_in_force_on_the_date_is_the_one_that_pays(): void
    {
        $organization = $this->organization('Acme', 'acme-allow-12');
        $user = $this->employee($organization, 'dated@example.com');
        $this->roster($user, $this->shift($organization));

        $this->assign($user, $this->policy($organization, ['night_percentage' => '10.00']), '2026-01-01');
        $this->assign($user, $this->policy($organization, ['night_percentage' => '25.00']), '2026-08-01');

        // A payroll re-run for July must read July's policy, not today's.
        $july = $this->engine()->computeFor($user, '2026-07-15', '1000.00');
        $august = $this->engine()->computeFor($user, '2026-08-19', '1000.00');

        $this->assertSame('100.00', $july->nightAmount);
        $this->assertSame('250.00', $august->nightAmount);
    }

    public function test_nothing_is_earned_on_a_date_the_shift_does_not_run(): void
    {
        $organization = $this->organization('Acme', 'acme-allow-13');
        $user = $this->employee($organization, 'offday@example.com');
        $this->roster($user, $this->shift($organization, [
            'applicable_days' => ['monday', 'tuesday'],
        ]));
        $this->assign($user, $this->policy($organization));

        // 2026-08-19 is a Wednesday: no shift runs, so no night is worked.
        $breakdown = $this->engine()->computeFor($user, '2026-08-19', '1000.00');

        $this->assertSame('none', $breakdown->source);
        $this->assertFalse($breakdown->nightApplies);
        $this->assertSame('0.00', $breakdown->totalAmount);
    }

    public function test_another_tenants_default_policy_is_never_read(): void
    {
        $organization = $this->organization('Acme', 'acme-allow-14');
        $rival = $this->organization('Rival', 'rival-allow-14');

        $user = $this->employee($organization, 'tenant@example.com');
        $this->roster($user, $this->shift($organization));
        $this->policy($rival, ['is_default' => true, 'night_percentage' => '99.00']);

        $breakdown = $this->engine()->computeFor($user, '2026-08-19', '1000.00');

        $this->assertSame('none', $breakdown->source);
        $this->assertSame('0.00', $breakdown->totalAmount);
    }
}
