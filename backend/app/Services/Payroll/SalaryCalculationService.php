<?php

namespace App\Services\Payroll;

use App\Models\EmployeePayrollTemplate;
use App\Models\PayslipYtdHistory;
use App\Models\User;
use App\Services\PTStateService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class SalaryCalculationService
{
    /**
     * Calculate salary for a single employee for a given month.
     *
     * @throws RuntimeException when the employee or their payroll template is
     *         missing. This deliberately throws rather than defaulting: a
     *         payslip computed from absent configuration is silently wrong,
     *         which is worse than a failed run.
     */
    public function calculateSalary(int $employeeId, int $payMonth, int $payYear): array
    {
        // Employees are users — there is no separate Employee model/table.
        $employee = User::with(['employeePayrollTemplate', 'employeeWorkInfo'])->find($employeeId);
        if (!$employee) {
            throw new RuntimeException("Employee not found: {$employeeId}");
        }

        /** @var EmployeePayrollTemplate|null $template */
        $template = $employee->employeePayrollTemplate;
        if (!$template) {
            throw new RuntimeException(
                "No payroll template configured for employee {$employeeId}. "
                . 'Assign a salary structure before running payroll.'
            );
        }

        $annualCtc = (float) ($template->annual_ctc ?? 0);
        if ($annualCtc <= 0) {
            throw new RuntimeException(
                "Employee {$employeeId} has no annual CTC on their payroll template."
            );
        }

        $stateCode = $template->pt_state ?: 'maharashtra';
        $basicPercentage = (float) ($template->basic_percentage ?? 40);

        // 1. Get attendance
        $attendance = $this->getAttendance($employeeId, $payMonth, $payYear);
        $totalDays = $this->getMonthDays($payMonth, $payYear);
        $daysPresent = $attendance['present'] ?? $totalDays;
        $paidLeave = $attendance['paid_leave'] ?? 0;
        $workingDays = $daysPresent + $paidLeave; // actual days worked + paid leave
        $lopDays = max(0, $totalDays - $workingDays);
        $halfDays = $attendance['half_days'] ?? 0;
        $overtimeHours = $attendance['overtime_hours'] ?? 0;

        // 2. Calculate earnings — pro-rata based on days actually worked
        $proRataFactor = $totalDays > 0 ? $workingDays / $totalDays : 1;

        // Compute monthly values from annual CTC
        $monthlyCtc = $annualCtc / 12;
        $basic = $monthlyCtc * ($basicPercentage / 100);
        $hra = $basic * (((float) ($template->hra_percentage ?? 50)) / 100);
        $da = $monthlyCtc * (((float) ($template->da_percentage ?? 0)) / 100);

        // Apply pro-rata for days worked
        $basic *= $proRataFactor;
        $hra *= $proRataFactor;
        $da *= $proRataFactor;

        // Conveyance, medical, special allowance are fixed (not pro-rated)
        $conveyance = min((float) ($template->conveyance_allowance ?? 1600), 1600);
        $medical = min((float) ($template->medical_allowance ?? 0), 1250);
        $specialAllowance = max(0, $monthlyCtc - ($monthlyCtc * ($basicPercentage / 100)) - $hra - $da - $conveyance - $medical);
        $statutoryBonus = $this->calculateStatutoryBonus($basic, $payMonth, $payYear);
        $foodAllowance = (float) ($template->meal_allowance ?? 0);
        $overtimePay = $this->calculateOvertime($basic, $overtimeHours);

        // Pro-rata for mid-month joiners (override attendance-based pro-rata)
        $joiningDate = $employee->employeeWorkInfo?->joining_date;
        if ($joiningDate
            && (int) $joiningDate->format('n') === $payMonth
            && (int) $joiningDate->format('Y') === $payYear
        ) {
            $daysWorked = $totalDays - (int) $joiningDate->format('j') + 1;
            $proRataFactor = $totalDays > 0 ? $daysWorked / $totalDays : 1;
            $basic = $monthlyCtc * ($basicPercentage / 100) * $proRataFactor;
            $hra = $basic * (((float) ($template->hra_percentage ?? 50)) / 100);
            $da = $monthlyCtc * (((float) ($template->da_percentage ?? 0)) / 100) * $proRataFactor;
        }

        $totalEarnings = $basic + $hra + $da + $specialAllowance + $conveyance + $medical + $statutoryBonus + $foodAllowance + $overtimePay;

        // 3. Calculate deductions
        // PF (on basic + DA, capped at ₹15,000 unless the employer has opted
        // in to contributing above the statutory wage cap).
        $pfWages = $basic + $da;
        $pfBase = ($template->pf_above_cap ?? false)
            ? $pfWages
            : min($pfWages, (float) ($template->pf_wage_cap ?? 15000));
        $pfEnabled = $template->pf_enabled ?? true;
        $pfEe = $pfEnabled ? $pfBase * (($template->pf_employee_percentage ?? 12) / 100) : 0;
        $pfEr = $pfEnabled ? $pfBase * (($template->pf_employer_percentage ?? 12) / 100) : 0;
        $edli = $pfEnabled ? $pfBase * 0.0017 : 0;
        $adminCharges = $pfEnabled ? $pfBase * 0.005 : 0;

        // LOP deduction = lost wages for unpaid days
        $lopDeduction = 0;
        if ($lopDays > 0 && $totalDays > 0) {
            $dailyWage = $totalEarnings / $totalDays;
            $lopDeduction = round($dailyWage * $lopDays, 2);
        }

        // LOP-adjusted gross for ESI/PT (these apply to payable wages)
        $lopAdjustedGross = max(0, $totalEarnings - $lopDeduction);

        // ESI (on gross, if ≤ ₹21,000)
        $esiEnabled = $template->esi_enabled ?? true;
        $esiThreshold = $template->esi_threshold ?? 21000;
        if ($esiEnabled && $totalEarnings <= $esiThreshold) {
            $esiEe = $totalEarnings * (($template->esi_employee_percentage ?? 0.75) / 100);
            $esiEr = $totalEarnings * (($template->esi_employer_percentage ?? 3.25) / 100);
        } else {
            $esiEe = 0;
            $esiEr = 0;
        }

        // Professional Tax (state-wise) — applied to LOP-adjusted gross.
        // Delegated to PTStateService so there is a single source of truth for
        // state slabs; the local copy that used to live here had drifted and
        // carried off-by-one gaps between slab boundaries.
        $ptAmount = ($template->pt_enabled ?? true)
            ? PTStateService::calculate($stateCode, $lopAdjustedGross, $payMonth)
            : 0.0;

        // LWF (state-wise)
        $lwfAmount = $this->calculateLwf($stateCode, $payMonth);

        // TDS (simplified)
        $tds = $this->calculateTds($employee, $totalEarnings, $payMonth, $payYear);

        // Other deductions
        $loanEmi = $this->getLoanEmi($employeeId);
        $advanceRecovery = $this->getAdvanceRecovery($employeeId);
        $latePenalty = $this->calculateLatePenalty($attendance);

        // $lopDeduction was previously computed and then dropped on the floor,
        // so loss-of-pay days were never actually withheld. It belongs in the
        // deduction total alongside the statutory items.
        $totalDeductions = $lopDeduction + $pfEe + $esiEe + $ptAmount + $lwfAmount
            + $tds + $loanEmi + $advanceRecovery + $latePenalty;

        // 4. Net pay
        $netPayable = round($totalEarnings - $totalDeductions, 2);
        $netPayWords = $this->numberToWords($netPayable);

        // 5. Employer contribution
        $employerContribution = [
            'pf_er' => round($pfEr, 2),
            'esi_er' => round($esiEr, 2),
            'lwf_er' => round($lwfAmount, 2),
            'edli_admin' => round($edli + $adminCharges, 2),
            'total' => round($pfEr + $esiEr + $lwfAmount + $edli + $adminCharges, 2),
        ];

        // 6. YTD calculation
        $ytd = $this->calculateYtd($employeeId, $payYear, $payMonth);

        return [
            'attendance' => [
                'total_days' => $totalDays,
                'days_present' => $daysPresent,
                'paid_leave' => $paidLeave,
                'lop_days' => $lopDays,
                'half_days' => $halfDays,
                'overtime_hours' => $overtimeHours,
            ],
            'earnings' => [
                'basic' => round($basic, 2),
                'hra' => round($hra, 2),
                'da' => round($da, 2),
                'special_allowance' => round($specialAllowance, 2),
                'conveyance' => round($conveyance, 2),
                'medical' => round($medical, 2),
                'statutory_bonus' => round($statutoryBonus, 2),
                'food_allowance' => round($foodAllowance, 2),
                'overtime' => round($overtimePay, 2),
            ],
            'deductions' => [
                'lop' => round($lopDeduction, 2),
                'pf_ee' => round($pfEe, 2),
                'esi_ee' => round($esiEe, 2),
                'pt' => round($ptAmount, 2),
                'lwf' => round($lwfAmount, 2),
                'tds' => round($tds, 2),
                'loan_emi' => round($loanEmi, 2),
                'advance_recovery' => round($advanceRecovery, 2),
                'late_penalty' => round($latePenalty, 2),
            ],
            'total_earnings' => round($totalEarnings, 2),
            'total_deductions' => round($totalDeductions, 2),
            'net_payable' => $netPayable,
            'net_pay_words' => $netPayWords,
            'statutory' => [
                'pf_ee' => round($pfEe, 2),
                'pf_er' => round($pfEr, 2),
                'edli' => round($edli, 2),
                'admin_charges' => round($adminCharges, 2),
                'esi_ee' => round($esiEe, 2),
                'esi_er' => round($esiEr, 2),
                'pt' => round($ptAmount, 2),
                'lwf' => round($lwfAmount, 2),
                'tds' => round($tds, 2),
            ],
            'employer_contribution' => $employerContribution,
            'ytd' => $ytd,
        ];
    }

    /**
     * Calculate LWF for state
     */
    private function calculateLwf(string $stateCode, int $payMonth): float
    {
        $lwfConfig = [
            'maharashtra' => ['enabled' => true, 'amount' => 50, 'frequency' => 'monthly'],
            'gujarat' => ['enabled' => true, 'amount' => 50, 'frequency' => 'bi_annual', 'months' => [1, 7]],
            'karnataka' => ['enabled' => true, 'amount' => 15, 'frequency' => 'monthly'],
            'andhra_pradesh' => ['enabled' => true, 'amount' => 20, 'frequency' => 'monthly'],
            'telangana' => ['enabled' => true, 'amount' => 20, 'frequency' => 'monthly'],
            'tamil_nadu' => ['enabled' => true, 'amount' => 25, 'frequency' => 'monthly'],
            'west_bengal' => ['enabled' => true, 'amount' => 10, 'frequency' => 'monthly'],
            'kerala' => ['enabled' => true, 'amount' => 20, 'frequency' => 'monthly'],
            'bihar' => ['enabled' => true, 'amount' => 10, 'frequency' => 'monthly'],
            'delhi' => ['enabled' => true, 'amount' => 6, 'frequency' => 'monthly'],
            'madhya_pradesh' => ['enabled' => true, 'amount' => 18.75, 'frequency' => 'monthly'],
            'rajasthan' => ['enabled' => true, 'amount' => 10, 'frequency' => 'monthly'],
            'goa' => ['enabled' => true, 'amount' => 15, 'frequency' => 'monthly'],
            'odisha' => ['enabled' => true, 'amount' => 10, 'frequency' => 'monthly'],
        ];

        $config = $lwfConfig[$stateCode] ?? ['enabled' => false, 'amount' => 0, 'frequency' => 'not_applicable'];

        if (!$config['enabled']) {
            return 0;
        }

        if ($config['frequency'] === 'bi_annual') {
            if (in_array($payMonth, $config['months'] ?? [1, 7])) {
                return $config['amount'];
            }
            return 0;
        }

        return $config['amount'];
    }

    /**
     * Calculate YTD values
     */
    private function calculateYtd(int $employeeId, int $payYear, int $currentMonth): array
    {
        $ytd = PayslipYtdHistory::where('employee_id', $employeeId)
            ->where('pay_year', $payYear)
            ->where('pay_month', '<', $currentMonth)
            ->selectRaw('
                COALESCE(SUM(gross), 0) as gross,
                COALESCE(SUM(deductions), 0) as deductions,
                COALESCE(SUM(net), 0) as net,
                COALESCE(SUM(pf_ee), 0) as pf_ee,
                COALESCE(SUM(esi_ee), 0) as esi_ee,
                COALESCE(SUM(pt), 0) as pt,
                COALESCE(SUM(lwf), 0) as lwf
            ')
            ->first();

        return [
            'gross' => round($ytd->gross ?? 0, 2),
            'deductions' => round($ytd->deductions ?? 0, 2),
            'net' => round($ytd->net ?? 0, 2),
            'pf_ee' => round($ytd->pf_ee ?? 0, 2),
            'esi_ee' => round($ytd->esi_ee ?? 0, 2),
            'pt' => round($ytd->pt ?? 0, 2),
            'lwf' => round($ytd->lwf ?? 0, 2),
        ];
    }

    private function calculateStatutoryBonus(float $basic, int $payMonth, int $payYear): float
    {
        // Statutory bonus: 8.33% of basic, capped at ₹7,000 — paid in specific month (typically Sept/Oct)
        if ($payMonth == 9 || $payMonth == 10) {
            return min($basic * 0.0833, 7000);
        }
        return 0;
    }

    private function calculateOvertime(float $basic, float $hours): float
    {
        if ($hours <= 0) return 0;
        $hourlyRate = $basic / 208; // 30 days * 8 hours ≈ 240, using 208 for 4-week month
        return $hourlyRate * $hours * 2; // OT is 2x
    }

    private function calculateTds($employee, float $totalEarnings, int $payMonth, int $payYear): float
    {
        // Simplified TDS: 5% if annual income > ₹2.5L
        $annualIncome = $totalEarnings * 12;
        if ($annualIncome > 250000) {
            return max(0, ($annualIncome * 0.05) / 12);
        }
        return 0;
    }

    private function getLoanEmi(int $employeeId): float
    {
        return 0; // Placeholder — would fetch from loans table
    }

    private function getAdvanceRecovery(int $employeeId): float
    {
        return 0; // Placeholder — would fetch from advances table
    }

    private function calculateLatePenalty(array $attendance): float
    {
        return 0; // Placeholder — would calculate based on late marks
    }

    private function getAttendance(int $employeeId, int $payMonth, int $payYear): array
    {
        // Placeholder — in real app would fetch from attendance module
        $totalDays = $this->getMonthDays($payMonth, $payYear);
        return [
            'present' => $totalDays,
            'paid_leave' => 0,
            'half_days' => 0,
            'overtime_hours' => 0,
        ];
    }

    private function getMonthDays(int $month, int $year): int
    {
        return cal_days_in_month(CAL_GREGORIAN, $month, $year);
    }

    /**
     * Convert number to words (Indian numbering system)
     */
    private function numberToWords(float $amount): string
    {
        if ($amount == 0) return 'Zero Rupees Only';

        $amount = (int) round($amount);
        $ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
            'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
            'Seventeen', 'Eighteen', 'Nineteen'];
        $tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

        $parts = [];
        if ($amount >= 10000000) {
            $parts[] = $this->convertBelow1000(intdiv($amount, 10000000), $ones, $tens) . ' Crore';
            $amount %= 10000000;
        }
        if ($amount >= 100000) {
            $parts[] = $this->convertBelow1000(intdiv($amount, 100000), $ones, $tens) . ' Lakh';
            $amount %= 100000;
        }
        if ($amount >= 1000) {
            $parts[] = $this->convertBelow1000(intdiv($amount, 1000), $ones, $tens) . ' Thousand';
            $amount %= 1000;
        }
        if ($amount > 0) {
            $parts[] = $this->convertBelow1000($amount, $ones, $tens);
        }

        return implode(' ', $parts) . ' Rupees Only';
    }

    /**
     * Spell out a value below 1000.
     *
     * This used to be declared as a plain `function` inside numberToWords(),
     * which defines it in the global namespace on first call and then fatals
     * with "Cannot redeclare convertBelow1000()" on the second — so any payroll
     * run covering more than one employee died partway through.
     *
     * @param  array<int,string>  $ones
     * @param  array<int,string>  $tens
     */
    private function convertBelow1000(int $n, array $ones, array $tens): string
    {
        if ($n === 0) {
            return '';
        }
        if ($n < 20) {
            return $ones[$n];
        }
        if ($n < 100) {
            return $tens[intdiv($n, 10)] . ($n % 10 ? ' ' . $ones[$n % 10] : '');
        }

        return $ones[intdiv($n, 100)] . ' Hundred'
            . ($n % 100 ? ' ' . $this->convertBelow1000($n % 100, $ones, $tens) : '');
    }
}
