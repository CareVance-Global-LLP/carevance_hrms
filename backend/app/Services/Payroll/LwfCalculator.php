<?php

namespace App\Services\Payroll;

use App\Services\PayrollFilingService;

/**
 * Labour Welfare Fund, employee contribution.
 *
 * LWF was filed but never collected: PayrollAutoProcessService generates an
 * LWF return for the run while neither live engine ever deducted a rupee, so
 * the return reported contributions that had not been withheld from anyone.
 * The one implementation that did compute it lived privately inside
 * SalaryCalculationService with its own state table whose amounts disagreed
 * with the table used for filing (Gujarat ₹50 vs ₹25, Tamil Nadu ₹25 vs ₹30,
 * Karnataka ₹15 vs ₹20).
 *
 * PayrollFilingService::LWF_STATE_CONFIG is the table the returns are built
 * from, so it is the one the deduction has to agree with. A state that is not
 * in it has no LWF Act and yields ₹0 — never a guessed default.
 */
class LwfCalculator
{
    /**
     * Employee LWF contribution for one payroll month.
     *
     * @param string   $stateCode lowercase state key; '' when unconfigured
     * @param int|null $payMonth  1-12, needed for the bi-annual states
     */
    public function forMonth(string $stateCode, ?int $payMonth): float
    {
        $key = strtolower(trim($stateCode));
        if ($key === '') {
            return 0.0;
        }

        $config = PayrollFilingService::LWF_STATE_CONFIG[$key] ?? null;
        if (! $config) {
            // No LWF Act in this state (Uttar Pradesh, Rajasthan, ...), or the
            // state is unknown. Either way nothing is owed.
            return 0.0;
        }

        if (($config['frequency'] ?? 'monthly') === 'bi_annual') {
            $months = $config['months'] ?? [1, 7];

            return $payMonth !== null && in_array($payMonth, $months, true)
                ? (float) $config['amount']
                : 0.0;
        }

        return (float) $config['amount'];
    }
}
