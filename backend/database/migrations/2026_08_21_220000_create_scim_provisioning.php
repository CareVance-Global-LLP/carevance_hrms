<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * SCIM provisioning.
 *
 * SAML lets somebody sign IN through Entra, Okta or Google. Nothing until now
 * provisioned them, or — the half that actually matters — DEPROVISIONED them.
 * Somebody disabled in the IdP kept their CareVance account until an admin
 * removed it by hand: SAML refused their next login, but an existing API token
 * carried on working. This closes that.
 *
 * THE BEARER TOKEN IS THE WHOLE SECURITY BOUNDARY. An IdP cannot do OAuth
 * against us and cannot hold a session; SCIM is defined as bearer-token auth
 * and that is what identity providers send. So it is generated from a CSPRNG,
 * stored ONLY as a SHA-256 hash, and shown once at creation — a leaked database
 * must not hand somebody the ability to create and delete users across a
 * tenant.
 *
 * `scim_external_id` ON USERS IS THE JOIN. An IdP identifies people by its own
 * immutable id, not by email — people change their surname and their email, and
 * matching on email means a rename silently creates a second account and
 * deprovisions neither.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('scim_tokens', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();

            $table->string('name');
            // Hashed like a password. Never recoverable, including by an admin.
            $table->string('token_hash', 64)->unique();
            // Enough to tell two tokens apart in a list without exposing either.
            $table->string('token_hint', 12)->nullable();

            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('revoked_at')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['organization_id', 'revoked_at']);
        });

        Schema::table('users', function (Blueprint $table) {
            /*
             * The IdP's own immutable id for this person. Nullable because most
             * users are not provisioned by SCIM, and unique per organization
             * rather than globally: the same person can exist in two customers'
             * directories with the same external id from the same IdP vendor.
             */
            $table->string('scim_external_id')->nullable()->after('legal_entity_id');

            /*
             * Whether this account is under the IdP's control.
             *
             * Load-bearing, not decorative: an admin editing a SCIM-managed
             * user by hand will have their change overwritten on the next sync,
             * and the UI needs to be able to say so rather than letting
             * somebody make the same edit three times.
             */
            $table->boolean('is_scim_managed')->default(false)->after('scim_external_id');
            $table->timestamp('scim_synced_at')->nullable()->after('is_scim_managed');

            $table->unique(['organization_id', 'scim_external_id'], 'users_scim_external_unique');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique('users_scim_external_unique');
            $table->dropColumn(['scim_external_id', 'is_scim_managed', 'scim_synced_at']);
        });

        Schema::dropIfExists('scim_tokens');
    }
};
