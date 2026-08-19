<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Time-based one-time passwords, and the recovery codes that stop TOTP from
 * being a way to permanently lock a customer out of their own payroll.
 *
 * Neither table carries organization_id, and that is deliberate: MFA is a
 * property of the account, not of the tenant. A user belongs to exactly one
 * organisation, so the tenant is already reachable through user_id, and adding
 * the column would only create a second place for the two to disagree.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_mfa_secrets', function (Blueprint $table) {
            $table->id();

            // One secret per account. A second row would mean two working
            // authenticators with no way to tell which the user still has.
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();

            // Encrypted at rest via the model cast. A TOTP secret is a
            // credential: anyone holding it can generate valid codes forever.
            $table->text('secret');

            // Null until the user has proved they can generate a valid code.
            // An unconfirmed secret must never gate a login, or a failed
            // enrolment locks the account.
            $table->timestamp('confirmed_at')->nullable();

            $table->timestamp('last_used_at')->nullable();

            // The last accepted TOTP window, to refuse a replay of the same
            // code inside its own validity period.
            $table->unsignedBigInteger('last_used_timestamp')->nullable();

            $table->timestamps();
        });

        Schema::create('user_recovery_codes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            // Hashed, never stored in the clear. They are shown once, at
            // enrolment, and cannot be recovered afterwards.
            $table->string('code_hash');

            // Single use. Kept rather than deleted so the audit trail can show
            // that a recovery code was spent and when.
            $table->timestamp('used_at')->nullable();

            $table->timestamps();

            $table->index(['user_id', 'used_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_recovery_codes');
        Schema::dropIfExists('user_mfa_secrets');
    }
};
