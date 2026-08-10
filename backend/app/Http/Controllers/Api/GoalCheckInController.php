<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\GoalCheckIn;
use App\Models\PerformanceGoal;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GoalCheckInController extends Controller
{
    private function findVisibleGoal(int $goalId, Request $request): ?PerformanceGoal
    {
        $user = $request->user();
        $goal = PerformanceGoal::where('organization_id', $user->organization_id)->find($goalId);
        if (! $goal) {
            return null;
        }

        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $involved = $goal->employee_id === $user->id || $goal->manager_id === $user->id;

        // Team and company goals are visible to the whole organization
        if (! $isAdmin && ! $involved && $goal->scope === 'individual') {
            return null;
        }

        return $goal;
    }

    public function index(int $goalId, Request $request): JsonResponse
    {
        $goal = $this->findVisibleGoal($goalId, $request);
        if (! $goal) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $checkIns = GoalCheckIn::with('user:id,name')
            ->where('goal_id', $goal->id)
            ->orderByDesc('created_at')
            ->limit(50)
            ->get();

        return response()->json($checkIns);
    }

    public function store(int $goalId, Request $request): JsonResponse
    {
        $user = $request->user();
        $goal = $this->findVisibleGoal($goalId, $request);
        if (! $goal) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $canUpdate = $isAdmin || $goal->manager_id === $user->id || $goal->employee_id === $user->id;
        if (! $canUpdate) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $data = $request->validate([
            'progress_percentage' => 'required|integer|min:0|max:100',
            'note' => 'nullable|string|max:2000',
        ]);

        $checkIn = GoalCheckIn::create([
            'goal_id' => $goal->id,
            'user_id' => $user->id,
            'progress_percentage' => $data['progress_percentage'],
            'note' => $data['note'] ?? null,
        ]);

        // A check-in IS the progress update
        $goal->update(['progress_percentage' => $data['progress_percentage']]);

        return response()->json([
            'message' => 'Check-in recorded.',
            'check_in' => $checkIn->load('user:id,name'),
            'goal' => $goal->fresh()->load(['employee:id,name', 'manager:id,name']),
        ], 201);
    }
}
