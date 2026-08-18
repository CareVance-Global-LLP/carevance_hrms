<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Make "the residual" a role rather than a hardcoded component.
 *
 * The salary structure is entirely residual: special allowance is whatever
 * remains after basic, HRA and conveyance come out of CTC. So an override on
 * any component has to be absorbed by something, and today that something is
 * named in code.
 *
 * Keka's own PF article proves the right shape without saying so directly:
 * "If there is no Special Allowance component, the PF proration adjustment will
 * be applied to the next available taxable component." That sentence only makes
 * sense if the residual is a ROLE with an ordered fallback chain behind it. The
 * word taxable is load-bearing — it stops the balancer silently eroding HRA,
 * conveyance or LTA and changing the employee's tax position while trying to
 * satisfy an arithmetic identity.
 *
 * `is_taxable` already exists on this table and has never been read. It is the
 * second link in that chain, so it starts being read now.
 *
 * Exactly one residual per structure, which is Zoho's rule stated structurally:
 * "You cannot add multiple earnings for Leave Encashment, Notice Pay, Gratuity,
 * and Fixed Allowance." Two residuals is an unsolvable balancing problem — the
 * engine cannot know which one absorbs the delta.
 *
 * Guarded throughout — the schema has drifted from the migrations before.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('salary_components')) {
            return;
        }

        Schema::table('salary_components', function (Blueprint $table) {
            if (! Schema::hasColumn('salary_components', 'is_residual')) {
                // The designated sink. At most one per organisation should
                // carry this; the balancer treats a second as a configuration
                // error rather than picking arbitrarily.
                $table->boolean('is_residual')->default(false);
            }

            if (! Schema::hasColumn('salary_components', 'allow_employee_override')) {
                // Keka's per-component permission gate: "Allow this component
                // to be customized and overridden at the employee level."
                // Unchecked components never appear in the override grid, which
                // is a far better control than validating the attempt later.
                $table->boolean('allow_employee_override')->default(false);
            }

            if (! Schema::hasColumn('salary_components', 'residual_order')) {
                // Position in the fallback chain when the designated residual
                // is absent or is itself the component being overridden.
                $table->unsignedInteger('residual_order')->default(0);
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('salary_components')) {
            return;
        }

        Schema::table('salary_components', function (Blueprint $table) {
            foreach (['is_residual', 'allow_employee_override', 'residual_order'] as $column) {
                if (Schema::hasColumn('salary_components', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
