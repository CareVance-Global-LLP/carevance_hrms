<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Drop the legacy `invites` table.
 *
 * It backed a second invite implementation that ran in parallel with
 * `invitations` and shared none of its guarantees: the token was stored in
 * plaintext, there was no organization_id column, and the accept path resolved
 * the invited address with an unscoped `User::query()` — so an invite for an
 * address that already had an account overwrote that account's password, in any
 * organization. See the note in routes/api/public.php.
 *
 * The routes, controller, model and mailable are gone; this removes the storage.
 * Any invite still in flight is dead either way, so nothing is migrated across.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('invites');
    }

    /**
     * Recreated to match 2026_03_17_130000_create_invites_table so a rollback
     * leaves the schema where it found it. Nothing reads or writes this table
     * any more — rolling back restores the table, not the feature.
     */
    public function down(): void
    {
        if (Schema::hasTable('invites')) {
            return;
        }

        Schema::create('invites', function (Blueprint $table) {
            $table->id();
            $table->string('email');
            $table->string('role')->nullable();
            $table->string('token')->unique();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('accepted_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index('email');
        });
    }
};
