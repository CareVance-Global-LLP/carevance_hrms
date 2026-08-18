<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\AttendanceTimeEditRequest;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A closed payroll period is closed to upstream edits.
 *
 * Approving an attendance regularisation for a month whose run is already
 * locked/approved/released/disbursed used to mutate the very attendance the
 * run had consumed, with no status check and no arrear — so the money paid and
 * the attendance backing it silently diverged.
 */
class LockedPayrollPeriodGuardTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $employee;
    private string $monthYear = '2026-06';

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);
        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);
    }

    private function workday(): Carbon
    {
        $date = Carbon::parse($this->monthYear.'-01')->startOfDay();
        while ($date->isWeekend()) {
            $date->addDay();
        }

        return $date;
    }

    private function runWithStatus(string $status): PayrollMonthlyRun
    {
        return PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => $this->monthYear,
            'status' => $status,
            'created_by' => $this->admin->id,
        ]);
    }

    private function pendingEditRequest(): AttendanceTimeEditRequest
    {
        $day = $this->workday();

        AttendanceRecord::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'attendance_date' => $day->toDateString(),
            'check_in_at' => $day->copy()->setTime(9, 30),
            'check_out_at' => $day->copy()->setTime(17, 0),
            'worked_seconds' => 7 * 3600,
            'late_minutes' => 0,
            'status' => 'present',
        ]);

        return AttendanceTimeEditRequest::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'attendance_date' => $day->toDateString(),
            'extra_seconds' => 3600,
            'reason' => 'Forgot to stop the timer',
            'status' => 'pending',
        ]);
    }

    private function approve(AttendanceTimeEditRequest $item)
    {
        return $this->patchJson(
            '/api/attendance-time-edit-requests/'.$item->id.'/approve',
            ['review_note' => 'ok'],
            $this->apiHeadersFor($this->admin)
        );
    }

    public function test_approval_is_refused_once_the_run_is_locked(): void
    {
        $this->runWithStatus('locked');
        $item = $this->pendingEditRequest();

        $this->approve($item)->assertStatus(422);

        $this->assertSame('pending', $item->fresh()->status, 'The request must stay pending, not silently approve.');
    }

    public function test_approval_is_refused_once_the_run_is_disbursed(): void
    {
        $this->runWithStatus('disbursed');
        $item = $this->pendingEditRequest();

        $this->approve($item)->assertStatus(422);
    }

    public function test_locked_period_attendance_is_left_untouched(): void
    {
        $this->runWithStatus('approved');
        $item = $this->pendingEditRequest();

        $this->approve($item);

        $record = AttendanceRecord::where('user_id', $this->employee->id)->firstOrFail();
        $this->assertSame(
            0,
            (int) $record->manual_adjustment_seconds,
            'The attendance the run already consumed must not move.'
        );
    }

    public function test_approval_still_works_while_the_run_is_a_draft(): void
    {
        $this->runWithStatus('draft');
        $item = $this->pendingEditRequest();

        $this->approve($item)->assertOk();

        $this->assertSame('approved', $item->fresh()->status);
        $this->assertSame(3600, (int) AttendanceRecord::where('user_id', $this->employee->id)->firstOrFail()->manual_adjustment_seconds);
    }

    public function test_approval_still_works_when_no_run_exists_for_the_month(): void
    {
        $item = $this->pendingEditRequest();

        $this->approve($item)->assertOk();

        $this->assertSame('approved', $item->fresh()->status);
    }

    // ------------------------------------------------------- Leave approval
    //
    // PayrollPeriodGuard's docblock names leave approval as a case it exists
    // for, but it was only ever wired into the time-edit path above. Approving
    // or revoking a leave writes and deletes AttendanceRecord rows for
    // arbitrary back-dated ranges, so it rewrote closed periods freely.

    private function pendingLeave(?string $start = null, ?string $end = null): LeaveRequest
    {
        $day = $this->workday();

        // A pending leave whose end_date has passed is auto-cancelled on the
        // way into approve(), which would 422 for a reason that has nothing to
        // do with the payroll guard under test. Sit inside the fixture month.
        Carbon::setTestNow($day);

        return LeaveRequest::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'start_date' => $start ?? $day->toDateString(),
            'end_date' => $end ?? $day->toDateString(),
            'leave_type' => 'casual',
            'leave_category' => 'paid',
            'reason' => 'Family function',
            'status' => 'pending',
        ]);
    }

    private function approveLeave(LeaveRequest $leave)
    {
        return $this->patchJson(
            '/api/leave-requests/'.$leave->id.'/approve',
            ['review_note' => 'ok'],
            $this->apiHeadersFor($this->admin)
        );
    }

    public function test_leave_approval_is_refused_once_the_run_is_locked(): void
    {
        $this->runWithStatus('locked');
        $leave = $this->pendingLeave();

        $this->approveLeave($leave)->assertStatus(422);

        $this->assertSame('pending', $leave->fresh()->status, 'The leave must stay pending, not silently approve.');
    }

    public function test_leave_approval_is_refused_once_the_run_is_disbursed(): void
    {
        $this->runWithStatus('disbursed');
        $leave = $this->pendingLeave();

        $this->approveLeave($leave)->assertStatus(422);
    }

    /**
     * The reason the guard checks every month the leave spans rather than just
     * start_date: this request begins in an open month and ends in a closed
     * one, and would otherwise be approved.
     */
    public function test_leave_approval_is_refused_when_the_range_ends_in_a_closed_month(): void
    {
        $this->runWithStatus('approved'); // closes 2026-06

        $leave = $this->pendingLeave('2026-05-28', '2026-06-02');

        $this->approveLeave($leave)->assertStatus(422);
        $this->assertSame('pending', $leave->fresh()->status);
    }

    public function test_leave_approval_still_works_while_the_run_is_a_draft(): void
    {
        $this->runWithStatus('draft');
        $leave = $this->pendingLeave();

        $this->approveLeave($leave)->assertOk();

        $this->assertSame('approved', $leave->fresh()->status);
    }

    public function test_revoke_approval_is_refused_once_the_run_is_locked(): void
    {
        $this->runWithStatus('locked');

        $leave = $this->pendingLeave();
        $leave->update([
            'status' => 'approved',
            'revoke_status' => 'pending',
            'revoke_requested_at' => now(),
        ]);

        $this->patchJson(
            '/api/leave-requests/'.$leave->id.'/revoke-approve',
            ['review_note' => 'ok'],
            $this->apiHeadersFor($this->admin)
        )->assertStatus(422);

        $this->assertSame('approved', $leave->fresh()->status, 'A closed period must not have its leave rolled back.');
    }
}
