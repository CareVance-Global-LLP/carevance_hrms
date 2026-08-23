<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The second half of a statutory filing: the acknowledgement that comes back.
 *
 * `payroll_filings` already carried status, acknowledgment_number, filed_at and
 * acknowledged_at, so the lifecycle was designed for. What it had no room for
 * was the DOCUMENT the portal returns — the stamped challan, the EPFO receipt,
 * the ESIC acknowledgement PDF. There is one file column, `file_path`, and it
 * holds the artefact we generated, so attaching the receipt there would
 * overwrite the return itself.
 *
 * Without somewhere to put it, "we filed this" is an assertion nobody can check
 * six months later when an inspector asks. That is the whole reason this table
 * exists.
 *
 * `due_date` is stored rather than always computed so that a filing keeps the
 * deadline it was actually judged against. State PT and LWF dates change; a
 * return filed on time under the old rule must not become retrospectively late
 * because the schedule was edited afterwards.
 *
 * Guarded per column: schema has drifted from migrations in this codebase
 * before (see bank_transfer_batches), and a reconcile migration that assumes
 * its own starting point is how that happens.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('payroll_filings')) {
            return;
        }

        Schema::table('payroll_filings', function (Blueprint $table) {
            $missing = fn (string $column) => ! Schema::hasColumn('payroll_filings', $column);

            if ($missing('receipt_path')) {
                $table->string('receipt_path')->nullable();
            }

            if ($missing('receipt_original_filename')) {
                $table->string('receipt_original_filename')->nullable();
            }

            if ($missing('receipt_uploaded_at')) {
                $table->timestamp('receipt_uploaded_at')->nullable();
            }

            if ($missing('receipt_uploaded_by')) {
                $table->unsignedBigInteger('receipt_uploaded_by')->nullable();
            }

            // Date-only on purpose. A deadline is a calendar date, not an
            // instant — see the `date:Y-m-d` cast on the model.
            if ($missing('due_date')) {
                $table->date('due_date')->nullable();
            }

            /*
             * 'generated' (we produced it) or 'uploaded' (somebody prepared the
             * return outside this system and brought it in). A consultant-
             * prepared 24Q is still the organisation's filing, and refusing to
             * record it just means the compliance history is wrong.
             */
            if ($missing('source')) {
                $table->string('source', 16)->default('generated');
            }
        });

        // Separate statement: the column has to exist before it can be indexed,
        // and Schema::table batches its Blueprint into one ALTER.
        if (Schema::hasColumn('payroll_filings', 'due_date')) {
            Schema::table('payroll_filings', function (Blueprint $table) {
                $indexes = Schema::getIndexes('payroll_filings');
                $named = array_column($indexes, 'name');

                if (! in_array('payroll_filings_due_date_index', $named, true)) {
                    $table->index('due_date');
                }
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('payroll_filings')) {
            return;
        }

        Schema::table('payroll_filings', function (Blueprint $table) {
            foreach ([
                'receipt_path',
                'receipt_original_filename',
                'receipt_uploaded_at',
                'receipt_uploaded_by',
                'due_date',
                'source',
            ] as $column) {
                if (Schema::hasColumn('payroll_filings', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
