<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Resignation;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;

class ResignationController extends Controller
{
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
            ->with(['user', 'approver']);

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
