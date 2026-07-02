<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ClearMonthlyPayrollData extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'payroll:clear-monthly-data 
                            {--force : Force deletion without confirmation}
                            {--preserve-config : Preserve employee payroll configurations (default: true)}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Clear all monthly payroll data (runs, items, payslips) while preserving employee configurations';

    /**
     * Tables to clear (monthly payroll data only).
     *
     * @var array
     */
    protected $tablesToClear = [
        'payroll_filings',
        'payroll_audit_logs',
        'payroll_adjustments',
        'payslips',
        'payroll_transactions',
        'payroll_items',
        'pay_run_items',
        'pay_runs',
        'payrolls',
        'payroll_monthly_runs',
    ];

    /**
     * Tables to preserve (employee configurations).
     *
     * @var array
     */
    protected $tablesToPreserve = [
        'employee_payroll_templates',
        'payroll_profiles',
        'salary_templates',
        'salary_components',
        'salary_template_components',
        'department_payroll_templates',
        'pay_groups',
        'pay_group_assignments',
        'employee_salary_assignments',
    ];

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $this->info('═══════════════════════════════════════════════════════════');
        $this->info('   CAREVANCE HRMS - CLEAR MONTHLY PAYROLL DATA');
        $this->info('═══════════════════════════════════════════════════════════');
        $this->newLine();

        // Show what will be deleted
        $this->warn('The following tables will be CLEARED:');
        foreach ($this->tablesToClear as $table) {
            $count = DB::table($table)->count();
            $this->line("  • {$table}: {$count} records");
        }

        $this->newLine();
        $this->info('The following tables will be PRESERVED:');
        foreach ($this->tablesToPreserve as $table) {
            $count = DB::table($table)->count();
            $this->line("  ✓ {$table}: {$count} records");
        }

        $this->newLine();

        // Confirm unless --force flag is set
        if (!$this->option('force')) {
            if (!$this->confirm('Are you sure you want to delete ALL monthly payroll data? This cannot be undone!', false)) {
                $this->info('Operation cancelled.');
                return 0;
            }
        }

        $this->newLine();
        $this->info('Starting deletion process...');
        $this->newLine();

        // Track deleted counts
        $deletedCounts = [];

        // Use database transaction for safety
        DB::beginTransaction();

        try {
            // Clear tables in correct order (children first, parents last)
            foreach ($this->tablesToClear as $table) {
                $this->info("Clearing table: {$table}...");
                
                $countBefore = DB::table($table)->count();
                
                // Handle foreign key constraints
                DB::statement("SET CONSTRAINTS ALL DEFERRED");
                
                // Delete all records
                DB::table($table)->delete();
                
                $deletedCounts[$table] = $countBefore;
                
                $this->info("  ✓ Deleted {$countBefore} records from {$table}");
                
                // Reset sequence for PostgreSQL
                if (DB::getDriverName() === 'pgsql') {
                    try {
                        $sequenceName = $table . '_id_seq';
                        DB::statement("ALTER SEQUENCE IF EXISTS {$sequenceName} RESTART WITH 1");
                        $this->line("  ✓ Reset sequence for {$table}");
                    } catch (\Exception $e) {
                        // Sequence might not exist, ignore
                    }
                }
            }

            // Commit transaction
            DB::commit();

            $this->newLine();
            $this->info('═══════════════════════════════════════════════════════════');
            $this->info('   SUCCESS: Monthly payroll data cleared!');
            $this->info('═══════════════════════════════════════════════════════════');
            $this->newLine();

            // Summary
            $this->info('Summary of deleted data:');
            $totalDeleted = 0;
            foreach ($deletedCounts as $table => $count) {
                $this->line("  • {$table}: {$count} records deleted");
                $totalDeleted += $count;
            }
            $this->newLine();
            $this->info("Total records deleted: {$totalDeleted}");
            $this->newLine();

            $this->info('You can now start fresh payroll processing!');
            $this->info('Employee configurations have been preserved.');

            // Log the operation
            Log::info('Monthly payroll data cleared', [
                'tables_cleared' => $this->tablesToClear,
                'records_deleted' => $deletedCounts,
                'timestamp' => now()->toDateTimeString(),
            ]);

            return 0;

        } catch (\Exception $e) {
            // Rollback on error
            DB::rollBack();
            
            $this->newLine();
            $this->error('ERROR: Failed to clear payroll data!');
            $this->error($e->getMessage());
            
            Log::error('Failed to clear monthly payroll data', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            
            return 1;
        }
    }
}
