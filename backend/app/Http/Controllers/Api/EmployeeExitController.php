<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ChecklistItem;
use App\Models\EmployeeExit;
use App\Models\ExitInterview;
use App\Models\User;
use App\Services\Lifecycle\ChecklistService;
use App\Services\Lifecycle\ExitService;
use App\Services\Lifecycle\NoticePeriodService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use RuntimeException;

class EmployeeExitController extends Controller
{
    public function __construct(
        private readonly ExitService $exits,
        private readonly ChecklistService $checklists,
        private readonly NoticePeriodService $notice,
    ) {
    }

    /** Managers and admins only — an exit exposes everyone's clearance state. */
    private function denyIfNotManager(User $user): ?JsonResponse
    {
        if ($user->getHierarchyLevel() >= 100) {
            return response()->json(['message' => 'Only managers and admins can view exits.'], 403);
        }

        return null;
    }

    public function index(Request $request): JsonResponse
    {
        $user = Auth::user();
        if ($deny = $this->denyIfNotManager($user)) {
            return $deny;
        }

        $query = EmployeeExit::with(['user:id,name,email', 'checklistItems', 'interview'])
            ->where('organization_id', $user->organization_id);

        if ($stage = $request->query('stage')) {
            $query->where('stage', $stage);
        }
        if ($request->boolean('open_only')) {
            $query->open();
        }

        return response()->json([
            'data' => $query->orderBy('last_working_date')->get(),
        ]);
    }

    public function show(int $id): JsonResponse
    {
        $user = Auth::user();
        if ($deny = $this->denyIfNotManager($user)) {
            return $deny;
        }

        $exit = EmployeeExit::with([
            'user:id,name,email',
            'checklistItems.owner:id,name',
            'checklistItems.assetAssignment.asset:id,name,asset_tag',
            'interview',
            'resignation',
            'settlement',
        ])
            ->where('organization_id', $user->organization_id)
            ->findOrFail($id);

        return response()->json(['data' => $exit]);
    }

    /**
     * Open an exit directly. This is the route for terminations, retirements
     * and redundancies — the exit types the settlement table has always
     * recognised but which had no way into the product.
     */
    public function store(Request $request): JsonResponse
    {
        $actor = Auth::user();
        if ($actor->getHierarchyLevel() > 10) {
            return response()->json(['message' => 'Only admins can open an exit directly.'], 403);
        }

        $validated = $request->validate([
            'user_id' => 'required|integer|exists:users,id',
            'last_working_date' => 'required|date',
            'exit_type' => 'required|in:'.implode(',', EmployeeExit::TYPES),
            'reason' => 'nullable|string|max:2000',
        ]);

        $subject = User::where('organization_id', $actor->organization_id)
            ->findOrFail($validated['user_id']);

        if ($subject->id === $actor->id) {
            return response()->json(['message' => 'You cannot open an exit for yourself.'], 422);
        }

        $exit = $this->exits->open(
            user: $subject,
            lastWorkingDate: Carbon::parse($validated['last_working_date']),
            exitType: $validated['exit_type'],
            reason: $validated['reason'] ?? null,
            initiator: $actor,
        );

        return response()->json([
            'message' => 'Exit opened.',
            'data' => $exit->load(['user:id,name,email', 'checklistItems']),
        ], 201);
    }

    public function advance(Request $request, int $id): JsonResponse
    {
        $user = Auth::user();
        if ($deny = $this->denyIfNotManager($user)) {
            return $deny;
        }

        $validated = $request->validate([
            'stage' => 'required|in:notice,clearance,settlement,closed',
        ]);

        $exit = EmployeeExit::with('checklistItems')
            ->where('organization_id', $user->organization_id)
            ->findOrFail($id);

        try {
            $updated = $this->exits->advance($exit, $validated['stage']);
        } catch (RuntimeException $error) {
            // A blocked settlement is an expected outcome, not a server fault.
            return response()->json(['message' => $error->getMessage()], 422);
        }

        return response()->json([
            'message' => 'Exit moved to '.$validated['stage'].'.',
            'data' => $updated->load(['user:id,name,email', 'checklistItems']),
        ]);
    }

