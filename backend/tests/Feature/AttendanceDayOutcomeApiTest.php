<?php

namespace Tests\Feature;

use App\Models\AttendanceHoliday;
use App\Models\AttendanceRecord;
use App\Models\AttendanceTimeEditRequest;
use App\Models\EmployeeOvertimePolicy;
use App\Models\EmployeePenalisationPolicy;
use App\Models\EmployeeShift;
use App\Models\EmployeeWeeklyOffPolicy;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\OvertimePolicy;
use App\Models\OvertimePolicyScope;
use App\Models\PenalisationHalfDayRule;
use App\Models\PenalisationPolicy;
use App\Models\Shift;
use App\Models\User;
use App\Models\WeeklyOffPolicy;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The outcomes endpoint that puts the penalisation and overtime engines on the
 * screen people actually look at.
 *
 * The engines already decide correctly. What they had no way to do was reach
 * anybody: the attendance calendar rendered a grey cell for a weekly off and
 * the identical grey cell for an unexplained absence, and said "half day"
 * without ever saying which rung fired or what it measured. A penalty an
 * employee cannot see the working of is a penalty they cannot dispute, which is
 * exactly the conversation this endpoint has to survive.
 *
 * The dates are pinned, never inferred from a weekday name:
 *
 *   2026-08-19 is a WEDNESDAY — an ordinary working day, and "today".
 *   2026-08-16 is a SUNDAY    — the weekly off in these fixtures.
 *   2026-08-15 is a SATURDAY  — the public holiday.
 *   2026-08-26 is a WEDNESDAY — in the future, so nothing may be judged on it.
 */
class AttendanceDayOutcomeApiTest extends TestCase
{
    use RefreshDatabase;

    private const TZ = 'Asia/Kolkata';
    private const WEDNESDAY = '2026-08-19';
    private const SUNDAY = '2026-08-16';
    private const SATURDAY_HOLIDAY = '2026-08-15';
    private const FUTURE_WEDNESDAY = '2026-08-26';

    private Organization $organization;
    private User $admin;
    private User $employee;
    private User $colleague;

