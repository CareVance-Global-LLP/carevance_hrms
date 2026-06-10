<?php

namespace App\Console\Commands;

use App\Models\PayrollMonthlyRun;
use App\Services\PayrollValidationService;
use Illuminate\Console\Command;

class ValidatePayrollCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'payroll:validate 
                            {--run= : Validate specific payroll run ID}
                            {--month= : Validate all runs for a specific month (YYYY-MM)}
                            {--org= : Organization ID to validate}
                            {--report : Generate detailed report}
                            {--fix : Attempt to fix errors automatically}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Validate payroll calculations for accuracy and compliance';

    /**
     * Execute the console command.
     */
    public function handle(PayrollValidationService $validator): int
    {
        $this->info('🔍 Starting Payroll Validation...');
        $this->newLine();

        if ($this->option('run')) {
            return $this->validateSpecificRun($validator, $this->option('run'));
        }

        if ($this->option('month') && $this->option('org')) {
            return $this->validateMonthForOrg($validator, $this->option('month'), $this->option('org'));
        }

        $this->error('Please provide either --run, or both --month and --org options');
        return 1;
    }

    /**
     * Validate specific payroll run
     */
    private function validateSpecificRun(PayrollValidationService $validator, int $runId): int
    {
        $this->info("Validating Payroll Run ID: {$runId}");
        $this->newLine();

        $result = $validator->validatePayrollRun($runId);

        if (!$result['valid']) {
            $this->error("❌ Validation FAILED!");
            $this->newLine();
        } else {
            $this->info("✅ Validation PASSED!");
            $this->newLine();
        }

        // Display summary
        $this->displaySummary($result);

        // Display detailed report if requested
        if ($this->option('report')) {
            $this->displayDetailedReport($result);
        }

        return $result['valid'] ? 0 : 1;
    }

    /**
     * Validate all payrolls for a month
     */
    private function validateMonthForOrg(PayrollValidationService $validator, string $month, int $orgId): int
    {
        $this->info("Validating Payroll for Month: {$month}, Organization: {$orgId}");
        $this->newLine();

        $result = $validator->getOrganizationValidationReport($orgId, $month);

        // Display organization summary
        $this->table(
            ['Metric', 'Value'],
            [
                ['Total Employees', $result['total_employees']],
                ['Valid Items', $result['valid_items']],
                ['Items with Errors', $result['items_with_errors']],
                ['Items with Warnings', $result['items_with_warnings']],
                ['Success Rate', $result['total_employees'] > 0 
                    ? round(($result['valid_items'] / $result['total_employees']) * 100, 2) . '%' 
                    : 'N/A'],
            ]
        );

        $this->newLine();

        // Display individual validations
        if ($this->option('report')) {
            foreach ($result['validations'] as $validation) {
                $this->displayValidationItem($validation);
            }
        }

        $hasErrors = $result['items_with_errors'] > 0;

        if ($hasErrors) {
            $this->error("❌ Validation completed with {$result['items_with_errors']} errors!");
            return 1;
        } else {
            $this->info("✅ All validations passed!");
            return 0;
        }
    }

    /**
     * Display summary
     */
    private function displaySummary(array $result): void
    {
        $this->table(
            ['Field', 'Value'],
            [
                ['Payroll Run ID', $result['payroll_run_id'] ?? 'N/A'],
                ['Month/Year', $result['month_year'] ?? 'N/A'],
                ['Total Items', $result['total_items'] ?? 0],
                ['Items with Errors', $result['items_with_errors'] ?? 0],
                ['Items with Warnings', $result['items_with_warnings'] ?? 0],
            ]
        );
    }

    /**
     * Display detailed report
     */
    private function displayDetailedReport(array $result): void
    {
        if (!isset($result['validations'])) {
            return;
        }

        $this->newLine();
        $this->info('📋 Detailed Validation Report:');
        $this->newLine();

        foreach ($result['validations'] as $index => $validation) {
            $this->displayValidationItem($validation, $index + 1);
        }
    }

    /**
     * Display individual validation item
     */
    private function displayValidationItem(array $validation, int $index = 1): void
    {
        $summary = $validation['summary'] ?? [];
        
        $this->line("─" . str_repeat("─", 60));
        $this->info("Employee: {$summary['employee_name'] ?? 'Unknown'} (ID: {$summary['employee_id'] ?? 'N/A'})");
        $this->line("─" . str_repeat("─", 60));

        // Display errors
        if (!empty($validation['errors'])) {
            $this->warn('   Errors:');
            foreach ($validation['errors'] as $error) {
                $this->error("     ❌ {$error['field']}: {$error['message']}");
                if (isset($error['expected'])) {
                    $this->line("        Expected: {$error['expected']}, Actual: {$error['actual']}");
                }
            }
        }

        // Display warnings
        if (!empty($validation['warnings'])) {
            $this->warn('   Warnings:');
            foreach ($validation['warnings'] as $warning) {
                $this->warn("     ⚠️  {$warning['field']}: {$warning['message']}");
            }
        }

        // Display passed checks
        if (!empty($validation['passed'])) {
            $this->info('   Passed Checks:');
            foreach ($validation['passed'] as $passed) {
                $this->info("     ✅ {$passed['field']}: {$passed['message']}");
            }
        }

        $this->newLine();
    }
}
