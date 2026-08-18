<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Freeze the Code on Wages statutory wage base onto every payroll item.
 *
 * The Code on Wages has been in force since 21 November 2025. Its s.2(y)
 * proviso means PF, gratuity, bonus and leave encashment are computed on a base
 * that can differ from the employee's contractual basic — where excluded
 * allowances exceed half of remuneration, the excess is deemed into wages.
 *
 * Deriving that base at render time would be wrong in the one situation that
 * matters. Central and state implementing rules are still landing, so
 * organisations adopt on different dates; recomputing a pre-adoption month with
 * today's rule produces a figure that month never paid, and no report could
 * then answer the question an EPFO audit actually asks — what base did you use,
 * and why. So it is stored per month, alongside the rule that produced it.
 *
 * The employee's salary structure is deliberately untouched. It stays as agreed
 * with them; this is a parallel statutory figure computed from it. Rewriting
 * templates at adoption would destroy the original structure, make every
 * pre-adoption month unreproducible, and leave the offer letter disagreeing
 * with the record.
 *
 * Guarded throughout — the schema has drifted from the migrations before.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('payroll_items')) {
            Schema::table('payroll_items', function (Blueprint $table) {
                if (! Schema::hasColumn('payroll_items', 'statutory_wage_base')) {
                    // What PF, gratuity, bonus and leave encashment were
                    // actually computed on, that month.
                    $table->decimal('statutory_wage_base', 14, 2)->nullable();
                }

                if (! Schema::hasColumn('payroll_items', 'wage_base_rule')) {
                    // 'pre_code' | 'code_on_wages_50pct' — which definition
                    // produced the base above.
                    $table->string('wage_base_rule', 32)->nullable();
                }
            });

            // Every existing row predates adoption by construction: nothing has
            // ever written a Code-on-Wages base. Labelling them explicitly is
            // what makes a later report able to say which rule applied, rather
            // than reading NULL and guessing.
            DB::table('payroll_items')
                ->whereNull('wage_base_rule')
                ->update(['wage_base_rule' => 'pre_code']);
        }

        if (Schema::hasTable('organizations')) {
            Schema::table('organizations', function (Blueprint $table) {
                if (! Schema::hasColumn('organizations', 'code_on_wages_effective_from')) {
                    // Nullable and unset by default: an organisation is on the
                    // old rule until it says otherwise. Defaulting this to the
                    // commencement date would silently restate every structure
                    // in every tenant on the next run.
                    $table->date('code_on_wages_effective_from')->nullable();
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('payroll_items')) {
            Schema::table('payroll_items', function (Blueprint $table) {
                foreach (['statutory_wage_base', 'wage_base_rule'] as $column) {
                    if (Schema::hasColumn('payroll_items', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }

        if (Schema::hasTable('organizations') && Schema::hasColumn('organizations', 'code_on_wages_effective_from')) {
            Schema::table('organizations', function (Blueprint $table) {
                $table->dropColumn('code_on_wages_effective_from');
            });
        }
    }
};
