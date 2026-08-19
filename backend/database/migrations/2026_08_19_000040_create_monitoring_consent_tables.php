<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Notice and consent for workforce monitoring.
 *
 * The platform captures screenshots, application and URL activity, geofenced
 * punches and attendance selfies. None of it had a consent record, an
 * employee-facing disclosure, a stated purpose, or a way to withdraw. A
 * comment in TrackerPolicyResolver observed that a resolved policy "is the one
 * a DPDP notice can actually point at" — the notice did not exist.
 *
 * Under the DPDP Act the exposure lands on the employer deploying this, not
 * on the vendor shipping it, which makes it the customer's problem and
 * therefore the product's.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('monitoring_notices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();

            // Monotonic per organisation. Consent is recorded against a
            // version, so rewriting the notice does not silently re-use
            // agreement given to different words.
            $table->unsignedInteger('version');

            $table->text('body');

            // capture_type => stated purpose. The purpose is the part that
            // makes a notice a notice rather than a disclaimer.
            $table->json('purposes');

            $table->unsignedSmallInteger('retention_days');

            $table->timestamp('published_at')->nullable();
            $table->foreignId('published_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['organization_id', 'version']);
            $table->index(['organization_id', 'published_at']);
        });

        Schema::create('monitoring_consents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            // Which notice they actually read.
            $table->unsignedInteger('notice_version');

            // The capture types agreed to. Consent is per purpose, not one
            // blanket yes — an employee may accept activity tracking and
            // refuse screenshots.
            $table->json('capture_types');

            $table->timestamp('granted_at');

            // Withdrawal is a right, not a favour. Kept as a timestamp rather
            // than a delete so the history of what was permitted, and when,
            // survives — which is what makes past captures defensible.
            $table->timestamp('withdrawn_at')->nullable();

            $table->string('ip_address', 64)->nullable();
            $table->text('user_agent')->nullable();
            $table->timestamps();

            $table->index(['organization_id', 'user_id', 'withdrawn_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('monitoring_consents');
        Schema::dropIfExists('monitoring_notices');
    }
};
