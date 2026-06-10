<?php

namespace App\Services;

use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\EmployeePayrollTemplate;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Payroll Validation Service
 * 
 * Validates payroll calculations for accuracy and compliance
 */
class PayrollValidationService
{
    /**
     * Validation errors
     */
    protected array $errors = [];

    /**
     * Validation warnings
     */
    protected array $warnings = [];

    /**
     * Validation passed items
     */
    protected array $passed = [];

    /**
     * PF Wage Cap
     */
    const PF_WAGE_CAP = 15000;

    /**
     * PF Rate
     */
    const PF_RATE = 0.12;

    /**
     * ESI Threshold
     */
    const ESI_THRESHOLD = 21000;

    /**
     * ESI Employee Rate
     */
    const ESI_EMPLOYEE_RATE = 0.0075;

    /**
     * ESI Employer Rate
     */
    const ESI_EMPLOYER_RATE = 0.0325;

    /**
     * Gratuity Rate
     */
    const GRATUITY_RATE = 0.0481;

    /**
     * Validate a payroll item
     */
    public function validatePayrollItem(PayrollItem $item): array
    {
        $this->errors = [];
        $this->warnings = [];
        $this->passed = [];

        $this->validateBasicCalculations($item);
        $this->validatePFCalculations($item);
        $this->validateESICalculations($item);
        $this->validatePTCalculations($item);
        $this->validateTDSCalculations($item);
        $this->validateGratuityCalculations($item);
        $this->validateEmployerContributions($item);
        $this->validateNetPayCalculation($item);
        $this->validateGrossCalculation($item);

        return [
            'valid' => empty($this->errors),
            'errors' => $this->errors,
            'warnings' => $this->warnings,
            'passed' => $this->passed,
            'summary' => $this->generateSummary($item),
        ];
    }

    /**
     * Validate basic salary calculations
     */
    protected function validateBasicCalculations(PayrollItem $item): void
    {
        // Check if basic is positive
        if ($item->basic <= 0) {
            $this->errors[] = [
                'field' => 'basic',
                'message' => 'Basic salary must be greater than 0',
                'value' => $item->basic,
            ];
        } else {
            $this->passed[] = [
                'field' => 'basic',
                'message' => 'Basic salary is valid',
                'value' => $item->basic,
            ];
        }

        // Check if HRA is calculated
        if ($item->hra <= 0) {
            $this->warnings[] = [
                'field' => 'hra',
                'message' => 'HRA is 0 or negative',
                'value' => $item->hra,
            ];
        } else {
            // Verify HRA is approximately 40-50% of basic
            $hraPercentage = ($item->hra / $item->basic) * 100;
            if ($hraPercentage < 35 || $hraPercentage > 55) {
                $this->warnings[] = [
                    'field' => 'hra',
                    'message' => 'HRA percentage is outside typical range (40-50% of basic)',
                    'value' => $hraPercentage,
                    'expected' => '40-50%',
                ];
            } else {
                $this->passed[] = [
                    'field' => 'hra',
                    'message' => 'HRA is within expected range',
                    'percentage' => round($hraPercentage, 2),
                ];
            }
        }
    }

    /**
     * Validate PF calculations
     */
    protected function validatePFCalculations(PayrollItem $item): void
    {
        // Calculate expected PF
        $pfWages = min($item->basic, self::PF_WAGE_CAP);
        $expectedPf = $pfWages * self::PF_RATE;

        // Check PF employee contribution
        $pfDifference = abs($item->pf_employee - $expectedPf);
        if ($pfDifference > 0.01) {
            $this->errors[] = [
                'field' => 'pf_employee',
                'message' => 'PF employee contribution calculation mismatch',
                'expected' => $expectedPf,
                'actual' => $item->pf_employee,
                'difference' => $pfDifference,
            ];
        } else {
            $this->passed[] = [
                'field' => 'pf_employee',
                'message' => 'PF employee contribution is accurate',
                'value' => $item->pf_employee,
            ];
        }

        // Check if PF cap was applied correctly
        if ($item->basic > self::PF_WAGE_CAP) {
            if ($item->pf_employee > (self::PF_WAGE_CAP * self::PF_RATE + 0.01)) {
                $this->errors[] = [
                    'field' => 'pf_employee',
                    'message' => 'PF should be capped at 12% of ₹15,000 when basic exceeds cap',
                    'expected' => self::PF_WAGE_CAP * self::PF_RATE,
                    'actual' => $item->pf_employee,
                ];
            }
        }

        // Validate PF split (EPS + EPF)
        $expectedEps = $pfWages * 0.0833;
        $expectedEpf = $pfWages * 0.0367;

        if (abs($item->eps - $expectedEps) > 0.10) {
            $this->warnings[] = [
                'field' => 'eps',
                'message' => 'EPS calculation may be incorrect',
                'expected' => $expectedEps,
                'actual' => $item->eps,
            ];
        }

        if (abs($item->epf - $expectedEpf) > 0.10) {
            $this->warnings[] = [
                'field' => 'epf',
                'message' => 'EPF calculation may be incorrect',
                'expected' => $expectedEpf,
                'actual' => $item->epf,
            ];
        }
    }

