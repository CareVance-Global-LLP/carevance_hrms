<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Gives the tracker domain structural tenancy.
 *
 * activity_sessions, activities, time_entries and screenshots carry no
 * organization_id today, so SchemaIntrospector::tenantScopedModels() cannot
 * see them (it iterates models using BelongsToOrganization) and nothing
 * enforces per-organization isolation on employee monitoring data beyond
 * every query remembering to join users. TenantIsolationTest cannot catch
 * this either: it only fires on a table that already HAS the column, and
 * these four fell through that net entirely.
 *
 * The column, the backfill and the trait on all four models land in the same
 * commit — the moment this migration runs, TenantIsolationTest starts
 * requiring the trait on any model owning a table with organization_id.
 */
return new class extends Migration
{
    private const TABLES = ['activity_sessions', 'activities', 'time_entries', 'screenshots'];

    public function up(): void
    {
        foreach (self::TABLES as $table) {
            if (! Schema::hasColumn($table, 'organization_id')) {
                Schema::table($table, function (Blueprint $t): void {
                    $t->unsignedBigInteger('organization_id')->nullable()->after('id');
                    $t->index('organization_id');
                });
            }
        }

        /*
         * Backfill from the owning user via a correlated subquery in SET,
         * which SQLite (the test suite, under RefreshDatabase) and
         * PostgreSQL (the app) both accept. `UPDATE ... FROM` is
         * PostgreSQL-only and would break every backend test that touches
         * this migration.
         */
        foreach (['activity_sessions', 'activities', 'time_entries'] as $table) {
            DB::table($table)->whereNull('organization_id')->update([
                'organization_id' => DB::raw(
                    "(SELECT organization_id FROM users WHERE users.id = {$table}.user_id)"
                ),
            ]);
        }

        /*
         * screenshots has no user_id — only time_entry_id — so it backfills
         * one hop further, through the time entry it belongs to. A
         * screenshot with a null time_entry_id CANNOT be attributed to a
         * tenant and is left null: it stays out of every scoped query, and
         * nothing is deleted. Destroying monitoring data to tidy a backfill
         * is not a trade this migration is entitled to make.
         */
        DB::table('screenshots')->whereNull('organization_id')->update([
            'organization_id' => DB::raw(
                '(SELECT users.organization_id FROM time_entries '.
                'INNER JOIN users ON users.id = time_entries.user_id '.
                'WHERE time_entries.id = screenshots.time_entry_id)'
            ),
        ]);
    }

    public function down(): void
    {
        foreach (self::TABLES as $table) {
            if (Schema::hasColumn($table, 'organization_id')) {
                Schema::table($table, function (Blueprint $t): void {
                    $t->dropColumn('organization_id');
                });
            }
        }
    }
};
