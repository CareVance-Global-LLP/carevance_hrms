<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Relabel the seeded demo projects as money budgets.
 *
 * ComprehensiveDemoSeeder wrote rupee amounts into a column the UI read as
 * hours. Now that budget_type exists those rows need to say so, otherwise the
 * ledger keeps rendering "500000h".
 *
 * The obvious `UPDATE projects SET budget_type = 'amount' WHERE budget IS NOT
 * NULL` is wrong. Every pre-existing budget was typed into a form labelled
 * "Budget (hours)", so a blanket update would reinterpret somebody's genuine
 * 200-hour budget as ₹200. A magnitude heuristic ("over 10000 must be money")
 * is a guess dressed up as a rule.
 *
 * So this matches the ten seeded rows on their exact (name, budget) pair. A
 * real project that merely shares a name is never touched, which is the
 * property ProjectBudgetBackfillTest pins.
 *
 * The rate is written for the same reason the relabelling is: without one a
 * money budget has no percentage, so all ten would show "Rate needed" and the
 * ledger would still tell nobody anything. These rows are provably demo data —
 * that is what the exact-match predicate establishes — so a demo rate is not
 * an invented number for real work.
 */
return new class extends Migration
{
    /**
     * Names and budgets exactly as ComprehensiveDemoSeeder wrote them.
     */
    private const DEMO_PROJECTS = [
        'Website Redesign' => 150000,
        'Mobile App v2' => 500000,
        'Data Migration' => 80000,
        'AI Chatbot Integration' => 200000,
        'Security Audit Q2' => 50000,
        'HR Portal' => 120000,
        'Payment Gateway v3' => 300000,
        'Analytics Dashboard' => 90000,
        'API Documentation' => 30000,
        'DevOps Pipeline' => 60000,
    ];

    private const DEMO_HOURLY_RATE = 1200;

    public function up(): void
    {
        if (! $this->columnsExist()) {
            return;
        }

        foreach (self::DEMO_PROJECTS as $name => $budget) {
            DB::table('projects')
                ->where('name', $name)
                ->where('budget', $budget)
                // Idempotent: a second run finds nothing left on 'hours'.
                ->where('budget_type', 'hours')
                ->update([
                    'budget_type' => 'amount',
                    'hourly_rate' => self::DEMO_HOURLY_RATE,
                    'updated_at' => now(),
                ]);
        }
    }

    /**
     * Reversible, unlike most backfills — the prior state of these rows is
     * knowable, because the column defaulted to 'hours' and only this
     * migration moved them off it.
     */
    public function down(): void
    {
        if (! $this->columnsExist()) {
            return;
        }

        foreach (self::DEMO_PROJECTS as $name => $budget) {
            DB::table('projects')
                ->where('name', $name)
                ->where('budget', $budget)
                ->where('budget_type', 'amount')
                ->where('hourly_rate', self::DEMO_HOURLY_RATE)
                ->update([
                    'budget_type' => 'hours',
                    'hourly_rate' => null,
                    'updated_at' => now(),
                ]);
        }
    }

    private function columnsExist(): bool
    {
        return Schema::hasTable('projects')
            && Schema::hasColumn('projects', 'budget_type')
            && Schema::hasColumn('projects', 'hourly_rate');
    }
};
