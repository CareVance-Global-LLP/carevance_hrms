<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Index `organization_id` on the two tenant-scoped tables that lack one.
 *
 * Both `break_times` and `attendance_punches` use BelongsToOrganization, so the
 * global scope adds `where organization_id = ?` to every single query against
 * them — and neither had an index to serve it. Every read was a sequential scan
 * that grows with the whole platform's row count rather than with the tenant's,
 * so one busy customer slows the query down for everybody.
 *
 * These are append-only, high-volume tables (break_times is already the largest
 * of the pair), which is exactly where the scan cost compounds.
 *
 * Guarded and idempotent: each index is created only if the table and column
 * exist and the index does not, so this is a no-op on a database that already
 * has them.
 */
return new class extends Migration
{
    /** @var array<string, string> table => index name */
    private const TARGETS = [
        'break_times' => 'break_times_organization_id_index',
        'attendance_punches' => 'attendance_punches_organization_id_index',
    ];

    public function up(): void
    {
        foreach (self::TARGETS as $table => $indexName) {
            if (! Schema::hasTable($table) || ! Schema::hasColumn($table, 'organization_id')) {
                continue;
            }

            if ($this->indexExists($table, $indexName)) {
                continue;
            }

            Schema::table($table, function (Blueprint $blueprint) use ($indexName) {
                $blueprint->index('organization_id', $indexName);
            });
        }
    }

    public function down(): void
    {
        foreach (self::TARGETS as $table => $indexName) {
            if (! Schema::hasTable($table) || ! $this->indexExists($table, $indexName)) {
                continue;
            }

            Schema::table($table, function (Blueprint $blueprint) use ($indexName) {
                $blueprint->dropIndex($indexName);
            });
        }
    }

    /**
     * Laravel has no cross-driver index check, and the suite runs on SQLite
     * while the app runs on PostgreSQL — so ask each driver in its own terms.
     */
    private function indexExists(string $table, string $indexName): bool
    {
        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'pgsql') {
            return ! empty(Schema::getConnection()->select(
                'select 1 from pg_indexes where tablename = ? and indexname = ?',
                [$table, $indexName],
            ));
        }

        if ($driver === 'sqlite') {
            return ! empty(Schema::getConnection()->select(
                "select 1 from sqlite_master where type = 'index' and name = ?",
                [$indexName],
            ));
        }

        // Unknown driver: let the create attempt decide rather than guessing.
        return false;
    }
};
