<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Backfill `payroll_items.month_year` from the owning run.
 *
 * Three rows on the live database (payroll_run_id = 3, the April 2026 run)
 * carry a NULL month_year and 66 LOP days between them. Nothing errors on
 * them — they are simply dropped by every `group by month_year` query, so
 * anything that aggregates items by month silently under-reports.
 *
 * The dashboard charts read `payroll_monthly_runs`, which stores the month
 * correctly, so they are unaffected. Item-level month queries — filings and
 * registers — are not.
 *
 * Guarded rather than assumed: the table, both columns and the parent run
 * are all checked before anything is written, so this is a no-op on a
 * database that never had the problem.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('payroll_items') || ! Schema::hasTable('payroll_monthly_runs')) {
            return;
        }

        if (! Schema::hasColumn('payroll_items', 'month_year')
            || ! Schema::hasColumn('payroll_items', 'payroll_run_id')) {
            return;
        }

        DB::table('payroll_items')
            ->whereNull('month_year')
            ->whereNotNull('payroll_run_id')
            ->orderBy('id')
            ->chunkById(500, function ($items) {
                $runIds = $items->pluck('payroll_run_id')->unique()->filter()->all();

                if (empty($runIds)) {
                    return;
                }

                $months = DB::table('payroll_monthly_runs')
                    ->whereIn('id', $runIds)
                    ->whereNotNull('month_year')
                    ->pluck('month_year', 'id');

                foreach ($items as $item) {
                    $month = $months[$item->payroll_run_id] ?? null;

                    // A run with no month of its own cannot repair its items.
                    // Leave those alone rather than inventing a date.
                    if ($month === null) {
                        continue;
                    }

                    DB::table('payroll_items')
                        ->where('id', $item->id)
                        ->update(['month_year' => $month]);
                }
            });
    }

    public function down(): void
    {
        // Irreversible by design. The previous state was NULL, and restoring it
        // would re-introduce the defect this migration exists to remove. There
        // is no way to tell a backfilled row from one that was always correct.
    }
};
