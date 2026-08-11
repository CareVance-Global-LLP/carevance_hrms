<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Lets a person say what an idle stretch actually was.
 *
 * Until now idle was decided for them: the timer stopped and the tail was
 * rewound off the entry, with no way to say "I was reading" or "I was on a
 * call". Every comparable product asks instead, and neither Hubstaff nor Time
 * Doctor deducts idle from worked hours without the person's answer.
 *
 * `idle_resolution` records the answer — 'kept' or 'discarded' — and stays null
 * for an idle span nobody was ever asked about, which is how the client knows
 * there is still a question outstanding.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('activities', function (Blueprint $table) {
            if (! Schema::hasColumn('activities', 'idle_resolution')) {
                $table->string('idle_resolution', 16)->nullable()->after('classifier_version');
            }
            if (! Schema::hasColumn('activities', 'idle_resolved_at')) {
                $table->timestamp('idle_resolved_at')->nullable()->after('idle_resolution');
            }
        });

        Schema::table('activities', function (Blueprint $table) {
            // Answering the prompt is a per-person, per-type lookup ("do I owe
            // this user an answer on any idle row?"), so the index leads with
            // the columns that narrow it hardest.
            if (! Schema::hasIndex('activities', ['user_id', 'type', 'idle_resolution'])) {
                $table->index(['user_id', 'type', 'idle_resolution'], 'activities_idle_resolution_idx');
            }
        });
    }

    public function down(): void
    {
        Schema::table('activities', function (Blueprint $table) {
            $table->dropIndex('activities_idle_resolution_idx');
            $table->dropColumn(['idle_resolution', 'idle_resolved_at']);
        });
    }
};
