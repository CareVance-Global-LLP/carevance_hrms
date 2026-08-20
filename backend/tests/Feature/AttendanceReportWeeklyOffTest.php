<?php

namespace Tests\Feature;

use App\Models\AttendanceHoliday;
use App\Models\AttendanceRecord;
use App\Models\EmployeeWeeklyOffPolicy;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\User;
use App\Models\WeeklyOffPolicy;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * `GET /reports/attendance`, and the four things it used to call an absence
 * that were not one.
 *
 * The attendance calendar learned to tell a weekly off from a missed day (see
 * AttendanceDayOutcomeApiTest). The report did not, and the report is the
 * screen a manager actually reviews people on. It decided who was absent by
 * `Carbon::isWeekend()` -- a hardcoded Saturday and Sunday -- so:
 *
 *   A SIX-DAY WEEK, which is most of the Indian market, had every Saturday
 *   silently excused. Somebody who simply did not turn up on Saturday was
 *   invisible in the one report meant to find them.
 *
 *   A ROTATING OR MID-WEEK OFF -- Wednesday off, alternate Saturdays -- was
 *   counted as an absence every single week, against an employee who was
 *   working exactly the days they were told to.
 *
 *   APPROVED LEAVE and a PUBLIC HOLIDAY both landed in `absent_dates` too, and
 *   so did every day of the rest of the year: the default range runs to
 *   December, and a day that has not happened yet had not been missed.
 *
 * The fix resolves the weekly off through the real WeeklyOffPolicy, and keeps
 * the Saturday/Sunday assumption as the fallback for an organization that has
 * configured none -- the same "policy wins when present, the old default
 * otherwise" rule the shift columns follow.
 *
 * Dates are pinned, never inferred from a weekday name:
 *
 *   2026-08-03 MONDAY ... 2026-08-07 FRIDAY
 *   2026-08-05 WEDNESDAY  -- the mid-week off, the leave day, the holiday
 *   2026-08-08 SATURDAY   -- worked in a six-day week
 *   2026-08-09 SUNDAY     -- off in every fixture here
 */
class AttendanceReportWeeklyOffTest extends TestCase
{
    use RefreshDatabase;

    private const MONDAY = '2026-08-03';
    private const TUESDAY = '2026-08-04';
    private const WEDNESDAY = '2026-08-05';
    private const THURSDAY = '2026-08-06';
    private const FRIDAY = '2026-08-07';
    private const SATURDAY = '2026-08-08';
    private const SUNDAY = '2026-08-09';

    private Organization $organization;

    private User $admin;

    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        // The whole fixture week is in the past, so nothing is excused merely
        // for not having happened yet. The future-dates test moves this.
        Carbon::setTestNow('2026-08-10 09:00:00');

        $this->organization = Organization::create(['name' => 'Acme', 'slug' => 'acme-report-offs']);
        $this->admin = $this->makeUser($this->organization, 'report-admin@example.com', 'admin');
        $this->employee = $this->makeUser($this->organization, 'report-employee@example.com', 'employee');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    private function makeUser(Organization $organization, string $email, string $role): User
    {
        return User::create([
            'name' => ucfirst($role),
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $organization->id,
        ]);
    }

