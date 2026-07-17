<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_filings', function (Blueprint $table) {
            $table->dropForeign(['submitted_by']);
            $table->dropForeign(['approved_by']);
            $table->dropColumn([
                'submitted_at',
                'submitted_by',
                'approved_at',
                'approved_by',
                'review_note',
                'reviewer_user_id',
                'portal_status',
            ]);
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