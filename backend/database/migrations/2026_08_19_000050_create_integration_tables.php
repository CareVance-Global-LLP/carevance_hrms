<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Customer-facing integration surface.
 *
 * There was none. No public API, no API keys, no outbound webhooks — the only
 * webhook in the codebase was inbound from Razorpay for the vendor's own
 * billing. Every customer integration was therefore a manual CSV, which erases
 * the labour saving that justifies buying the product.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('api_clients', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name');

            // A short, non-secret prefix shown in the UI so a customer can tell
            // two keys apart without us storing either of them.
            $table->string('key_prefix', 16)->unique();

            // sha256 of the full key. The key itself is shown once, at
            // creation, and is unrecoverable afterwards.
            $table->string('key_hash', 64)->unique();

            // What this key may do. Narrow by default — a key that can do
            // everything is a password with a longer name.
            $table->json('scopes');

            $table->timestamp('expires_at')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['organization_id', 'revoked_at']);
        });

        Schema::create('webhook_endpoints', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('url', 2048);

            // Shared secret for the HMAC signature. Encrypted at rest: it is a
            // credential, and anyone holding it can forge our webhooks.
            $table->text('secret');

            $table->json('events');
            $table->boolean('is_active')->default(true);

            // Consecutive failures. A dead endpoint is disabled rather than
            // retried forever, because retrying forever is how one customer's
            // broken URL becomes everyone's queue backlog.
            $table->unsignedSmallInteger('consecutive_failures')->default(0);
            $table->timestamp('disabled_at')->nullable();
            $table->text('disabled_reason')->nullable();

            $table->timestamps();

            $table->index(['organization_id', 'is_active']);
        });

        Schema::create('webhook_deliveries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('webhook_endpoint_id')->constrained()->cascadeOnDelete();

            $table->string('event', 120);
            $table->json('payload');

            $table->string('status', 20)->default('pending');
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->unsignedSmallInteger('response_status')->nullable();
            $table->text('error')->nullable();

            $table->timestamp('delivered_at')->nullable();

            // When the next retry is due. Null once the delivery is settled
            // one way or the other.
            $table->timestamp('next_attempt_at')->nullable();

            $table->timestamps();

            $table->index(['organization_id', 'status']);
            $table->index(['status', 'next_attempt_at']);
            $table->index(['webhook_endpoint_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('webhook_deliveries');
        Schema::dropIfExists('webhook_endpoints');
        Schema::dropIfExists('api_clients');
    }
};
