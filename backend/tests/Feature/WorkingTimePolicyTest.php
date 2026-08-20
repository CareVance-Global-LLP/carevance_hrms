<?php

namespace Tests\Feature;

use App\Models\EmployeeOvertimePolicy;
use App\Models\EmployeePenalisationPolicy;
use App\Models\EmployeeShiftAllowancePolicy;
use App\Models\EmployeeWeeklyOffPolicy;
use App\Models\Organization;
use App\Models\OvertimePolicy;
use App\Models\OvertimePolicyScope;
use App\Models\PenalisationHalfDayRule;
use App\Models\PenalisationPolicy;
use App\Models\ShiftAllowancePolicy;
use App\Models\User;
use App\Models\WeeklyOffPolicy;
use App\Traits\BelongsToOrganization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Working time is five independently assigned objects, not one.
 *
 * The shift used to carry grace periods, overtime multipliers and night
 * differentials as columns, which meant two teams on the same timings could not
 * have different late rules without duplicating the shift. Splitting them out
 * is only worth anything if each piece is genuinely separable: separately
 * created, separately versioned, separately assigned. These tests pin that
 * shape — the schema, the casts, the tenancy and the effective-dated assignment
 * that mirrors employee_shifts.
 */
class WorkingTimePolicyTest extends TestCase
{
    use RefreshDatabase;

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

    public function test_every_policy_and_assignment_table_exists_with_an_organization_column(): void
    {
        $tables = [
            'weekly_off_policies',
            'penalisation_policies',
            'penalisation_half_day_rules',
            'overtime_policies',
            'overtime_policy_scopes',
            'shift_allowance_policies',
            'employee_weekly_off_policies',
            'employee_penalisation_policies',
            'employee_overtime_policies',
            'employee_shift_allowance_policies',
        ];

        foreach ($tables as $table) {
            $this->assertTrue(Schema::hasTable($table), "Table {$table} is missing.");
            $this->assertTrue(
                Schema::hasColumn($table, 'organization_id'),
                "Table {$table} does not carry organization_id."
            );
        }
    }

    public function test_the_shift_columns_being_split_out_are_left_in_place(): void
    {
        // The policies win when configured, but an organization that has none
        // must keep working off the shift's own columns. Dropping them would
        // silently zero every existing grace period and overtime multiplier.
        foreach ([
            'grace_period_minutes',
            'early_exit_grace_minutes',
            'overtime_multiplier',
            'has_shift_differential',
            'differential_percentage',
            'differential_fixed',
            'has_weekend_differential',
            'weekend_differential_percentage',
            'weekend_differential_fixed',
        ] as $column) {
            $this->assertTrue(
                Schema::hasColumn('shifts', $column),
                "shifts.{$column} was dropped; it is still the fallback for orgs with no policy."
            );
        }
    }

    public function test_every_new_model_carries_the_organization_scope(): void
    {
        foreach ([
            WeeklyOffPolicy::class,
            PenalisationPolicy::class,
            PenalisationHalfDayRule::class,
            OvertimePolicy::class,
            OvertimePolicyScope::class,
            ShiftAllowancePolicy::class,
            EmployeeWeeklyOffPolicy::class,
            EmployeePenalisationPolicy::class,
            EmployeeOvertimePolicy::class,
            EmployeeShiftAllowancePolicy::class,
        ] as $class) {
            $this->assertContains(
                BelongsToOrganization::class,
                class_uses_recursive($class),
                "{$class} owns tenant data but has no organization scope."
            );
        }
    }

