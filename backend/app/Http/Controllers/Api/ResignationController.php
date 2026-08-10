<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Resignation;
use App\Models\User;
use App\Services\Approvals\ApprovalRoutingService;
use App\Services\Lifecycle\ExitService;
use App\Services\Lifecycle\NoticePeriodService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use Throwable;

class ResignationController extends Controller
{
    public function __construct(
        private readonly ApprovalRoutingService $approvalRoutingService,
        private readonly ExitService $exitService,
        private readonly NoticePeriodService $noticePeriodService,
    ) {
    }

    /**
     * Submit a new resignation request.
     */
    public function submit(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'last_working_date' => 'required|date|after_or_equal:today',
            'reason' => 'nullable|string|max:1000',
        ]);

        $user = Auth::user();

        // One live resignation per person. Checking only for 'pending' let an
        // employee whose resignation had already been approved file another,
        // and another — leaving several approved exits for the same person with
        // no single answer for which one drives F&F, notice recovery or the
        // exit date. 'rejected' and 'cancelled' are terminal and do not block.
        $existingResignation = Resignation::where('user_id', $user->id)
            ->whereIn('status', ['pending', 'approved'])
            ->latest('id')
            ->first();

        if ($existingResignation) {
            return response()->json([
                'message' => $existingResignation->status === 'approved'
                    ? 'Your resignation has already been approved. Ask HR to cancel it before filing a new one.'
                    : 'You already have a pending resignation request.',
                'resignation' => $existingResignation,
            ], 422);
        }

        // Record the notice policy as it stands right now, and how short this
        // date falls. Stored rather than recomputed so a later policy change
        // cannot retroactively put somebody in shortfall, and so the employee
        // and payroll are looking at the same number.
        $notice = $this->noticePeriodService->evaluate(
            $user,
            Carbon::parse($validated['last_working_date'])
        );

        $resignation = Resignation::create([
            'user_id' => $user->id,
            'organization_id' => $user->organization_id,
            'last_working_date' => $validated['last_working_date'],
            'reason' => $validated['reason'] ?? null,
            'status' => 'pending',
            'notice_period_days' => $notice['required'],
            'shortfall_days' => $notice['shortfall'],
        ]);

        // Notify manager and HR
        $this->notifyManagersAndHR($resignation);

        return response()->json([
            'message' => 'Resignation submitted successfully.',
            'resignation' => $this->withApprovalDestination($resignation->load(['user', 'escalatedTo'])),
        ], 201);
    }

    /**
     * Get current user's resignation.
     */
    public function getMyResignation(): JsonResponse
    {
        $user = Auth::user();

        $resignation = Resignation::where('user_id', $user->id)
            ->whereIn('status', ['pending', 'approved'])
            ->with(['user', 'approver', 'escalatedTo'])
            ->first();

        return response()->json([
            'resignation' => $resignation ? $this->withApprovalDestination($resignation) : null,
        ]);
    }

    /**
     * Get user's resignation history.
     */
    public function getMyResignationHistory(): JsonResponse
    {
        $user = Auth::user();

        $resignations = Resignation::where('user_id', $user->id)
            ->with(['user', 'approver', 'escalatedTo'])
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json([
            'resignations' => $resignations->map(fn (Resignation $r) => $this->withApprovalDestination($r)),
        ]);
    }

    /**
     * List all resignations (for managers and admins).
     */
    public function list(Request $request): JsonResponse
    {
        $user = Auth::user();

        // Check if user can manage resignations
        if ($user->getHierarchyLevel() >= 100) {
            return response()->json([
                'message' => 'Unauthorized. Only managers and admins can view all resignations.',
            ], 403);
        }

        $query = Resignation::where('organization_id', $user->organization_id)
            ->with(['user', 'approver', 'escalatedTo']);

        // Filter by status
        if ($request->has('status')) {
            $query->where('status', $request->status);
        }

        // If manager/lead, show all resignations in the organization
        // (They can see all employees' resignations for approval)
        if ($user->getHierarchyLevel() < 100) {
            // No additional filter - manager/lead sees all resignations in org
            // This allows them to approve/reject any resignation
        }

        $resignations = $query->orderBy('created_at', 'desc')->get();

        return response()->json([
            'data' => $resignations->map(fn (Resignation $r) => $this->withApprovalDestination($r)),
        ]);
    }

    /**
     * Approve a resignation.
     */
    public function approve(Request $request, int $id): JsonResponse
    {
        $user = Auth::user();

        // Check if user can manage resignations
        if ($user->getHierarchyLevel() >= 100) {
            return response()->json([
                'message' => 'Unauthorized. Only managers and admins can approve resignations.',
            ], 403);
        }

        $resignation = Resignation::where('organization_id', $user->organization_id)
            ->findOrFail($id);

        if (!$resignation->isPending()) {
            return response()->json([
                'message' => 'This resignation is no longer pending.',
            ], 422);
        }

        $resignation->approve($user->id);

        /*
         * Approval is the moment the exit process starts: clearance is
         * generated, outstanding assets become blocking items, and the notice
         * arithmetic is fixed. Previously approval wrote three columns and
         * nothing else happened at all.
         *
         * It is deliberately not fatal. If the exit cannot be opened the
         * approval still stands — refusing a decision the manager has already
         * made, because a checklist failed to build, would be the wrong
         * trade-off. The failure is logged and the exit can be opened by hand.
         */
        $exit = null;
        try {
            $exit = $this->exitService->openFromResignation($resignation->fresh(['user']), $user);
        } catch (Throwable $error) {
            Log::error('Could not open exit for approved resignation', [
                'resignation_id' => $resignation->id,
                'error' => $error->getMessage(),
            ]);
        }

        // Notify employee
        $this->notifyEmployee($resignation, 'approved');

        return response()->json([
            'message' => 'Resignation approved successfully.',
            'resignation' => $this->withApprovalDestination($resignation->fresh(['user', 'approver', 'escalatedTo'])),
            'employee_exit' => $exit?->load('checklistItems'),
        ]);
    }

    /**
     * Reject a resignation.
     */
    public function reject(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'reason' => 'required|string|max:1000',
        ]);

        $user = Auth::user();

        // Check if user can manage resignations
        if ($user->getHierarchyLevel() >= 100) {
            return response()->json([
                'message' => 'Unauthorized. Only managers and admins can reject resignations.',
            ], 403);
        }

        $resignation = Resignation::where('organization_id', $user->organization_id)
            ->findOrFail($id);

        if (!$resignation->isPending()) {
            return response()->json([
                'message' => 'This resignation is no longer pending.',
            ], 422);
        }

        $resignation->reject($validated['reason']);

        // Notify employee
        $this->notifyEmployee($resignation, 'rejected');

        return response()->json([
            'message' => 'Resignation rejected successfully.',
            'resignation' => $this->withApprovalDestination($resignation->fresh(['user', 'approver', 'escalatedTo'])),
        ]);
    }

    /**
     * Forward (escalate) a pending resignation to another approver.
     */
    public function transfer(Request $request, int $id): JsonResponse
    {
        $request->validate([
            'note' => 'nullable|string|max:2000',
            'to_user_id' => 'nullable|integer|exists:users,id',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        $resignation = Resignation::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$resignation) {
            return response()->json(['message' => 'Resignation request not found'], 404);
        }

        // Only the user currently holding the request may forward it upward.
        $currentHolderIds = $this->approvalRoutingService->currentReviewerIds($resignation->user, $resignation->escalated_to_user_id);
        if (! $currentHolderIds->contains((int) $currentUser->id) && ! $this->canManage($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        if ($resignation->status !== 'pending') {
            return response()->json(['message' => 'Only pending requests can be transferred.'], 422);
        }

        $requester = $resignation->user()->with('employeeWorkInfo', 'customRole')->firstOrFail();
        $excludeUserId = $resignation->escalated_to_user_id ?? $this->immediateReviewerId($requester);

        $targetUser = null;
        if ($request->filled('to_user_id')) {
            $candidate = User::query()
                ->where('organization_id', $currentUser->organization_id)
                ->where('id', (int) $request->to_user_id)
                ->first();

            if (!$candidate || ! $this->approvalRoutingService->isValidForwardTarget($requester, (int) $candidate->id, $excludeUserId)) {
                return response()->json([
                    'message' => 'Selected user is not a valid forward target for this request.',
                ], 422);
            }

            $targetUser = $candidate;
        } else {
            $targetIds = $this->approvalRoutingService->escalationTargetIds($requester, $excludeUserId);

            if ($targetIds->isEmpty()) {
                return response()->json([
                    'message' => 'No higher hierarchy is available to escalate this request to.',
                ], 422);
            }

            $targetUser = User::query()->whereIn('id', $targetIds)->first();
        }

        $history = $resignation->escalation_history ?? [];
        $history[] = [
            'from_user_id' => $excludeUserId ? (int) $excludeUserId : null,
            'to_user_id' => $targetUser->id,
            'to_level' => $targetUser->name,
            'note' => $request->note,
            'by_user_id' => (int) $currentUser->id,
            'at' => now()->toIso8601String(),
        ];

        $resignation->update([
            'escalated_to_user_id' => $targetUser->id,
            'escalation_history' => $history,
        ]);

        \Log::info('Resignation forwarded', [
            'resignation_id' => $resignation->id,
            'from_user_id' => $excludeUserId,
            'to_user_id' => $targetUser->id,
            'by_user_id' => $currentUser->id,
        ]);

        return response()->json([
            'message' => 'Resignation request transferred to the next hierarchy level.',
            'resignation' => $this->withApprovalDestination($resignation->fresh(['user', 'approver', 'escalatedTo'])),
        ]);
    }

    /**
     * List valid forward targets for a pending resignation.
     */
    public function forwardTargets(Request $request, int $id): JsonResponse
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['data' => []]);
        }

        $resignation = Resignation::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$resignation) {
            return response()->json(['message' => 'Resignation request not found'], 404);
        }

        $requester = $resignation->user()->with('employeeWorkInfo', 'customRole')->firstOrFail();
        $excludeUserId = $resignation->escalated_to_user_id ?? $this->immediateReviewerId($requester);

        $targets = $this->approvalRoutingService->forwardTargets($requester, $excludeUserId);

        return response()->json(['data' => $targets->all()]);
    }

    /**
     * Cancel own resignation.
     */
    public function cancel(): JsonResponse
    {
        $user = Auth::user();

        $resignation = Resignation::where('user_id', $user->id)
            ->where('status', 'pending')
            ->first();

        if (!$resignation) {
            return response()->json([
                'message' => 'No pending resignation found to cancel.',
            ], 404);
        }

        $resignation->cancel();

        // Notify manager
        $this->notifyManagersAndHR($resignation, 'cancelled');

        return response()->json([
            'message' => 'Resignation cancelled successfully.',
        ]);
    }

    /**
     * Notify managers and HR about resignation.
     */
    private function immediateReviewerId(User $requester): ?int
    {
        return $this->approvalRoutingService->reviewerUserIds($requester)->first();
    }

    private function notifyManagersAndHR(Resignation $resignation, string $action = 'submitted'): void
    {
        $organization = $resignation->organization;
        $user = $resignation->user;

        // Get admins and managers
        $managersAndAdmins = User::where('organization_id', $organization->id)
            ->where(function ($q) {
                $q->whereHas('customRole', fn ($cr) => $cr->where('hierarchy_level', '<', 100))
                    ->orWhereIn('role', ['admin', 'manager']);
            })
            ->get();

        // TODO: Implement actual notification logic
        // For now, just log
        \Log::info("Resignation {$action}", [
            'resignation_id' => $resignation->id,
            'user_id' => $user->id,
            'user_name' => $user->name,
            'managers_notified' => $managersAndAdmins->pluck('email')->toArray(),
        ]);
    }

    /**
     * Notify employee about resignation status update.
     */
    private function notifyEmployee(Resignation $resignation, string $status): void
    {
        $user = $resignation->user;

        // TODO: Implement actual notification logic
        \Log::info("Resignation {$status}", [
            'resignation_id' => $resignation->id,
            'user_id' => $user->id,
            'user_name' => $user->name,
            'status' => $status,
        ]);
    }

    /**
     * Enrich a resignation with who the approval is routed to.
     * Shows the specific person who currently holds the approval (the
     * nearest non-super_admin reviewer by hierarchy level), or the
     * forwarded-to recipient once escalated. Super admins are excluded
     * from the reviewer set since they only observe the company.
     */
    private function withApprovalDestination(Resignation $resignation): Resignation
    {
        $resignation->loadMissing('user.employeeWorkInfo');

        $allReviewerIds = $this->approvalRoutingService
            ->reviewerUserIds($resignation->user);

        // Exclude super_admins — they only observe the company, they don't
        // approve resignations. Pick the nearest reviewer from the rest.
        $eligibleReviewerIds = $allReviewerIds->filter(function (int $id) {
            $reviewer = User::query()
                ->where('id', $id)
                ->with('customRole')
                ->first(['id', 'role', 'role_id']);
            return $reviewer && $reviewer->role !== 'super_admin';
        })->values();

        if ($resignation->escalated_to_user_id && $resignation->escalatedTo) {
            $resignation->setAttribute('approval_destination', 'Forwarded to '.$resignation->escalatedTo->name);
            $currentReviewerIds = collect([(int) $resignation->escalated_to_user_id]);
        } elseif ($eligibleReviewerIds->isNotEmpty()) {
            $reviewerUsers = User::query()
                ->whereIn('id', $eligibleReviewerIds)
                ->with('customRole')
                ->get(['id', 'name', 'role', 'role_id']);

            $nearestLevel = $reviewerUsers
                ->map(fn (User $u) => $this->approvalRoutingService->hierarchyLevel($u))
                ->min();

            $currentReviewerIds = $reviewerUsers
                ->filter(fn (User $u) => $this->approvalRoutingService->hierarchyLevel($u) === $nearestLevel)
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values();

            $reviewerNames = $currentReviewerIds->map(function (int $id) use ($reviewerUsers) {
                return trim((string) $reviewerUsers->firstWhere('id', $id)?->name);
            })->filter()->values();

            $resignation->setAttribute(
                'approval_destination',
                $reviewerNames->isEmpty() ? 'Sent to reviewer' : 'Sent to '.$reviewerNames->implode(', ')
            );
        } else {
            $resignation->setAttribute('approval_destination', 'Sent to reviewer');
            $currentReviewerIds = collect();
        }

        $resignation->setAttribute('escalated_to', $resignation->escalatedTo?->only(['id', 'name']));
        $resignation->setAttribute('escalation_history', $resignation->escalation_history ?? []);
        $resignation->setAttribute('current_reviewer_ids', $currentReviewerIds->all());

        return $resignation;
    }
}
