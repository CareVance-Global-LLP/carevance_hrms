<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Where an override came from, and which upload produced it.
 *
 * A CSV import writes hundreds of rows in one act. Two questions follow it
 * immediately and neither is answerable without these columns:
 *
 *   "undo that import"        — needs the rows grouped, hence import_batch_id
 *   "which line did this?"    — needs the spreadsheet row, hence source_row
 *
 * `source` separates a row an officer typed into the grid from one a file
 * produced, which is the first thing anyone asks when a figure looks wrong.
 * It defaults to 'ui' so every override already on the table reads correctly:
 * they were all raised through the register by hand.
 *
 * Guarded, in the same style as its siblings — the schema has drifted before.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('payroll_overrides')) {
            return;
        }

        Schema::table('payroll_overrides', function (Blueprint $table) {
            if (! Schema::hasColumn('payroll_overrides', 'import_batch_id')) {
                // Nullable: a hand-raised override belongs to no batch.
                $table->uuid('import_batch_id')->nullable()->index();
            }

            if (! Schema::hasColumn('payroll_overrides', 'source_row')) {
                // The row number the officer sees in Excel's gutter, not the
                // zero-indexed data row. Off-by-one here is a support ticket.
                $table->unsignedInteger('source_row')->nullable();
            }

            if (! Schema::hasColumn('payroll_overrides', 'source')) {
                // 'ui' | 'import' | 'api'
                $table->string('source', 16)->default('ui');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('payroll_overrides')) {
            return;
        }

        Schema::table('payroll_overrides', function (Blueprint $table) {
            foreach (['import_batch_id', 'source_row', 'source'] as $column) {
                if (Schema::hasColumn('payroll_overrides', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
