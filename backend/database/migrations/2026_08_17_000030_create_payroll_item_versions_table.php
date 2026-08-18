<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Retain the figure a correction replaced.
 *
 * Today a correction overwrites the payroll item in place and the earlier
 * figure is gone. That is the gap the whole position rests on: "every figure
 * traceable back to the work that earned it, and every hand that touched it" is
 * only true if a superseded figure still exists to be traced.
 *
 * Keka's answer is an irreversible Rollback that clears payslips and bank
 * statements and regenerates them — their own docs say it "cannot be undone",
 * and that a rollback intended to fix one LOP day pulls in every change made
 * since finalization, so it can silently restate the whole month. We diverge:
 * a correction writes a NEW version and the old one is retained, marked
 * superseded, with a reason and an actor.
 *
 * `template_snapshot` on payroll_items is the existing precedent for freezing
 * state onto a row; this does the same for the money, and for the identity of
 * whoever moved it.
 *
 * Guarded throughout — the schema has drifted from the migrations before.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('payroll_items')) {
            return;
        }

        if (! Schema::hasTable('payroll_item_versions')) {
            Schema::create('payroll_item_versions', function (Blueprint $table) {
                $table->id();

                $table->unsignedBigInteger('payroll_item_id');
                // Denormalised so a version survives its item being deleted and
                // remains attributable to a tenant. An audit trail that
                // disappears with the thing it audits is not one.
                $table->unsignedBigInteger('organization_id')->nullable();
                $table->unsignedBigInteger('user_id')->nullable();
                $table->string('month_year', 7)->nullable();

                // 1 for the figure first paid, rising with each correction.
                $table->unsignedInteger('version_no')->default(1);

                // The money columns as they stood BEFORE the correction that
                // superseded them. Stored as JSON rather than as a mirrored set
                // of columns so a new money column is captured automatically —
                // the alternative needs a migration every time PayrollItem
                // gains one, which is how audit tables fall behind.
                $table->json('money_snapshot');

                // Why, and by whom. Both required in practice: a superseded
                // figure with no reason answers "what changed" and not "why",
                // and only the second is any use in a dispute.
                $table->text('reason')->nullable();
                $table->unsignedBigInteger('superseded_by')->nullable();
                $table->timestamp('superseded_at')->nullable();

                $table->timestamps();

                $table->index(['payroll_item_id', 'version_no'], 'payroll_item_versions_item_version');
                $table->index(['organization_id', 'month_year'], 'payroll_item_versions_tenant_period');
            });
        }

        Schema::table('payroll_items', function (Blueprint $table) {
            if (! Schema::hasColumn('payroll_items', 'current_version_no')) {
                // Which version the row's current figures represent. A payslip
                // binds to this, so re-rendering an already-issued payslip can
                // be told from re-rendering a corrected one.
                $table->unsignedInteger('current_version_no')->default(1);
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_item_versions');

        if (Schema::hasTable('payroll_items') && Schema::hasColumn('payroll_items', 'current_version_no')) {
            Schema::table('payroll_items', function (Blueprint $table) {
                $table->dropColumn('current_version_no');
            });
        }
    }
};
