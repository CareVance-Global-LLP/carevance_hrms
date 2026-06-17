<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Regression test for the "timer auto-close corrupts historical data" bug.
 *
 * Bug: closeStaleRunningTimers() used now()->startOfDay() as its
 * boundary. When called during payroll processing for month M, it would
 * close any running timer (even one started in month M-1) at today's
 * date, then the next time payroll was reprocessed for month M, the
 * inflated duration would leak in.
 *
 * Fix: scope the stale-entries query to the requested month. Verify
 * here that a stale timer from the previous month is NOT touched when
 * payroll is processed for the current month.
 *
 * The closeStaleRunningTimers logic lives in
 * PayrollDepartmentController::closeStaleRunningTimers, so this test
 * exercises that method directly via reflection. (The controller is
 * the only call site; the auto-process service does not call it.)
 */
class TimerScopeRegressionTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Helper: invoke the private closeStaleRunningTimers method on the
     * controller via reflection, then return the count it returned.
     */
    private function callCloseStale(int $userId, string $monthYear): int
    {
        $controller = app(\App\Http\Controllers\Api\PayrollDepartmentController::class);
        $ref = new \ReflectionMethod($controller, 'closeStaleRunningTimers');
        $ref->setAccessible(true);

        return (int) $ref->invoke($controller, $userId, $monthYear);
    }

    public function test_stale_timer_from_previous_month_is_not_modified_by_current_month_payroll(): void
    {
        $org = \App\Models\Organization::create(['name' => 'Regression Org A', 'slug' => 'regression-org-a-' . uniqid()]);
        $user = User::factory()->create(['organization_id' => $org->id]);

        $previousMonth = now()->subMonthNoOverflow();
        $staleStart = $previousMonth->copy()->day(15)->setTime(10, 0, 0);

        $id = \DB::table('time_entries')->insertGetId([
            'user_id' => $user->id,
            'project_id' => null,
            'task_id' => null,
            'description' => 'regression-test-stale-prev-month',
            'start_time' => $staleStart,
            'end_time' => null,
            'duration' => 0,
            'timer_slot' => 'primary',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Call the controller's closeStaleRunningTimers for the CURRENT month.
        $currentMonth = now()->format('Y-m');
        $closed = $this->callCloseStale($user->id, $currentMonth);

        $this->assertEquals(0, $closed, 'No timer should be closed for the current-month call');

        // The previous-month row must be UNCHANGED.
        $row = \DB::table('time_entries')->where('id', $id)->first();
        $this->assertNull($row->end_time,
            'Stale timer from a previous month must not be auto-closed by current-month payroll');
        $this->assertEquals(0, (int) $row->duration,
            'Duration of a previous-month stale timer must remain 0');
    }

    public function test_stale_timer_in_current_month_is_capped_to_start_of_today(): void
    {
        $org = \App\Models\Organization::create(['name' => 'Regression Org B', 'slug' => 'regression-org-b-' . uniqid()]);
        $user = User::factory()->create(['organization_id' => $org->id]);

        // Insert a "stale" TimeEntry started 5 days ago in the CURRENT
        // month, still running.
        $currentMonthStart = now()->copy()->startOfMonth();
        $staleStart = $currentMonthStart->copy()->addDays(5);

        $id = \DB::table('time_entries')->insertGetId([
            'user_id' => $user->id,
            'project_id' => null,
            'task_id' => null,
            'description' => 'regression-test-stale-current-month',
            'start_time' => $staleStart,
            'end_time' => null,
            'duration' => 0,
            'timer_slot' => 'primary',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $currentMonth = now()->format('Y-m');
        $closed = $this->callCloseStale($user->id, $currentMonth);

        $this->assertEquals(1, $closed, 'Exactly one stale timer should be closed');

        // The current-month row should be closed and capped at start of today.
        $row = \DB::table('time_entries')->where('id', $id)->first();
        $this->assertNotNull($row->end_time, 'Current-month stale timer should be auto-closed');
        $this->assertGreaterThan(0, (int) $row->duration, 'Duration must be > 0 after auto-close');
        // end_time must be <= start of today.
        $this->assertLessThanOrEqual(
            now()->startOfDay()->toDateTimeString(),
            $row->end_time,
            'end_time must not be after start of today (capped)',
        );
    }

    public function test_no_running_timers_means_zero_auto_close_count(): void
    {
        $org = \App\Models\Organization::create(['name' => 'Regression Org C', 'slug' => 'regression-org-c-' . uniqid()]);
        $user = User::factory()->create(['organization_id' => $org->id]);

        $currentMonth = now()->format('Y-m');
        $closed = $this->callCloseStale($user->id, $currentMonth);
        $this->assertEquals(0, $closed, 'No stale timers means zero closed');
    }

    public function test_helper_returns_count_for_bulk_call(): void
    {
        // Insert 3 stale timers in the current month for the same user.
        $org = \App\Models\Organization::create(['name' => 'Regression Org D', 'slug' => 'regression-org-d-' . uniqid()]);
        $user = User::factory()->create(['organization_id' => $org->id]);

        $monthStart = now()->copy()->startOfMonth();
        for ($i = 1; $i <= 3; $i++) {
            \DB::table('time_entries')->insert([
                'user_id' => $user->id,
                'project_id' => null,
                'task_id' => null,
                'description' => "regression-bulk-timer-{$i}",
                'start_time' => $monthStart->copy()->addDays($i),
                'end_time' => null,
                'duration' => 0,
                'timer_slot' => 'primary',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $currentMonth = now()->format('Y-m');
        $closed = $this->callCloseStale($user->id, $currentMonth);
        $this->assertEquals(3, $closed, 'All 3 timers should be closed in one call');
    }
}
