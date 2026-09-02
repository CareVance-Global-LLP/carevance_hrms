<?php

namespace App\Services\Payroll;

use App\Models\EmployeeLoan;
use App\Models\EmployeePayrollTemplate;
use App\Models\User;
use App\Services\PayrollCalculatorService;

/**
 * How much can lawfully be deducted from somebody's pay each month.
 *
 * THE LIMIT IS STATUTORY, NOT A POLICY SETTING. Code on Wages 2019 s.18: the
 * total deductions in a wage period must not exceed fifty per cent of wages. It
 * replaces Payment of Wages Act 1936 s.7(3) and drops that Act's 75% exception
 * for payments to co-operative societies, so 50% is the number for everybody.
 *
 * The cap is on TOTAL deductions — provident fund, ESI, professional tax, income
 * tax and the loan instalment together — which is exactly the quantity that went
 * wrong in the August 2026 run. One employee had ₹17,089 deducted from ₹8,542 of
 * gross and finished at −₹8,547: he would have owed the company money for having
 * worked a month. His ₹15,000 EMI had been approved against a salary that could
 * never carry it, because nothing in the loan path ever compared the two.
 *
 * Deliberately computed from the SALARY STRUCTURE rather than a past payslip.
 * A loan is requested before the month it will be recovered in, so the honest
 * basis is what the employee is contracted to earn — using last month's actual
 * gross would make a loan approvable or not depending on how much leave somebody
 * happened to take. `PayrollCalculatorService` is the same engine the run uses,
 * so the estimate and the reality cannot drift apart.
 *
 * What this does NOT do is guarantee a positive net pay in every month. An
 * employee who then takes unpaid leave earns less than their structure implies,
 * and the affordable EMI stops being affordable — which is what happened to two
 * of the three negative rows. Catching that needs a check at RUN time as well;
 * this one stops the unaffordable schedule ever being agreed.
 */
class LoanAffordability
{
    /** Code on Wages 2019, s.18. */
    public const STATUTORY_DEDUCTION_CEILING = 0.50;

    public function __construct(
        private readonly PayrollCalculatorService $calculator,
    ) {
    }

    /**
     * The largest EMI this person can lawfully take on.
     *
     * @param  int|null  $excludeLoanId  A loan being re-assessed, so its own EMI
     *                                   is not counted against itself.
     * @return array{
     *     max_emi: float, monthly_gross: float, statutory_deductions: float,
     *     existing_loan_emis: float, ceiling: float, has_salary: bool, reason: ?string
     * }
     */
    public function maxEmiFor(User $user, ?int $excludeLoanId = null): array
    {
        $annualCtc = (float) (EmployeePayrollTemplate::withoutGlobalScopes()
            ->where('user_id', $user->id)
            ->where('is_active', true)
            ->value('annual_ctc') ?? 0);

        if ($annualCtc <= 0) {
            // No salary on record is not zero headroom by arithmetic — it is an
            // unanswerable question, and it must say so rather than silently
            // refusing every loan as "unaffordable".
            return $this->empty('This employee has no salary structure configured, so affordability cannot be assessed.');
        }

        $breakdown = $this->calculator->calculatePayroll(annualCtc: $annualCtc);

        $gross = (float) ($breakdown['monthly']['gross'] ?? 0);
        $statutory = (float) ($breakdown['monthly']['total_deductions'] ?? 0);

        if ($gross <= 0) {
            return $this->empty('This employee has no monthly gross to deduct from.');
        }

        $existingEmis = (float) EmployeeLoan::withoutGlobalScopes()
            ->where('user_id', $user->id)
            ->where('status', 'approved')
            ->where('remaining_amount', '>', 0)
            ->when($excludeLoanId !== null, fn ($q) => $q->where('id', '!=', $excludeLoanId))
            ->sum('emi_amount');

        $ceiling = round($gross * self::STATUTORY_DEDUCTION_CEILING, 2);

        // Never negative: somebody already past the ceiling has no headroom, not
        // negative headroom, and the message has to be about that.
        $headroom = round(max(0, $ceiling - $statutory - $existingEmis), 2);

        return [
            'max_emi' => $headroom,
            'monthly_gross' => round($gross, 2),
            'statutory_deductions' => round($statutory, 2),
            'existing_loan_emis' => round($existingEmis, 2),
            'ceiling' => $ceiling,
            'has_salary' => true,
            'reason' => $headroom > 0 ? null : 'Existing deductions already reach the statutory limit of 50% of wages.',
        ];
    }

    /**
     * Whether a proposed instalment fits, with a sentence explaining why not.
     *
     * @return array{allowed: bool, message: ?string, assessment: array}
     */
    public function check(User $user, float $emi, ?int $excludeLoanId = null): array
    {
        $a = $this->maxEmiFor($user, $excludeLoanId);

        /*
         * Unanswerable is not the same as unaffordable.
         *
         * With no salary on record there is nothing to take fifty per cent of,
         * so this DEFERS rather than refusing — vetoing here would make a loan
         * impossible for anyone whose payroll is not set up yet, which is a
         * different and worse problem than the one this guard exists for.
         * approveLoan checks again, and by then a CTC must exist because the
         * run cannot price anybody without one.
         */
        if (! $a['has_salary']) {
            return ['allowed' => true, 'message' => $a['reason'], 'assessment' => $a];
        }

        if ($emi <= $a['max_emi']) {
            return ['allowed' => true, 'message' => null, 'assessment' => $a];
        }

        $money = fn (float $v) => '₹'.number_format($v, 2);

        $message = $a['max_emi'] <= 0
            ? sprintf(
                'This employee already has %s of monthly deductions against %s of gross pay, which reaches the '
                .'statutory limit of 50%% of wages (Code on Wages 2019, s.18). No further instalment can be added.',
                $money($a['statutory_deductions'] + $a['existing_loan_emis']),
                $money($a['monthly_gross'])
            )
            : sprintf(
                'An instalment of %s would take total monthly deductions past 50%% of wages, which the Code on '
                .'Wages 2019 (s.18) does not permit. The most that can be deducted is %s a month — %s of that is '
                .'already committed, leaving %s. Reduce the instalment or spread it over more months.',
                $money($emi),
                $money($a['ceiling']),
                $money($a['statutory_deductions'] + $a['existing_loan_emis']),
                $money($a['max_emi'])
            );

        return ['allowed' => false, 'message' => $message, 'assessment' => $a];
    }

    private function empty(string $reason): array
    {
        return [
            'max_emi' => 0.0,
            'monthly_gross' => 0.0,
            'statutory_deductions' => 0.0,
            'existing_loan_emis' => 0.0,
            'ceiling' => 0.0,
            'has_salary' => false,
            'reason' => $reason,
        ];
    }
}