    /**
     * Validate ESI calculations
     */
    protected function validateESICalculations(PayrollItem $item): void
    {
        // Check if ESI should apply
        $esiShouldApply = $item->gross_salary <= self::ESI_THRESHOLD;

        if ($esiShouldApply) {
            $expectedEsi = $item->gross_salary * self::ESI_EMPLOYEE_RATE;
            $esiDifference = abs($item->esi_employee - $expectedEsi);

            if ($esiDifference > 0.01) {
                $this->errors[] = [
                    'field' => 'esi_employee',
                    'message' => 'ESI employee contribution calculation mismatch',
                    'expected' => $expectedEsi,
                    'actual' => $item->esi_employee,
                    'difference' => $esiDifference,
                ];
            } else {
                $this->passed[] = [
                    'field' => 'esi_employee',
                    'message' => 'ESI employee contribution is accurate',
                    'value' => $item->esi_employee,
                ];
            }

            // Validate employer ESI
            $expectedEsiEmployer = $item->gross_salary * self::ESI_EMPLOYER_RATE;
            if (abs($item->esi_employer - $expectedEsiEmployer) > 0.01) {
                $this->errors[] = [
                    'field' => 'esi_employer',
                    'message' => 'ESI employer contribution calculation mismatch',
                    'expected' => $expectedEsiEmployer,
                    'actual' => $item->esi_employer,
                ];
            }
        } else {
            // ESI should not apply
            if ($item->esi_employee > 0) {
                $this->errors[] = [
                    'field' => 'esi_employee',
                    'message' => 'ESI should not apply when gross exceeds ₹21,000',
                    'gross_salary' => $item->gross_salary,
                    'esi_amount' => $item->esi_employee,
                ];
            }
        }
    }

    /**
     * Validate PT calculations
     */
    protected function validatePTCalculations(PayrollItem $item): void
    {
        // PT is state-specific, just check if it's reasonable
        if ($item->pt < 0) {
            $this->errors[] = [
                'field' => 'pt',
                'message' => 'Professional Tax cannot be negative',
                'value' => $item->pt,
            ];
        } else if ($item->pt > 2500) {
            $this->warnings[] = [
                'field' => 'pt',
                'message' => 'Professional Tax seems high, verify state configuration',
                'value' => $item->pt,
            ];
        } else {
            $this->passed[] = [
                'field' => 'pt',
                'message' => 'Professional Tax is within expected range',
                'value' => $item->pt,
            ];
        }
    }

    /**
     * Validate TDS calculations
     */
    protected function validateTDSCalculations(PayrollItem $item): void
    {
        // TDS should be reasonable for the salary
        if ($item->tds < 0) {
            $this->errors[] = [
                'field' => 'tds',
                'message' => 'TDS cannot be negative',
                'value' => $item->tds,
            ];
        }

        // For salary above certain threshold, TDS should exist
        if ($item->gross_salary > 50000 && $item->tds == 0) {
            $this->warnings[] = [
                'field' => 'tds',
                'message' => 'TDS is 0 but salary is above taxable threshold',
                'gross_salary' => $item->gross_salary,
            ];
        }

        if ($item->tds > 0) {
            $this->passed[] = [
                'field' => 'tds',
                'message' => 'TDS is calculated',
                'value' => $item->tds,
            ];
        }
    }

    /**
     * Validate Gratuity calculations
     */
    protected function validateGratuityCalculations(PayrollItem $item): void
    {
        $expectedGratuity = $item->basic * self::GRATUITY_RATE;

        if (abs($item->gratuity - $expectedGratuity) > 0.01) {
            $this->warnings[] = [
                'field' => 'gratuity',
                'message' => 'Gratuity provision may be incorrect',
                'expected' => $expectedGratuity,
                'actual' => $item->gratuity,
            ];
        } else {
            $this->passed[] = [
                'field' => 'gratuity',
                'message' => 'Gratuity provision is accurate',
                'value' => $item->gratuity,
            ];
        }
    }

    /**
     * Validate employer contributions
     */
    protected function validateEmployerContributions(PayrollItem $item): void
    {
        $expectedTotal = $item->pf_employer + $item->esi_employer + $item->gratuity;

        if (abs($item->total_employer_contributions - $expectedTotal) > 0.01) {
            $this->errors[] = [
                'field' => 'total_employer_contributions',
                'message' => 'Total employer contributions mismatch',
                'expected' => $expectedTotal,
                'actual' => $item->total_employer_contributions,
            ];
        } else {
            $this->passed[] = [
                'field' => 'total_employer_contributions',
                'message' => 'Total employer contributions are accurate',
                'value' => $item->total_employer_contributions,
            ];
        }
    }

