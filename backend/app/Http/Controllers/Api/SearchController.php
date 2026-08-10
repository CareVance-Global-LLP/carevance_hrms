<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AppNotification;
use App\Models\Asset;
use App\Models\Group;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Services\Authorization\GroupAccessService;
use App\Services\Billing\PlanService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Cross-entity search behind the command bar.
 *
 * One request fans out across whichever entities the caller is allowed to see
 * and returns a single uniform shape, so the client does not need to know which
 * modules exist or which of them this organization has paid for.
 *
 * Two rules hold for every branch below:
 *
 *  1. Organization scoping is not optional. Every query filters on the caller's
 *     organization, directly or through a relation.
 *  2. Visibility reuses the module's own rules rather than inventing new ones.
 *     People reuse the hierarchy tiers from UserController::index; tasks and
 *     projects reuse GroupAccessService. Search must never be a way to see
 *     something the module itself would hide.
 */
class SearchController extends Controller
{
    /** Minimum query length. One character matches most of the table. */
    private const MIN_QUERY_LENGTH = 2;

    /** Per-type cap. The client shows at most five of any one group. */
    private const DEFAULT_LIMIT = 5;

    private const MAX_LIMIT = 10;

    public const TYPES = ['people', 'departments', 'tasks', 'projects', 'leave', 'assets', 'announcements'];

