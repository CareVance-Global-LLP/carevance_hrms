<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Group;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskAttachment;
use App\Models\TaskChecklistItem;
use App\Models\TaskComment;
use App\Models\TaskDependency;
use App\Models\TaskLabel;
use App\Models\TaskRecurrence;
use App\Models\TaskWatcher;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\AppNotificationService;
use App\Services\Authorization\GroupAccessService;
use App\Services\Tasks\TaskActivityService;
use App\Services\TimeEntries\TimeEntryDurationService;
use Illuminate\Support\Collection;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class TaskController extends Controller
{
    public function __construct(
        private readonly GroupAccessService $groupAccessService,
        private readonly TimeEntryDurationService $timeEntryDurationService,
        private readonly AppNotificationService $notificationService,
        private readonly TaskActivityService $taskActivityService,
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
            ->with(['group', 'project', 'assignee', 'assignees'])
            ->withSum('timeEntries', 'duration')
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

        $resolvedNow = now();
        $taskIds = $tasks->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->all();
        $runningEntriesByTaskId = empty($taskIds)
            ? collect()
            : TimeEntry::query()
                ->whereIn('task_id', $taskIds)
                ->whereNull('end_time')
                ->get(['task_id', 'start_time', 'end_time', 'duration'])
                ->groupBy('task_id');

        $tasks->each(function (Task $task) use ($resolvedNow, $runningEntriesByTaskId) {
            $baseTrackedDuration = max(0, (int) ($task->time_entries_sum_duration ?? 0));
            $runningEntries = $runningEntriesByTaskId->get((int) $task->id, collect());
            $runningDurationAdjustment = collect($runningEntries)->sum(function ($entry) use ($resolvedNow) {
                $effective = $this->timeEntryDurationService->effectiveDuration($entry, $resolvedNow);
                $stored = max(0, (int) data_get($entry, 'duration', 0));

                return max(0, $effective - $stored);
            });

            $task->setAttribute('time_entries_sum_duration', (int) ($baseTrackedDuration + $runningDurationAdjustment));
        });

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
            'assignee_ids' => 'nullable|array',
            'assignee_ids.*' => 'integer|exists:users,id',
            'due_date' => 'nullable|date',
            'estimated_time' => 'nullable|integer|min:0',
            'remind_at' => 'nullable|date',
            'label_ids' => 'nullable|array',
            'label_ids.*' => 'integer|exists:task_labels,id',
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

        $project = $this->resolveProjectForOrganization(
            $user,
            $request->project_id ? (int) $request->project_id : null,
            $group
        );
        if ($project instanceof JsonResponse) {
            return $project;
        }

        $assignee = $this->resolveAssigneeForGroup(
            $user,
            $group,
            $request->assignee_id ? (int) $request->assignee_id : null
        );
        $assignees = $this->resolveAssigneesForGroup(
            $user,
            $group,
            $request->input('assignee_ids', [])
        );
        if ($assignee && !$assignees->contains('id', $assignee->id)) {
            $assignees->push($assignee);
        }

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
            'remind_at' => $request->remind_at,
        ]);
        $task->assignees()->sync($assignees->pluck('id')->all());

        if ($request->filled('label_ids')) {
            $task->labels()->sync($request->input('label_ids', []));
        }

        // Log activity
        $this->taskActivityService->logCreated($task, $user);

        // Auto-watch: creator watches the task
        $this->watchTask($task, $user);

        // Notify assignees
        $this->notifyAssignees($task, $user, $assignees);

        return response()->json($task->load(['group', 'project', 'assignee', 'assignees', 'labels']), 201);
    }

    public function show(Task $task)
    {
        if (!$this->canAccessTask($task)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $task->load(['group', 'project', 'timeEntries', 'assignee', 'assignees']);
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
            'assignee_ids' => 'nullable|array',
            'assignee_ids.*' => 'integer|exists:users,id',
            'due_date' => 'nullable|date',
            'estimated_time' => 'nullable|integer|min:0',
            'label_ids' => 'nullable|array',
            'label_ids.*' => 'integer|exists:task_labels,id',
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

        $assigneeId = $request->exists('assignee_id')
            ? ($request->assignee_id ? (int) $request->assignee_id : null)
            : ($task->assignee_id ? (int) $task->assignee_id : null);

        $resolvedGroup = $group ?: $task->group;
        if (!$resolvedGroup) {
            throw ValidationException::withMessages([
                'group_id' => ['A task group is required before this task can be updated.'],
            ]);
        }

        $project = $this->resolveProjectForOrganization($user, $projectId, $resolvedGroup);
        if ($project instanceof JsonResponse) {
            return $project;
        }

        $oldStatus = $task->status;
        $oldPriority = $task->priority;
        $oldDueDate = $task->due_date?->toDateString();
        $oldTitle = $task->title;
        $oldAssignee = $task->assignee;

        $assignee = $this->resolveAssigneeForGroup($user, $resolvedGroup, $assigneeId);
        $oldAssigneeIds = $task->assignees()->pluck('users.id')->all();
        $assignees = $request->exists('assignee_ids')
            ? $this->resolveAssigneesForGroup($user, $resolvedGroup, $request->input('assignee_ids', []))
            : $task->assignees()->get();
        if ($assignee && !$assignees->contains('id', $assignee->id)) {
            $assignees->push($assignee);
        }

        $payload = $request->only(['title', 'description', 'status', 'priority', 'due_date', 'estimated_time', 'remind_at']);

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
        $newAssigneeIds = $assignees->pluck('id')->all();

        if ($request->exists('assignee_ids') || $request->exists('assignee_id') || $request->exists('group_id')) {
            $task->assignees()->sync($newAssigneeIds);
        }

        if ($request->exists('label_ids')) {
            $task->labels()->sync($request->input('label_ids', []));
        }

        // Log activities
        $this->taskActivityService->logStatusChanged($task, $user, $oldStatus, $task->status);
        $this->taskActivityService->logPriorityChanged($task, $user, $oldPriority, $task->priority);
        $this->taskActivityService->logDueDateChanged($task, $user, $oldDueDate, $task->due_date?->toDateString());
        $this->taskActivityService->logTitleChanged($task, $user, $oldTitle, $task->title);
        $this->taskActivityService->logAssigneeChanged($task, $user, $oldAssignee, $newAssigneeIds);

        // Notify new assignees
        $newAssigneeIds = collect($newAssigneeIds);
        $oldAssigneeSet = collect($oldAssigneeIds);
        $addedAssigneeIds = $newAssigneeIds->diff($oldAssigneeSet);
        if ($addedAssigneeIds->isNotEmpty()) {
            $addedAssignees = User::whereIn('id', $addedAssigneeIds)->get();
            $this->notifyAssignees($task, $user, $addedAssignees);
        }

        // Notify watchers about the update
        $this->notifyWatchers($task, $user, 'updated');

        return response()->json($task->fresh()->load(['group', 'project', 'assignee', 'assignees', 'labels']));
    }

    public function updateStatus(Request $request, Task $task)
    {
        if (!$this->canAccessTask($task)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $user = $request->user();
        if (!$this->groupAccessService->canManageTasks($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $request->validate([
            'status' => 'required|in:todo,in_progress,done',
        ]);

        $oldStatus = $task->status;
        $task->update(['status' => $request->status]);

        // Log activity
        $this->taskActivityService->logStatusChanged($task, $user, $oldStatus, $request->status);

        // Notify assignees and watchers
        $this->notifyAssignees($task, $user, collect([$task->assignee])->filter(), 'status_change');
        $this->notifyWatchers($task, $user, 'status_change');

        return response()->json($task->fresh()->load(['group', 'project', 'assignee', 'assignees']));
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

    public function activities(int $id)
    {
        $task = $this->findScopedTask($id);
        if (!$task) {
            return response()->json(['message' => 'Task not found'], 404);
        }

        return response()->json(
            $this->taskActivityService->getActivities($task)
        );
    }

    public function watch(Request $request, Task $task)
    {
        if (!$this->canAccessTask($task)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $user = $request->user();
        TaskWatcher::firstOrCreate([
            'task_id' => $task->id,
            'user_id' => $user->id,
        ]);

        $count = TaskWatcher::where('task_id', $task->id)->count();

        return response()->json([
            'message' => 'Now watching this task',
            'watching' => true,
            'watchers_count' => $count,
        ]);
    }

    public function unwatch(Request $request, Task $task)
    {
        if (!$this->canAccessTask($task)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $user = $request->user();
        TaskWatcher::where('task_id', $task->id)
            ->where('user_id', $user->id)
            ->delete();

        $count = TaskWatcher::where('task_id', $task->id)->count();

        return response()->json([
            'message' => 'No longer watching this task',
            'watching' => false,
            'watchers_count' => $count,
        ]);
    }

    public function watchStatus(Request $request, Task $task)
    {
        if (!$this->canAccessTask($task)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $user = $request->user();
        $isWatching = TaskWatcher::where('task_id', $task->id)
            ->where('user_id', $user->id)
            ->exists();

        $count = TaskWatcher::where('task_id', $task->id)->count();

        return response()->json([
            'watching' => $isWatching,
            'watchers_count' => $count,
        ]);
    }

    public function comments(int $id)
    {
        $task = $this->findScopedTask($id);
        if (!$task) return response()->json([]);

        return response()->json(
            $task->comments()->with('user')->latest()->get()
        );
    }

    public function storeComment(Request $request, int $id)
    {
        $task = $this->findScopedTask($id);
        if (!$task) return response()->json(['message' => 'Not found'], 404);

        $request->validate(['content' => 'required|string|max:5000']);

        $comment = $task->comments()->create([
            'user_id' => $request->user()->id,
            'content' => $request->content,
        ]);

        return response()->json($comment->load('user'), 201);
    }

    public function destroyComment(Request $request, TaskComment $comment)
    {
        $user = $request->user();
        if ($comment->user_id !== $user->id && !$this->groupAccessService->canManageTasks($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $comment->delete();
        return response()->json(['message' => 'Comment deleted']);
    }

    public function attachments(int $id)
    {
        $task = $this->findScopedTask($id);
        if (!$task) return response()->json([]);

        return response()->json(
            $task->attachments()->with('user')->latest()->get()
        );
    }

    public function storeAttachment(Request $request, int $id)
    {
        $task = $this->findScopedTask($id);
        if (!$task) return response()->json(['message' => 'Not found'], 404);

        $request->validate([
            'file' => 'required|file|max:10240',
        ]);

        $file = $request->file('file');
        $storedName = time() . '_' . $file->getClientOriginalName();
        $path = $file->storeAs('task_attachments/' . $task->id, $storedName, 'public');

        $attachment = $task->attachments()->create([
            'user_id' => $request->user()->id,
            'filename' => $path,
            'original_filename' => $file->getClientOriginalName(),
            'mime_type' => $file->getMimeType(),
            'file_size' => $file->getSize(),
        ]);

        return response()->json($attachment->load('user'), 201);
    }

    public function destroyAttachment(Request $request, TaskAttachment $attachment)
    {
        $user = $request->user();
        if ($attachment->user_id !== $user->id && !$this->groupAccessService->canManageTasks($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        \Illuminate\Support\Facades\Storage::disk('public')->delete($attachment->filename);
        $attachment->delete();

        return response()->json(['message' => 'Attachment deleted']);
    }

    public function addLabel(Request $request, Task $task)
    {
        if (!$this->canAccessTask($task)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $request->validate(['label_id' => 'required|exists:task_labels,id']);

        if ($task->labels()->where('task_label_id', $request->label_id)->exists()) {
            return response()->json(['message' => 'Label already attached'], 409);
        }

        $task->labels()->attach($request->label_id);

        return response()->json($task->fresh()->load('labels'), 201);
    }

    public function removeLabel(Request $request, Task $task, TaskLabel $label)
    {
        if (!$this->canAccessTask($task)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $task->labels()->detach($label->id);

        return response()->json($task->fresh()->load('labels'));
    }

    private function notifyAssignees(Task $task, User $sender, Collection $assignees, string $type = 'assignment'): void
    {
        if ($assignees->isEmpty()) {
            return;
        }

        $assigneeIds = $assignees
            ->pluck('id')
            ->filter(fn ($id) => (int) $id !== (int) $sender->id)
            ->values();

        if ($assigneeIds->isEmpty()) {
            return;
        }

        $projectName = $task->project?->name ?? 'Unnamed Project';

        $isCompleted = $task->status === 'done' && $type === 'status_change';
        $title = $isCompleted
            ? "Task completed: {$task->title}"
            : ($type === 'status_change'
                ? "Task status updated: {$task->title}"
                : "New task assigned: {$task->title}");

        $message = $isCompleted
            ? "{$sender->name} marked \"{$task->title}\" as done in {$projectName}"
            : ($type === 'status_change'
                ? "{$sender->name} changed status of \"{$task->title}\" to {$task->status} in {$projectName}"
                : "{$sender->name} assigned you to \"{$task->title}\" in {$projectName}");

        $notifType = $isCompleted ? 'task_completed' : 'task_assigned';

        $this->notificationService->sendToUsers(
            organizationId: (int) $task->group?->organization_id ?? (int) $sender->organization_id,
            userIds: $assigneeIds,
            senderId: (int) $sender->id,
            type: $notifType,
            title: $title,
            message: $message,
            meta: [
                'route' => "/tasks/{$task->id}",
                'task_id' => $task->id,
                'project_name' => $projectName,
                'status' => $task->status,
            ],
        );
    }

    private function notifyWatchers(Task $task, User $actor, string $type): void
    {
        $watcherIds = TaskWatcher::where('task_id', $task->id)
            ->where('user_id', '!=', $actor->id)
            ->pluck('user_id');

        if ($watcherIds->isEmpty()) {
            return;
        }

        $assigneeIds = $task->assignees()->pluck('users.id');
        $watcherIds = $watcherIds->diff($assigneeIds);

        if ($watcherIds->isEmpty()) {
            return;
        }

        $projectName = $task->project?->name ?? 'Unnamed Project';

        $this->notificationService->sendToUsers(
            organizationId: (int) $task->group?->organization_id ?? (int) $actor->organization_id,
            userIds: $watcherIds,
            senderId: (int) $actor->id,
            type: 'task_assigned',
            title: "Task updated: {$task->title}",
            message: "{$actor->name} updated \"{$task->title}\" in {$projectName}",
            meta: [
                'route' => "/tasks/{$task->id}",
                'task_id' => $task->id,
                'project_name' => $projectName,
                'status' => $task->status,
            ],
        );
    }

    public function checklistItems(int $id)
    {
        $task = $this->findScopedTask($id);
        if (!$task) return response()->json([]);
        return response()->json($task->checklistItems);
    }

    public function storeChecklistItem(Request $request, int $id)
    {
        $task = $this->findScopedTask($id);
        if (!$task) return response()->json(['message' => 'Not found'], 404);

        $request->validate(['title' => 'required|string|max:500']);

        $maxPos = $task->checklistItems()->max('position') ?? 0;
        $item = $task->checklistItems()->create([
            'title' => $request->title,
            'position' => $maxPos + 1,
        ]);

        return response()->json($item, 201);
    }

    public function updateChecklistItem(Request $request, TaskChecklistItem $item)
    {
        $task = $this->findScopedTask($item->task_id);
        if (!$task) return response()->json(['message' => 'Not found'], 404);

        $request->validate([
            'title' => 'nullable|string|max:500',
            'is_completed' => 'nullable|boolean',
            'position' => 'nullable|integer|min:0',
        ]);

        $item->update($request->only(['title', 'is_completed', 'position']));
        return response()->json($item);
    }

    public function destroyChecklistItem(TaskChecklistItem $item)
    {
        $task = $this->findScopedTask($item->task_id);
        if (!$task) return response()->json(['message' => 'Not found'], 404);

        $item->delete();
        return response()->json(['message' => 'Item deleted']);
    }

    public function dependencies(int $id)
    {
        $task = $this->findScopedTask($id);
        if (!$task) return response()->json([]);

        return response()->json(
            $task->dependencies()->with('dependsOnTask')->get()
        );
    }

    public function storeDependency(Request $request, int $id)
    {
        $task = $this->findScopedTask($id);
        if (!$task) return response()->json(['message' => 'Not found'], 404);

        $request->validate([
            'depends_on_task_id' => 'required|integer|exists:tasks,id',
        ]);

        $depId = (int) $request->depends_on_task_id;

        if ($depId === $task->id) {
            return response()->json(['message' => 'A task cannot depend on itself.'], 422);
        }

        if ($task->dependencies()->where('depends_on_task_id', $depId)->exists()) {
            return response()->json(['message' => 'Dependency already exists.'], 409);
        }

        $dep = $task->dependencies()->create(['depends_on_task_id' => $depId]);
        return response()->json($dep->load('dependsOnTask'), 201);
    }

    public function destroyDependency(TaskDependency $dependency)
    {
        $task = $this->findScopedTask($dependency->task_id);
        if (!$task) return response()->json(['message' => 'Not found'], 404);

        $dependency->delete();
        return response()->json(['message' => 'Dependency removed']);
    }

    public function storeRecurrence(Request $request, Task $task)
    {
        if (!$this->canAccessTask($task)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $request->validate([
            'frequency' => 'required|in:daily,weekly,monthly,yearly',
            'interval_value' => 'nullable|integer|min:1',
            'days_of_week' => 'nullable|array',
            'days_of_week.*' => 'integer|between:0,6',
            'day_of_month' => 'nullable|integer|between:1,31',
            'end_date' => 'nullable|date|after_or_equal:today',
        ]);

        $startDate = now()->addDay()->toDateString();

        $recurrence = TaskRecurrence::create([
            'task_id' => $task->id,
            'template_title' => $task->title,
            'template_description' => $task->description,
            'template_group_id' => $task->group_id,
            'template_project_id' => $task->project_id,
            'template_priority' => $task->priority ?? 'medium',
            'template_estimated_time' => $task->estimated_time,
            'template_assignee_ids' => $task->assignees->pluck('id')->toArray(),
            'template_label_ids' => $task->labels->pluck('id')->toArray(),
            'frequency' => $request->frequency,
            'interval_value' => $request->interval_value ?? 1,
            'days_of_week' => $request->days_of_week,
            'day_of_month' => $request->day_of_month,
            'start_date' => $startDate,
            'end_date' => $request->end_date,
            'next_run_date' => $startDate,
        ]);

        return response()->json($recurrence, 201);
    }

    public function updateRecurrence(Request $request, TaskRecurrence $recurrence)
    {
        $task = $this->findScopedTask($recurrence->task_id);
        if (!$task) return response()->json(['message' => 'Not found'], 404);

        $request->validate([
            'is_active' => 'nullable|boolean',
            'end_date' => 'nullable|date',
            'next_run_date' => 'nullable|date',
        ]);

        $recurrence->update($request->only(['is_active', 'end_date', 'next_run_date']));
        return response()->json($recurrence);
    }

    public function destroyRecurrence(TaskRecurrence $recurrence)
    {
        $task = $this->findScopedTask($recurrence->task_id);
        if (!$task) return response()->json(['message' => 'Not found'], 404);

        $recurrence->delete();
        return response()->json(['message' => 'Recurrence removed']);
    }

    public function getRecurrence(Task $task)
    {
        if (!$this->canAccessTask($task)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $recurrence = $task->recurrence()->first();
        return response()->json($recurrence);
    }

    public function updateReminder(Request $request, Task $task)
    {
        if (!$this->canAccessTask($task)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $request->validate(['remind_at' => 'nullable|date']);

        $task->update([
            'remind_at' => $request->remind_at,
            'reminded_at' => null,
        ]);

        return response()->json($task->fresh());
    }

    private function watchTask(Task $task, User $user): void
    {
        TaskWatcher::firstOrCreate([
            'task_id' => $task->id,
            'user_id' => $user->id,
        ]);
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
            ->with(['group', 'project', 'assignee', 'assignees'])
            ->where('id', $id)
            ->first();
    }

    private function scopedTasksQuery(User $user): Builder
    {
        $query = Task::query();
        $this->groupAccessService->applyTaskVisibilityScope($query, $user);
        if ($user->getHierarchyLevel() >= 100) {
            $assignedProjectIds = $this->assignedProjectIds($user);

            if (!empty($assignedProjectIds)) {
                $query->whereIn('project_id', $assignedProjectIds);
            }
        }

        return $query;
    }

    private function assignedProjectIds(User $user): array
    {
        try {
            return $user->assignedProjects()
                ->pluck('projects.id')
                ->map(fn ($id) => (int) $id)
                ->all();
        } catch (QueryException $exception) {
            if (str_contains(strtolower($exception->getMessage()), 'project_user')) {
                return [];
            }

            throw $exception;
        }
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

    private function resolveProjectForOrganization(User $user, ?int $projectId, ?Group $group = null): Project|JsonResponse|null
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

        if (!$project->group_id) {
            return response()->json(['message' => 'Selected project is not linked to any group.'], 422);
        }

        if ($group && (int) $project->group_id !== (int) $group->id) {
            return response()->json(['message' => 'Selected project does not belong to the selected group.'], 422);
        }

        $projectGroup = Group::query()
            ->where('organization_id', $user->organization_id)
            ->find((int) $project->group_id);

        if (!$projectGroup || !$this->groupAccessService->canManageGroup($user, $projectGroup)) {
            return response()->json(['message' => 'You cannot use this project with your current role.'], 403);
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

    private function resolveAssigneesForGroup(User $user, Group $group, array $assigneeIds): Collection
    {
        $cleanIds = collect($assigneeIds)
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->values();

        if ($cleanIds->isEmpty()) {
            return collect();
        }

        $assignees = User::query()
            ->where('organization_id', $user->organization_id)
            ->whereIn('id', $cleanIds)
            ->whereHas('groups', fn (Builder $builder) => $builder->where('groups.id', $group->id))
            ->get();

        if ($assignees->count() !== $cleanIds->count()) {
            throw ValidationException::withMessages([
                'assignee_ids' => ['Each assigned user must belong to the selected group.'],
            ]);
        }

        return $assignees;
    }
}
