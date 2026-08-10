<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Competency;
use App\Models\PerformanceReview;
use App\Models\ReviewCycle;
use App\Models\ReviewCycleParticipant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PerformanceReviewController extends Controller
{
    private const RELATIONS = [
        'employee:id,name',
        'reviewer:id,name',
        'competencyRatings.competency:id,name',
        'cycle:id,name,anonymize_peer',
    ];

    /** The reporting line lives on employee_work_infos, not users.manager_id. */
    private function reportingManagerId(int $employeeId): ?int
    {
        return \App\Models\EmployeeWorkInfo::where('user_id', $employeeId)->value('reporting_manager_id');
    }

    /**
     * Peer/360 reviewers stay anonymous to everyone except admins and the
     * author, unless the review's cycle explicitly disabled anonymity.
     */
    private function anonymize(PerformanceReview $review, $user): void
    {
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $anonymityOn = $review->cycle->anonymize_peer ?? true;

        if (
            $anonymityOn
            && ! $isAdmin
            && $review->reviewer_id !== $user->id
            && in_array($review->review_type, ['peer', '360'], true)
        ) {
            $review->setRelation('reviewer', null);
            $review->setAttribute('reviewer_id', null);
        }
    }

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';

        $query = PerformanceReview::with(self::RELATIONS)
            ->where('organization_id', $user->organization_id);

        if (!$isAdmin) {
            $query->where(function ($q) use ($user) {
                $q->where('employee_id', $user->id)
                  ->orWhere('reviewer_id', $user->id);
            });
            // Confidential reviews are hidden from the employee they are about
            $query->where(function ($q) use ($user) {
                $q->where('is_confidential', false)
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
        $reviews->each(fn ($review) => $this->anonymize($review, $user));

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
            'review_cycle_id' => 'nullable|integer|exists:review_cycles,id',
            'competency_ratings' => 'nullable|array',
            'competency_ratings.*.competency_id' => 'required|integer|exists:competencies,id',
            'competency_ratings.*.rating' => 'required|integer|min:1|max:5',
            'competency_ratings.*.comment' => 'nullable|string|max:1000',
        ]);

        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';

        if ($request->filled('review_cycle_id')) {
            $cycle = ReviewCycle::where('organization_id', $user->organization_id)->find($request->review_cycle_id);
            if (! $cycle) {
                return response()->json(['message' => 'Unknown review cycle.'], 422);
            }
        }

        if ($invalid = $this->invalidCompetencyIds($request, $user)) {
            return response()->json(['message' => 'Unknown competency: '.implode(', ', $invalid)], 422);
        }
        
        $employee = \App\Models\User::findOrFail($request->employee_id);
        if ($employee->organization_id !== $user->organization_id) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        // Check authorization based on review type
        if (!$isAdmin) {
            if ($request->review_type === 'self' && $user->id !== $request->employee_id) {
                return response()->json(['message' => 'Unauthorized. Can only create self-review for yourself.'], 403);
            }

            if ($request->review_type === 'manager' && $this->reportingManagerId($employee->id) !== $user->id) {
                return response()->json(['message' => 'Unauthorized. You are not the manager of this employee.'], 403);
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
            'review_cycle_id' => $request->review_cycle_id,
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

        $this->syncCompetencyRatings($review, $request->input('competency_ratings'));
        $this->linkCycleParticipant($review);

        return response()->json([
            'message' => 'Performance review created successfully.',
            'review' => $review->load(self::RELATIONS),
        ], 201);
    }

    public function show(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $review = PerformanceReview::with(self::RELATIONS)
            ->where('organization_id', $user->organization_id)
            ->findOrFail($id);

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

        $this->anonymize($review, $user);

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
            'competency_ratings' => 'nullable|array',
            'competency_ratings.*.competency_id' => 'required|integer|exists:competencies,id',
            'competency_ratings.*.rating' => 'required|integer|min:1|max:5',
            'competency_ratings.*.comment' => 'nullable|string|max:1000',
        ]);

        $user = $request->user();
        $review = PerformanceReview::where('organization_id', $user->organization_id)->findOrFail($id);

        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $isReviewer = $review->reviewer_id === $user->id;

        if (!$isAdmin && !$isReviewer) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        if ($invalid = $this->invalidCompetencyIds($request, $user)) {
            return response()->json(['message' => 'Unknown competency: '.implode(', ', $invalid)], 422);
        }

        $review->update($request->only([
            'overall_rating',
            'strengths',
            'areas_for_improvement',
            'goals',
            'comments',
            'is_confidential',
            'status',
        ]));

        if ($request->has('competency_ratings')) {
            $this->syncCompetencyRatings($review, $request->input('competency_ratings'));
        }

        // Auto-update status if rating is provided
        if ($request->has('overall_rating') && $request->overall_rating) {
            $review->update(['status' => 'completed']);
        }

        return response()->json([
            'message' => 'Performance review updated successfully.',
            'review' => $review->fresh()->load(self::RELATIONS),
        ]);
    }

    public function destroy(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $review = PerformanceReview::where('organization_id', $user->organization_id)->findOrFail($id);

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
        
        $employee = \App\Models\User::findOrFail($employeeId);
        if ($employee->organization_id !== $user->organization_id) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        if (!$isAdmin && $user->id !== $employeeId && $this->reportingManagerId($employeeId) !== $user->id) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $query = PerformanceReview::with(['reviewer:id,name'])
            ->where('organization_id', $user->organization_id)
            ->where('employee_id', $employeeId);

        // Confidential reviews stay hidden from the employee they are about
        if (!$isAdmin && $user->id === $employeeId) {
            $query->where(function ($q) use ($user) {
                $q->where('is_confidential', false)
                  ->orWhere('reviewer_id', $user->id);
            });
        }

        $reviews = $query->orderBy('review_period_end', 'desc')->get();

        return response()->json($reviews);
    }

    public function getSummary(Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        
        $query = PerformanceReview::where('organization_id', $user->organization_id);

        if (!$isAdmin) {
            $query->where('employee_id', $user->id);
            // Keep the summary consistent with what the employee can actually see
            $query->where(function ($q) use ($user) {
                $q->where('is_confidential', false)
                  ->orWhere('reviewer_id', $user->id);
            });
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

    /**
     * Aggregated 360° feedback: every completed peer/360 review for an
     * employee over a period, averaged overall and per competency, with
     * reviewer names stripped according to the anonymity rules.
     */
    public function aggregate360(Request $request): JsonResponse
    {
        $request->validate([
            'employee_id' => 'required|integer|exists:users,id',
            'period_start' => 'required|date',
            'period_end' => 'required|date|after_or_equal:period_start',
        ]);

        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        $employee = \App\Models\User::findOrFail($request->employee_id);

        if ($employee->organization_id !== $user->organization_id) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }
        if (!$isAdmin && $user->id !== $employee->id && $this->reportingManagerId($employee->id) !== $user->id) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $reviews = PerformanceReview::with(['competencyRatings.competency:id,name', 'reviewer:id,name', 'cycle:id,anonymize_peer'])
            ->where('organization_id', $user->organization_id)
            ->where('employee_id', $employee->id)
            ->whereIn('review_type', ['peer', '360'])
            ->where('status', 'completed')
            ->whereDate('review_period_start', '<=', $request->period_end)
            ->whereDate('review_period_end', '>=', $request->period_start)
            ->get();

        $rated = $reviews->whereNotNull('overall_rating');

        $competencies = [];
        foreach ($reviews as $review) {
            foreach ($review->competencyRatings as $rating) {
                $key = $rating->competency_id;
                $competencies[$key] ??= [
                    'competency_id' => $key,
                    'name' => $rating->competency->name ?? 'Unknown',
                    'sum' => 0,
                    'count' => 0,
                ];
                $competencies[$key]['sum'] += $rating->rating;
                $competencies[$key]['count']++;
            }
        }
        $competencies = array_values(array_map(fn ($c) => [
            'competency_id' => $c['competency_id'],
            'name' => $c['name'],
            'avg' => round($c['sum'] / max($c['count'], 1), 1),
            'count' => $c['count'],
        ], $competencies));

        $comments = $reviews
            ->filter(fn ($review) => filled($review->comments))
            ->map(function ($review) use ($user, $isAdmin) {
                $anonymityOn = $review->cycle->anonymize_peer ?? true;
                $showName = !$anonymityOn || $isAdmin || $review->reviewer_id === $user->id;

                return [
                    'review_type' => $review->review_type,
                    'comment' => $review->comments,
                    'reviewer_name' => $showName ? ($review->reviewer->name ?? null) : null,
                ];
            })
            ->values();

        return response()->json([
            'reviewer_count' => $reviews->pluck('reviewer_id')->unique()->count(),
            'review_count' => $reviews->count(),
            'average_rating' => $rated->count() ? round($rated->avg('overall_rating'), 1) : null,
            'competencies' => $competencies,
            'comments' => $comments,
        ]);
    }

    /** Competency ids in the payload that don't belong to the caller's org. */
    private function invalidCompetencyIds(Request $request, $user): array
    {
        $ids = collect($request->input('competency_ratings', []))->pluck('competency_id')->unique();
        if ($ids->isEmpty()) {
            return [];
        }

        $known = Competency::where('organization_id', $user->organization_id)
            ->whereIn('id', $ids)
            ->pluck('id');

        return $ids->diff($known)->values()->all();
    }

    /** Replace the review's competency ratings with the given set. */
    private function syncCompetencyRatings(PerformanceReview $review, ?array $ratings): void
    {
        if ($ratings === null) {
            return;
        }

        $review->competencyRatings()->delete();
        foreach ($ratings as $rating) {
            $review->competencyRatings()->create([
                'competency_id' => $rating['competency_id'],
                'rating' => $rating['rating'],
                'comment' => $rating['comment'] ?? null,
            ]);
        }
    }

    /** Record a cycle-bound self/manager review on the employee's participant row. */
    private function linkCycleParticipant(PerformanceReview $review): void
    {
        if (!$review->review_cycle_id || !in_array($review->review_type, ['self', 'manager'], true)) {
            return;
        }

        $participant = ReviewCycleParticipant::where('review_cycle_id', $review->review_cycle_id)
            ->where('employee_id', $review->employee_id)
            ->first();
        if (!$participant) {
            return;
        }

        $column = $review->review_type === 'self' ? 'self_review_id' : 'manager_review_id';
        if (!$participant->$column) {
            $participant->update([$column => $review->id]);
        }
    }
}
