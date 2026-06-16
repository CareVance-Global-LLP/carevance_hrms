<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add a `captured_at` timestamp to the screenshots table.
 *
 * The (local_id, device_id) idempotency columns were already added by
 * the `2026_06_10_000001_add_idempotency_keys` migration, so this
 * migration only contributes the missing `captured_at` column that the
 * desktop offline queue uses to preserve the original capture time of
 * a screenshot when it is later synced to the server.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('screenshots', 'captured_at')) {
            Schema::table('screenshots', function (Blueprint $table) {
                $table->timestamp('captured_at')->nullable()->after('device_id');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('screenshots', 'captured_at')) {
            Schema::table('screenshots', function (Blueprint $table) {
                $table->dropColumn('captured_at');
            });
        }
    }
};
