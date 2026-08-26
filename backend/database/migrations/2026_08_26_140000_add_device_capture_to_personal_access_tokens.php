<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What a session was signed in from, so a person can recognise it.
 *
 * `personal_access_tokens` carried nothing but `name`, and every login writes
 * the same name — 'auth-token' — so a list of somebody's live sessions was a
 * column of identical rows. These three columns are the minimum that makes the
 * list answer "is that PC in the corner me, or somebody else".
 *
 * Deliberately three columns and not more:
 *
 * - `created_ip` / `created_user_agent` are the sign-in itself and never
 *   change. They are what the row IS.
 * - `last_ip` moves, and moving is the signal: a session that signed in from
 *   the office and is now answering from somewhere else is the thing worth
 *   seeing. It is written inside the existing once-a-minute activity throttle
 *   in AuthenticateApiToken, never as a second write.
 *
 * No geolocation column. Resolving an IP to a city means posting our users' IP
 * addresses to somebody else's API, which is a data transfer we are not making
 * for a line of UI copy.
 *
 * 45 characters holds a full IPv6 address including an IPv4-mapped form
 * ("::ffff:255.255.255.255", plus room for a zone index). 512 for the user
 * agent: real ones run past 255, and a truncated one parses to the wrong
 * device rather than to nothing.
 *
 * Existing rows get NULL and stay NULL — nothing was ever recorded, so there
 * is nothing to backfill. They must render as "Unknown device", never as a
 * guess.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            if (! Schema::hasColumn('personal_access_tokens', 'created_ip')) {
                $table->string('created_ip', 45)->nullable()->after('abilities');
            }

            if (! Schema::hasColumn('personal_access_tokens', 'created_user_agent')) {
                $table->string('created_user_agent', 512)->nullable()->after('created_ip');
            }

            if (! Schema::hasColumn('personal_access_tokens', 'last_ip')) {
                $table->string('last_ip', 45)->nullable()->after('created_user_agent');
            }
        });
    }

    public function down(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            foreach (['created_ip', 'created_user_agent', 'last_ip'] as $column) {
                if (Schema::hasColumn('personal_access_tokens', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
