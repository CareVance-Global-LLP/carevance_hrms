<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reimbursements', function (Blueprint $table) {
            // Two-level approval chain:
            //   pending_manager → employee submitted, awaiting their reporting manager
            //   pending_admin   → manager approved, awaiting admin final approval
            //   approved        → fully approved, will be included in next payroll run
            //   rejected        → declined at either level
            $table->string('approval_level', 32)->default('pending_manager')->after('status');

            // Manager-level approval tracking
            $table->foreignId('manager_approved_by')->nullable()->constrained('users')->nullOnDelete()->after('approved_by');
            $table->timestamp('manager_approved_at')->nullable()->after('manager_approved_by');

            // Rejection reason (used at both levels)
            $table->text('rejection_reason')->nullable()->after('manager_approved_at');

            // Category for expense classification
            $table->string('category', 64)->nullable()->after('title');

            // Receipt and metadata fields (model already references these)
            $table->string('receipt_url', 500)->nullable()->after('meta');
            $table->string('merchant_name', 255)->nullable()->after('receipt_url');
            $table->string('location', 255)->nullable()->after('merchant_name');

            // Update the composite index to include approval_level
            $table->index(['organization_id', 'approval_level'], 'reimbursements_org_approval_idx');
        });
    }

    public function down(): void
    {
        Schema::table('reimbursements', function (Blueprint $table) {
            $table->dropIndex('reimbursements_org_approval_idx');
            $table->dropColumn([
                'approval_level',
                'manager_approved_by',
                'manager_approved_at',
                'rejection_reason',
                'category',
                'receipt_url',
                'merchant_name',
                'location',
            ]);
        });
    }
};