    public function test_another_tenants_policies_are_invisible(): void
    {
        $mine = $this->organization('Mine', 'mine-wtp');
        $theirs = $this->organization('Theirs', 'theirs-wtp');
        $admin = $this->employee($mine, 'admin-wtp@example.com');

        $foreign = WeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $theirs->id,
            'name' => 'Their Week',
            'day_rules' => ['sunday' => 'every'],
        ]);
        $ours = WeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $mine->id,
            'name' => 'Our Week',
            'day_rules' => ['sunday' => 'every', 'saturday' => [2, 4]],
        ]);

        $this->actingAs($admin);

        $this->assertNull(WeeklyOffPolicy::find($foreign->id));
        $this->assertNotNull(WeeklyOffPolicy::find($ours->id));
        $this->assertSame(1, WeeklyOffPolicy::count());

        // Pinning explicitly is how a queued job or console command must reach
        // a tenant, because the global scope is a no-op with no acting user.
        $this->assertSame(1, WeeklyOffPolicy::forOrganization($theirs->id)->count());
    }

    public function test_creating_a_policy_stamps_the_acting_organization(): void
    {
        $mine = $this->organization('Mine', 'mine-stamp');
        $admin = $this->employee($mine, 'stamp-wtp@example.com');

        $this->actingAs($admin);

        $policy = OvertimePolicy::create(['name' => 'Standard OT']);

        $this->assertSame($mine->id, $policy->organization_id);
    }

    public function test_the_weekly_off_day_rules_survive_a_round_trip_as_an_array(): void
    {
        $organization = $this->organization('Round Trip', 'round-trip-wtp');

        WeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'name' => 'Five Day',
            'day_rules' => ['sunday' => 'every', 'saturday' => [2, 4]],
        ]);

        $stored = WeeklyOffPolicy::withoutOrganizationScope()->firstOrFail();

        $this->assertIsArray($stored->day_rules);
        $this->assertSame(['sunday' => 'every', 'saturday' => [2, 4]], $stored->day_rules);
        // And it still evaluates after the round trip — a JSON column that
        // decodes to a string would pass an isArray check on write and fail here.
        $this->assertTrue($stored->isOffOn('2026-08-22'));
        $this->assertFalse($stored->isOffOn('2026-08-15'));
    }

    public function test_the_half_day_ladder_is_ordered_and_not_a_single_threshold(): void
    {
        $organization = $this->organization('Ladder', 'ladder-wtp');

        $policy = PenalisationPolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'name' => 'Standard',
            'grace_period_minutes' => 15,
            'late_rule_type' => 'incident',
            'late_threshold' => 3,
            'exemptions_per_cycle' => 2,
            'cycle' => 'monthly',
            'ignore_late_when_hours_met' => true,
            'hours_basis' => 'effective',
            'no_show_below_hours' => 4.5,
            'treat_penalties_as_lop' => true,
        ]);

        // Deliberately inserted out of order: the relationship, not the insert
        // order, is what has to produce the ladder.
        foreach ([[50, 0.5, 20], [25, 1.0, 10]] as [$percent, $leaves, $sort]) {
            PenalisationHalfDayRule::withoutOrganizationScope()->create([
                'organization_id' => $organization->id,
                'penalisation_policy_id' => $policy->id,
                'sort_order' => $sort,
                'percent_of_shift_hours' => $percent,
                'leaves_deducted' => $leaves,
            ]);
        }

        $ladder = $policy->fresh()->halfDayRules;

        $this->assertCount(2, $ladder, 'A ladder is a set of rows, not one threshold column.');
        $this->assertSame('25.00', (string) $ladder[0]->percent_of_shift_hours);
        $this->assertSame('1.00', (string) $ladder[0]->leaves_deducted);
        $this->assertSame('50.00', (string) $ladder[1]->percent_of_shift_hours);
        $this->assertSame('0.50', (string) $ladder[1]->leaves_deducted);

        $this->assertFalse(
            Schema::hasColumn('penalisation_policies', 'half_day_threshold'),
            'Half-day is a ladder in the documented model; a single threshold column would be wrong.'
        );
    }

    public function test_penalisation_scalars_cast_to_the_right_types(): void
    {
        $organization = $this->organization('Casts', 'casts-wtp');

        PenalisationPolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'name' => 'Cast Check',
            'grace_period_minutes' => '15',
            'late_threshold' => '3',
            'exemptions_per_cycle' => '2',
            'ignore_late_when_hours_met' => 1,
            'no_show_below_hours' => 4.5,
            'treat_penalties_as_lop' => 0,
        ]);

        $policy = PenalisationPolicy::withoutOrganizationScope()->firstOrFail();

        $this->assertSame(15, $policy->grace_period_minutes);
        $this->assertSame(2, $policy->exemptions_per_cycle);
        $this->assertSame('3.00', (string) $policy->late_threshold);
        $this->assertSame('4.50', (string) $policy->no_show_below_hours);
        $this->assertTrue($policy->ignore_late_when_hours_met);
        $this->assertFalse($policy->treat_penalties_as_lop);
    }

    public function test_overtime_carries_three_independent_scopes(): void
    {
        $organization = $this->organization('OT', 'ot-wtp');

        $policy = OvertimePolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'name' => 'Standard OT',
            'hours_basis' => 'gross',
            'minimum_minutes_before_accrual' => 30,
            'rounding' => 'nearest',
            'rounding_increment_minutes' => 15,
            'requires_approval' => true,
            'pay_code' => 'OT-STD',
        ]);

        foreach ([
            ['working_day', 'pay', 1.50],
            ['weekly_off', 'comp_off', 1.00],
            ['holiday', 'pay', 2.00],
        ] as [$scope, $treatment, $multiplier]) {
            OvertimePolicyScope::withoutOrganizationScope()->create([
                'organization_id' => $organization->id,
                'overtime_policy_id' => $policy->id,
                'scope' => $scope,
                'treatment' => $treatment,
                'multiplier' => $multiplier,
            ]);
        }

        $scopes = $policy->fresh()->rateScopes->keyBy('scope');

        $this->assertCount(3, $scopes);
        $this->assertSame('pay', $scopes['working_day']->treatment);
        $this->assertSame('1.50', (string) $scopes['working_day']->multiplier);
        $this->assertSame('comp_off', $scopes['weekly_off']->treatment);
        $this->assertSame('2.00', (string) $scopes['holiday']->multiplier);
        $this->assertSame(30, $policy->minimum_minutes_before_accrual);
        $this->assertTrue($policy->requires_approval);
    }

    public function test_an_extended_overtime_rate_carries_a_validity_window_cast_as_a_plain_date(): void
    {
        $organization = $this->organization('Extended', 'extended-wtp');

        $policy = OvertimePolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'name' => 'Festive OT',
        ]);

        $extended = OvertimePolicyScope::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'overtime_policy_id' => $policy->id,
            'scope' => 'working_day',
            'treatment' => 'pay',
            'multiplier' => 2.50,
            'applies_after_minutes' => 120,
            'effective_from' => '2026-10-01',
            'effective_to' => '2026-11-15',
        ]);

        $reloaded = OvertimePolicyScope::withoutOrganizationScope()->findOrFail($extended->id);

        // date:Y-m-d, not date — a bare date cast serialises as UTC midnight and
        // an IST client reads the window as starting a day early.
        $this->assertSame('2026-10-01', $reloaded->toArray()['effective_from']);
        $this->assertSame('2026-11-15', $reloaded->toArray()['effective_to']);
        $this->assertSame(120, $reloaded->applies_after_minutes);
    }

    public function test_shift_allowance_holds_night_and_weekend_premiums_and_the_night_window(): void
    {
        $organization = $this->organization('Allowance', 'allowance-wtp');

        ShiftAllowancePolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'name' => 'Night Premium',
            'night_allowance_type' => 'percentage',
            'night_percentage' => 12.5,
            'night_window_start' => '22:00',
            'night_window_end' => '06:00',
            'night_minimum_minutes_in_window' => 240,
            'weekend_allowance_type' => 'fixed',
            'weekend_fixed' => 500,
        ]);

        $policy = ShiftAllowancePolicy::withoutOrganizationScope()->firstOrFail();

        $this->assertSame('12.50', (string) $policy->night_percentage);
        $this->assertSame('500.00', (string) $policy->weekend_fixed);
        $this->assertSame(240, $policy->night_minimum_minutes_in_window);

        // Times are wall-clock readings with no date. Normalised on read the
        // same way Shift does it, and deliberately NOT cast to a Carbon — the
        // night window crosses midnight, and a Carbon pinned to today would
        // claim it ends sixteen hours before it starts.
        $this->assertSame('22:00:00', $policy->night_window_start);
        $this->assertSame('06:00:00', $policy->night_window_end);
    }

    public function test_each_policy_is_assigned_to_a_person_effective_dated_like_employee_shifts(): void
    {
        $organization = $this->organization('Assign', 'assign-wtp');
        $employee = $this->employee($organization, 'assignee-wtp@example.com');

        $weeklyOff = WeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'name' => 'Five Day',
            'day_rules' => ['sunday' => 'every', 'saturday' => [2, 4]],
        ]);
        $penalisation = PenalisationPolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'name' => 'Standard',
        ]);
        $overtime = OvertimePolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'name' => 'Standard OT',
        ]);
        $allowance = ShiftAllowancePolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'name' => 'Night Premium',
        ]);

        $assignments = [
            EmployeeWeeklyOffPolicy::class => ['weekly_off_policy_id' => $weeklyOff->id],
            EmployeePenalisationPolicy::class => ['penalisation_policy_id' => $penalisation->id],
            EmployeeOvertimePolicy::class => ['overtime_policy_id' => $overtime->id],
            EmployeeShiftAllowancePolicy::class => ['shift_allowance_policy_id' => $allowance->id],
        ];

        foreach ($assignments as $class => $key) {
            $row = $class::withoutOrganizationScope()->create(array_merge([
                'organization_id' => $organization->id,
                'user_id' => $employee->id,
                'effective_from' => '2026-04-01',
                'effective_to' => null,
                'is_active' => true,
            ], $key));

            $reloaded = $class::withoutOrganizationScope()->findOrFail($row->id);

            $this->assertSame('2026-04-01', $reloaded->toArray()['effective_from'], "{$class} effective_from");
            $this->assertNull($reloaded->toArray()['effective_to'], "{$class} effective_to");
            $this->assertTrue($reloaded->is_active, "{$class} is_active");
            $this->assertSame($employee->id, $reloaded->user->id, "{$class} user relationship");
            $this->assertNotNull($reloaded->policy, "{$class} policy relationship");
        }
    }

    public function test_reassignment_is_a_new_row_so_an_earlier_month_still_resolves_the_old_policy(): void
    {
        $organization = $this->organization('History', 'history-wtp');
        $employee = $this->employee($organization, 'history-wtp@example.com');

        $sixDay = WeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'name' => 'Six Day',
            'day_rules' => ['sunday' => 'every'],
        ]);
        $fiveDay = WeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'name' => 'Five Day',
            'day_rules' => ['sunday' => 'every', 'saturday' => 'every'],
        ]);

        foreach ([[$sixDay, '2026-01-01'], [$fiveDay, '2026-07-01']] as [$policy, $from]) {
            EmployeeWeeklyOffPolicy::withoutOrganizationScope()->create([
                'organization_id' => $organization->id,
                'user_id' => $employee->id,
                'weekly_off_policy_id' => $policy->id,
                'effective_from' => $from,
                'is_active' => true,
            ]);
        }

        $rows = EmployeeWeeklyOffPolicy::withoutOrganizationScope()
            ->where('user_id', $employee->id)
            ->orderBy('effective_from')
            ->get();

        $this->assertCount(2, $rows, 'Re-assignment must append a row, not edit the old one.');
        $this->assertSame($sixDay->id, $rows[0]->weekly_off_policy_id);
        $this->assertSame($fiveDay->id, $rows[1]->weekly_off_policy_id);
    }
}
