<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PerformanceReview;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PerformanceReviewController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        
        $query = PerformanceReview::with(['employee:id,name', 'reviewer:id,name']);
        
        if (!$isAdmin) {
            $query->where(function ($q) use ($user) {
                $q->where('employee_id', $user->id)
                  ->orWhere('reviewer_id', $user->id);
            });
        }
        
        if ($request->has('employee_id') && $isAdmin) {
            $query->where('employee_id', $request->employee_id);
        }
        
        if ($request->has('review_type')) {
            $query->where('review_type', $request->review_type);
        }
        
        if ($request->has('status')) {
            $query->where('status', $request->status);
        }
        
        $reviews = $query->orderBy('review_period_end', 'desc')->get();
        
        return response()->json($reviews);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'employee_id' => 'required|integer|exists:users,id',
            'review_type' => 'required|string|in:self,manager,peer,360',
            'review_period_start' => 'required|date',
            'review_period_end' => 'required|date|after_or_equal:review_period_start',
            'overall_rating' => 'nullable|integer|min:1|max:5',
            'strengths' => 'nullable|array',
            'areas_for_improvement' => 'nullable|array',
            'goals' => 'nullable|array',
            'comments' => 'nullable|string',
            'is_confidential' => 'nullable|boolean',
        ]);

        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        
        // Check authorization based on review type
        if (!$isAdmin) {
            if ($request->review_type === 'self' && $user->id !== $request->employee_id) {
                return response()->json(['message' => 'Unauthorized. Can only create self-review for yourself.'], 403);
            }
            
            if ($request->review_type === 'manager') {
                $employee = \App\Models\User::findOrFail($request->employee_id);
                if ($employee->manager_id !== $user->id) {
                    return response()->json(['message' => 'Unauthorized. You are not the manager of this employee.'], 403);
                }
            }
        }

        // Check for existing review
        $existingReview = PerformanceReview::where('employee_id', $request->employee_id)
            ->where('reviewer_id', $user->id)
            ->where('review_type', $request->review_type)
            ->where('review_period_start', $request->review_period_start)
            ->where('review_period_end', $request->review_period_end)
            ->first();
            
        if ($existingReview) {
            return response()->json(['message' => 'Review already exists for this period.'], 409);
        }

        $review = PerformanceReview::create([
            'organization_id' => $user->organization_id,
            'employee_id' => $request->employee_id,
            'reviewer_id' => $user->id,
            'review_type' => $request->review_type,
            'review_period_start' => $request->review_period_start,
            'review_period_end' => $request->review_period_end,
            'overall_rating' => $request->overall_rating,
            'strengths' => $request->strengths,
            'areas_for_improvement' => $request->areas_for_improvement,
            'goals' => $request->goals,
            'comments' => $request->comments,
            'is_confidential' => $request->is_confidential ?? false,
            'status' => $request->overall_rating ? 'completed' : 'draft',
        ]);

        return response()->json([
            'message' => 'Performance review created successfully.',
            'review' => $review->load(['employee:id,name', 'reviewer:id,name']),
        ], 201);
    }

    public function show(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $review = PerformanceReview::with(['employee:id,name', 'reviewer:id,name'])->findOrFail($id);
        
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $isEmployee = $review->employee_id === $user->id;
        $isReviewer = $review->reviewer_id === $user->id;
        
        // Check confidentiality
        if ($review->is_confidential && !$isAdmin && !$isReviewer) {
            return response()->json(['message' => 'Unauthorized. This review is confidential.'], 403);
        }
        
        if (!$isAdmin && !$isEmployee && !$isReviewer) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        return response()->json($review);
    }

    public function update(int $id, Request $request): JsonResponse
    {
        $request->validate([
            'overall_rating' => 'nullable|integer|min:1|max:5',
            'strengths' => 'nullable|array',
            'areas_for_improvement' => 'nullable|array',
            'goals' => 'nullable|array',
            'comments' => 'nullable|string',
            'is_confidential' => 'nullable|boolean',
            'status' => 'nullable|string|in:draft,completed,archived',
        ]);

        $user = $request->user();
        $review = PerformanceReview::findOrFail($id);
        
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $isReviewer = $review->reviewer_id === $user->id;
        
        if (!$isAdmin && !$isReviewer) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $review->update($request->all());
        
        // Auto-update status if rating is provided
        if ($request->has('overall_rating') && $request->overall_rating) {
            $review->update(['status' => 'completed']);
        }

        return response()->json([
            'message' => 'Performance review updated successfully.',
            'review' => $review->fresh()->load(['employee:id,name', 'reviewer:id,name']),
        ]);
    }

    public function destroy(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $review = PerformanceReview::findOrFail($id);
        
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $isReviewer = $review->reviewer_id === $user->id;
        
        if (!$isAdmin && !$isReviewer) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $review->delete();

        return response()->json(['message' => 'Performance review deleted successfully.']);
    }

    public function getEmployeeReviews(int $employeeId, Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        
        if (!$isAdmin && $user->id !== $employeeId) {
            // Check if user is manager
            $employee = \App\Models\User::findOrFail($employeeId);
            if ($employee->manager_id !== $user->id) {
                return response()->json(['message' => 'Unauthorized.'], 403);
            }
        }

        $reviews = PerformanceReview::with(['reviewer:id,name'])
            ->where('employee_id', $employeeId)
            ->orderBy('review_period_end', 'desc')
            ->get();

        return response()->json($reviews);
    }

    public function getSummary(Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        
        $query = PerformanceReview::query();
        
        if (!$isAdmin) {
            $query->where('employee_id', $user->id);
        } elseif ($request->has('employee_id')) {
            $query->where('employee_id', $request->employee_id);
        }
        
        $totalReviews = $query->count();
        $completedReviews = (clone $query)->where('status', 'completed')->count();
        $averageRating = (clone $query)->whereNotNull('overall_rating')->avg('overall_rating');
        
        // Get reviews by type
        $reviewsByType = (clone $query)
            ->selectRaw('review_type, COUNT(*) as count, AVG(overall_rating) as avg_rating')
            ->whereNotNull('overall_rating')
            ->groupBy('review_type')
            ->get();

        return response()->json([
            'total_reviews' => $totalReviews,
            'completed_reviews' => $completedReviews,
            'average_rating' => round($averageRating, 2),
            'reviews_by_type' => $reviewsByType,
        ]);
    }
}