    protected function setUp(): void
    {
        parent::setUp();

        Carbon::setTestNow('2026-08-19 18:30:00');

        $this->organization = Organization::create(['name' => 'Acme', 'slug' => 'acme-outcomes']);
        $this->admin = $this->makeUser('outcome-admin@example.com', 'admin');
        $this->employee = $this->makeUser('outcome-employee@example.com', 'employee');
        $this->colleague = $this->makeUser('outcome-colleague@example.com', 'employee');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    private function makeUser(string $email, string $role): User
    {
        return User::create([
            'name' => ucfirst($role),
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $this->organization->id,
        ]);
    }

    /**
     * A 09:00-18:00 shift with a one-hour break: 540 gross minutes, 480
     * effective. Every percentage in this file is against that eight hours.
     *
     * @param array<string, mixed> $attributes
     */
    private function rosterOn(User $user, array $attributes = []): Shift
    {
        $shift = Shift::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $this->organization->id,
            'name' => 'General',
            'code' => 'GEN'.uniqid(),
            'type' => 'general',
            'start_time' => '09:00:00',
            'end_time' => '18:00:00',
            'duration_minutes' => 540,
            'break_duration_minutes' => 60,
            'grace_period_minutes' => 0,
            'is_active' => true,
        ], $attributes));

        EmployeeShift::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);

        return $shift;
    }

    /** @param array<string, mixed> $attributes */
    private function penalisationPolicy(User $user, array $attributes = []): PenalisationPolicy
    {
        $policy = PenalisationPolicy::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $this->organization->id,
            'name' => 'Standard '.uniqid(),
            'grace_period_minutes' => 15,
            'late_rule_type' => PenalisationPolicy::LATE_RULE_INCIDENT,
            'late_threshold' => 1,
            'exemptions_per_cycle' => 0,
            'cycle' => PenalisationPolicy::CYCLE_MONTHLY,
            'ignore_late_when_hours_met' => false,
            'hours_basis' => PenalisationPolicy::BASIS_EFFECTIVE,
            'no_show_below_hours' => null,
            'treat_penalties_as_lop' => true,
            'is_active' => true,
        ], $attributes));

        EmployeePenalisationPolicy::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'penalisation_policy_id' => $policy->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);

        return $policy;
    }

    /** @param array<int|string, mixed> $rungs percent => leaves */
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

    private function sundaysOff(User $user): WeeklyOffPolicy
    {
        $policy = WeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'name' => 'Sundays '.uniqid(),
            'day_rules' => ['sunday' => 'every'],
            'is_active' => true,
        ]);

        EmployeeWeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'weekly_off_policy_id' => $policy->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);

        return $policy;
    }

    /** @param array<string, mixed> $attributes */
    private function overtimePolicy(User $user, array $attributes = []): OvertimePolicy
    {
        $policy = OvertimePolicy::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $this->organization->id,
            'name' => 'OT '.uniqid(),
            'hours_basis' => OvertimePolicy::BASIS_EFFECTIVE,
            'minimum_minutes_before_accrual' => 0,
            'rounding' => OvertimePolicy::ROUNDING_NEAREST,
            'rounding_increment_minutes' => 15,
            'requires_approval' => true,
            'is_active' => true,
        ], $attributes));

        OvertimePolicyScope::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'overtime_policy_id' => $policy->id,
            'scope' => OvertimePolicyScope::SCOPE_WORKING_DAY,
            'treatment' => OvertimePolicyScope::TREATMENT_PAY,
            'multiplier' => 1.50,
            'applies_after_minutes' => 0,
        ]);

        OvertimePolicyScope::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'overtime_policy_id' => $policy->id,
            'scope' => OvertimePolicyScope::SCOPE_WEEKLY_OFF,
            'treatment' => OvertimePolicyScope::TREATMENT_COMP_OFF,
            'multiplier' => 2.00,
            'applies_after_minutes' => 0,
        ]);

        EmployeeOvertimePolicy::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'overtime_policy_id' => $policy->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);

        return $policy;
    }

    private function record(
        User $user,
        string $date,
        ?string $checkIn = null,
        int $workedSeconds = 0,
        ?string $checkOut = null,
    ): AttendanceRecord {
        return AttendanceRecord::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'attendance_date' => $date,
            'check_in_at' => $checkIn ? Carbon::parse($date.' '.$checkIn, self::TZ) : null,
            'check_out_at' => $checkOut ? Carbon::parse($date.' '.$checkOut, self::TZ) : null,
            'worked_seconds' => $workedSeconds,
            'status' => 'present',
        ]);
    }

    /** @return array<string, mixed>|null */
    private function dayFor(array $days, string $date): ?array
    {
        foreach ($days as $day) {
            if (($day['date'] ?? null) === $date) {
                return $day;
            }
        }

        return null;
    }

    private function fetch(User $actor, ?int $forUserId = null): array
    {
        $query = ['month' => '2026-08'];
        if ($forUserId !== null) {
            $query['user_id'] = $forUserId;
        }

        return $this->getJson('/api/attendance/day-outcomes?'.http_build_query($query), $this->apiHeadersFor($actor))
            ->assertOk()
            ->json();
    }

    // -----------------------------------------------------------------
    // A weekly off is not an absence
    // -----------------------------------------------------------------

    public function test_a_weekly_off_is_reported_as_a_weekly_off_and_never_as_an_absence(): void
    {
        $this->rosterOn($this->employee);
        $this->sundaysOff($this->employee);

        $days = $this->fetch($this->employee)['days'];
        $sunday = $this->dayFor($days, self::SUNDAY);

        $this->assertNotNull($sunday, 'The Sunday is missing from the month.');
        $this->assertSame('weekly_off', $sunday['kind']);
        $this->assertTrue($sunday['is_weekly_off']);
        $this->assertFalse($sunday['is_absence'], 'A weekly off must never read as an absence.');
        $this->assertNotSame(
            'no_show',
            $sunday['penalisation']['status'],
            'Nothing was expected on a weekly off, so nothing can be a no show.',
        );
    }

    public function test_a_missed_working_day_is_an_absence_so_the_two_cannot_look_alike(): void
    {
        $this->rosterOn($this->employee);
        $this->sundaysOff($this->employee);

        // Tuesday the 18th: rostered, not a weekly off, and no record at all.
        $days = $this->fetch($this->employee)['days'];
        $missed = $this->dayFor($days, '2026-08-18');

        $this->assertNotNull($missed);
        $this->assertSame('working', $missed['kind']);
        $this->assertFalse($missed['is_weekly_off']);
        $this->assertTrue($missed['is_absence']);
    }

    public function test_a_public_holiday_outranks_the_weekly_off_label(): void
    {
        $this->rosterOn($this->employee);
        AttendanceHoliday::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'holiday_date' => self::SATURDAY_HOLIDAY,
            'country' => 'ALL',
            'title' => 'Independence Day',
        ]);

        $days = $this->fetch($this->employee)['days'];
        $holiday = $this->dayFor($days, self::SATURDAY_HOLIDAY);

        $this->assertSame('holiday', $holiday['kind']);
        $this->assertSame('Independence Day', $holiday['holiday_title']);
        $this->assertFalse($holiday['is_absence']);
    }

    /**
     * The precedence above is only a precedence when the two actually collide.
     *
     * The test before this one puts the holiday on a Saturday that no policy
     * marks off, so it never exercises the ordering it is named for — reversing
     * the `holiday` and `weekly_off` arms of DayOutcomeService::dayFor leaves it
     * green. A public holiday landing on somebody's weekly off is the ordinary
     * case, not an edge one: Sunday holidays exist every year.
     *
     * Both facts are asserted together because they are the same fact seen
     * twice. `kind` comes from DayOutcomeService and `overtime.scope` from
     * OvertimeEngine::scopeFor, which decide the ordering independently — and
     * if they ever disagree, the day is drawn as a holiday while its extra
     * hours are paid at the weekly-off rate.
     */
    public function test_a_holiday_falling_on_a_weekly_off_is_a_holiday_to_both_engines(): void
    {
        $this->rosterOn($this->employee);
        $this->sundaysOff($this->employee);
        $this->overtimePolicy($this->employee);

        AttendanceHoliday::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'holiday_date' => self::SUNDAY,
            'country' => 'ALL',
            'title' => 'Sunday Holiday',
        ]);

        $days = $this->fetch($this->employee)['days'];
        $day = $this->dayFor($days, self::SUNDAY);

        $this->assertSame('holiday', $day['kind'], 'A weekly off swallowed the holiday label.');
        $this->assertSame('Sunday Holiday', $day['holiday_title']);
        // Still genuinely a weekly off — the flag stays true, only the headline
        // fact changes, so nothing downstream loses the day off.
        $this->assertTrue($day['is_weekly_off']);
        $this->assertTrue($day['is_holiday']);
        $this->assertFalse($day['is_absence']);
        $this->assertSame(
            'holiday',
            $day['overtime']['scope'],
            'The two engines disagreed about what kind of day this was.'
        );
    }

    // -----------------------------------------------------------------
    // The penalisation outcome, and the reason
    // -----------------------------------------------------------------

    public function test_a_short_day_reports_the_half_day_rung_and_says_what_it_measured(): void
    {
        $this->rosterOn($this->employee);
        $policy = $this->penalisationPolicy($this->employee);
        $this->ladder($policy, ['50' => '0.5']);

        // 3h12m = 11520s of an eight hour effective shift, which is 40%.
        $this->record($this->employee, self::WEDNESDAY, '09:00:00', 11520, '12:12:00');

        $days = $this->fetch($this->employee)['days'];
        $day = $this->dayFor($days, self::WEDNESDAY);

        $this->assertSame('half_day', $day['penalisation']['status']);
        $this->assertSame('0.50', $day['penalisation']['cost']['lop_days']);
        $this->assertStringContainsString('3h 12m', $day['penalisation']['explanation']);
        $this->assertStringContainsString('50.00% rung', $day['penalisation']['explanation']);
        $this->assertNotEmpty($day['penalisation']['reasons']);
    }

    public function test_a_late_arrival_reports_the_grace_it_broke(): void
    {
        $this->rosterOn($this->employee);
        $this->penalisationPolicy($this->employee, ['grace_period_minutes' => 15]);

        $this->record($this->employee, self::WEDNESDAY, '09:47:00', 28800, '18:47:00');

        $days = $this->fetch($this->employee)['days'];
        $day = $this->dayFor($days, self::WEDNESDAY);

        $this->assertTrue($day['penalisation']['late']['is_late']);
        $this->assertSame(15, $day['penalisation']['late']['grace_period_minutes']);
        $this->assertStringContainsString('15 minute grace', $day['penalisation']['explanation']);
    }

    public function test_a_day_covered_by_approved_leave_is_not_judged_as_a_no_show(): void
    {
        $this->rosterOn($this->employee);
        $this->penalisationPolicy($this->employee, ['no_show_below_hours' => 4]);

        LeaveRequest::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'leave_category' => 'casual',
            'start_date' => self::WEDNESDAY,
            'end_date' => self::WEDNESDAY,
            'reason' => 'Family',
            'status' => 'approved',
        ]);

        $days = $this->fetch($this->employee)['days'];
        $day = $this->dayFor($days, self::WEDNESDAY);

        $this->assertSame('leave', $day['kind']);
        $this->assertFalse($day['is_absence']);
        $this->assertSame('not_evaluated', $day['penalisation']['status']);
    }

    public function test_a_future_date_is_never_judged(): void
    {
        $this->rosterOn($this->employee);
        $this->penalisationPolicy($this->employee, ['no_show_below_hours' => 4]);

        $days = $this->fetch($this->employee)['days'];
        $future = $this->dayFor($days, self::FUTURE_WEDNESDAY);

        $this->assertNotNull($future, 'The whole month must be returned, future days included.');
        $this->assertFalse($future['is_evaluated']);
        $this->assertFalse($future['is_absence'], 'A day that has not happened is not an absence.');
        $this->assertSame('not_evaluated', $future['penalisation']['status']);
    }

    // -----------------------------------------------------------------
    // Overtime: scope, and pending never folded into counted
    // -----------------------------------------------------------------

    public function test_overtime_awaiting_approval_is_reported_as_pending_and_counts_nothing(): void
    {
        $this->rosterOn($this->employee);
        $this->overtimePolicy($this->employee);

        // Nine effective hours against an eight hour shift: one hour over.
        $this->record($this->employee, self::WEDNESDAY, '09:00:00', 32400, '19:00:00');

        $days = $this->fetch($this->employee)['days'];
        $day = $this->dayFor($days, self::WEDNESDAY);

        $this->assertSame('working_day', $day['overtime']['scope']);
        $this->assertSame('pending', $day['overtime']['approval_state']);
        $this->assertSame(60, $day['overtime']['pending_minutes']);
        $this->assertSame(0, $day['overtime']['counted_minutes']);
    }

    public function test_an_approved_time_edit_moves_the_same_overtime_into_counted(): void
    {
        $this->rosterOn($this->employee);
        $this->overtimePolicy($this->employee);
        $this->record($this->employee, self::WEDNESDAY, '09:00:00', 32400, '19:00:00');

        AttendanceTimeEditRequest::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'attendance_date' => self::WEDNESDAY,
            'extra_seconds' => 3600,
            'message' => 'Stayed for the release',
            'status' => 'approved',
        ]);

        $days = $this->fetch($this->employee)['days'];
        $day = $this->dayFor($days, self::WEDNESDAY);

        $this->assertSame('approved', $day['overtime']['approval_state']);
        $this->assertSame(60, $day['overtime']['counted_minutes']);
        $this->assertSame(0, $day['overtime']['pending_minutes']);
    }

    public function test_weekly_off_overtime_keeps_its_own_scope_and_comp_off_treatment(): void
    {
        $this->rosterOn($this->employee);
        $this->sundaysOff($this->employee);
        $this->overtimePolicy($this->employee);

        // Four hours worked on the Sunday off.
        $this->record($this->employee, self::SUNDAY, '10:00:00', 14400, '14:00:00');

        $days = $this->fetch($this->employee)['days'];
        $sunday = $this->dayFor($days, self::SUNDAY);

        $this->assertSame('weekly_off', $sunday['overtime']['scope']);
        $this->assertSame('comp_off', $sunday['overtime']['treatment']);
        $this->assertSame(240, $sunday['overtime']['pending_minutes']);
    }

    // -----------------------------------------------------------------
    // Who may read whose
    // -----------------------------------------------------------------

    public function test_an_employee_cannot_read_a_colleagues_outcomes(): void
    {
        $this->rosterOn($this->colleague);

        $this->getJson(
            '/api/attendance/day-outcomes?month=2026-08&user_id='.$this->colleague->id,
            $this->apiHeadersFor($this->employee),
        )->assertForbidden();
    }

    public function test_an_admin_may_read_an_employees_outcomes(): void
    {
        $this->rosterOn($this->employee);
        $this->penalisationPolicy($this->employee);
        $this->record($this->employee, self::WEDNESDAY, '09:00:00', 28800, '18:00:00');

        $payload = $this->fetch($this->admin, $this->employee->id);

        $this->assertSame($this->employee->id, $payload['user_id']);
        $this->assertSame('2026-08', $payload['month']);
        $this->assertCount(31, $payload['days']);
    }

    public function test_another_tenants_employee_is_refused(): void
    {
        $rival = Organization::create(['name' => 'Rival', 'slug' => 'rival-outcomes']);
        $outsider = User::create([
            'name' => 'Outsider',
            'email' => 'outsider-outcomes@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $rival->id,
        ]);

        $this->getJson(
            '/api/attendance/day-outcomes?month=2026-08&user_id='.$outsider->id,
            $this->apiHeadersFor($this->admin),
        )->assertForbidden();
    }
}