    /**
     * Validate net pay calculation
     */
    protected function validateNetPayCalculation(PayrollItem $item): void
    {
        $expectedNet = $item->gross_salary - $item->total_deductions;

        if (abs($item->net_pay - $expectedNet) > 0.01) {
            $this->errors[] = [
                'field' => 'net_pay',
                'message' => 'Net pay calculation mismatch',
                'formula' => 'Gross - Total Deductions',
                'expected' => $expectedNet,
                'actual' => $item->net_pay,
                'difference' => abs($item->net_pay - $expectedNet),
            ];
        } else {
            $this->passed[] = [
                'field' => 'net_pay',
                'message' => 'Net pay calculation is accurate',
                'formula' => 'Gross - Total Deductions',
                'gross' => $item->gross_salary,
                'deductions' => $item->total_deductions,
                'net' => $item->net_pay,
            ];
        }

        // Net pay should be positive
        if ($item->net_pay < 0) {
            $this->errors[] = [
                'field' => 'net_pay',
                'message' => 'Net pay cannot be negative',
                'value' => $item->net_pay,
            ];
        }
    }

    /**
     * Validate gross calculation
     */
    protected function validateGrossCalculation(PayrollItem $item): void
    {
        $expectedGross = $item->basic + $item->hra + $item->conveyance + 
                        $item->medical + $item->special_allowance + 
                        $item->overtime_pay;

        // Allow for rounding differences
        if (abs($item->gross_salary - $expectedGross) > 1) {
            $this->warnings[] = [
                'field' => 'gross_salary',
                'message' => 'Gross salary may have additional components not included in validation',
                'expected_from_components' => $expectedGross,
                'actual' => $item->gross_salary,
            ];
        }

        if ($item->gross_salary <= 0) {
            $this->errors[] = [
                'field' => 'gross_salary',
                'message' => 'Gross salary must be greater than 0',
                'value' => $item->gross_salary,
            ];
        }
    }

    /**
     * Generate validation summary
     */
    protected function generateSummary(PayrollItem $item): array
    {
        return [
            'employee_id' => $item->user_id,
            'employee_name' => $item->user?->name ?? 'Unknown',
            'gross_salary' => $item->gross_salary,
            'total_deductions' => $item->total_deductions,
            'net_pay' => $item->net_pay,
            'error_count' => count($this->errors),
            'warning_count' => count($this->warnings),
            'passed_count' => count($this->passed),
            'validation_status' => empty($this->errors) ? 'PASSED' : 'FAILED',
        ];
    }

    /**
     * Validate entire payroll run
     */
    public function validatePayrollRun(int $payrollRunId): array
    {
        $run = PayrollMonthlyRun::find($payrollRunId);
        
        if (!$run) {
            return [
                'valid' => false,
                'message' => 'Payroll run not found',
            ];
        }

        $results = [];
        $totalErrors = 0;
        $totalWarnings = 0;

        foreach ($run->items as $item) {
            $validation = $this->validatePayrollItem($item);
            $results[] = $validation;
            
            if (!empty($validation['errors'])) {
                $totalErrors++;
            }
            if (!empty($validation['warnings'])) {
                $totalWarnings++;
            }
        }

        return [
            'payroll_run_id' => $payrollRunId,
            'month_year' => $run->month_year,
            'total_items' => count($results),
            'items_with_errors' => $totalErrors,
            'items_with_warnings' => $totalWarnings,
            'valid' => $totalErrors === 0,
            'validations' => $results,
        ];
    }

    /**
     * Get validation report for organization
     */
    public function getOrganizationValidationReport(int $organizationId, string $monthYear): array
    {
        $items = PayrollItem::where('organization_id', $organizationId)
            ->whereHas('payrollRun', function ($query) use ($monthYear) {
                $query->where('month_year', $monthYear);
            })
            ->with('user')
            ->get();

        $report = [
            'organization_id' => $organizationId,
            'month_year' => $monthYear,
            'total_employees' => $items->count(),
            'valid_items' => 0,
            'items_with_errors' => 0,
            'items_with_warnings' => 0,
            'validations' => [],
        ];

        foreach ($items as $item) {
            $validation = $this->validatePayrollItem($item);
            $report['validations'][] = $validation;

            if ($validation['valid']) {
                $report['valid_items']++;
            } else {
                $report['items_with_errors']++;
            }

            if (!empty($validation['warnings'])) {
                $report['items_with_warnings']++;
            }
        }

        return $report;
    }
}
