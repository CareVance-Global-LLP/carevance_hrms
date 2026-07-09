<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Resignation;
use App\Models\User;
use App\Services\Approvals\ApprovalRoutingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;

class ResignationController extends Controller
{
    public function __construct(
        private readonly ApprovalRoutingService $approvalRoutingService,
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

        // Check if user already has a pending resignation
        $existingResignation = Resignation::where('user_id', $user->id)
            ->where('status', 'pending')
            ->first();

        if ($existingResignation) {
            return response()->json([
                'message' => 'You already have a pending resignation request.',
                'resignation' => $existingResignation,
            ], 422);
        }

        // Create resignation
        $resignation = Resignation::create([
            'user_id' => $user->id,
            'organization_id' => $user->organization_id,
            'last_working_date' => $validated['last_working_date'],
            'reason' => $validated['reason'] ?? null,
            'status' => 'pending',
        ]);

        // Notify manager and HR
        $this->notifyManagersAndHR($resignation);

        return response()->json([
            'message' => 'Resignation submitted successfully.',
            'resignation' => $resignation->load('user'),
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
            ->with(['user', 'approver'])
            ->first();

        return response()->json([
            'resignation' => $resignation,
        ]);
    }

    /**
     * Get user's resignation history.
     */
    public function getMyResignationHistory(): JsonResponse
    {
        $user = Auth::user();

        $resignations = Resignation::where('user_id', $user->id)
            ->with(['user', 'approver'])
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json([
            'resignations' => $resignations,
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

        foreach ($resignations as $resignation) {
            $resignation->setAttribute(
                'current_reviewer_ids',
                $this->approvalRoutingService
                    ->currentReviewerIds($resignation->user, $resignation->escalated_to_user_id)
                    ->values()
                    ->all()
            );
        }

        return response()->json([
            'data' => $resignations,
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

        // Notify employee
        $this->notifyEmployee($resignation, 'approved');

        return response()->json([
            'message' => 'Resignation approved successfully.',
            'resignation' => $resignation->fresh(['user', 'approver']),
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
            'resignation' => $resignation->fresh(['user', 'approver']),
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
            'resignation' => $resignation->fresh(['user', 'approver', 'escalatedTo']),
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
}
