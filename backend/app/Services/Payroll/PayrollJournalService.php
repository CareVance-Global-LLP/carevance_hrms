<?php

namespace App\Services\Payroll;

use App\Models\GlMappingConfig;
use App\Models\PayrollMonthlyRun;
use RuntimeException;

/**
 * A payroll run, as double-entry.
 *
 * THE JOURNAL MUST BALANCE, EXACTLY. Debits equal credits to the paisa or the
 * export is not produced at all. An unbalanced journal is rejected by every
 * accounting system worth the name — and the ones that do not reject it import
 * half of it, which is considerably worse than a refusal somebody can act on.
 *
 * NOTHING IS SILENTLY DROPPED. A component with no ledger mapped is reported as
 * unmapped and the export refuses; it is never posted to a suspense account or
 * omitted. "Your salary journal is 40,000 light and nobody knows why" is a
 * month-end nobody should have to have, and it is what omitting one line
 * produces.
 *
 * COMPUTED IN BCMATH, ROUNDED ONCE. Every figure here comes off decimal columns
 * and goes into an accounting system that will compare it against a bank
 * statement. A float sum drifts by a paisa across a few hundred employees, and
 * a paisa is the difference between balanced and rejected.
 *
 * THE SHAPE, for a payroll run:
 *
 *   Dr  Salaries and wages                gross
 *   Dr  Employer PF contribution          employer PF
 *   Dr  Employer ESI contribution         employer ESI
 *       Cr  PF payable                    employee PF + employer PF
 *       Cr  ESI payable                   employee ESI + employer ESI
 *       Cr  TDS payable                   TDS
 *       Cr  Professional tax payable      PT
 *       Cr  Salaries payable              net pay
 */
class PayrollJournalService
{
    /**
     * Which ledger each line wants, and which side it sits on.
     *
     * Keyed by the run column so the mapping is checkable against the schema
     * rather than against a comment. `debit` is from the EMPLOYER's books: a
     * salary is an expense, a statutory deduction is a liability owed onward.
     *
     * @var array<string, array{label: string, side: string, entity: string}>
     */
    private const LINES = [
        'total_gross' => ['label' => 'Salaries and wages', 'side' => 'debit', 'entity' => 'gross'],
        'total_pf_employer' => ['label' => 'Employer PF contribution', 'side' => 'debit', 'entity' => 'pf_employer'],
        'total_esi_employer' => ['label' => 'Employer ESI contribution', 'side' => 'debit', 'entity' => 'esi_employer'],

        'total_tds' => ['label' => 'TDS payable', 'side' => 'credit', 'entity' => 'tds'],
        'total_pt' => ['label' => 'Professional tax payable', 'side' => 'credit', 'entity' => 'pt'],
        'total_net_pay' => ['label' => 'Salaries payable', 'side' => 'credit', 'entity' => 'net_pay'],
    ];

