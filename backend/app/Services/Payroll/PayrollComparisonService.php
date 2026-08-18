<?php

namespace App\Services\Payroll;

use App\Models\EmployeeBankAccount;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;

/**
 * What changed between two payroll runs, and what looks wrong inside one.
 *
 * This is the detective half of payroll control. Preventive guards stop a bad
 * write; nothing stopped a bad *figure*, because nobody could see it. A payroll
 * officer's real question before payday is "who moved, and why" — and until
 * this existed the only way to answer it was to open two months side by side.
 *
 * One diff primitive, four presentations. The alternative — four independent
 * report endpoints — would have copy-pasted the delta logic three times and
 * left four definitions of "changed" to drift apart, which is the same failure
 * mode that produced four tax engines and twenty-five immutability guards.
 *
 * Deltas are measured over PayrollItem::MONEY_COLUMNS, the list the closed-run
 * observer already guards. Reusing it means a new money column appears in this
 * report the moment it is added there, rather than the moment someone remembers
 * this file exists.
 *
 * Nothing here writes. Every method is safe to run against a disbursed run,
 * which is the point: the reports must work on exactly the months you can no
 * longer change.
 */
class PayrollComparisonService
{
    /** Ignore rounding dust so a 1-paisa cast difference is not "a change". */
    private const MATERIALITY = 0.01;

    /**
     * Component-level deltas between two runs.
     *
     * @return array{
     *   from: string, to: string,
     *   continuing: list<array>, joiners: list<array>, leavers: list<array>,
     *   totals: array<string, float>
     * }
     */
    public function compare(PayrollMonthlyRun $from, PayrollMonthlyRun $to): array
    {
        $fromItems = $this->itemsKeyedByUser($from);
        $toItems = $this->itemsKeyedByUser($to);

        $continuing = [];
        $joiners = [];
        $leavers = [];
        $totals = [];

        foreach ($toItems as $userId => $toItem) {
            $fromItem = $fromItems[$userId] ?? null;

            if ($fromItem === null) {
                // A joiner is not a 100% increase. Reporting them as one is how
                // a differences report becomes noise nobody reads.
                $joiners[] = [
                    'user_id' => $userId,
                    'name' => $toItem->user->name ?? "User #{$userId}",
                    'net_pay' => (float) $toItem->net_pay,
                ];

                continue;
            }

            $changes = $this->columnDeltas($fromItem, $toItem);

            foreach ($changes as $column => $delta) {
                $totals[$column] = ($totals[$column] ?? 0) + $delta['delta'];
            }

            if ($changes !== []) {
                $continuing[] = [
                    'user_id' => $userId,
                    'name' => $toItem->user->name ?? "User #{$userId}",
                    'changes' => $changes,
                    'net_pay_delta' => $changes['net_pay']['delta'] ?? 0.0,
                ];
            }
        }

        foreach ($fromItems as $userId => $fromItem) {
            if (! isset($toItems[$userId])) {
                $leavers[] = [
                    'user_id' => $userId,
                    'name' => $fromItem->user->name ?? "User #{$userId}",
                    'net_pay' => (float) $fromItem->net_pay,
                ];
            }
        }

        return [
            'from' => (string) $from->month_year,
            'to' => (string) $to->month_year,
            'continuing' => $continuing,
            'joiners' => $joiners,
            'leavers' => $leavers,
            'totals' => array_map(fn (float $v) => round($v, 2), $totals),
        ];
    }

    /**
     * Presentation 1 — item-wise: every changed component, one row each.
     * The view a payroll officer uses to answer "what moved".
     */
    public function itemWise(PayrollMonthlyRun $from, PayrollMonthlyRun $to): array
    {
        $rows = [];

        foreach ($this->compare($from, $to)['continuing'] as $employee) {
            foreach ($employee['changes'] as $column => $delta) {
                $rows[] = [
                    'user_id' => $employee['user_id'],
                    'name' => $employee['name'],
                    'component' => $column,
                ] + $delta;
            }
        }

        return $rows;
    }

    /**
     * Presentation 2 — employee-wise: one row per person, ranked by how much
     * their net pay moved. Answers "who should I look at first".
     */
    public function employeeWise(PayrollMonthlyRun $from, PayrollMonthlyRun $to): array
    {
        $rows = $this->compare($from, $to)['continuing'];

        usort($rows, fn (array $a, array $b) => abs($b['net_pay_delta']) <=> abs($a['net_pay_delta']));

        return $rows;
    }

    /**
     * Presentation 3 — consolidated: one row per component across the whole
     * run. Answers "did the payroll as a whole move the way I expected".
     */
    public function consolidated(PayrollMonthlyRun $from, PayrollMonthlyRun $to): array
    {
        $comparison = $this->compare($from, $to);
        $rows = [];

        foreach ($comparison['totals'] as $column => $delta) {
            $rows[] = ['component' => $column, 'delta' => $delta];
        }

        usort($rows, fn (array $a, array $b) => abs($b['delta']) <=> abs($a['delta']));

        return $rows;
    }

