<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Group;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Services\Authorization\GroupAccessService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class TaskController extends Controller
{
    public function __construct(
        private readonly GroupAccessService $groupAccessService,
    ) {
    }

    public function index(Request $request)
    {
        if ($request->has('timer_only')) {
            $request->merge([
                'timer_only' => $request->boolean('timer_only'),
            ]);
        }

        $request->validate([
            'group_id' => 'nullable|integer',
            'project_id' => 'nullable|integer',
            'status' => 'nullable|in:todo,in_progress,done',
            'assignee_id' => 'nullable|integer',
            'timer_only' => 'nullable|boolean',
        ]);

        $user = request()->user();
        if (!$user || !$user->organization_id) {
            return response()->json([]);
        }

        $tasks = $this->scopedTasksQuery($user)
            ->with(['group', 'project', 'assignee'])
            ->when($request->filled('group_id'), function (Builder $query) use ($request, $user) {
                $groupId = (int) $request->group_id;
                $visibleGroupIds = $this->groupAccessService->visibleGroupIds($user);

                if (is_array($visibleGroupIds) && !in_array($groupId, $visibleGroupIds, true)) {
                    $query->whereRaw('1 = 0');

                    return;
                }

                $query->where('group_id', $groupId);
            })
            ->when($request->filled('project_id'), fn (Builder $query) => $query->where('project_id', (int) $request->project_id))
            ->when($request->filled('status'), fn (Builder $query) => $query->where('status', $request->status))
            ->when($request->filled('assignee_id'), fn (Builder $query) => $query->where('assignee_id', (int) $request->assignee_id))
            ->when($request->boolean('timer_only'), fn (Builder $query) => $query->where('status', '!=', 'done'))
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json($tasks);
    }

    public function store(Request $request)
    {
        $request->validate([
            'title' => 'required|string|max:255',
            'description' => 'nullable|string',
            'group_id' => 'required|exists:groups,id',
            'project_id' => 'nullable|exists:projects,id',
            'status' => 'nullable|in:todo,in_progress,done',
            'priority' => 'nullable|in:low,medium,high,urgent',
            'assignee_id' => 'nullable|exists:users,id',
            'due_date' => 'nullable|date',
            'estimated_time' => 'nullable|integer|min:0',
        ]);

        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if (!$this->groupAccessService->canManageTasks($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $group = $this->resolveManagedGroup($user, (int) $request->group_id);
        if ($group instanceof JsonResponse) {
            return $group;
        }

        $project = $this->resolveProjectForOrganization($user, $request->project_id ? (int) $request->project_id : null);
        if ($project instanceof JsonResponse) {
            return $project;
        }

        $assignee = $this->resolveAssigneeForGroup(
            $user,
            $group,
            $request->assignee_id ? (int) $request->assignee_id : null
        );

        $task = Task::create([
            'title' => $request->title,
            'description' => $request->description,
            'group_id' => $group->id,
            'project_id' => $project?->id,
            'status' => $request->status ?? 'todo',
            'priority' => $request->priority ?? 'medium',
            'assignee_id' => $assignee?->id,
            'due_date' => $request->due_date,
            'estimated_time' => $request->estimated_time,
        ]);

        return response()->json($task->load(['group', 'project', 'assignee']), 201);
    }

    public function show(Task $task)
    {
        if (!$this->canAccessTask($task)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $task->load(['group', 'project', 'timeEntries', 'assignee']);
        return response()->json($task);
    }

    public function update(Request $request, Task $task)
    {
        if (!$this->canAccessTask($task)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $user = $request->user();
        if (!$this->groupAccessService->canManageTasks($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $request->validate([
            'title' => 'sometimes|string|max:255',
            'description' => 'nullable|string',
            'group_id' => 'nullable|exists:groups,id',
            'project_id' => 'nullable|exists:projects,id',
            'status' => 'nullable|in:todo,in_progress,done',
            'priority' => 'nullable|in:low,medium,high,urgent',
            'assignee_id' => 'nullable|exists:users,id',
            'due_date' => 'nullable|date',
            'estimated_time' => 'nullable|integer|min:0',
        ]);

        $groupId = $request->exists('group_id')
            ? ($request->group_id ? (int) $request->group_id : null)
            : ($task->group_id ? (int) $task->group_id : null);

        $group = $groupId ? $this->resolveManagedGroup($user, $groupId) : null;
        if ($group instanceof JsonResponse) {
            return $group;
        }

        $projectId = $request->exists('project_id')
            ? ($request->project_id ? (int) $request->project_id : null)
            : ($task->project_id ? (int) $task->project_id : null);

        $project = $this->resolveProjectForOrganization($user, $projectId);
        if ($project instanceof JsonResponse) {
            return $project;
        }

        $assigneeId = $request->exists('assignee_id')
            ? ($request->assignee_id ? (int) $request->assignee_id : null)
            : ($task->assignee_id ? (int) $task->assignee_id : null);

        $resolvedGroup = $group ?: $task->group;
        if (!$resolvedGroup) {
            throw ValidationException::withMessages([
                'group_id' => ['A task group is required before this task can be updated.'],
            ]);
        }

        $assignee = $this->resolveAssigneeForGroup($user, $resolvedGroup, $assigneeId);

        $payload = $request->only(['title', 'description', 'status', 'priority', 'due_date', 'estimated_time']);

        if ($request->exists('group_id')) {
            $payload['group_id'] = $resolvedGroup->id;
        }

        if ($request->exists('project_id')) {
            $payload['project_id'] = $project?->id;
        }

        if ($request->exists('assignee_id') || $request->exists('group_id')) {
            $payload['assignee_id'] = $assignee?->id;
        }

        $task->update($payload);

        return response()->json($task->fresh()->load(['group', 'project', 'assignee']));
    }

    public function updateStatus(Request $request, Task $task)
    {
        if (!$this->canAccessTask($task)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $request->validate([
            'status' => 'required|in:todo,in_progress,done',
        ]);

        $task->update(['status' => $request->status]);

        return response()->json($task->fresh()->load(['group', 'project', 'assignee']));
    }

    public function destroy(Task $task)
    {
        if (!$this->canAccessTask($task)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        if (!$this->groupAccessService->canManageTasks(request()->user())) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $task->delete();

        return response()->json(['message' => 'Task deleted']);
    }

    public function timeEntries(int $id)
    {
        $task = $this->findScopedTask($id);
        if (!$task) {
            return response()->json(['message' => 'Task not found'], 404);
        }

        return response()->json(
            $task->timeEntries()
                ->with(['project', 'user', 'task.group'])
                ->orderBy('start_time', 'desc')
                ->get()
        );
    }

    private function canAccessTask(Task $task): bool
    {
        $user = request()->user();
        return $this->groupAccessService->canAccessTask($user, $task);
    }

    private function findScopedTask(int $id): ?Task
    {
        $user = request()->user();
        if (!$user || !$user->organization_id) {
            return null;
        }

        return $this->scopedTasksQuery($user)
            ->with(['group', 'project', 'assignee'])
            ->where('id', $id)
            ->first();
    }

    private function scopedTasksQuery(User $user): Builder
    {
        $query = Task::query();
        $this->groupAccessService->applyTaskVisibilityScope($query, $user);
        if ($user->role === 'employee') {
            $assignedProjectIds = $user->assignedProjects()
                ->pluck('projects.id')
                ->map(fn ($id) => (int) $id)
                ->all();

            if (!empty($assignedProjectIds)) {
                $query->whereIn('project_id', $assignedProjectIds);
            }
        }

        return $query;
    }

    private function resolveManagedGroup(User $user, int $groupId): Group|JsonResponse
    {
        $group = Group::query()
            ->where('organization_id', $user->organization_id)
            ->find($groupId);

        if (!$group) {
            return response()->json(['message' => 'Invalid group for your organization.'], 422);
        }

        if (!$group->is_active) {
            return response()->json(['message' => 'Selected group is inactive.'], 422);
        }

        if (!$this->groupAccessService->canManageGroup($user, $group)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return $group;
    }

    private function resolveProjectForOrganization(User $user, ?int $projectId): Project|JsonResponse|null
    {
        if (!$projectId) {
            return null;
        }

        $project = Project::query()
            ->where('organization_id', $user->organization_id)
            ->find($projectId);

        if (!$project) {
            return response()->json(['message' => 'Invalid project for your organization.'], 422);
        }

        return $project;
    }

    private function resolveAssigneeForGroup(User $user, Group $group, ?int $assigneeId): ?User
    {
        if (!$assigneeId) {
            return null;
        }

        $assignee = User::query()
            ->where('organization_id', $user->organization_id)
            ->find($assigneeId);

        if (!$assignee) {
            throw ValidationException::withMessages([
                'assignee_id' => ['Assigned user must belong to your organization.'],
            ]);
        }

        $belongsToGroup = $assignee->groups()
            ->where('groups.id', $group->id)
            ->exists();

        if (!$belongsToGroup) {
            throw ValidationException::withMessages([
                'assignee_id' => ['Assigned user must belong to the selected group.'],
            ]);
        }

        return $assignee;
    }
}
