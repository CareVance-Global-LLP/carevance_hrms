<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Records which calculation engine produced a payroll item.
 *
 * Several engines have historically been live at once and disagreed on net
 * pay. Existing rows are stamped 'v1'; rows written after the statutory
 * correctness fixes are stamped 'v2'. Nothing is recomputed — the policy is
 * fix-forward — so this column is what makes the boundary auditable and lets
 * reports segment old numbers from corrected ones.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('payroll_items')) {
            return;
        }

        if (!Schema::hasColumn('payroll_items', 'engine_version')) {
            Schema::table('payroll_items', function (Blueprint $table) {
                $table->string('engine_version', 16)->nullable()->index();
            });
        }

        DB::table('payroll_items')->whereNull('engine_version')->update(['engine_version' => 'v1']);
    }

    public function down(): void
    {
        if (!Schema::hasColumn('payroll_items', 'engine_version')) {
            return;
        }

        Schema::table('payroll_items', function (Blueprint $table) {
            $table->dropColumn('engine_version');
        });
    }
};
