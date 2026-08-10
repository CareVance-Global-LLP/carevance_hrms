<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Bring bank_transfer_batches back in line with the migrations.
 *
 * The live database carries `batch_reference`, `total_transactions`,
 * `success_count`, `failure_count`, `file_format`, `api_response`,
 * `error_message` and `completed_at`. None of those appear in either migration
 * that creates the table — both write `batch_name` and `total_employees`
 * instead. The schema was changed directly against the database at some point
 * and the migrations never caught up, which means a deploy building from
 * scratch produces a different table from the one the code expects.
 *
 * Every step is guarded, so this is a no-op on the database that is already
 * correct and a repair on one that is not.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('bank_transfer_batches')) {
            return;
        }

        // Renames first, so the data in an older database is carried over
        // rather than dropped and re-added empty.
        if (Schema::hasColumn('bank_transfer_batches', 'batch_name')
            && ! Schema::hasColumn('bank_transfer_batches', 'batch_reference')) {
            Schema::table('bank_transfer_batches', function (Blueprint $table) {
                $table->renameColumn('batch_name', 'batch_reference');
            });
        }

        if (Schema::hasColumn('bank_transfer_batches', 'total_employees')
            && ! Schema::hasColumn('bank_transfer_batches', 'total_transactions')) {
            Schema::table('bank_transfer_batches', function (Blueprint $table) {
                $table->renameColumn('total_employees', 'total_transactions');
            });
        }

        Schema::table('bank_transfer_batches', function (Blueprint $table) {
            if (! Schema::hasColumn('bank_transfer_batches', 'batch_reference')) {
                $table->string('batch_reference')->nullable()->after('payroll_run_id');
            }
            if (! Schema::hasColumn('bank_transfer_batches', 'total_transactions')) {
                $table->integer('total_transactions')->default(0)->after('total_amount');
            }
            if (! Schema::hasColumn('bank_transfer_batches', 'success_count')) {
                $table->integer('success_count')->default(0)->after('total_transactions');
            }
            if (! Schema::hasColumn('bank_transfer_batches', 'failure_count')) {
                $table->integer('failure_count')->default(0)->after('success_count');
            }
            if (! Schema::hasColumn('bank_transfer_batches', 'file_format')) {
                $table->string('file_format')->nullable()->after('status');
            }
            if (! Schema::hasColumn('bank_transfer_batches', 'api_response')) {
                $table->json('api_response')->nullable();
            }
            if (! Schema::hasColumn('bank_transfer_batches', 'error_message')) {
                $table->string('error_message')->nullable();
            }
            if (! Schema::hasColumn('bank_transfer_batches', 'completed_at')) {
                $table->timestamp('completed_at')->nullable();
            }
        });
    }

    public function down(): void
    {
        // Deliberately not reversed. Rolling back to a shape the application
        // no longer writes would break disbursement rather than restore it.
    }
};
