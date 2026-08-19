<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;

/*
 * time_entries carried indexes for every access pattern except the one the
 * task list uses. GET /api/tasks sums duration per task with a correlated
 * subquery, and with no index on task_id Postgres ran a sequential scan of the
 * whole table once per task — EXPLAIN showed 450 loops each discarding 2,639
 * rows, 93 ms for a single query on a small dev dataset that grows with every
 * tracked minute.
 *
 * The partial index covers the second half of the same request, which fetches
 * still-running entries for those tasks (task_id IN (...) AND end_time IS NULL).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('time_entries') || ! Schema::hasColumn('time_entries', 'task_id')) {
            return;
        }

        Schema::table('time_entries', function (Blueprint $table) {
            if (! $this->hasIndex('time_entries_task_id_index')) {
                $table->index('task_id', 'time_entries_task_id_index');
            }
        });

        if (Schema::getConnection()->getDriverName() === 'pgsql'
            && ! $this->hasIndex('time_entries_task_running_idx')) {
            Schema::getConnection()->statement(
                'CREATE INDEX time_entries_task_running_idx ON time_entries (task_id) WHERE end_time IS NULL'
            );
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('time_entries')) {
            return;
        }

        Schema::table('time_entries', function (Blueprint $table) {
            if ($this->hasIndex('time_entries_task_id_index')) {
                $table->dropIndex('time_entries_task_id_index');
            }
        });

        if ($this->hasIndex('time_entries_task_running_idx')) {
            Schema::getConnection()->statement('DROP INDEX time_entries_task_running_idx');
        }
    }

    private function hasIndex(string $name): bool
    {
        try {
            return collect(Schema::getIndexes('time_entries'))
                ->contains(fn ($index) => ($index['name'] ?? null) === $name);
        } catch (\Throwable) {
            return false;
        }
    }
};
