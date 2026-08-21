<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-customer SAML single sign-on.
 *
 * Google OAuth is the only federated option today, which covers Google
 * Workspace shops and nobody else. A buyer on Okta or Microsoft Entra cannot use
 * it at all, so for them the honest answer is "no SSO" — and that fails the
 * security review on any deal above roughly 500 seats.
 *
 * Bound to a LEGAL ENTITY rather than an organization. A group running several
 * companies frequently runs several identity providers — an acquisition keeps
 * its own Entra tenant for years — and retrofitting that later means every
 * connection needs migrating while people are signing in through it. Null means
 * "the whole organization", which is what a single-entity customer gets.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('saml_connections')) {
            return;
        }

        Schema::create('saml_connections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('legal_entity_id')->nullable()->constrained('legal_entities')->nullOnDelete();

            $table->string('name')->nullable();

            /*
             * What the identity provider tells us about itself. All three come
             * from the IdP's metadata and are copied in by an admin.
             */
            $table->string('idp_entity_id');
            $table->text('idp_sso_url');
            $table->text('idp_slo_url')->nullable();

            /*
             * The signing certificate, and the entire security boundary.
             *
             * An assertion is trusted because it is signed by the key matching
             * this certificate. Without it, anybody who can POST to the ACS
             * endpoint can claim to be anybody - so a connection with no
             * certificate must never be usable, which is why this is NOT
             * nullable.
             */
            $table->text('idp_x509_cert');

            /*
             * Which assertion attribute carries the email. IdPs disagree:
             * Entra sends a schemas.xmlsoap.org URI, Okta usually sends
             * "email", others send NameID only. Configurable because guessing
             * wrong means every login fails with "no email in assertion".
             */
            $table->string('email_attribute')->nullable();
            $table->string('name_attribute')->nullable();

            /*
             * Whether somebody who authenticates successfully but has no
             * account here gets one.
             *
             * Default FALSE. Just-in-time provisioning on an HRMS means an
             * assertion can create a person - and this system holds payroll.
             * Turning it on is a decision an admin makes knowingly.
             */
            $table->boolean('provision_users')->default(false);
            $table->string('default_role', 32)->default('employee');

            $table->boolean('is_active')->default(false);
            $table->timestamp('last_login_at')->nullable();
            $table->timestamps();

            // One connection per entity, and one org-wide connection when the
            // entity is null. Two active connections for the same scope would
            // make "which IdP do I redirect to" ambiguous.
            $table->unique(['organization_id', 'legal_entity_id'], 'saml_connections_scope_unique');
            $table->index('idp_entity_id');
        });

        /*
         * Assertion IDs already consumed.
         *
         * A SAML assertion is a bearer credential: anybody holding a valid one
         * can present it. Replay protection is therefore not optional - without
         * it, an assertion captured from a browser or a proxy log can be
         * replayed until it expires. The library validates timestamps; only we
         * can know whether we have seen this exact assertion before.
         */
        Schema::create('saml_used_assertions', function (Blueprint $table) {
            $table->id();
            $table->string('assertion_id', 191);
            $table->timestamp('expires_at');
            $table->timestamps();

            $table->unique('assertion_id');
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('saml_used_assertions');
        Schema::dropIfExists('saml_connections');
    }
};
