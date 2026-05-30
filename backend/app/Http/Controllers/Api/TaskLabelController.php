<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TaskLabel;
use App\Services\Authorization\GroupAccessService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TaskLabelController extends Controller
{
    public function __construct(
        private readonly GroupAccessService $groupAccessService,
    ) {
    }

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json([]);
        }

        return response()->json(
            TaskLabel::query()
                ->where('organization_id', $user->organization_id)
                ->orderBy('name')
                ->get()
        );
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if (!$this->groupAccessService->canManageTasks($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $request->validate([
            'name' => 'required|string|max:100',
            'color' => 'nullable|string|max:7',
        ]);

        $exists = TaskLabel::query()
            ->where('organization_id', $user->organization_id)
            ->where('name', $request->name)
            ->exists();

        if ($exists) {
            return response()->json(['message' => 'A label with this name already exists.'], 409);
        }

        $label = TaskLabel::create([
            'organization_id' => $user->organization_id,
            'name' => $request->name,
            'color' => $request->color ?? '#6366f1',
        ]);

        return response()->json($label, 201);
    }

    public function destroy(Request $request, TaskLabel $taskLabel)
    {
        $user = $request->user();
        if (!$this->groupAccessService->canManageTasks($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $taskLabel->delete();
        return response()->json(['message' => 'Label deleted']);
    }
}
