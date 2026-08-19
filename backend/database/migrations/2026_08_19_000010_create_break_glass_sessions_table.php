<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Governed vendor access to a customer tenant.
 *
 * Replaces an endpoint that minted an unlimited, unlogged, non-expiring
 * impersonation token for any user in any organisation, with no customer
 * consent and no notification. A vendor employee could read the customer's
 * CEO's payslip and nothing in the system recorded it — which is precisely
 * what a Data Processing Agreement forbids.
 *
 * Every column here exists to answer one question an auditor will ask: who
 * asked, why, who allowed it, when did it stop, and what did they do.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('break_glass_sessions', function (Blueprint $table) {
            $table->id();

            // The customer tenant being entered. Scoped like everything else so
            // a customer admin listing sessions sees only their own.
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();

            // Whose account the vendor would act as.
            $table->foreignId('target_user_id')->constrained('users')->cascadeOnDelete();

            // The vendor engineer asking. Nullable on delete so removing a
            // staff account never erases the record that they had access.
            $table->foreignId('requested_by_user_id')->nullable()->constrained('users')->nullOnDelete();

            // Not nullable, and enforced again at the request layer. An access
            // record without a stated purpose is not an access record.
            $table->text('reason');

            $table->string('status', 20)->default('pending');

            $table->timestamp('requested_at');
            $table->foreignId('approved_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();

            // Hard ceiling, set at approval. The token issued against this
            // session may never outlive it.
            $table->timestamp('expires_at')->nullable();

            $table->timestamp('token_issued_at')->nullable();

            $table->foreignId('revoked_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('revoked_at')->nullable();
            $table->text('revoked_reason')->nullable();

            $table->string('ip_address', 64)->nullable();
            $table->text('user_agent')->nullable();

            $table->timestamps();

            $table->index(['organization_id', 'status']);
            $table->index(['requested_by_user_id', 'created_at']);
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('break_glass_sessions');
    }
};
