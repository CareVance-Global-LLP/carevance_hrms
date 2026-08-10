<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\AttendanceTimeEditRequest;
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
}
