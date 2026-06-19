<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Reimbursement;
use App\Models\ReimbursementPayrollLink;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReimbursementController extends Controller
{
    /**
     * Status values this controller understands:
     *   pending  — submitted by the employee, awaiting approval
     *   approved — admin approved; reimbursable amount rolls into next payroll
     *   rejected — admin declined; no payroll impact
     *   removed  — previously approved but pulled out before being
     *              included in a paid run. Soft-state, keeps audit trail.
     *
     * The historical schema enum (where it exists) is checked leniently
     * via a string column with no DB-side constraint, so unknown values
     * are tolerated and the controller is the source of truth for valid
     * transitions.
     */
    private const ALLOWED_STATUSES = ['pending', 'approved', 'rejected', 'removed'];

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';

        $query = Reimbursement::with(['employee:id,name', 'approver:id,name', 'employee.groups:id']);

        // Non-admins can only see their own reimbursements.
        if (!$isAdmin) {
            $query->where('user_id', $user->id);
        }

        // Optional filters used by the Salary Structure page to fetch
        // approved (or any other status) reimbursements for a specific
        // employee.
        if ($request->filled('status') && in_array($request->status, self::ALLOWED_STATUSES, true)) {
            $query->where('status', $request->status);
        }

        if ($request->filled('user_id') || $request->filled('employee_id')) {
            $empId = (int) ($request->user_id ?? $request->employee_id);
            if ($empId > 0) {
                $query->where('user_id', $empId);
            }
        }

        $reimbursements = $query->orderBy('created_at', 'desc')->get();

        return response()->json($reimbursements);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'amount' => 'required|numeric|min:0.01',
            'currency' => 'nullable|string|size:3',
            'expense_date' => 'required|date',
            'description' => 'required|string|max:1000',
            'receipt_url' => 'nullable|string',
            'merchant_name' => 'nullable|string|max:255',
            'location' => 'nullable|string|max:255',
            // Free-text label so the Salary Structure "Approved
            // Reimbursements" panel can show a meaningful name
            // without having to pull the old `category` enum.
            'title' => 'nullable|string|max:255',
        ]);

        $user = $request->user();

        $reimbursement = Reimbursement::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'title' => $request->title ?: $request->description,
            'description' => $request->description,
            'amount' => $request->amount,
            'currency' => $request->currency ?: 'INR',
            'expense_date' => $request->expense_date,
            'receipt_url' => $request->receipt_url,
            'merchant_name' => $request->merchant_name,
            'location' => $request->location,
            'status' => 'pending',
        ]);

        return response()->json([
            'message' => 'Reimbursement request submitted successfully.',
            'reimbursement' => $reimbursement->load(['employee:id,name']),
        ], 201);
    }

    public function show(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $reimbursement = Reimbursement::with(['employee:id,name', 'approver:id,name', 'employee.groups:id'])->findOrFail($id);

        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';

        if (!$isAdmin && $reimbursement->user_id !== $user->id) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        return response()->json($reimbursement);
    }

    public function update(int $id, Request $request): JsonResponse
    {
        $request->validate([
            'amount' => 'nullable|numeric|min:0.01',
            'currency' => 'nullable|string|size:3',
            'expense_date' => 'nullable|date',
            'description' => 'nullable|string|max:1000',
            'receipt_url' => 'nullable|string',
            'merchant_name' => 'nullable|string|max:255',
            'location' => 'nullable|string|max:255',
            'title' => 'nullable|string|max:255',
        ]);

        $user = $request->user();
        $reimbursement = Reimbursement::findOrFail($id);

        // Only employee can update their own pending reimbursement.
        if ($reimbursement->user_id !== $user->id) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        if ($reimbursement->status !== 'pending') {
            return response()->json(['message' => 'Cannot update reimbursement that is not pending.'], 422);
        }

        $reimbursement->fill($request->only([
            'title', 'description', 'amount', 'currency', 'expense_date',
            'receipt_url', 'merchant_name', 'location',
        ]));
        $reimbursement->save();

        return response()->json([
            'message' => 'Reimbursement updated successfully.',
            'reimbursement' => $reimbursement->fresh()->load(['employee:id,name']),
        ]);
    }

    public function destroy(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $reimbursement = Reimbursement::findOrFail($id);

        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';

        if (!$isAdmin && $reimbursement->user_id !== $user->id) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        if (!$isAdmin && $reimbursement->status !== 'pending') {
            return response()->json(['message' => 'Cannot delete reimbursement that is not pending.'], 422);
        }

        $reimbursement->delete();

        return response()->json(['message' => 'Reimbursement deleted successfully.']);
    }

    public function approve(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';

        if (!$isAdmin) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $reimbursement = Reimbursement::findOrFail($id);

        if ($reimbursement->status !== 'pending') {
            return response()->json(['message' => 'Reimbursement is not pending.'], 422);
        }

        $reimbursement->update([
            'status' => 'approved',
            'approved_by' => $user->id,
            'approved_at' => now(),
        ]);

        return response()->json([
            'message' => 'Reimbursement approved successfully.',
            'reimbursement' => $reimbursement->fresh()
                ->load(['employee:id,name', 'approver:id,name', 'employee.groups:id']),
        ]);
    }

    public function reject(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';

        if (!$isAdmin) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $reimbursement = Reimbursement::findOrFail($id);

        if ($reimbursement->status !== 'pending') {
            return response()->json(['message' => 'Reimbursement is not pending.'], 422);
        }

        $reimbursement->update([
            'status' => 'rejected',
            'approved_by' => $user->id,
            'approved_at' => now(),
        ]);

        return response()->json([
            'message' => 'Reimbursement rejected.',
            'reimbursement' => $reimbursement->fresh()
                ->load(['employee:id,name', 'approver:id,name', 'employee.groups:id']),
        ]);
    }

    /**
     * Pull a previously-approved reimbursement out of the payroll pool.
     * Soft-state: sets status='removed' so the audit trail is preserved.
     *
     * Only available for `approved` reimbursements (admin/manager only).
     * Once the reimbursement is included in a paid payroll run, the
     * amount has already hit the employee's bank — removing it here
     * only stops it from being added to future runs and unlinks the
     * reimbursement_payroll_links rows; it does NOT claw back the money.
     * A payroll reversal would be a separate flow.
     */
    public function remove(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';

        if (!$isAdmin) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $reimbursement = Reimbursement::findOrFail($id);

        if ($reimbursement->status !== 'approved') {
            return response()->json([
                'message' => 'Only approved reimbursements can be removed from the salary structure. ' .
                             'Current status: ' . $reimbursement->status . '.',
            ], 422);
        }

        // Wrap in a transaction so the status flip and any payroll-link
        // deletes are atomic. Without this, a concurrent payroll run
        // could insert a new link between our SELECT and our status
        // update and the row would silently stay linked.
        DB::transaction(function () use ($reimbursement) {
            $reimbursement->update([
                'status' => 'removed',
                // We don't clear approved_by/approved_at — keeping the audit
                // trail of who originally approved and when this was later
                // pulled out is required for compliance.
            ]);

            // Drop the payroll-link rows that would otherwise drag the
            // removed reimbursement into future payroll calculations.
            // Hard-delete is safe here — the link is a pure join entity
            // and the actual payroll_item remains untouched (the
            // reversal flow handles money that's already been paid out).
            ReimbursementPayrollLink::where('reimbursement_id', $reimbursement->id)->delete();
        });

        return response()->json([
            'message' => 'Reimbursement removed from salary structure.',
            'reimbursement' => $reimbursement->fresh()
                ->load(['employee:id,name', 'approver:id,name', 'employee.groups:id']),
        ]);
    }

    public function getSummary(Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';

        $query = Reimbursement::query();

        if (!$isAdmin) {
            $query->where('user_id', $user->id);
        }

        $totalCount = $query->count();
        $totalAmount = $query->sum('amount');
        $pendingCount = (clone $query)->where('status', 'pending')->count();
        $pendingAmount = (clone $query)->where('status', 'pending')->sum('amount');
        $approvedCount = (clone $query)->where('status', 'approved')->count();
        $approvedAmount = (clone $query)->where('status', 'approved')->sum('amount');

        return response()->json([
            'total_count' => $totalCount,
            'total_amount' => $totalAmount,
            'pending_count' => $pendingCount,
            'pending_amount' => $pendingAmount,
            'approved_count' => $approvedCount,
            'approved_amount' => $approvedAmount,
        ]);
    }
}