    /**
     * @param  array<string, mixed>  $rules  keyed by weekday name
     */
    private function weeklyOff(User $user, array $rules): WeeklyOffPolicy
    {
        $policy = WeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $user->organization_id,
            'name' => 'Offs '.uniqid(),
            'day_rules' => $rules,
            'is_default' => false,
            'is_active' => true,
        ]);

        EmployeeWeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'weekly_off_policy_id' => $policy->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);

        return $policy;
    }

    private function present(User $user, string $date): AttendanceRecord
    {
        return AttendanceRecord::withoutOrganizationScope()->create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'attendance_date' => $date,
            'check_in_at' => $date.' 09:00:00',
            'check_out_at' => $date.' 18:00:00',
            'worked_seconds' => 28800,
            'manual_adjustment_seconds' => 0,
            'late_minutes' => 0,
            'status' => 'present',
        ]);
    }

    /** @return array<string, mixed> */
    private function row(string $start = self::MONDAY, string $end = self::SUNDAY): array
    {
        $query = http_build_query([
            'start_date' => $start,
            'end_date' => $end,
            'user_id' => $this->employee->id,
        ]);

        return $this->getJson("/api/reports/attendance?{$query}", $this->apiHeadersFor($this->admin))
            ->assertOk()
            ->json('data.0');
    }

    // -----------------------------------------------------------------
    // A weekly off is not an absence
    // -----------------------------------------------------------------

    public function test_a_mid_week_off_is_reported_as_a_weekly_off_and_never_as_an_absence(): void
    {
        $this->weeklyOff($this->employee, ['wednesday' => 'every']);

        foreach ([self::MONDAY, self::TUESDAY, self::THURSDAY, self::FRIDAY, self::SATURDAY, self::SUNDAY] as $date) {
            $this->present($this->employee, $date);
        }

        $row = $this->row();

        $this->assertSame([self::WEDNESDAY], $row['weekly_off_dates']);
        $this->assertSame('policy', $row['weekly_off_source']);
        $this->assertSame([], $row['absent_dates'], 'The Wednesday off was counted as an absence.');
        $this->assertSame(0, $row['absent_days']);
        // Seven calendar days less the one day nobody was owed.
        $this->assertSame(6, $row['expected_days']);
    }

    public function test_a_missed_saturday_in_a_six_day_week_is_an_absence_rather_than_a_weekend(): void
    {
        $this->weeklyOff($this->employee, ['sunday' => 'every']);

        foreach ([self::MONDAY, self::TUESDAY, self::WEDNESDAY, self::THURSDAY, self::FRIDAY] as $date) {
            $this->present($this->employee, $date);
        }

        $row = $this->row();

        $this->assertSame([self::SUNDAY], $row['weekly_off_dates']);
        $this->assertSame(
            [self::SATURDAY],
            $row['absent_dates'],
            'A six-day week had its missed Saturday excused as a weekend.'
        );
        $this->assertSame(1, $row['absent_days']);
        $this->assertSame(6, $row['expected_days']);
    }

    public function test_alternate_saturdays_are_off_only_on_the_weeks_the_policy_names(): void
    {
        // The range runs three weeks, so the clock has to clear all of it —
        // an absence is only counted on a day that has already finished.
        Carbon::setTestNow('2026-08-24 09:00:00');

        // 2026-08-01, 08, 15, 22 and 29 are the Saturdays of August 2026, so
        // the 2nd and the 4th are the 8th and the 22nd.
        $this->weeklyOff($this->employee, ['saturday' => [2, 4], 'sunday' => 'every']);

        $row = $this->row(self::MONDAY, '2026-08-23');

        $this->assertContains(self::SATURDAY, $row['weekly_off_dates']);
        $this->assertContains('2026-08-22', $row['weekly_off_dates']);
        $this->assertNotContains('2026-08-15', $row['weekly_off_dates'], 'The 3rd Saturday is a working day.');
        $this->assertContains('2026-08-15', $row['absent_dates']);
    }

    // -----------------------------------------------------------------
    // Nor is leave, a holiday, or a day that has not happened
    // -----------------------------------------------------------------

    public function test_an_approved_leave_day_is_not_an_absence(): void
    {
        foreach ([self::MONDAY, self::TUESDAY, self::THURSDAY, self::FRIDAY] as $date) {
            $this->present($this->employee, $date);
        }

        LeaveRequest::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'leave_type' => 'casual',
            'start_date' => self::WEDNESDAY,
            'end_date' => self::WEDNESDAY,
            'total_days' => 1,
            'reason' => 'Personal',
            'status' => 'approved',
        ]);

        $row = $this->row();

        $this->assertContains(self::WEDNESDAY, $row['leave_dates']);
        $this->assertSame([], $row['absent_dates'], 'Approved leave was counted as an absence.');
    }

    public function test_a_public_holiday_is_not_an_absence(): void
    {
        foreach ([self::MONDAY, self::TUESDAY, self::THURSDAY, self::FRIDAY] as $date) {
            $this->present($this->employee, $date);
        }

        AttendanceHoliday::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'title' => 'Founders Day',
            'holiday_date' => self::WEDNESDAY,
            'country' => 'ALL',
        ]);

        $row = $this->row();

        $this->assertSame([self::WEDNESDAY], $row['holiday_dates']);
        $this->assertSame([], $row['absent_dates'], 'A public holiday was counted as an absence.');
    }

    public function test_a_day_that_has_not_happened_yet_is_not_an_absence(): void
    {
        Carbon::setTestNow('2026-08-05 12:00:00');

        foreach ([self::MONDAY, self::TUESDAY, self::WEDNESDAY] as $date) {
            $this->present($this->employee, $date);
        }

        $row = $this->row();

        $this->assertSame(
            [],
            $row['absent_dates'],
            'Thursday and Friday had not happened yet and were already marked missed.'
        );
    }

    // -----------------------------------------------------------------
    // The fallback, and the tenant boundary
    // -----------------------------------------------------------------

    public function test_an_organization_with_no_weekly_off_policy_keeps_the_saturday_sunday_default(): void
    {
        foreach ([self::MONDAY, self::TUESDAY, self::WEDNESDAY, self::THURSDAY, self::FRIDAY] as $date) {
            $this->present($this->employee, $date);
        }

        $row = $this->row();

        $this->assertSame([self::SATURDAY, self::SUNDAY], $row['weekly_off_dates']);
        $this->assertSame('calendar_weekend', $row['weekly_off_source']);
        $this->assertSame([], $row['absent_dates']);
        $this->assertSame(5, $row['expected_days']);
    }

    public function test_another_tenants_default_weekly_off_policy_never_reaches_this_employee(): void
    {
        $otherOrganization = Organization::create(['name' => 'Rival', 'slug' => 'rival-report-offs']);
        WeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $otherOrganization->id,
            'name' => 'Rival Wednesdays',
            'day_rules' => ['wednesday' => 'every'],
            'is_default' => true,
            'is_active' => true,
        ]);

        foreach ([self::MONDAY, self::TUESDAY, self::THURSDAY, self::FRIDAY] as $date) {
            $this->present($this->employee, $date);
        }

        $row = $this->row();

        $this->assertSame('calendar_weekend', $row['weekly_off_source']);
        $this->assertNotContains(self::WEDNESDAY, $row['weekly_off_dates']);
        $this->assertSame([self::WEDNESDAY], $row['absent_dates']);
    }
}
