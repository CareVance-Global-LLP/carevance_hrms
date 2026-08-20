<?php

namespace Tests\Feature;

use App\Models\EmployeePenalisationPolicy;
use App\Models\EmployeeShift;
use App\Models\EmployeeWeeklyOffPolicy;
use App\Models\PenalisationPolicy;
use App\Models\Organization;
use App\Models\Shift;
use App\Models\User;
use App\Models\WeeklyOffPolicy;
use App\Services\Attendance\DayOutcomeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * A weekly off is not a day anybody failed to work.
 *
 * DayOutcomeService already exempts approved leave and public holidays, with
 * the reasoning "no shift was owed, so no attendance penalty applies". A weekly
 * off is that same case and was simply missed: the day was labelled
 * `weekly_off` and then handed to the penalisation engine anyway, which saw
 * zero worked seconds against an eight-hour shift and called it a no-show.
 *
 * Caught by a browser run on 20 Aug 2026: the calendar drew "Weekly off" and
 * "LOP 1.00 day" on the same cells, and charged 18 LOP days across 20 elapsed
 * days. In a payroll product that is docked pay for days nobody was rostered.
 */
class WeeklyOffNotPenalisedTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_weekly_off_is_never_charged_loss_of_pay(): void
    {
        [$organization, $employee] = $this->employeeWithSundayOff();

        // 2026-08-09 is a Sunday, and the employee is rostered Mon-Sun on an
        // 8h shift, so without the guard the engine sees a full shift unworked.
        $outcome = $this->dayOutcome($employee, '2026-08-09');

        $this->assertTrue($outcome['is_weekly_off'], 'expected the day to be a weekly off');

        $penalisation = $outcome['penalisation'];

        $this->assertNotSame('no_show', $penalisation['status'] ?? null, 'a weekly off must not be a no-show');
        $this->assertSame(
            0.0,
            (float) ($penalisation['lop_days'] ?? 0),
            'a weekly off must never cost loss of pay'
        );
    }

    public function test_a_working_day_is_still_judged(): void
    {
        [$organization, $employee] = $this->employeeWithSundayOff();

        // Monday: a real rostered day with no attendance recorded. The guard
        // must not have suppressed judgement everywhere.
        $outcome = $this->dayOutcome($employee, '2026-08-10');

        $this->assertFalse($outcome['is_weekly_off']);
        $this->assertSame('no_show', $outcome['penalisation']['status'] ?? null);
    }

    /**
     * One day out of the month payload the API actually serves.
     *
     * @return array<string, mixed>
     */
    private function dayOutcome(User $employee, string $date): array
    {
        $result = app(DayOutcomeService::class)->forMonth($employee, $employee->id, substr($date, 0, 7));

        $this->assertSame(200, $result['status'], 'expected the month to be readable');

        $day = collect($result['payload']['days'])->firstWhere('date', $date);

        $this->assertNotNull($day, "expected a row for {$date}");

        return $day;
    }

    /** @return array{0: Organization, 1: User} */
    private function employeeWithSundayOff(): array
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);

        $employee = User::create([
            'name' => 'Rostered Employee',
            'email' => 'rostered@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $shift = Shift::create([
            'organization_id' => $organization->id,
            'name' => 'Day Shift',
            'code' => 'DAY',
            'type' => 'general',
            'start_time' => '09:00:00',
            'end_time' => '18:00:00',
            'duration_minutes' => 540,
            'break_duration_minutes' => 60,
            'is_active' => true,
        ]);

        EmployeeShift::create([
            'organization_id' => $organization->id,
            'user_id' => $employee->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-08-01',
            'is_active' => true,
        ]);

        $policy = WeeklyOffPolicy::create([
            'organization_id' => $organization->id,
            'name' => 'Sunday off',
            'day_rules' => ['sunday' => ['mode' => 'every']],
            'is_active' => true,
        ]);

        EmployeeWeeklyOffPolicy::create([
            'organization_id' => $organization->id,
            'user_id' => $employee->id,
            'weekly_off_policy_id' => $policy->id,
            'effective_from' => '2026-08-01',
            'is_active' => true,
        ]);

        // Without a penalisation policy nothing is ever judged, so the weekly-off
        // assertion would pass vacuously. `no_show_below_hours` is what turns an
        // unworked day into a loss-of-pay day, and it is the rule that was
        // firing on rest days.
        $penalisation = PenalisationPolicy::create([
            'organization_id' => $organization->id,
            'name' => 'Standard',
            'grace_period_minutes' => 15,
            'hours_basis' => 'effective',
            'no_show_below_hours' => 4,
            'treat_penalties_as_lop' => true,
            'is_active' => true,
        ]);

        EmployeePenalisationPolicy::create([
            'organization_id' => $organization->id,
            'user_id' => $employee->id,
            'penalisation_policy_id' => $penalisation->id,
            'effective_from' => '2026-08-01',
            'is_active' => true,
        ]);

        return [$organization, $employee];
    }
}
