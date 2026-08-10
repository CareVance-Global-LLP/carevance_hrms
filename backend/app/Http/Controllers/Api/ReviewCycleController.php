<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ReviewCycle;
use App\Models\ReviewCycleParticipant;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReviewCycleController extends Controller
{
    /** Phases advance strictly forward through this order. */
    private const PHASE_ORDER = ['draft', 'self', 'manager', 'shared', 'closed'];

    private function isAdmin(Request $request): bool
    {
        $role = $request->user()->role;

        return $role === 'admin' || $role === 'super_admin';
    }

    public function index(Request $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $cycles = ReviewCycle::withCount('participants')
            ->where('organization_id', $request->user()->organization_id)
            ->orderByDesc('period_end')
            ->get();

        return response()->json($cycles);
    }

    public function store(Request $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $data = $request->validate([
            'name' => 'required|string|max:255',
            'period_start' => 'required|date',
            'period_end' => 'required|date|after_or_equal:period_start',
            'self_due' => 'nullable|date',
            'manager_due' => 'nullable|date',
            'share_date' => 'nullable|date',
            'anonymize_peer' => 'nullable|boolean',
        ]);

        $cycle = ReviewCycle::create([
            ...$data,
            'organization_id' => $request->user()->organization_id,
            'phase' => 'draft',
            'anonymize_peer' => $data['anonymize_peer'] ?? true,
        ]);

        return response()->json([
            'message' => 'Review cycle created.',
            'cycle' => $cycle->loadCount('participants'),
        ], 201);
    }

    public function show(int $id, Request $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $cycle = ReviewCycle::where('organization_id', $request->user()->organization_id)->findOrFail($id);

        return response()->json([
            'cycle' => $cycle,
            'stats' => $this->cycleStats($cycle),
        ]);
    }

    public function update(int $id, Request $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $cycle = ReviewCycle::where('organization_id', $request->user()->organization_id)->findOrFail($id);

        $data = $request->validate([
            'name' => 'nullable|string|max:255',
            'period_start' => 'nullable|date',
            'period_end' => 'nullable|date',
            'self_due' => 'nullable|date',
            'manager_due' => 'nullable|date',
            'share_date' => 'nullable|date',
            'anonymize_peer' => 'nullable|boolean',
            'phase' => 'nullable|string|in:draft,self,manager,shared,closed',
        ]);

        if (isset($data['phase']) && $data['phase'] !== $cycle->phase) {
            $from = array_search($cycle->phase, self::PHASE_ORDER, true);
            $to = array_search($data['phase'], self::PHASE_ORDER, true);
            if ($to !== $from + 1) {
                return response()->json([
                    'message' => "A cycle can only advance one phase at a time (currently '{$cycle->phase}').",
                ], 422);
            }

            if ($data['phase'] === 'self') {
                $this->enrollParticipants($cycle);
            }

            if ($data['phase'] === 'shared') {
                $cycle->participants()->whereNull('shared_at')->update(['shared_at' => now()]);
            }
        }

        $cycle->update(array_filter($data, fn ($value) => $value !== null));

        return response()->json([
            'message' => 'Review cycle updated.',
            'cycle' => $cycle->fresh()->loadCount('participants'),
        ]);
    }

    public function destroy(int $id, Request $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $cycle = ReviewCycle::where('organization_id', $request->user()->organization_id)->findOrFail($id);

        if ($cycle->phase !== 'draft') {
            return response()->json(['message' => 'Only draft cycles can be deleted.'], 422);
        }

        $cycle->delete();

        return response()->json(['message' => 'Review cycle deleted.']);
    }

    /**
     * The banner endpoint: the org's current non-closed cycle plus the
     * calling user's own participant state. Available to everyone.
     */
    public function active(Request $request): JsonResponse
    {
        $user = $request->user();

        $cycle = ReviewCycle::where('organization_id', $user->organization_id)
            ->whereIn('phase', ['self', 'manager', 'shared'])
            ->orderByDesc('period_end')
            ->first();

        if (! $cycle) {
            return response()->json(['cycle' => null]);
        }

        $me = ReviewCycleParticipant::where('review_cycle_id', $cycle->id)
            ->where('employee_id', $user->id)
            ->first();

        $enrolled = $cycle->participants()->count();

        return response()->json([
            'cycle' => $cycle,
            'me' => $me,
            'counts' => [
                'enrolled' => $enrolled,
                'self_done' => $cycle->participants()->whereNotNull('self_review_id')->count(),
                'manager_done' => $cycle->participants()->whereNotNull('manager_review_id')->count(),
            ],
        ]);
    }

    private function enrollParticipants(ReviewCycle $cycle): void
    {
        $employeeIds = User::where('organization_id', $cycle->organization_id)
            ->whereNull('deactivated_at')
            ->pluck('id');

        $existing = $cycle->participants()->pluck('employee_id')->all();
        $now = now();

        $rows = $employeeIds
            ->reject(fn ($id) => in_array($id, $existing, true))
            ->map(fn ($id) => [
                'review_cycle_id' => $cycle->id,
                'employee_id' => $id,
                'created_at' => $now,
                'updated_at' => $now,
            ])
            ->all();

        if ($rows) {
            ReviewCycleParticipant::insert($rows);
        }
    }

    private function cycleStats(ReviewCycle $cycle): array
    {
        $enrolled = $cycle->participants()->count();
        $selfDone = $cycle->participants()->whereNotNull('self_review_id')->count();
        $managerDone = $cycle->participants()->whereNotNull('manager_review_id')->count();

        // The reporting line lives on employee_work_infos, not users
        $pendingEmployeeIds = $cycle->participants()->whereNull('manager_review_id')->pluck('employee_id');
        $blockedManagers = \App\Models\EmployeeWorkInfo::whereIn('user_id', $pendingEmployeeIds)
            ->whereNotNull('reporting_manager_id')
            ->distinct()
            ->count('reporting_manager_id');

        // Completion by department (departments are Groups via employee_work_infos)
        $byDepartment = DB::table('review_cycle_participants as p')
            ->join('users as u', 'u.id', '=', 'p.employee_id')
            ->leftJoin('employee_work_infos as w', 'w.user_id', '=', 'u.id')
            ->leftJoin('groups as g', 'g.id', '=', 'w.report_group_id')
            ->where('p.review_cycle_id', $cycle->id)
            ->groupBy('g.id', 'g.name')
            ->selectRaw("COALESCE(g.name, 'Unassigned') as department")
            ->selectRaw('COUNT(*) as enrolled')
            ->selectRaw('SUM(CASE WHEN p.self_review_id IS NOT NULL THEN 1 ELSE 0 END) as self_done')
            ->selectRaw('SUM(CASE WHEN p.manager_review_id IS NOT NULL THEN 1 ELSE 0 END) as manager_done')
            ->orderBy('department')
            ->get();

        return [
            'enrolled' => $enrolled,
            'self_done' => $selfDone,
            'manager_done' => $managerDone,
            'blocked_managers' => $blockedManagers,
            'by_department' => $byDepartment,
        ];
    }
}
