<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Ensure org-scoped user lookups are indexed.
     *
     * Every report/monitoring endpoint scopes users via
     * `where('organization_id', ...)` (see ReportController::visibleUsersQuery).
     * PostgreSQL automatically backs a foreign key with an index, but MySQL and
     * SQLite do not, so we add an explicit (idempotent) index for portability.
     */
    public function up(): void
    {
        if (! $this->indexExists('users', 'idx_users_organization')) {
            Schema::table('users', function (Blueprint $table) {
                $table->index('organization_id', 'idx_users_organization');
            });
        }
    }

    public function down(): void
    {
        if ($this->indexExists('users', 'idx_users_organization')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropIndex('idx_users_organization');
            });
        }
    }

    private function indexExists(string $table, string $index): bool
    {
        $driver = DB::connection()->getDriverName();

        if ($driver === 'pgsql') {
            $result = DB::select(
                'SELECT indexname FROM pg_indexes WHERE tablename = ? AND indexname = ?',
                [$table, $index]
            );

            return count($result) > 0;
        }

        if ($driver === 'mysql') {
            $result = DB::select(
                'SELECT INDEX_NAME AS indexname FROM information_schema.STATISTICS WHERE TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
                [$table, $index]
            );

            return count($result) > 0;
        }

        $result = DB::select(
            'SELECT name AS indexname FROM sqlite_master WHERE type = ? AND tbl_name = ? AND name = ?',
            ['index', $table, $index]
        );

        return count($result) > 0;
    }
};
