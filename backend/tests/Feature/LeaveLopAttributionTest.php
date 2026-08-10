<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\User;
use App\Services\Attendance\AttendanceService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Payable-day attribution for approved leave.
 *
 * The paid/unpaid decision lives in `leave_category` (and, when a request
 * overruns its quota, in `consumed_breakdown`). `leave_type` only ever holds
 * 'full_day'/'half_day', so testing it against category names silently marks
 * every leave unpaid and deducts salary for it.
 */
class LeaveLopAttributionTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
    }

    private function employee(string $email = 'employee@example.com'): User
    {
        return User::create([
            'name' => 'Employee',
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);
    }

    /** Pick a month whose 2nd..4th are weekdays, so the fixtures never land on a weekend. */
    private function weekdayIn(string $monthYear, int $nth = 1): Carbon
    {
        $date = Carbon::parse($monthYear.'-01')->startOfDay();
        $found = 0;
        while (true) {
            if (! $date->isWeekend()) {
                $found++;
                if ($found === $nth) {
                    return $date->copy();
                }
            }
            $date->addDay();
        }
    }

    private function approveLeave(User $user, Carbon $start, Carbon $end, string $category, string $type = 'full_day'): LeaveRequest
    {
        return LeaveRequest::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'start_date' => $start->toDateString(),
            'end_date' => $end->toDateString(),
            'leave_type' => $type,
            'leave_category' => $category,
            'reason' => 'test',
            'status' => 'approved',
        ]);
    }

    private function summary(User $user, string $monthYear): array
    {
        return app(AttendanceService::class)->monthlyAttendanceSummary($user, $monthYear);
    }

    /**
     * Mark the user present on every working day of the month except $excluded,
     * so that assertions on total_lop_days isolate the leave under test instead
     * of picking up the rest of the month as plain absence.
     *
     * @param array<int, string> $excluded Y-m-d dates to leave without a record
     */
    private function presentOnAllWorkingDaysExcept(User $user, string $monthYear, array $excluded = []): void
    {
        $date = Carbon::parse($monthYear.'-01')->startOfDay();
        $end = $date->copy()->endOfMonth();

        for (; $date->lessThanOrEqualTo($end); $date->addDay()) {
            if ($date->isWeekend() || in_array($date->toDateString(), $excluded, true)) {
                continue;
            }

            AttendanceRecord::create([
                'organization_id' => $this->organization->id,
                'user_id' => $user->id,
                'attendance_date' => $date->toDateString(),
                'check_in_at' => $date->copy()->setTime(9, 30),
                'check_out_at' => $date->copy()->setTime(18, 30),
                'worked_seconds' => 8 * 3600,
                'late_minutes' => 0,
                'status' => 'present',
            ]);
        }
    }

    public function test_approved_paid_leave_is_payable_and_never_counted_as_lop(): void
    {
        $monthYear = '2026-06';
        $user = $this->employee();
        $day = $this->weekdayIn($monthYear, 2);

        $this->approveLeave($user, $day, $day, 'paid');
        $this->presentOnAllWorkingDaysExcept($user, $monthYear, [$day->toDateString()]);

        $summary = $this->summary($user, $monthYear);

        $this->assertSame(1.0, $summary['paid_leave_days'], 'A paid leave day must count as paid leave.');
        $this->assertSame(0.0, $summary['unpaid_leave_days'], 'A paid leave day must not be counted as unpaid.');
        $this->assertSame(0.0, $summary['total_lop_days'], 'A paid leave day must never become LOP.');
        $this->assertSame(
            $summary['working_days'],
            $summary['total_payable_days'],
            'Present every working day bar one paid leave day: the whole month is payable.'
        );
    }

    public function test_custom_org_leave_category_is_treated_as_paid(): void
    {
        // Categories are org-configurable; anything that is not 'unpaid' is paid.
        $this->organization->update([
            'settings' => [
                'leave_policy' => [
                    'categories' => [
                        ['code' => 'sick', 'name' => 'Sick Leave', 'annual_quota' => 12],
                        ['code' => 'sabbatical', 'name' => 'Sabbatical', 'annual_quota' => 5],
                    ],
                ],
            ],
        ]);

        $monthYear = '2026-06';
        $user = $this->employee();
        $day = $this->weekdayIn($monthYear, 2);

        $this->approveLeave($user, $day, $day, 'sabbatical');
        $this->presentOnAllWorkingDaysExcept($user, $monthYear, [$day->toDateString()]);

        $summary = $this->summary($user, $monthYear);

        $this->assertSame(1.0, $summary['paid_leave_days'], 'A custom org-defined category is paid leave.');
        $this->assertSame(0.0, $summary['total_lop_days']);
    }

    public function test_unpaid_leave_is_lop(): void
    {
        $monthYear = '2026-06';
        $user = $this->employee();
        $day = $this->weekdayIn($monthYear, 2);

        $this->approveLeave($user, $day, $day, 'unpaid');
        $this->presentOnAllWorkingDaysExcept($user, $monthYear, [$day->toDateString()]);

        $summary = $this->summary($user, $monthYear);

        $this->assertSame(0.0, $summary['paid_leave_days']);
        $this->assertSame(1.0, $summary['unpaid_leave_days'], 'Unpaid leave is the one category that is LOP.');
        $this->assertSame(1.0, $summary['total_lop_days']);
        $this->assertSame($summary['working_days'] - 1.0, $summary['total_payable_days']);
    }

    public function test_half_day_paid_leave_is_half_payable_not_half_lop(): void
    {
        $monthYear = '2026-06';
        $user = $this->employee();
        $day = $this->weekdayIn($monthYear, 2);

        $this->approveLeave($user, $day, $day, 'paid', 'half_day');
        $this->presentOnAllWorkingDaysExcept($user, $monthYear, [$day->toDateString()]);

        $summary = $this->summary($user, $monthYear);

        $this->assertSame(0.5, $summary['half_day_present'], 'Half a paid leave day is payable.');
        $this->assertSame(0.0, $summary['half_day_absent']);
        $this->assertSame(0.0, $summary['total_lop_days']);
    }

    public function test_half_day_unpaid_leave_is_half_lop(): void
    {
        $monthYear = '2026-06';
        $user = $this->employee();
        $day = $this->weekdayIn($monthYear, 2);

        $this->approveLeave($user, $day, $day, 'unpaid', 'half_day');
        $this->presentOnAllWorkingDaysExcept($user, $monthYear, [$day->toDateString()]);

        $summary = $this->summary($user, $monthYear);

        $this->assertSame(0.0, $summary['half_day_present']);
        $this->assertSame(0.5, $summary['half_day_absent']);
        $this->assertSame(0.5, $summary['total_lop_days']);
    }

    /**
     * When a request overruns its quota the split is recorded in
     * `consumed_breakdown`; quota is consumed chronologically, so the earliest
     * days are paid and the overflow is unpaid.
     */
    public function test_quota_overrun_splits_days_paid_then_unpaid(): void
    {
        $monthYear = '2026-06';
        $user = $this->employee();
        $start = $this->weekdayIn($monthYear, 2);
        $end = $this->weekdayIn($monthYear, 5);

        $leave = $this->approveLeave($user, $start, $end, 'paid');
        // 4 weekday-spanning days requested, only 1 day of quota was left.
        $leave->update([
            'consumed_breakdown' => [
                ['category' => 'paid', 'units' => 1.0],
                ['category' => 'unpaid', 'units' => 3.0],
            ],
        ]);

        $leaveDates = [];
        for ($d = $start->copy(); $d->lessThanOrEqualTo($end); $d->addDay()) {
            $leaveDates[] = $d->toDateString();
        }
        $this->presentOnAllWorkingDaysExcept($user, $monthYear, $leaveDates);

        $summary = $this->summary($user, $monthYear);

        $this->assertSame(1.0, $summary['paid_leave_days'], 'Only the quota-covered day is paid.');
        $this->assertSame(3.0, $summary['unpaid_leave_days'], 'The overflow is LOP.');
        $this->assertSame(3.0, $summary['total_lop_days']);
    }

    public function test_absent_with_no_leave_is_still_lop(): void
    {
        $monthYear = '2026-06';
        $user = $this->employee();

        $summary = $this->summary($user, $monthYear);

        // No attendance and no leave for the whole month: every working day is LOP.
        $this->assertSame($summary['working_days'], $summary['total_lop_days']);
        $this->assertSame(0.0, $summary['total_payable_days']);
    }
}