    public function revokeAccess(int $id): JsonResponse
    {
        $user = Auth::user();
        if ($user->getHierarchyLevel() > 10) {
            return response()->json(['message' => 'Only admins can revoke access.'], 403);
        }

        $exit = EmployeeExit::where('organization_id', $user->organization_id)->findOrFail($id);

        return response()->json([
            'message' => 'Access revoked.',
            'data' => $this->exits->revokeAccess($exit, 'exit_manual'),
        ]);
    }

    /** Live preview of the notice arithmetic, before anything is committed. */
    public function noticePreview(Request $request): JsonResponse
    {
        $actor = Auth::user();

        $validated = $request->validate([
            'last_working_date' => 'required|date',
            'user_id' => 'nullable|integer|exists:users,id',
        ]);

        $subject = $actor;
        if (! empty($validated['user_id']) && $actor->getHierarchyLevel() < 100) {
            $subject = User::where('organization_id', $actor->organization_id)
                ->findOrFail($validated['user_id']);
        }

        return response()->json([
            'data' => $this->notice->evaluate($subject, Carbon::parse($validated['last_working_date'])),
        ]);
    }

    /* ── checklist ─────────────────────────────────────────────── */

    public function completeItem(Request $request, int $id, int $itemId): JsonResponse
    {
        $user = Auth::user();
        if ($deny = $this->denyIfNotManager($user)) {
            return $deny;
        }

        $validated = $request->validate(['notes' => 'nullable|string|max:2000']);

        $exit = EmployeeExit::where('organization_id', $user->organization_id)->findOrFail($id);
        $item = ChecklistItem::forSubject($exit)->findOrFail($itemId);

        return response()->json([
            'message' => 'Item completed.',
            'data' => $this->checklists->complete($item, $user, $validated['notes'] ?? null),
            'progress' => $exit->fresh()->clearance_progress,
        ]);
    }

    public function reopenItem(int $id, int $itemId): JsonResponse
    {
        $user = Auth::user();
        if ($deny = $this->denyIfNotManager($user)) {
            return $deny;
        }

        $exit = EmployeeExit::where('organization_id', $user->organization_id)->findOrFail($id);
        $item = ChecklistItem::forSubject($exit)->findOrFail($itemId);

        return response()->json([
            'message' => 'Item reopened.',
            'data' => $this->checklists->reopen($item),
            'progress' => $exit->fresh()->clearance_progress,
        ]);
    }

    /* ── exit interview ────────────────────────────────────────── */

    public function saveInterview(Request $request, int $id): JsonResponse
    {
        $user = Auth::user();

        $exit = EmployeeExit::where('organization_id', $user->organization_id)->findOrFail($id);

        // The person leaving may fill in their own; otherwise HR records it.
        if ($exit->user_id !== $user->id && $user->getHierarchyLevel() >= 100) {
            return response()->json(['message' => 'You cannot record this exit interview.'], 403);
        }

        $validated = $request->validate([
            'primary_reason' => 'nullable|in:'.implode(',', ExitInterview::REASONS),
            'responses' => 'nullable|array',
            'would_recommend' => 'nullable|integer|min:0|max:10',
            'would_rejoin' => 'nullable|boolean',
            'comments' => 'nullable|string|max:5000',
        ]);

        $interview = ExitInterview::updateOrCreate(
            ['employee_exit_id' => $exit->id],
            array_merge($validated, [
                'organization_id' => $exit->organization_id,
                'conducted_by' => $user->id,
                'submitted_at' => now(),
            ])
        );

        return response()->json(['message' => 'Exit interview saved.', 'data' => $interview]);
    }

    /** Attrition by reason — the payoff for storing answers rather than a PDF. */
    public function attritionReport(): JsonResponse
    {
        $user = Auth::user();
        if ($deny = $this->denyIfNotManager($user)) {
            return $deny;
        }

        $rows = ExitInterview::where('organization_id', $user->organization_id)
            ->whereNotNull('primary_reason')
            ->selectRaw('primary_reason, COUNT(*) as total')
            ->groupBy('primary_reason')
            ->orderByDesc('total')
            ->get();

        return response()->json(['data' => $rows]);
    }
}
