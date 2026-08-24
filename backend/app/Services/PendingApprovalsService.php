<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Every queue waiting on an administrator, as one number each.
 *
 * The dashboard's attention strip used to make six round trips to build six
 * badges, across three different counting conventions: a true pre-limit
 * `total` from a paginator (leave), a `data.length` under a hard 200-row
 * server cap (time edits), and a bare unpaginated array (resignations). Three
 * conventions means three ways to be wrong, and the 200 cap in particular
 * renders as a confident "200" for an organisation with four hundred waiting.
 *
 * These are COUNT queries. No rows are loaded, no cap applies, and a count is
 * a count.
 *
 * Every table is checked before it is queried: this runs on tenants whose
 * schema has drifted from migrations before (see the bank_transfer_batches
 * note in CLAUDE.md), and a dashboard strip is the wrong place to discover it.
 * A missing table yields null — "not counted" — never a zero, because a zero
 * here reads as "nothing is waiting on you".
 */
class PendingApprovalsService
{
    /** @return array<string, int|null> */
    public function forOrganization(int $organizationId): array
    {
        return [
            'leave' => $this->count('leave_requests', $organizationId, ['status' => 'pending']),
            'time_edits' => $this->count('attendance_time_edit_requests', $organizationId, ['status' => 'pending']),
            'resignations' => $this->count('resignations', $organizationId, ['status' => 'pending']),
            'reimbursements' => $this->count('reimbursements', $organizationId, ['status' => 'pending']),
            /*
             * Not a status: a filing is overdue when its deadline has passed
             * and nothing has been filed. `filed_at` null AND due_date behind
             * us — a filed return can never become overdue however long ago
             * the deadline was, which is the same rule FilingDueDates applies.
             */
            'filings_overdue' => $this->overdueFilings($organizationId),
        ];
    }

    /** @return array<string, int|null> */
    public function withTotal(int $organizationId): array
    {
        $counts = $this->forOrganization($organizationId);

        // Sum only what was actually counted. A null must not read as zero.
        $counted = array_filter($counts, fn ($n) => $n !== null);

        return $counts + ['total' => array_sum($counted)];
    }

    private function count(string $table, int $organizationId, array $where): ?int
    {
        if (! Schema::hasTable($table)) {
            return null;
        }

        $query = DB::table($table);

        // Not every one of these tables is tenant-scoped in the same way, and
        // a missing organization_id column must not throw here.
        if (Schema::hasColumn($table, 'organization_id')) {
            $query->where('organization_id', $organizationId);
        }

        foreach ($where as $column => $value) {
            if (Schema::hasColumn($table, $column)) {
                $query->where($column, $value);
            }
        }

        return (int) $query->count();
    }

    private function overdueFilings(int $organizationId): ?int
    {
        if (! Schema::hasTable('payroll_filings') || ! Schema::hasColumn('payroll_filings', 'due_date')) {
            return null;
        }

        return (int) DB::table('payroll_filings')
            ->where('organization_id', $organizationId)
            ->whereNull('filed_at')
            ->whereNotNull('due_date')
            ->whereDate('due_date', '<', now()->toDateString())
            ->count();
    }
}
