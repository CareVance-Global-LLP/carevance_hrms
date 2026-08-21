<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Task extends Model
{
    use BelongsToOrganization;

    /** What kind of work this is. A bug and a feature are not the same thing to report on. */
    public const TYPES = ['task', 'bug', 'story', 'epic'];

    /**
     * How a task ENDED, which `status` cannot say.
     *
     * `done` alone cannot tell shipped from abandoned from duplicate, so
     * "completed tasks" was a number nobody could act on.
     */
    public const RESOLUTIONS = ['fixed', 'wont_do', 'duplicate', 'cannot_reproduce'];

    protected $fillable = [
        'organization_id',
        'group_id',
        'project_id',
        'parent_id',
        'assignee_id',
        'created_by',
        'title',
        'description',
        'status',
        'type',
        'resolution',
        'priority',
        'due_date',
        'estimated_time',
        'remind_at',
        'reminded_at',
        'overdue_notified_at',
    ];

    protected $casts = [
        'due_date' => 'date:Y-m-d',
        'estimated_time' => 'integer',
        'number' => 'integer',
        'remind_at' => 'datetime',
        'reminded_at' => 'datetime',
        'overdue_notified_at' => 'datetime',
    ];

    /**
     * Keep the primary assignee inside the assignee set.
     *
     * Ownership has two representations: `assignee_id`, which every filter,
     * notification and visibility rule reads because it indexes, and the
     * `task_user` pivot, which carries everyone else. They are not redundant —
     * but they can DISAGREE, and when they do a task is owned by one person
     * according to the board and a different set according to the detail panel.
     *
     * The rule, in one place rather than repeated at every call site: the
     * primary assignee is always a member of the set. This is the only
     * supported way to write the pivot.
     *
     * @param  iterable<int>  $userIds
     */
    public function syncAssignees(iterable $userIds): void
    {
        $ids = collect($userIds)
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->unique();

        if ($this->assignee_id && ! $ids->contains((int) $this->assignee_id)) {
            $ids->push((int) $this->assignee_id);
        }

        $this->assignees()->sync($ids->values()->all());
    }

    /** The shareable identifier, e.g. CV-14. Bare ids cannot be pasted into a conversation. */
    protected $appends = ['key'];

    /**
     * Assign the next per-organization number on create.
     *
     * Done in the model rather than a database sequence because the number is
     * per TENANT, not global — two organizations both having a #1 is the point.
     * Wrapped so a tenant-less task (an import, a console command) still saves
     * rather than failing on a number it has no scope to allocate.
     */
    protected static function booted(): void
    {
        static::creating(function (Task $task) {
            /*
             * Derive the tenant from the work the task already belongs to.
             *
             * BelongsToOrganization stamps this from the authenticated user,
             * which covers every request path. It does NOT cover a task created
             * with no acting user — an import, a console command, a seeder — and
             * such a task is worse than wrong: it belongs to no tenant, so the
             * global scope hides it from everyone and it is unreachable forever.
             *
             * A task's project already knows the answer, so ask it rather than
             * requiring every caller to remember. Same order as the migration
             * that backfilled the column, deliberately: project, then group,
             * then the assignee, so the two can never disagree about which
             * tenant a given row belongs to.
             */
            /*
             * The task's CONTEXT outranks the acting user.
             *
             * BelongsToOrganization stamps the authenticated user's tenant, which
             * is right when there is nothing better to go on and wrong the moment
             * there is: a task hung off a project belongs to that project's
             * organization no matter who typed it. Trusting the actor instead
             * silently misfiles the row into the creator's tenant, where the
             * people who own the work cannot see it and the people who do not
             * own it can.
             *
             * So derive first and only fall back to what the trait set.
             */
            $derived = static::organizationIdFromContext($task);
            if ($derived) {
                $task->organization_id = $derived;
            }

            if (empty($task->organization_id)) {
                /*
                 * Read through the query builder rather than the relations.
                 *
                 * Project and Group are themselves organization-scoped, so
                 * `$task->project` resolves against whoever happens to be
                 * authenticated — which during a create is frequently nobody,
                 * and occasionally somebody from a different tenant. Either way
                 * the relation returns null and the task is left orphaned. The
                 * question being asked here is "which tenant owns this row",
                 * which must not depend on who is asking.
                 */
                $task->organization_id = static::organizationIdFromContext($task);
            }

            if ($task->number !== null || empty($task->organization_id)) {
                return;
            }

            $task->number = (int) static::withoutOrganizationScope()
                ->where('organization_id', $task->organization_id)
                ->max('number') + 1;
        });
    }

    /**
     * Which tenant a task belongs to, taken from the work it hangs off.
     *
     * Same order as the migration that backfilled the column — project, then
     * group, then assignee — so a row created now and a row repaired then can
     * never disagree about their owner.
     */
    private static function organizationIdFromContext(Task $task): ?int
    {
        $lookup = static function (string $table, $id): ?int {
            if (empty($id)) {
                return null;
            }

            $organizationId = \Illuminate\Support\Facades\DB::table($table)
                ->where('id', $id)
                ->value('organization_id');

            return $organizationId ? (int) $organizationId : null;
        };

        return $lookup('projects', $task->project_id)
            ?? $lookup('groups', $task->group_id)
            ?? $lookup('users', $task->assignee_id);
    }

    public function getKeyAttribute(): ?string
    {
        return $this->number ? 'CV-'.$this->number : null;
    }

    /** The task this one is part of. One level is enough to express a feature and its pieces. */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(Task::class, 'parent_id');
    }

    /**
     * The pieces this task breaks down into.
     *
     * Real tasks, unlike checklist items: they carry their own assignee, status
     * and time entries, which is the whole reason checklist items were not
     * enough.
     */
    public function children(): HasMany
    {
        return $this->hasMany(Task::class, 'parent_id');
    }

    /** Who raised it. Distinct from who is doing it. */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function project(): BelongsTo

    {
        return $this->belongsTo(Project::class);
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class);
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignee_id');
    }

    public function assignees(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'task_user')
            ->withTimestamps();
    }

    public function timeEntries(): HasMany
    {
        return $this->hasMany(TimeEntry::class);
    }

    public function taskActivities(): HasMany
    {
        return $this->hasMany(TaskActivity::class);
    }

    public function watchers(): HasMany
    {
        return $this->hasMany(TaskWatcher::class);
    }

    public function watcherUsers(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'task_watchers')
            ->withTimestamps();
    }

    public function comments(): HasMany
    {
        return $this->hasMany(TaskComment::class);
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(TaskAttachment::class);
    }

    public function labels(): BelongsToMany
    {
        return $this->belongsToMany(TaskLabel::class, 'task_task_label')
            ->withTimestamps();
    }

    public function checklistItems(): HasMany
    {
        return $this->hasMany(TaskChecklistItem::class)->orderBy('position');
    }

    public function dependencies(): HasMany
    {
        return $this->hasMany(TaskDependency::class);
    }

    public function dependsOn(): HasMany
    {
        return $this->hasMany(TaskDependency::class, 'depends_on_task_id');
    }

    public function recurrence(): HasMany
    {
        return $this->hasMany(TaskRecurrence::class);
    }
}
