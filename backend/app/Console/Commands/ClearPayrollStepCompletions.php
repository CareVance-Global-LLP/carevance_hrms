<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ClearPayrollStepCompletions extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'payroll:clear-step-completions 
                            {--force : Force reset without confirmation}
                            {--organization= : Organization ID to reset (optional)}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Clear all step completion statuses from employee payroll templates to reset the bulk payroll wizard';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $this->info('═══════════════════════════════════════════════════════════');
        $this->info('   CAREVANCE HRMS - CLEAR STEP COMPLETIONS');
        $this->info('═══════════════════════════════════════════════════════════');
        $this->newLine();

        $this->info('This will reset the step completion tracking for all employees.');
        $this->warn('Green ticks in the Bulk Payroll wizard will be cleared.');
        $this->newLine();

        // Check current status
        $count = DB::table('employee_payroll_templates')
            ->where(function ($query) {
                $query->where('step1_completed', true)
                    ->orWhere('step2_completed', true)
                    ->orWhere('step3_completed', true)
                    ->orWhere('step4_completed', true)
                    ->orWhere('step5_completed', true)
                    ->orWhere('step6_completed', true);
            })
            ->count();

        $this->info("Found {$count} employees with completed steps.");
        $this->newLine();

        // Confirm unless --force flag is set
        if (!$this->option('force')) {
            if (!$this->confirm('Are you sure you want to reset all step completions?', false)) {
                $this->info('Operation cancelled.');
                return 0;
            }
        }

        $this->newLine();
        $this->info('Resetting step completions...');
        $this->newLine();

        try {
            // Build query
            $query = DB::table('employee_payroll_templates');
            
            // Filter by organization if specified
            if ($this->option('organization')) {
                $query->where('organization_id', $this->option('organization'));
            }

            // Reset all step completions
            $affected = $query->update([
                'step1_completed' => false,
                'step2_completed' => false,
                'step3_completed' => false,
                'step4_completed' => false,
                'step5_completed' => false,
                'step6_completed' => false,
                'current_step' => 1,
                'steps_month_year' => null,
            ]);

            $this->newLine();
            $this->info('═══════════════════════════════════════════════════════════');
            $this->info('   SUCCESS: Step completions reset!');
            $this->info('═══════════════════════════════════════════════════════════');
            $this->newLine();

            $this->info("Reset step completions for {$affected} employees.");
            $this->newLine();

            $this->info('✓ All green ticks have been cleared');
            $this->info('✓ All employees now start at Step 1');
            $this->info('✓ Bulk payroll wizard is now fresh and ready');
            $this->newLine();

            // Log the operation
            Log::info('Payroll step completions reset', [
                'affected_employees' => $affected,
                'organization_id' => $this->option('organization') ?? 'all',
                'timestamp' => now()->toDateTimeString(),
            ]);

            return 0;

        } catch (\Exception $e) {
            $this->newLine();
            $this->error('ERROR: Failed to reset step completions!');
            $this->error($e->getMessage());
            
            Log::error('Failed to reset payroll step completions', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            
            return 1;
        }
    }
}