    /**
     * Build the journal for a run.
     *
     * @return array{
     *   run_id: int,
     *   period: string,
     *   date: string,
     *   lines: array<int, array<string, mixed>>,
     *   totals: array{debit: string, credit: string, balanced: bool},
     *   unmapped: array<int, string>,
     * }
     */
    public function build(PayrollMonthlyRun $run): array
    {
        $mappings = GlMappingConfig::query()
            ->where('organization_id', $run->organization_id)
            ->where('is_active', true)
            ->get()
            ->keyBy('entity_type');

        $lines = [];
        $unmapped = [];
        $debit = '0.00';
        $credit = '0.00';

        foreach (self::LINES as $column => $spec) {
            $amount = $this->decimal($run->{$column} ?? 0);

            // A zero line is not posted. An organization with no ESI liability
            // this month should not have an ESI row in its journal, and a
            // reviewer scanning for anomalies should not have to skip past it.
            if (bccomp($amount, '0.00', 2) === 0) {
                continue;
            }

            $mapping = $mappings->get($spec['entity']);

            if (! $mapping || ! filled($mapping->gl_code)) {
                $unmapped[] = $spec['entity'];

                continue;
            }

            $lines[] = [
                'entity' => $spec['entity'],
                'ledger' => $mapping->gl_name ?: $spec['label'],
                'gl_code' => $mapping->gl_code,
                'cost_center' => $mapping->cost_center,
                'side' => $spec['side'],
                'amount' => $amount,
            ];

            if ($spec['side'] === 'debit') {
                $debit = bcadd($debit, $amount, 2);
            } else {
                $credit = bcadd($credit, $amount, 2);
            }
        }

        /*
         * PF and ESI payable carry BOTH halves. The employee's share was
         * deducted from their pay and the employer's was an expense above; the
         * organization owes the total onward as one liability, and splitting it
         * into two credit lines would not reconcile against the single
         * challan that actually gets paid.
         */
        foreach ([
            ['entity' => 'pf_payable', 'label' => 'PF payable', 'columns' => ['total_pf_employee', 'total_pf_employer']],
            ['entity' => 'esi_payable', 'label' => 'ESI payable', 'columns' => ['total_esi_employee', 'total_esi_employer']],
        ] as $payable) {
            $amount = '0.00';

            foreach ($payable['columns'] as $column) {
                $amount = bcadd($amount, $this->decimal($run->{$column} ?? 0), 2);
            }

            if (bccomp($amount, '0.00', 2) === 0) {
                continue;
            }

            $mapping = $mappings->get($payable['entity']);

            if (! $mapping || ! filled($mapping->gl_code)) {
                $unmapped[] = $payable['entity'];

                continue;
            }

            $lines[] = [
                'entity' => $payable['entity'],
                'ledger' => $mapping->gl_name ?: $payable['label'],
                'gl_code' => $mapping->gl_code,
                'cost_center' => $mapping->cost_center,
                'side' => 'credit',
                'amount' => $amount,
            ];

            $credit = bcadd($credit, $amount, 2);
        }

        return [
            'run_id' => (int) $run->id,
            'period' => (string) $run->month_year,
            'date' => ($run->pay_date ?: $run->created_at)?->toDateString() ?? now()->toDateString(),
            'lines' => $lines,
            'totals' => [
                'debit' => $debit,
                'credit' => $credit,
                'balanced' => bccomp($debit, $credit, 2) === 0,
            ],
            'unmapped' => array_values(array_unique($unmapped)),
        ];
    }

    /**
     * The journal, or a refusal.
     *
     * Refuses on an unmapped component and on an imbalance, and says which.
     * Exporting anyway would produce a file the accounting system either
     * rejects — wasting somebody's afternoon — or imports partially, which
     * costs considerably more than an afternoon.
     *
     * @return array<string, mixed>
     */
    public function buildOrFail(PayrollMonthlyRun $run): array
    {
        $journal = $this->build($run);

        if ($journal['unmapped'] !== []) {
            throw new RuntimeException(
                'These have no ledger mapped: '.implode(', ', $journal['unmapped'])
                .'. Map them under Settings before exporting.'
            );
        }

        if ($journal['lines'] === []) {
            throw new RuntimeException('There is nothing to post for this run.');
        }

        if (! $journal['totals']['balanced']) {
            /*
             * Should be unreachable given the shape above, and stated anyway.
             * If a run's own totals disagree with each other, the honest thing
             * is to say the journal does not balance rather than hand somebody
             * a file that quietly does not.
             */
            throw new RuntimeException(sprintf(
                'The journal does not balance: debits %s, credits %s. This is a problem with the payroll run, not the export.',
                $journal['totals']['debit'],
                $journal['totals']['credit'],
            ));
        }

        return $journal;
    }

    /** Two places, as a string. Money never becomes a float on the way through. */
    private function decimal(string|int|float|null $value): string
    {
        return bcadd((string) ($value ?: 0), '0', 2);
    }
}