    /**
     * Negative cost: money that cannot be right in the direction it points.
     *
     * A negative net pay is legitimate and is deliberately stored signed — the
     * house rule is that validation stops the run, not a clamp. But it must be
     * *seen*, and a negative earning or a negative deduction is a defect
     * outright. This is the report that turns a stored negative from a silent
     * liability into a pre-payday question.
     */
    public function negativeCost(PayrollMonthlyRun $run): array
    {
        $findings = [];

        foreach ($this->itemsKeyedByUser($run) as $userId => $item) {
            foreach (PayrollItem::MONEY_COLUMNS as $column) {
                $value = (float) ($item->{$column} ?? 0);

                if ($value >= -self::MATERIALITY) {
                    continue;
                }

                $findings[] = [
                    'user_id' => $userId,
                    'name' => $item->user->name ?? "User #{$userId}",
                    'component' => $column,
                    'value' => round($value, 2),
                    // net_pay is the one column where a negative is a real
                    // outcome rather than a broken input.
                    'severity' => $column === 'net_pay' ? 'review' : 'defect',
                ];
            }
        }

        return $findings;
    }

    /**
     * Duplicates: two ways the same person gets paid twice.
     *
     * The second is the one that actually loses money. A shared bank account
     * across two employee records pays one human twice and looks entirely
     * normal on a headcount report — it only shows up in the bank file, by
     * which point the transfer has left.
     */
    public function duplicates(PayrollMonthlyRun $run): array
    {
        $findings = [];

        $repeatedUsers = PayrollItem::where('payroll_run_id', $run->id)
            ->selectRaw('user_id, COUNT(*) as row_count')
            ->groupBy('user_id')
            ->havingRaw('COUNT(*) > 1')
            ->get();

        foreach ($repeatedUsers as $row) {
            $findings[] = [
                'kind' => 'duplicate_item',
                'user_id' => (int) $row->user_id,
                'occurrences' => (int) $row->row_count,
                'detail' => 'This employee has more than one payroll item in the run.',
            ];
        }

        $items = $this->itemsKeyedByUser($run);

        if ($items === []) {
            return $findings;
        }

        $accounts = EmployeeBankAccount::whereIn('user_id', array_keys($items))
            ->where('is_default', true)
            ->get(['user_id', 'account_number', 'ifsc_swift']);

        $byAccount = [];
        foreach ($accounts as $account) {
            $key = trim((string) $account->account_number).'|'.trim((string) $account->ifsc_swift);

            if ($key === '|') {
                continue;
            }

            $byAccount[$key][] = (int) $account->user_id;
        }

        foreach ($byAccount as $key => $userIds) {
            if (count($userIds) < 2) {
                continue;
            }

            $findings[] = [
                'kind' => 'shared_bank_account',
                'user_ids' => $userIds,
                'account' => explode('|', $key)[0],
                'detail' => 'More than one employee in this run is paid to the same account.',
            ];
        }

        return $findings;
    }

    /**
     * Reconciliation: does the run cover the people it should?
     *
     * A headcount assertion rather than a money one. The failure it catches is
     * the quiet one — an employee who simply is not in the run at all, and so
     * appears in no total, no variance and no exception list.
     */
    public function reconciliation(PayrollMonthlyRun $from, PayrollMonthlyRun $to): array
    {
        $comparison = $this->compare($from, $to);

        $fromCount = count($this->itemsKeyedByUser($from));
        $toCount = count($this->itemsKeyedByUser($to));

        return [
            'from' => $comparison['from'],
            'to' => $comparison['to'],
            'headcount_from' => $fromCount,
            'headcount_to' => $toCount,
            'joiners' => count($comparison['joiners']),
            'leavers' => count($comparison['leavers']),
            // The identity that must hold. If it does not, someone was added or
            // dropped without appearing in either list, which is a data defect
            // rather than a staffing change.
            'balances' => $fromCount + count($comparison['joiners']) - count($comparison['leavers']) === $toCount,
        ];
    }

    /**
     * @return array<string, array{from: float, to: float, delta: float, pct: float|null}>
     */
    private function columnDeltas(PayrollItem $from, PayrollItem $to): array
    {
        $changes = [];

        foreach (PayrollItem::MONEY_COLUMNS as $column) {
            $before = (float) ($from->{$column} ?? 0);
            $after = (float) ($to->{$column} ?? 0);
            $delta = $after - $before;

            if (abs($delta) < self::MATERIALITY) {
                continue;
            }

            $changes[$column] = [
                'from' => round($before, 2),
                'to' => round($after, 2),
                'delta' => round($delta, 2),
                // Null rather than infinity when a component starts at zero:
                // "new" is the honest answer, and a percentage there is a
                // division by zero dressed up as information.
                'pct' => abs($before) < self::MATERIALITY ? null : round($delta / $before * 100, 2),
            ];
        }

        return $changes;
    }

    /** @return array<int, PayrollItem> */
    private function itemsKeyedByUser(PayrollMonthlyRun $run): array
    {
        return PayrollItem::with('user:id,name')
            ->where('payroll_run_id', $run->id)
            ->get()
            ->keyBy('user_id')
            ->all();
    }
}