    public function __construct(private readonly GroupAccessService $groupAccess)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'q' => 'required|string|max:120',
            'types' => 'nullable|string|max:200',
            'limit' => 'nullable|integer|min:1|max:' . self::MAX_LIMIT,
        ]);

        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['data' => []]);
        }

        $term = trim((string) $request->query('q', ''));
        if (mb_strlen($term) < self::MIN_QUERY_LENGTH) {
            return response()->json(['data' => []]);
        }

        $limit = (int) ($request->query('limit') ?: self::DEFAULT_LIMIT);
        $requested = $this->requestedTypes($request);
        $organization = $user->organization;

        $results = [];

        foreach ($requested as $type) {
            if (!$this->allows($user, $organization, $type)) {
                continue;
            }

            $results = array_merge($results, match ($type) {
                'people' => $this->people($user, $term, $limit),
                'departments' => $this->departments($user, $term, $limit),
                'tasks' => $this->tasks($user, $term, $limit),
                'projects' => $this->projects($user, $term, $limit),
                'leave' => $this->leave($user, $term, $limit),
                'assets' => $this->assets($user, $term, $limit),
                'announcements' => $this->announcements($user, $term, $limit),
                default => [],
            });
        }

        return response()->json(['data' => $results]);
    }

    /** @return string[] */
    private function requestedTypes(Request $request): array
    {
        $raw = trim((string) $request->query('types', ''));
        if ($raw === '') {
            return self::TYPES;
        }

        $requested = array_map('trim', explode(',', $raw));

        return array_values(array_intersect(self::TYPES, $requested));
    }

    /**
     * Plan and role gates. The queries below are still individually scoped —
     * this only avoids running work the caller could never see the result of.
     */
    private function allows(User $user, ?Organization $organization, string $type): bool
    {
        $isAdmin = $user->getHierarchyLevel() <= Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['admin'];
        $feature = fn (string $name) => $organization ? PlanService::hasFeature($organization, $name) : false;

        return match ($type) {
            'people' => true,
            'departments' => $isAdmin,
            'tasks' => $feature('task_tracking'),
            'projects' => $feature('project_tracking'),
            'leave' => $feature('leave_management'),
            'assets' => $user->hasPermission('assets.view'),
            'announcements' => true,
            default => false,
        };
    }

    /**
     * Escapes a user-supplied term for a LIKE pattern.
     *
     * Without this, typing `%` matches every row and `_` matches any character
     * — a wildcard injection that turns the search box into a table dump.
     */
    private function likePattern(string $term): string
    {
        return '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower($term)) . '%';
    }

    /** Case-insensitive LIKE that behaves the same on Postgres and SQLite. */
    private function whereLike(Builder $query, array $columns, string $term): Builder
    {
        $pattern = $this->likePattern($term);

        return $query->where(function (Builder $inner) use ($columns, $pattern) {
            foreach ($columns as $column) {
                $inner->orWhereRaw("LOWER({$column}) LIKE ? ESCAPE '\\'", [$pattern]);
            }
        });
    }

    /**
     * People, using exactly the tiers UserController::index applies:
     * admins see the organization, managers see their groups, employees see
     * themselves. Search widening that would be a privacy regression.
     */
    private function people(User $user, string $term, int $limit): array
    {
        $level = $user->getHierarchyLevel();
        $adminLevel = Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['admin'];
        $employeeLevel = Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['employee'];

        $query = User::query()
            ->where('organization_id', $user->organization_id)
            ->with(['employeeWorkInfo.department:id,name']);

        if ($level >= $employeeLevel) {
            $query->where('id', $user->id);
        } elseif ($level > $adminLevel) {
            $visibleGroupIds = $user->groups()->pluck('groups.id')->all();
            $query->where(function (Builder $scoped) use ($user, $visibleGroupIds) {
                $scoped->where('id', $user->id)
                    ->orWhereHas('groups', fn (Builder $groups) => $groups->whereIn('groups.id', $visibleGroupIds));
            });
        }

        $this->whereLike($query, ['users.name', 'users.email'], $term);

        return $query->orderBy('name')
            ->limit($limit)
            ->get()
            ->map(function (User $person) {
                $department = $person->employeeWorkInfo?->department?->name;

                return [
                    'type' => 'person',
                    'id' => (int) $person->id,
                    'title' => (string) $person->name,
                    'subtitle' => trim(implode(' · ', array_filter([$person->email, $department]))),
                    'url' => '/employees/' . $person->id,
                ];
            })
            ->all();
    }

    private function departments(User $user, string $term, int $limit): array
    {
        $query = Group::query()->where('organization_id', $user->organization_id);
        $this->whereLike($query, ['groups.name'], $term);

        return $query->orderBy('name')
            ->limit($limit)
            ->get()
            ->map(fn (Group $group) => [
                'type' => 'department',
                'id' => (int) $group->id,
                'title' => (string) $group->name,
                'subtitle' => 'Department',
                'url' => '/employees?department=' . rawurlencode((string) $group->name),
            ])
            ->all();
    }

    private function tasks(User $user, string $term, int $limit): array
    {
        $query = Task::query()->with(['project:id,name']);
        // Same visibility rule the Tasks page uses.
        $this->groupAccess->applyTaskVisibilityScope($query, $user);
        $this->whereLike($query, ['tasks.title'], $term);

        return $query->orderByDesc('created_at')
            ->limit($limit)
            ->get()
            ->map(fn (Task $task) => [
                'type' => 'task',
                'id' => (int) $task->id,
                'title' => (string) $task->title,
                'subtitle' => trim(implode(' · ', array_filter([
                    $task->project?->name,
                    str_replace('_', ' ', (string) $task->status),
                ]))),
                'url' => '/tasks?task=' . $task->id,
            ])
            ->all();
    }

    private function projects(User $user, string $term, int $limit): array
    {
        $query = Project::query()->where('organization_id', $user->organization_id);

        $visibleGroupIds = $this->groupAccess->visibleGroupIds($user);
        if (is_array($visibleGroupIds)) {
            $query->where(function (Builder $scoped) use ($visibleGroupIds) {
                $scoped->whereIn('group_id', $visibleGroupIds)->orWhereNull('group_id');
            });
        }

        $this->whereLike($query, ['projects.name'], $term);

        return $query->orderBy('name')
            ->limit($limit)
            ->get()
            ->map(fn (Project $project) => [
                'type' => 'project',
                'id' => (int) $project->id,
                'title' => (string) $project->name,
                'subtitle' => trim('Project · ' . (string) $project->status),
                'url' => '/projects?project=' . $project->id,
            ])
            ->all();
    }

    /**
     * Leave requests. Admins search the organization's; everyone else searches
     * only their own, matching what each of them can open.
     */
    private function leave(User $user, string $term, int $limit): array
    {
        $isAdmin = $user->getHierarchyLevel() <= Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['admin'];

        $query = LeaveRequest::query()
            ->where('organization_id', $user->organization_id)
            ->with(['user:id,name']);

        if (!$isAdmin) {
            $query->where('user_id', $user->id);
        }

        $query->where(function (Builder $inner) use ($term, $isAdmin) {
            $pattern = $this->likePattern($term);
            $inner->orWhereRaw("LOWER(leave_requests.reason) LIKE ? ESCAPE '\\'", [$pattern])
                ->orWhereRaw("LOWER(leave_requests.leave_category) LIKE ? ESCAPE '\\'", [$pattern])
                ->orWhereRaw("LOWER(leave_requests.status) LIKE ? ESCAPE '\\'", [$pattern]);

            if ($isAdmin) {
                $inner->orWhereHas('user', function (Builder $owner) use ($pattern) {
                    $owner->whereRaw("LOWER(users.name) LIKE ? ESCAPE '\\'", [$pattern]);
                });
            }
        });

        return $query->orderByDesc('start_date')
            ->limit($limit)
            ->get()
            ->map(fn (LeaveRequest $leaveRequest) => [
                'type' => 'leave',
                'id' => (int) $leaveRequest->id,
                'title' => trim(($isAdmin ? ($leaveRequest->user?->name . ' · ') : '')
                    . $leaveRequest->start_date?->format('d M')
                    . ' – ' . $leaveRequest->end_date?->format('d M')),
                'subtitle' => trim(implode(' · ', array_filter([
                    ucfirst(str_replace('_', ' ', (string) $leaveRequest->leave_category)),
                    ucfirst((string) $leaveRequest->status),
                ]))),
                'url' => $isAdmin
                    ? '/approval-inbox?section=leave&view=' . ($leaveRequest->status === 'pending' ? 'pending' : 'all')
                    : '/leave',
            ])
            ->all();
    }

    private function assets(User $user, string $term, int $limit): array
    {
        $query = Asset::query()
            ->where('organization_id', $user->organization_id)
            ->with(['currentAssignment.user:id,name']);

        $this->whereLike($query, ['assets.name', 'assets.asset_tag', 'assets.serial_number', 'assets.category'], $term);

        return $query->orderBy('name')
            ->limit($limit)
            ->get()
            ->map(fn (Asset $asset) => [
                'type' => 'asset',
                'id' => (int) $asset->id,
                'title' => (string) $asset->name,
                'subtitle' => trim(implode(' · ', array_filter([
                    $asset->asset_tag,
                    $asset->currentAssignment?->user?->name,
                    ucfirst((string) $asset->status),
                ]))),
                'url' => '/assets?asset=' . $asset->id,
            ])
            ->all();
    }

    /** Announcements the caller actually received. */
    private function announcements(User $user, string $term, int $limit): array
    {
        $query = AppNotification::query()
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->where('type', 'announcement');

        $this->whereLike($query, ['app_notifications.title', 'app_notifications.message'], $term);

        return $query->orderByDesc('created_at')
            ->limit($limit)
            ->get()
            ->map(fn (AppNotification $notification) => [
                'type' => 'announcement',
                'id' => (int) $notification->id,
                'title' => (string) $notification->title,
                'subtitle' => 'Announcement · ' . optional($notification->created_at)->format('d M Y'),
                'url' => '/notifications',
            ])
            ->all();
    }
}
