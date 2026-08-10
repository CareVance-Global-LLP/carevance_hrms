<?php

namespace App\Services\Payroll;

use App\Models\EmployeePayrollTemplate;
use App\Models\PayslipYtdHistory;
use App\Models\User;
use App\Services\Attendance\AttendanceService;
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

        $stateCode = $template->pt_state ?: '';
        $basicPercentage = (float) ($template->basic_percentage ?? 40);

        // 1. Attendance, from the same monthly summary the payroll run uses.
        $attendance = $this->getAttendance($employeeId, $payMonth, $payYear);
        // Calendar days are only used for mid-month joiner pro-ration below,
        // which is day-of-month arithmetic. Everything else works on the
        // working-day basis so it agrees with the payroll run.
        $totalDays = $this->getMonthDays($payMonth, $payYear);
        $workingDays = (float) ($attendance['working_days'] ?? 0);
        $daysPresent = (float) ($attendance['present'] ?? 0);
        $paidLeave = (float) ($attendance['paid_leave'] ?? 0);
        $lopDays = (float) ($attendance['lop_days'] ?? 0);
        $halfDays = (float) ($attendance['half_days'] ?? 0);
        $overtimeHours = (float) ($attendance['overtime_hours'] ?? 0);

        // 2. Earnings are the FULL month. Loss of pay is withheld exactly once,
        // as the explicit lopDeduction below. Pro-rating earnings here as well
        // would charge every absent day twice.
        $proRataFactor = 1.0;

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

        // Pro-rata for mid-month joiners.
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

            /*
             * Days before the joining date are not loss of pay — the person was
             * not employed yet. The attendance summary has no concept of a
             * joining date and counts them absent, so charging that LOP on top
             * of the pro-ration above would deduct the same days twice.
             */
            $lopDays = max(0.0, $lopDays - $this->workingDaysBefore($joiningDate, $payMonth, $payYear));
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

        // LOP deduction = lost wages for unpaid days, on the working-day
        // divisor so it matches the payroll run. Capped at earnings so a bad
        // lopDays cannot invent wages to claw back.
        $lopDeduction = 0;
        $divisorDays = app(PayrollDayBasisResolver::class)->divisorDays(
            app(PayrollDayBasisResolver::class)->basisFor($employee->organization),
            sprintf('%04d-%02d', $payYear, $payMonth),
            $workingDays
        );
        if ($lopDays > 0 && $divisorDays > 0) {
            $dailyWage = $totalEarnings / $divisorDays;
            $lopDeduction = min(round($dailyWage * $lopDays, 2), round($totalEarnings, 2));
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
    /**
     * Delegated to the shared calculator. This used to carry its own state
     * table whose amounts disagreed with the one the LWF return is generated
     * from — Gujarat ₹50 vs ₹25, Tamil Nadu ₹25 vs ₹30, Karnataka ₹15 vs ₹20 —
     * so a payslip and the filing for the same month could not both be right.
     * It also listed Rajasthan and Bihar, which have no Labour Welfare Fund Act.
     */
    private function calculateLwf(string $stateCode, int $payMonth): float
    {
        return app(LwfCalculator::class)->forMonth($stateCode, $payMonth);
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

    /**
     * Attendance for the pay month, from the same summary the payroll run
     * consumes so a payslip can never disagree with what was actually paid.
     *
     * This used to be a placeholder returning "present every calendar day",
     * which forced lopDays to zero and made loss of pay impossible to show.
     */
    private function getAttendance(int $employeeId, int $payMonth, int $payYear): array
    {
        $employee = User::find($employeeId);
        if (! $employee) {
            return ['working_days' => 0, 'present' => 0, 'paid_leave' => 0, 'lop_days' => 0, 'half_days' => 0, 'overtime_hours' => 0];
        }

        $summary = app(AttendanceService::class)
            ->monthlyAttendanceSummary($employee, sprintf('%04d-%02d', $payYear, $payMonth));

        return [
            'working_days' => (float) ($summary['working_days'] ?? 0),
            'present' => (float) ($summary['present_days'] ?? 0),
            'paid_leave' => (float) ($summary['paid_leave_days'] ?? 0),
            'lop_days' => (float) ($summary['total_lop_days'] ?? 0),
            'half_days' => (float) ($summary['half_day_present'] ?? 0) + (float) ($summary['half_day_absent'] ?? 0),
            'overtime_hours' => round(((float) ($summary['overtime_seconds'] ?? 0)) / 3600, 2),
        ];
    }

    private function getMonthDays(int $month, int $year): int
    {
        return cal_days_in_month(CAL_GREGORIAN, $month, $year);
    }

    /**
     * Working days in the pay month that fall before $date — the days a
     * mid-month joiner was not yet employed for.
     */
    private function workingDaysBefore(\DateTimeInterface $date, int $payMonth, int $payYear): float
    {
        $cursor = \Carbon\Carbon::create($payYear, $payMonth, 1)->startOfDay();
        $joining = \Carbon\Carbon::parse($date)->startOfDay();
        $count = 0.0;

        for (; $cursor->lessThan($joining) && (int) $cursor->format('n') === $payMonth; $cursor->addDay()) {
            if (! $cursor->isWeekend()) {
                $count += 1.0;
            }
        }

        return $count;
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
