<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Gives a task an identity, a classification and a place in a hierarchy.
 *
 * Six gaps, all of which showed up the moment the task model was compared
 * against what issue trackers actually carry:
 *
 * - **organization_id.** `tasks` was the odd one out among ~97 models: tenancy
 *   was reached indirectly, through `group → org` or `project → org`. It holds
 *   today only because every row happens to have a project; a task with neither
 *   is invisible to every branch of the visibility scope and belongs to nobody.
 *   Backfilled from the project, then made the direct, enforceable answer.
 *
 * - **created_by.** There was no record of who raised a task. "Why does this
 *   exist?" had no answer anywhere in the system. Nullable, because history
 *   genuinely does not know — a backfill would be inventing an author.
 *
 * - **type.** A bug, a feature and a chore were all "task", so defect rates and
 *   noise filtering were impossible to express.
 *
 * - **resolution.** `done` could not distinguish shipped from abandoned from
 *   duplicate, which makes "completed tasks" an untrustworthy number.
 *
 * - **parent_id.** No hierarchy at all. Checklist items were the nearest thing
 *   and cannot be assigned or tracked against, so "this feature is these eight
 *   pieces" had nowhere to live.
 *
 * - **number.** Tasks were bare database ids, with no `PROJ-14` to paste into
 *   a conversation. Sequential per organization so it is stable and shareable.
 */
return new class extends Migration
{
    private const TYPES = ['task', 'bug', 'story', 'epic'];

    private const RESOLUTIONS = ['fixed', 'wont_do', 'duplicate', 'cannot_reproduce'];

    public function up(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            if (! Schema::hasColumn('tasks', 'organization_id')) {
                $table->unsignedBigInteger('organization_id')->nullable()->after('id');
                $table->index('organization_id');
            }
            if (! Schema::hasColumn('tasks', 'created_by')) {
                $table->unsignedBigInteger('created_by')->nullable()->after('assignee_id');
                $table->index('created_by');
            }
            if (! Schema::hasColumn('tasks', 'parent_id')) {
                $table->unsignedBigInteger('parent_id')->nullable()->after('project_id');
                $table->index('parent_id');
            }
            if (! Schema::hasColumn('tasks', 'type')) {
                $table->string('type', 20)->default('task')->after('status');
            }
            if (! Schema::hasColumn('tasks', 'resolution')) {
                $table->string('resolution', 30)->nullable()->after('type');
            }
            if (! Schema::hasColumn('tasks', 'number')) {
                $table->unsignedInteger('number')->nullable()->after('organization_id');
            }
        });

        $this->backfillOrganizationIds();
        $this->backfillNumbers();

        // Guarded like every other constraint here: sqlite stores these as plain
        // strings, so the CHECKs are a pgsql-only concern.
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_type_check');
            DB::statement("ALTER TABLE tasks ADD CONSTRAINT tasks_type_check CHECK (type IN ('".implode("', '", self::TYPES)."'))");

            DB::statement('ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_resolution_check');
            DB::statement("ALTER TABLE tasks ADD CONSTRAINT tasks_resolution_check CHECK (resolution IS NULL OR resolution IN ('".implode("', '", self::RESOLUTIONS)."'))");

            // A number is unique WITHIN an organization, not globally — two
            // tenants both having a #1 is the point of a per-tenant key.
            DB::statement('DROP INDEX IF EXISTS tasks_org_number_unique');
            DB::statement('CREATE UNIQUE INDEX tasks_org_number_unique ON tasks (organization_id, number) WHERE organization_id IS NOT NULL AND number IS NOT NULL');
        }
    }

    /**
     * Tenancy, taken from the project the task already belongs to.
     *
     * Chunked rather than one correlated UPDATE so this stays readable and does
     * not hold a long write lock on a table the app is serving from.
     */
    private function backfillOrganizationIds(): void
    {
        DB::table('tasks')
            ->whereNull('organization_id')
            ->orderBy('id')
            ->chunkById(500, function ($tasks) {
                foreach ($tasks as $task) {
                    $organizationId = null;

                    if (! empty($task->project_id)) {
                        $organizationId = DB::table('projects')->where('id', $task->project_id)->value('organization_id');
                    }

                    if (! $organizationId && ! empty($task->group_id)) {
                        $organizationId = DB::table('groups')->where('id', $task->group_id)->value('organization_id');
                    }

                    // Last resort: the assignee's organization. A task nobody can
                    // trace to a tenant is worse than one traced through a person.
                    if (! $organizationId && ! empty($task->assignee_id)) {
                        $organizationId = DB::table('users')->where('id', $task->assignee_id)->value('organization_id');
                    }

                    if ($organizationId) {
                        DB::table('tasks')->where('id', $task->id)->update(['organization_id' => $organizationId]);
                    }
                }
            });
    }

    /** Sequential per organization, oldest task first, so numbering reads chronologically. */
    private function backfillNumbers(): void
    {
        $organizationIds = DB::table('tasks')
            ->whereNotNull('organization_id')
            ->distinct()
            ->pluck('organization_id');

        foreach ($organizationIds as $organizationId) {
            $next = 1;
            DB::table('tasks')
                ->where('organization_id', $organizationId)
                ->whereNull('number')
                ->orderBy('id')
                ->get(['id'])
                ->each(function ($task) use (&$next, $organizationId) {
                    DB::table('tasks')->where('id', $task->id)->update(['number' => $next]);
                    $next++;
                });
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_type_check');
            DB::statement('ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_resolution_check');
            DB::statement('DROP INDEX IF EXISTS tasks_org_number_unique');
        }

        Schema::table('tasks', function (Blueprint $table) {
            foreach (['organization_id', 'created_by', 'parent_id', 'type', 'resolution', 'number'] as $column) {
                if (Schema::hasColumn('tasks', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
