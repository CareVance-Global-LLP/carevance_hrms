<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `in_review` has been on the `Task` TypeScript type and in the API's vocabulary
 * for a while, but the column constraint only ever allowed three values — so the
 * status could never actually be stored. The board now renders a fourth column
 * for it, which needs the database to accept it first.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check');
            DB::statement("ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('todo', 'in_progress', 'in_review', 'done'))");
        }
        // On sqlite the enum is stored as a plain string with no CHECK constraint.
    }

    public function down(): void
    {
        // Anything mid-review goes back to in_progress rather than being dropped
        // by the narrower constraint.
        DB::statement("UPDATE tasks SET status = 'in_progress' WHERE status = 'in_review'");

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check');
            DB::statement("ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('todo', 'in_progress', 'done'))");
        }
    }
};
