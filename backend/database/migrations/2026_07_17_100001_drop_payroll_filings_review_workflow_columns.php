<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('payroll_filings')) {
            return;
        }

        // Drop only what is actually present. This migration previously
        // dropped all seven columns and both foreign keys unconditionally,
        // which threw "no such column: submitted_at" on any database where the
        // review workflow had never been created — including the SQLite
        // in-memory database used by the test suite, where it aborted the
        // migration run and took every Feature test down with it.
        foreach (['submitted_by', 'approved_by'] as $foreignKey) {
            if (!Schema::hasColumn('payroll_filings', $foreignKey)) {
                continue;
            }

            try {
                Schema::table('payroll_filings', function (Blueprint $table) use ($foreignKey) {
                    $table->dropForeign([$foreignKey]);
                });
            } catch (\Throwable) {
                // No matching foreign key on this connection (SQLite reports
                // none); the column drop below is still valid.
            }
        }

        $columns = array_values(array_filter([
            'submitted_at',
            'submitted_by',
            'approved_at',
            'approved_by',
            'review_note',
            'reviewer_user_id',
            'portal_status',
        ], fn (string $column) => Schema::hasColumn('payroll_filings', $column)));

        if ($columns === []) {
            return;
        }

        Schema::table('payroll_filings', function (Blueprint $table) use ($columns) {
            $table->dropColumn($columns);
        });
    }

    public function down(): void
    {
        Schema::table('payroll_filings', function (Blueprint $table) {
            $table->timestamp('submitted_at')->nullable()->after('generated_at');
            $table->foreignId('submitted_by')->nullable()->after('submitted_at')->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable()->after('submitted_by');
            $table->foreignId('approved_by')->nullable()->after('approved_at')->constrained('users')->nullOnDelete();
            $table->text('review_note')->nullable()->after('approved_by');
            $table->integer('reviewer_user_id')->nullable()->after('review_note');
            $table->string('portal_status')->default('pending_upload')
                ->comment('pending_upload, uploaded, paid, error')
                ->after('status');
        });
    }
};