<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activity;
use App\Models\Project;
use App\Models\User;
use App\Services\Authorization\GroupAccessService;
use App\Services\Reports\TimeBreakdownService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class ProjectController extends Controller
{
    public function __construct(
        private readonly GroupAccessService $groupAccessService,
        private readonly TimeBreakdownService $timeBreakdownService,
    ) {
    }

    public function index()
    {
        $user = request()->user();
        if (!$user || !$user->organization_id) {
            return response()->json([]);
        }

        $projects = Project::with('tasks')
            ->where('organization_id', $user->organization_id)
            ->when($this->hasRestrictedAssignedProjects($user), function (Builder $query) use ($user) {
                $query->whereIn('id', $this->assignedProjectIds($user));
            })
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json($projects);
    }

    public function store(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'budget' => 'nullable|numeric',
            'deadline' => 'nullable|date',
            'status' => 'nullable|in:active,completed,archived',
        ]);

        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        $project = Project::create([
            'name' => $request->name,
            'description' => $request->description,
            'budget' => $request->budget,
            'deadline' => $request->deadline,
            'status' => $request->status ?? 'active',
            'organization_id' => $user->organization_id,
        ]);

        return response()->json($project, 201);
    }

    public function show(Project $project)
    {
        if (!$this->canAccessProject($project)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $user = request()->user();
        $taskQuery = $project->tasks()->with(['group', 'assignee'])->orderBy('created_at', 'desc');
        if ($user) {
            $this->groupAccessService->applyTaskVisibilityScope($taskQuery, $user);
        }

        $project->load('timeEntries');
        $project->setRelation('tasks', $taskQuery->get());

        return response()->json($project);
    }

    public function update(Request $request, Project $project)
    {
        if (!$this->canAccessProject($project)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $request->validate([
            'name' => 'sometimes|string|max:255',
            'description' => 'nullable|string',
            'budget' => 'nullable|numeric',
            'deadline' => 'nullable|date',
            'status' => 'nullable|in:active,completed,archived',
        ]);

        $project->update($request->only(['name', 'description', 'budget', 'deadline', 'status']));

        return response()->json($project);
    }

    public function destroy(Project $project)
    {
        if (!$this->canAccessProject($project)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $project->delete();

        return response()->json(['message' => 'Project deleted']);
    }

    public function timeEntries(int $id, Request $request)
    {
        $project = $this->findScopedProject($id);
        if (!$project) {
            return response()->json(['message' => 'Project not found'], 404);
        }

        $timeEntries = $project->timeEntries()
            ->with('task', 'user')
            ->when($request->start_date, fn (Builder $q, string $start) => $q->whereDate('start_time', '>=', $start))
            ->when($request->end_date, fn (Builder $q, string $end) => $q->whereDate('start_time', '<=', $end))
            ->orderBy('start_time', 'desc')
            ->get();

        return response()->json($timeEntries);
    }

    public function tasks(int $id, Request $request)
    {
        $project = $this->findScopedProject($id);
        if (!$project) {
            return response()->json(['message' => 'Project not found'], 404);
        }

        $user = $request->user();
        $tasks = $project->tasks()
            ->with(['group', 'assignee'])
            ->when($request->status, fn (Builder $q, string $status) => $q->where('status', $status))
            ->when($user, fn (Builder $query) => $this->groupAccessService->applyTaskVisibilityScope($query, $user))
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json($tasks);
    }

    public function stats(int $id, Request $request)
    {
        $project = $this->findScopedProject($id);
        if (!$project) {
            return response()->json(['message' => 'Project not found'], 404);
        }

        $timeEntries = $project->timeEntries()
            ->when($request->start_date, fn (Builder $q, string $start) => $q->whereDate('start_time', '>=', $start))
            ->when($request->end_date, fn (Builder $q, string $end) => $q->whereDate('start_time', '<=', $end))
            ->get();

        $totalDuration = (int) $timeEntries->sum('duration');
        $idleDuration = $timeEntries->isEmpty()
            ? 0
            : (int) Activity::query()
                ->whereIn('time_entry_id', $timeEntries->pluck('id'))
                ->where('type', 'idle')
                ->sum('duration');
        $timeBreakdown = $this->timeBreakdownService->build($totalDuration, $idleDuration);
        $user = $request->user();
        $tasksQuery = $project->tasks();
        if ($user) {
            $this->groupAccessService->applyTaskVisibilityScope($tasksQuery, $user);
        }

        return response()->json([
            'project_id' => $project->id,
            'entries_count' => $timeEntries->count(),
            'tasks_count' => (clone $tasksQuery)->count(),
            'completed_tasks' => (clone $tasksQuery)->where('status', 'done')->count(),
            'total_hours' => round($totalDuration / 3600, 2),
        ] + $timeBreakdown);
    }

    private function canAccessProject(Project $project): bool
    {
        $user = request()->user();
        if (!$user || $user->organization_id !== $project->organization_id) {
            return false;
        }

        if (!$this->hasRestrictedAssignedProjects($user)) {
            return true;
        }

        return in_array((int) $project->id, $this->assignedProjectIds($user), true);
    }

    private function findScopedProject(int $id): ?Project
    {
        $user = request()->user();
        if (!$user || !$user->organization_id) {
            return null;
        }

        return Project::where('organization_id', $user->organization_id)
            ->when($this->hasRestrictedAssignedProjects($user), function (Builder $query) use ($user) {
                $query->whereIn('id', $this->assignedProjectIds($user));
            })
            ->where('id', $id)
            ->first();
    }

    private function assignedProjectIds(User $user): array
    {
        return $user->assignedProjects()
            ->pluck('projects.id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    private function hasRestrictedAssignedProjects(User $user): bool
    {
        return $user->role === 'employee' && !empty($this->assignedProjectIds($user));
    }
}
