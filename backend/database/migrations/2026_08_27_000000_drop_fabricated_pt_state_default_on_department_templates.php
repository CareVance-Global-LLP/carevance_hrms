<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Stop the database itself fabricating a professional-tax state.
 *
 * `2026_06_17_100000_create_department_payroll_templates_table` declared
 *
 *     $table->string('pt_state', 64)->default('maharashtra');
 *
 * NOT NULL with a real state as the default. Every code path that could
 * fabricate a state had been removed, and this one survived them all because
 * it is not in the code at all. The setup wizard's Departments step sends no
 * pt_state (SetupDepartments posts CTC, basic/HRA/conveyance and the enable
 * flags), so the default landed on insert and the template came back holding a
 * Maharashtra nobody had chosen.
 *
 * From there it is money: EmployeePayrollTemplate::getOrCreateForUser seeds
 * every new hire's template from the department template, and
 * PayrollAutoProcessService prices `pt_state` directly — Rs 200 a month,
 * Rs 300 in February, Rs 2,500 a year per head, deducted from people in Delhi,
 * Haryana, Punjab or Uttar Pradesh, which levy no professional tax at all.
 * Worse, it overrode an admin who had explicitly answered "no professional tax
 * in my state" in the wizard.
 *
 * After this the column is nullable with no default. Null and '' both price at
 * Rs 0 through PTStateService, so an unconfigured department under-deducts,
 * which is correctable. Taking a tax that was never owed is not.
 *
 * EXISTING ROWS ARE LEFT EXACTLY AS THEY ARE, on purpose. A row holding
 * 'maharashtra' because an admin chose Maharashtra and a row holding it only
 * because of this default are byte-identical — nothing recorded which is which.
 * Blanking them would guess a genuine Maharashtra establishment into no-PT and
 * stop collecting a tax that IS owed, which is a compliance failure with
 * interest attached. Only the column shape changes, so the fabrication stops
 * for every row written from here on; the handful already written are a
 * question for a human with the tenant's registered address in front of them.
 *
 * Guarded because CLAUDE.md records that schema has drifted from migrations
 * before (bank_transfer_batches): the table, the column and its current shape
 * are all checked before anything is altered, so this is a no-op on a database
 * where the default is already gone.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('department_payroll_templates')) {
            return;
        }

        if (! Schema::hasColumn('department_payroll_templates', 'pt_state')) {
            return;
        }

        $column = collect(Schema::getColumns('department_payroll_templates'))
            ->firstWhere('name', 'pt_state');

        // Already nullable with no default: nothing to reconcile.
        if ($column !== null && ($column['nullable'] ?? false) && ($column['default'] ?? null) === null) {
            return;
        }

        Schema::table('department_payroll_templates', function (Blueprint $table) {
            // change() replaces the column's modifiers with exactly what is
            // named here, so omitting ->default() is what removes the default.
            $table->string('pt_state', 64)->nullable()->change();
        });
    }

    /**
     * Deliberately irreversible.
     *
     * Restoring NOT NULL DEFAULT 'maharashtra' would restore the defect this
     * migration exists to remove, and it could not even run cleanly: rows
     * legitimately written with a null pt_state while the column was nullable
     * would have to be given a state to satisfy NOT NULL, and inventing one is
     * precisely the thing that costs employees Rs 2,500 a year.
     */
    public function down(): void
    {
        // no-op
    }
};
