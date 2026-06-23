<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Fix the unique constraint on pay_group_assignments.
 *
 * The original migration created a global UNIQUE(user_id, effective_from)
 * index, which prevents a user from being moved from one pay group to
 * another on the same date — even though only the *active* assignment
 * matters at any given time. The Create Pay Group modal needs to be
 * able to close the previous active assignment and create a new one
 * for the same user on the same effective_from.
 *
 * The fix is a PARTIAL unique index that only applies to active rows
 * (is_active = 1). Inactive rows are part of the audit trail and can
 * share (user_id, effective_from) with other inactive rows without
 * violating uniqueness.
 *
 * This migration is driver-aware:
 *   - PostgreSQL: drop the unique *constraint* (auto-created by
 *     $table->unique()), then re-add as a partial unique index.
 *   - MySQL/MariaDB: drop the unique *index*, then re-add with the
 *     partial WHERE clause (MySQL 8+ supports partial indexes).
 *   - SQLite: drop the unique *index*, then re-add as a partial index.
 */
return new class extends Migration
{
    public function up(): void
    {
        $driver = DB::connection()->getDriverName();
        // The boolean column is stored as a true boolean in
        // PostgreSQL but as a tinyint (0/1) in MySQL/MariaDB and
        // SQLite. The partial-index predicate has to match.
        $whereClause = $driver === 'pgsql' ? 'is_active' : 'is_active = 1';

        if ($driver === 'pgsql') {
            // PostgreSQL stores $table->unique() as a unique
            // *constraint* backed by an index. We must drop the
            // constraint (not the index) first, then create a
            // partial index in its place.
            DB::statement(
                'ALTER TABLE pay_group_assignments '
                . 'DROP CONSTRAINT IF EXISTS pay_group_assignments_user_id_effective_from_unique'
            );
            DB::statement(
                'CREATE UNIQUE INDEX pay_group_assignments_user_id_effective_from_unique '
                . 'ON pay_group_assignments (user_id, effective_from) '
                . 'WHERE ' . $whereClause
            );
            return;
        }

        if ($driver === 'mysql' || $driver === 'mariadb') {
            // MySQL/MariaDB: the unique() created an index, not a
            // constraint. Drop the index, then create a partial
            // index in its place.
            DB::statement(
                'DROP INDEX pay_group_assignments_user_id_effective_from_unique '
                . 'ON pay_group_assignments'
            );
            DB::statement(
                'CREATE UNIQUE INDEX pay_group_assignments_user_id_effective_from_unique '
                . 'ON pay_group_assignments (user_id, effective_from) '
                . 'WHERE ' . $whereClause
            );
            return;
        }

        // sqlite (used in tests).
        DB::statement(
            'DROP INDEX IF EXISTS pay_group_assignments_user_id_effective_from_unique'
        );
        DB::statement(
            'CREATE UNIQUE INDEX pay_group_assignments_user_id_effective_from_unique '
            . 'ON pay_group_assignments (user_id, effective_from) '
            . 'WHERE ' . $whereClause
        );
    }

    public function down(): void
    {
        $driver = DB::connection()->getDriverName();

        DB::statement(
            'DROP INDEX IF EXISTS pay_group_assignments_user_id_effective_from_unique'
        );

        if ($driver === 'pgsql') {
            DB::statement(
                'ALTER TABLE pay_group_assignments '
                . 'ADD CONSTRAINT pay_group_assignments_user_id_effective_from_unique '
                . 'UNIQUE (user_id, effective_from)'
            );
            return;
        }

        // mysql / mariadb / sqlite — the original index was an index.
        DB::statement(
            'CREATE UNIQUE INDEX pay_group_assignments_user_id_effective_from_unique '
            . 'ON pay_group_assignments (user_id, effective_from)'
        );
    }
};
