<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Give `projects.budget` a unit.
 *
 * The column has never had one. The frontend read it as hours — the form said
 * "Budget (hours)", the ledger printed `${budget}h`, and the burn bar divided
 * tracked seconds by `budget * 3600`. The data held rupees: the demo seeder
 * writes 150000, 500000, 80000. Neither side was wrong, because nothing had
 * ever said which it was, so the ledger showed budgets like "500000h" — fifty-
 * seven years of work — against a burn bar stuck near zero.
 *
 * Every comparable product types the budget explicitly rather than inferring
 * it: Hubstaff offers Total Hours or Total Cost, Zoho Projects budgets on
 * Project Hours or Project Amount, Harvest splits hourly from fee-based, and
 * Keka PSA picks a billing model per project. All of them attach a rate to the
 * money case, because spend cannot be derived from tracked time without one.
 *
 * `budget_type` is a string rather than an enum on purpose. `tasks.status` was
 * an enum and needed a whole migration (2026_08_08_000001) to drop and re-add
 * a Postgres check constraint just to admit one new value; the vocabulary is
 * enforced in validation instead, where widening it costs nothing.
 *
 * `hourly_rate` stays nullable even for money budgets. Clockify behaves the
 * same way — the budget is real and displayed, there is simply no percentage
 * until somebody supplies a rate. Requiring it would turn every edit of an
 * existing rate-less project into a 422.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->string('budget_type', 16)->default('hours')->after('budget');
            $table->decimal('hourly_rate', 10, 2)->nullable()->after('budget_type');
        });
    }

    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->dropColumn(['budget_type', 'hourly_rate']);
        });
    }
};
