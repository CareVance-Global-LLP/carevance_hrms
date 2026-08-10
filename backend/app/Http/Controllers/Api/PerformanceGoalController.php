<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PerformanceGoal;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PerformanceGoalController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        
        $query = PerformanceGoal::with(['employee:id,name', 'manager:id,name', 'group:id,name', 'parent:id,title,scope'])
            ->where('organization_id', $user->organization_id);

        if (!$isAdmin) {
            // Team and company goals are org-visible; individual goals only to those involved
            $query->where(function ($q) use ($user) {
                $q->where('employee_id', $user->id)
                  ->orWhere('manager_id', $user->id)
                  ->orWhereIn('scope', ['team', 'company']);
            });
        }

        if ($request->has('scope')) {
            $query->where('scope', $request->scope);
        }
        
        if ($request->has('employee_id') && $isAdmin) {
            $query->where('employee_id', $request->employee_id);
        }
        
        if ($request->has('status')) {
            $query->where('status', $request->status);
        }
        
        $goals = $query->orderBy('created_at', 'desc')->get();
        
        return response()->json($goals);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'scope' => 'nullable|string|in:individual,team,company',
            'employee_id' => 'nullable|integer|exists:users,id',
            'group_id' => 'nullable|integer|exists:groups,id',
            'parent_goal_id' => 'nullable|integer|exists:performance_goals,id',
            'title' => 'required|string|max:255',
            'description' => 'nullable|string',
            'category' => 'required|string|in:development,performance,behavior,project',
            'start_date' => 'required|date',
            'end_date' => 'required|date|after_or_equal:start_date',
            'target_metrics' => 'nullable|array',
            'weight' => 'nullable|integer|min:1|max:100',
        ]);

        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $scope = $request->input('scope', 'individual');

        if ($scope === 'individual') {
            if (!$request->filled('employee_id')) {
                return response()->json(['message' => 'An individual goal needs an employee.'], 422);
            }

            $employee = \App\Models\User::findOrFail($request->employee_id);
            if ($employee->organization_id !== $user->organization_id) {
                return response()->json(['message' => 'Unauthorized.'], 403);
            }

            // Only admin or the reporting manager can create goals for others
            // (the reporting line lives on employee_work_infos, not users.manager_id)
            $reportingManagerId = \App\Models\EmployeeWorkInfo::where('user_id', $employee->id)->value('reporting_manager_id');
            if (!$isAdmin && $user->id !== $request->employee_id && $reportingManagerId !== $user->id) {
                return response()->json(['message' => 'Unauthorized.'], 403);
            }
        } else {
            // Company goals: admins. Team goals: admins and managers.
            $isManager = $user->role === 'manager';
            if ($scope === 'company' && !$isAdmin) {
                return response()->json(['message' => 'Only admins can create company goals.'], 403);
            }
            if ($scope === 'team' && !$isAdmin && !$isManager) {
                return response()->json(['message' => 'Only admins and managers can create team goals.'], 403);
            }
            if ($scope === 'team' && !$request->filled('group_id')) {
                return response()->json(['message' => 'A team goal needs a department.'], 422);
            }
        }

        if ($request->filled('group_id')) {
            $group = \App\Models\Group::find($request->group_id);
            if (!$group || $group->organization_id !== $user->organization_id) {
                return response()->json(['message' => 'Unknown department.'], 422);
            }
        }

        if ($request->filled('parent_goal_id')) {
            $parent = PerformanceGoal::find($request->parent_goal_id);
            if (!$parent || $parent->organization_id !== $user->organization_id) {
                return response()->json(['message' => 'Unknown parent goal.'], 422);
            }
        }

        $goal = PerformanceGoal::create([
            'organization_id' => $user->organization_id,
            'employee_id' => $scope === 'individual' ? $request->employee_id : null,
            'manager_id' => $user->id,
            'scope' => $scope,
            'parent_goal_id' => $request->parent_goal_id,
            'group_id' => $scope === 'individual' ? null : $request->group_id,
            'title' => $request->title,
            'description' => $request->description,
            'category' => $request->category,
            'start_date' => $request->start_date,
            'end_date' => $request->end_date,
            'target_metrics' => $request->target_metrics,
            'weight' => $request->weight ?? 100,
            'status' => 'active',
        ]);

        return response()->json([
            'message' => 'Performance goal created successfully.',
            'goal' => $goal->load(['employee:id,name', 'manager:id,name', 'group:id,name', 'parent:id,title,scope']),
        ], 201);
    }

    public function show(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $goal = PerformanceGoal::with(['employee:id,name', 'manager:id,name', 'reviews', 'group:id,name', 'parent:id,title,scope', 'children:id,title,scope,parent_goal_id,progress_percentage'])
            ->where('organization_id', $user->organization_id)
            ->findOrFail($id);
        
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $isEmployee = $goal->employee_id === $user->id;
        $isManager = $goal->manager_id === $user->id;

        // Team and company goals are visible to the whole organization
        if (!$isAdmin && !$isEmployee && !$isManager && $goal->scope === 'individual') {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        return response()->json($goal);
    }

    public function update(int $id, Request $request): JsonResponse
    {
        $request->validate([
            'title' => 'nullable|string|max:255',
            'description' => 'nullable|string',
            'category' => 'nullable|string|in:development,performance,behavior,project',
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date|after_or_equal:start_date',
            'target_metrics' => 'nullable|array',
            'weight' => 'nullable|integer|min:1|max:100',
            'status' => 'nullable|string|in:active,completed,cancelled',
            'progress_percentage' => 'nullable|integer|min:0|max:100',
            'parent_goal_id' => 'nullable|integer|exists:performance_goals,id',
        ]);

        $user = $request->user();
        $goal = PerformanceGoal::where('organization_id', $user->organization_id)->findOrFail($id);

        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $isManager = $goal->manager_id === $user->id;
        $isEmployee = $goal->employee_id === $user->id;

        // Only admin or manager can update most fields
        // Employee can only update progress
        if (!$isAdmin && !$isManager) {
            if ($isEmployee) {
                // Employee can only update progress
                $requestData = $request->only(['progress_percentage']);
            } else {
                return response()->json(['message' => 'Unauthorized.'], 403);
            }
        } else {
            if ($request->filled('parent_goal_id')) {
                $parent = PerformanceGoal::find($request->parent_goal_id);
                if (!$parent || $parent->organization_id !== $user->organization_id || $parent->id === $goal->id) {
                    return response()->json(['message' => 'Unknown parent goal.'], 422);
                }
            }

            $requestData = $request->only([
                'title',
                'description',
                'category',
                'start_date',
                'end_date',
                'target_metrics',
                'weight',
                'status',
                'progress_percentage',
                'parent_goal_id',
            ]);
        }

        $goal->update($requestData);

        return response()->json([
            'message' => 'Performance goal updated successfully.',
            'goal' => $goal->fresh()->load(['employee:id,name', 'manager:id,name', 'group:id,name', 'parent:id,title,scope']),
        ]);
    }

    public function destroy(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $goal = PerformanceGoal::where('organization_id', $user->organization_id)->findOrFail($id);

        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $isManager = $goal->manager_id === $user->id;

        if (!$isAdmin && !$isManager) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $goal->delete();

        return response()->json(['message' => 'Performance goal deleted successfully.']);
    }
}
