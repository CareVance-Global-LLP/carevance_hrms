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
        
        $query = PerformanceGoal::with(['employee:id,name', 'manager:id,name']);
        
        if (!$isAdmin) {
            $query->where(function ($q) use ($user) {
                $q->where('employee_id', $user->id)
                  ->orWhere('manager_id', $user->id);
            });
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
            'employee_id' => 'required|integer|exists:users,id',
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
        
        // Only admin or manager can create goals for others
        if (!$isAdmin && $user->id !== $request->employee_id) {
            // Check if user is manager of the employee
            $employee = \App\Models\User::findOrFail($request->employee_id);
            if ($employee->manager_id !== $user->id) {
                return response()->json(['message' => 'Unauthorized.'], 403);
            }
        }

        $goal = PerformanceGoal::create([
            'organization_id' => $user->organization_id,
            'employee_id' => $request->employee_id,
            'manager_id' => $user->id,
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
            'goal' => $goal->load(['employee:id,name', 'manager:id,name']),
        ], 201);
    }

    public function show(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $goal = PerformanceGoal::with(['employee:id,name', 'manager:id,name', 'reviews'])->findOrFail($id);
        
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $isEmployee = $goal->employee_id === $user->id;
        $isManager = $goal->manager_id === $user->id;
        
        if (!$isAdmin && !$isEmployee && !$isManager) {
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
        ]);

        $user = $request->user();
        $goal = PerformanceGoal::findOrFail($id);
        
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $isManager = $goal->manager_id === $user->id;
        $isEmployee = $goal->employee_id === $user->id;

        // Only admin or manager can update most fields
        // Employee can only update progress
        if (!$isAdmin && !$isManager) {
            if ($isEmployee) {
                // Employee can only update progress
                $allowedFields = ['progress_percentage'];
                $requestData = $request->only($allowedFields);
            } else {
                return response()->json(['message' => 'Unauthorized.'], 403);
            }
        } else {
            $requestData = $request->all();
        }

        $goal->update($requestData);

        return response()->json([
            'message' => 'Performance goal updated successfully.',
            'goal' => $goal->fresh()->load(['employee:id,name', 'manager:id,name']),
        ]);
    }

    public function destroy(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $goal = PerformanceGoal::findOrFail($id);
        
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $isManager = $goal->manager_id === $user->id;
        
        if (!$isAdmin && !$isManager) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $goal->delete();

        return response()->json(['message' => 'Performance goal deleted successfully.']);
    }
}
