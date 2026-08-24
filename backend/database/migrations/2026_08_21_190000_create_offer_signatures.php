<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Signing an offer letter.
 *
 * The signing link is the only credential a candidate has — they are not a user
 * of this system and never will be — so the token is treated like a password:
 * HASHED at rest, never stored in the clear, and compared with `hash_equals`.
 * A leaked database must not hand somebody the ability to accept offers.
 *
 * WHAT MAKES A SIGNATURE WORTH ANYTHING is not the drawing. It is the record
 * around it: which document, at what time, from where, and against a token that
 * could only have reached one person. So `offer_signatures` keeps the IP, the
 * user agent and — crucially — a hash of the PDF as it was at the moment of
 * signing. Without that last one, "I never agreed to that salary" cannot be
 * answered, because the letter could have been regenerated afterwards.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('job_offers', function (Blueprint $table) {
            /*
             * Hashed, like a password. Issued when the offer is sent and
             * cleared once it is signed, so a link cannot be replayed.
             */
            $table->string('signing_token_hash', 64)->nullable()->after('sent_at');
            $table->timestamp('signing_token_expires_at')->nullable()->after('signing_token_hash');

            // Where the generated letter lives, so it is not rebuilt on every
            // view — a regenerated PDF would break the content hash below.
            $table->string('letter_path')->nullable()->after('signing_token_expires_at');
        });

        Schema::create('offer_signatures', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('job_offer_id')->constrained('job_offers')->cascadeOnDelete();

            // What they typed as their name, and the drawn signature if they
            // drew one. Typed-only is a valid electronic signature.
            $table->string('signer_name');
            $table->string('signer_email')->nullable();
            $table->longText('signature_image')->nullable();

            /*
             * The evidence. An electronic signature is worth what its audit
             * trail is worth, and these are the four things anybody disputing
             * one will ask about.
             */
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 512)->nullable();
            $table->string('document_hash', 64)->nullable();
            $table->timestamp('signed_at');

            $table->timestamps();

            // One signature per offer. A second is a revision, which means a
            // new offer, not a second mark on this one.
            $table->unique('job_offer_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('offer_signatures');

        Schema::table('job_offers', function (Blueprint $table) {
            $table->dropColumn(['signing_token_hash', 'signing_token_expires_at', 'letter_path']);
        });
    }
};
