<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use App\Models\PayrollItem;
use App\Models\User;
use App\Services\Attendance\AttendanceService;

return new class extends Migration
{
    /**
     * Run the migrations.
     * 
     * Backfills simplified attendance data for existing payroll items.
     * This should be run AFTER the simplified attendance columns have been added.
     */
    public function up(): void
    {
        // Get the attendance service
        $attendanceService = app(AttendanceService::class);
        
        // Process payroll items in chunks to avoid memory issues
        PayrollItem::whereNull('present_days')
            ->whereHas('payrollRun', function ($query) {
                // Only process non-draft runs that have been created
                $query->whereIn('status', ['processing', 'locked', 'approved', 'released', 'disbursed']);
            })
            ->chunk(100, function ($items) use ($attendanceService) {
                foreach ($items as $item) {
                    $user = User::find($item->user_id);
                    if (!$user) {
                        continue;
                    }

                    try {
                        // Get simplified attendance summary
                        $summary = $attendanceService->monthlyAttendanceSummary($user, $item->payrollRun->month_year);

                        // Update the item with simplified data
                        $item->update([
                            'present_days' => (float) $summary['present_days'],
                            'paid_leave_days' => (float) $summary['paid_leave_days'],
                            'unpaid_leave_days' => (float) $summary['unpaid_leave_days'],
                            'half_day_present' => (float) $summary['half_day_present'],
                            'half_day_absent' => (float) $summary['half_day_absent'],
                            'absent_days' => (float) $summary['absent_days'],
                            'total_payable_days' => (float) $summary['total_payable_days'],
                            'total_lop_days' => (float) $summary['total_lop_days'],
                            'attendance_calculation_mode' => 'simplified',
                        ]);

                        // Log reconciliation if there's a significant difference
                        $legacyPresent = $summary['legacy_present_days'] ?? $summary['present_days'];
                        $newPresent = $summary['present_days'];
                        
                        if (abs($legacyPresent - $newPresent) > 0.01) {
                            DB::table('payroll_reconciliation')->insert([
                                'payroll_item_id' => $item->id,
                                'old_present_days' => $legacyPresent,
                                'new_present_days' => $newPresent,
                                'difference' => $legacyPresent - $newPresent,
                                'month_year' => $item->payrollRun->month_year,
                                'debug_info' => json_encode([
                                    'summary' => $summary,
                                    'backfill' => true,
                                    'migrated_at' => now()->toDateTimeString(),
                                ]),
                                'created_at' => now(),
                                'updated_at' => now(),
                            ]);
                        }
                    } catch (\Exception $e) {
                        // Log error but continue processing other items
                        DB::table('payroll_reconciliation')->insert([
                            'payroll_item_id' => $item->id,
                            'old_present_days' => 0,
                            'new_present_days' => 0,
                            'difference' => 0,
                            'month_year' => $item->payrollRun->month_year,
                            'debug_info' => json_encode([
                                'error' => $e->getMessage(),
                                'backfill_failed' => true,
                            ]),
                            'created_at' => now(),
                            'updated_at' => now(),
                        ]);
                    }
                }
            });
    }

    /**
     * Reverse the migrations.
     * 
     * Note: This doesn't actually reverse the data, but clears the simplified fields.
     * The data can be re-backfilled by running the migration again.
     */
    public function down(): void
    {
        // Clear simplified attendance fields (set to null)
        DB::table('payroll_items')->update([
            'present_days' => null,
            'paid_leave_days' => null,
            'unpaid_leave_days' => null,
            'half_day_present' => null,
            'half_day_absent' => null,
            'absent_days' => null,
            'total_payable_days' => null,
            'total_lop_days' => null,
            'attendance_calculation_mode' => null,
        ]);
        
        // Clear reconciliation data for backfilled entries
        DB::table('payroll_reconciliation')
            ->whereJsonContains('debug_info->backfill', true)
            ->delete();
    }
};
