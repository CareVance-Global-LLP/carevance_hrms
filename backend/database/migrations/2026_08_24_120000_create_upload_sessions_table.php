<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A large file arriving in pieces.
 *
 * The direct upload path could never carry what the interface promised. The UI
 * offered 200 MB and the validator agreed, but PHP discards a body over
 * upload_max_filesize BEFORE Laravel runs — 2 MB on a stock dev box, 10 MB in
 * production — so the request arrived with no file at all and the user was
 * told "no attachment" for a file they had plainly attached.
 *
 * Chunking removes the ceiling rather than raising it: no single request is
 * ever large, so the PHP limit stops being the thing that decides the maximum
 * attachment size. It also makes a dropped connection survivable, which
 * matters far more at 200 MB than at 2 MB.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('upload_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            // Opaque handle the client quotes on every chunk. Random rather
            // than sequential so one cannot be guessed from another, though
            // every query is scoped to the owning user as well — the key is a
            // handle, not an authorization.
            $table->string('upload_key', 64)->unique();

            $table->string('original_name');
            // What the CLIENT claimed. Never trusted: the mime that gets stored
            // on the message is detected from the assembled bytes.
            $table->string('client_mime')->nullable();

            $table->unsignedBigInteger('total_size');
            $table->unsignedInteger('chunk_size');
            $table->unsignedInteger('total_chunks');

            // Which indexes have landed. A resuming client asks for this and
            // sends only what is missing, which is the whole point of paying
            // for a session table rather than streaming into one temp file.
            $table->json('received_chunks')->nullable();

            $table->string('status', 20)->default('pending');
            $table->string('assembled_path')->nullable();

            // Abandoned uploads are the normal case, not the exception —
            // people close tabs. Without an expiry the chunk directory grows
            // forever, and these are the largest files the system handles.
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();

            $table->index(['organization_id', 'user_id', 'status'], 'upload_sessions_owner_status_idx');
            $table->index('expires_at', 'upload_sessions_expires_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('upload_sessions');
    }
};
