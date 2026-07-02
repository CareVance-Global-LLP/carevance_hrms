<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\Attendance\AttendanceService;
use App\Models\User;
use App\Models\PayrollItem;
use App\Models\PayrollReconciliation;

class TestSimplifiedAttendance extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'payroll:test-simplified-attendance 
                            {--user= : User ID to test (optional)} 
                            {--month= : Month to test in YYYY-MM format (default: current month)}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Test the simplified attendance calculation logic';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $this->info('═══════════════════════════════════════════════════════════');
        $this->info('   TEST: Simplified Attendance Calculation');
        $this->info('═══════════════════════════════════════════════════════════');
        $this->newLine();

        $monthYear = $this->option('month') ?? now()->format('Y-m');
        $userId = $this->option('user');

        $attendanceService = app(AttendanceService::class);

        if ($userId) {
            // Test specific user
            $user = User::find($userId);
            if (!$user) {
                $this->error("User not found: {$userId}");
                return 1;
            }
            $this->testUser($attendanceService, $user, $monthYear);
        } else {
            // Test all active users with payroll templates
            $users = User::whereHas('employeePayrollTemplate', function ($q) {
                $q->where('is_active', true);
            })->limit(5)->get();

            $this->info("Testing {$users->count()} users for {$monthYear}");
            $this->newLine();

            foreach ($users as $user) {
                $this->testUser($attendanceService, $user, $monthYear);
                $this->newLine();
            }
        }

        // Show reconciliation summary
        $this->showReconciliationSummary($monthYear);

        return 0;
    }

    private function testUser($attendanceService, User $user, string $monthYear): void
    {
        $this->info("Testing user: {$user->name} (ID: {$user->id})");
        $this->line("  Month: {$monthYear}");
        
        try {
            $summary = $attendanceService->monthlyAttendanceSummary($user, $monthYear);

            // Display results
            $this->line("  Working Days: {$summary['working_days']}");
            $this->line("  ---");
            $this->line("  Simplified Calculation:");
            $this->line("    ✓ Present Days: {$summary['present_days']}");
            $this->line("    ✓ Paid Leave Days: {$summary['paid_leave_days']}");
            $this->line("    ✓ Unpaid Leave Days: {$summary['unpaid_leave_days']}");
            $this->line("    ✓ Half Day Present: {$summary['half_day_present']}");
            $this->line("    ✓ Half Day Absent: {$summary['half_day_absent']}");
            $this->line("    ✓ Absent Days: {$summary['absent_days']}");
            $this->line("  ---");
            $this->line("  Totals:");
            $this->line("    ✓ Total Payable Days: {$summary['total_payable_days']}");
            $this->line("    ✓ Total LOP Days: {$summary['total_lop_days']}");
            
            if (isset($summary['legacy_present_days'])) {
                $this->line("  ---");
                $this->line("  Legacy Comparison:");
                $this->line("    Legacy Present: {$summary['legacy_present_days']}");
                $diff = $summary['legacy_present_days'] - $summary['present_days'];
                $this->line("    Difference: " . ($diff > 0 ? "+{$diff}" : $diff));
            }

            $this->line("  Source: {$summary['attendance_source']}");

            // Check if payroll item exists
            $payrollItem = PayrollItem::where('user_id', $user->id)
                ->whereHas('payrollRun', function ($q) use ($monthYear) {
                    $q->where('month_year', $monthYear);
                })
                ->first();

            if ($payrollItem) {
                $this->line("  Payroll Item: #{$payrollItem->id}");
                if ($payrollItem->attendance_calculation_mode) {
                    $this->line("  Calculation Mode: {$payrollItem->attendance_calculation_mode}");
                } else {
                    $this->warn("  Calculation Mode: Not set (needs backfill)");
                }
            } else {
                $this->line("  Payroll Item: None found");
            }

        } catch (\Exception $e) {
            $this->error("  Error: {$e->getMessage()}");
        }
    }

    private function showReconciliationSummary(string $monthYear): void
    {
        $this->newLine();
        $this->info('═══════════════════════════════════════════════════════════');
        $this->info('   RECONCILIATION SUMMARY');
        $this->info('═══════════════════════════════════════════════════════════');
        $this->newLine();

        $totalItems = PayrollItem::whereHas('payrollRun', function ($q) use ($monthYear) {
            $q->where('month_year', $monthYear);
        })->count();

        $simplifiedItems = PayrollItem::where('attendance_calculation_mode', 'simplified')
            ->whereHas('payrollRun', function ($q) use ($monthYear) {
                $q->where('month_year', $monthYear);
            })->count();

        $reconciliationCount = PayrollReconciliation::where('month_year', $monthYear)->count();

        $this->info("Month: {$monthYear}");
        $this->line("  Total Payroll Items: {$totalItems}");
        $this->line("  Using Simplified Mode: {$simplifiedItems}");
        $this->line("  Reconciliation Entries: {$reconciliationCount}");

        if ($reconciliationCount > 0) {
            $avgDiff = PayrollReconciliation::where('month_year', $monthYear)->avg('difference');
            $this->line("  Average Difference: " . round($avgDiff, 2) . " days");
        }

        $this->newLine();
        $this->info('Test completed!');
    }
}
