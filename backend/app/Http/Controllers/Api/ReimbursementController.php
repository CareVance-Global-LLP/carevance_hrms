<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Reimbursement;
use App\Models\ReimbursementPayrollLink;
use App\Models\EmployeeWorkInfo;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReimbursementController extends Controller
{
    /**
     * Two-level approval chain:
     *   pending_manager → employee submitted, awaiting reporting manager
     *   pending_admin   → manager approved, awaiting admin final approval
     *   approved        → fully approved, included in next payroll run
     *   rejected        → declined at either level
     */
    private const VALID_LEVELS = ['pending_manager', 'pending_admin', 'approved', 'rejected'];

    // ─── List ─────────────────────────────────────────────────

    /**
     * Role-aware listing:
     *   Employee  → own reimbursements only
     *   Manager   → own + pending from their direct reports
     *   Admin     → all reimbursements in the org
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $level = $user->getHierarchyLevel();
        $isStrictAdmin = $level <= 10;
        $isManager = $level >= 10 && $level < 100;

        $query = Reimbursement::with([
            'employee:id,name,email',
            'approver:id,name',
            'managerApprover:id,name',
        ]);

        if ($isStrictAdmin) {
            // Pure admin — see everything in org (no filter)
        } elseif ($isManager) {
            // Manager — see own + their direct reports' reimbursements
            $directReportIds = EmployeeWorkInfo::where('reporting_manager_id', $user->id)
                ->pluck('user_id')
                ->toArray();
            $directReportIds[] = $user->id; // include own
            $query->whereIn('user_id', $directReportIds);
        } else {
            // Employee — own only
            $query->where('user_id', $user->id);
        }

        // Optional status filter
        if ($request->filled('status') && in_array($request->status, ['pending', 'approved', 'rejected', 'removed'], true)) {
            $query->where('status', $request->status);
        }

        // Optional approval_level filter
        if ($request->filled('approval_level') && in_array($request->approval_level, self::VALID_LEVELS, true)) {
            $query->where('approval_level', $request->approval_level);
        }

        // Optional employee filter (admin/manager can filter by employee)
        if ($request->filled('user_id') || $request->filled('employee_id')) {
            $empId = (int) ($request->user_id ?? $request->employee_id);
            if ($empId > 0) {
                $query->where('user_id', $empId);
            }
        }

        // Optional month_year filter — by the submitted date (created_at)
        $query->forMonth($request->input('month_year'));

        $reimbursements = $query->orderBy('created_at', 'desc')->get();

        return response()->json($reimbursements);
    }

    // ─── Employee: My Reimbursements ──────────────────────────

    public function myReimbursements(Request $request): JsonResponse
    {
        $reimbursements = Reimbursement::with([
            'employee:id,name,email',
            'approver:id,name',
            'managerApprover:id,name',
        ])
            ->where('user_id', $request->user()->id)
            ->forMonth($request->input('month_year'))
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json($reimbursements);
    }

    // ─── Manager: Inbox ───────────────────────────────────────

    /**
     * Reimbursements from the manager's direct reports that are
     * awaiting manager-level approval.
     */
    public function managerInbox(Request $request): JsonResponse
    {
        $user = $request->user();
        $directReportIds = EmployeeWorkInfo::where('reporting_manager_id', $user->id)
            ->pluck('user_id')
            ->toArray();
        $directReportIds[] = $user->id; // include own claims

        $query = Reimbursement::with([
            'employee:id,name,email',
            'employee.employeeWorkInfo:user_id,report_group_id',
            'employee.groups:id,name',
        ])
            ->whereIn('user_id', $directReportIds)
            ->where('approval_level', 'pending_manager')
            ->forMonth($request->input('month_year'));

        if ($request->filled('search')) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', "%{$search}%")
                  ->orWhere('description', 'like', "%{$search}%")
                  ->orWhereHas('employee', function ($eq) use ($search) {
                      $eq->where('name', 'like', "%{$search}%");
                  });
            });
        }

        $reimbursements = $query->orderBy('created_at', 'desc')->get();

        // Flag each claim as read once the manager has opened it while it
        // was still awaiting their approval.
        $reimbursements->each(function (Reimbursement $r) {
            $r->is_read = !is_null($r->manager_read_at);
        });

        return response()->json($reimbursements);
    }

    // ─── Admin: Inbox ─────────────────────────────────────────

    /**
     * Reimbursements already manager-approved, awaiting admin
     * final approval.
     */
    public function adminInbox(Request $request): JsonResponse
    {
        $user = $request->user();

        $query = Reimbursement::with([
            'employee:id,name,email',
            'managerApprover:id,name',
            'employee.groups:id,name',
        ])
            ->where('organization_id', $user->organization_id)
            ->where('approval_level', 'pending_admin')
            ->forMonth($request->input('month_year'));

        if ($request->filled('search')) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', "%{$search}%")
                  ->orWhere('description', 'like', "%{$search}%")
                  ->orWhereHas('employee', function ($eq) use ($search) {
                      $eq->where('name', 'like', "%{$search}%");
                  });
            });
        }

        $reimbursements = $query->orderBy('created_at', 'desc')->get();

        // Flag each claim as read once an admin has opened it while it was
        // still awaiting admin approval.
        $reimbursements->each(function (Reimbursement $r) {
            $r->is_read = !is_null($r->admin_read_at);
        });

        return response()->json($reimbursements);
    }

    // ─── Create ───────────────────────────────────────────────

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'amount' => 'required|numeric|min:0.01',
            'currency' => 'nullable|string|size:3',
            'expense_date' => 'required|date',
            'description' => 'required|string|max:1000',
            'receipt_url' => 'nullable|string|max:500',
            'merchant_name' => 'nullable|string|max:255',
            'location' => 'nullable|string|max:255',
            'title' => 'nullable|string|max:255',
            'category' => 'nullable|string|max:64',
        ]);

        $user = $request->user();
        $level = $user->getHierarchyLevel();
        $isReviewer = $level < 100; // manager or admin — cannot approve own claim

        if ($isReviewer) {
            // Managers/admins skip the manager-approval step and go
            // straight to the admin inbox.
            $approvalLevel = 'pending_admin';
        } else {
            // Resolve the employee's reporting manager
            $workInfo = EmployeeWorkInfo::where('user_id', $user->id)->first();
            $managerId = $workInfo?->reporting_manager_id;

            if (!$managerId) {
                return response()->json([
                    'message' => 'No reporting manager assigned. Please contact HR before submitting a reimbursement claim.',
                ], 422);
            }

            $approvalLevel = 'pending_manager';
        }

        $reimbursement = Reimbursement::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'title' => $request->title ?: $request->description,
            'category' => $request->category,
            'description' => $request->description,
            'amount' => $request->amount,
            'currency' => $request->currency ?: 'INR',
            'expense_date' => $request->expense_date,
            'receipt_url' => $request->receipt_url,
            'merchant_name' => $request->merchant_name,
            'location' => $request->location,
            'status' => 'pending',
            'approval_level' => $approvalLevel,
            'submitted_by' => $user->id,
        ]);

        $message = $isReviewer
            ? 'Reimbursement submitted successfully. Forwarded to admin for approval.'
            : 'Reimbursement submitted successfully. Awaiting manager approval.';

        return response()->json([
            'message' => $message,
            'reimbursement' => $reimbursement->load(['employee:id,name']),
        ], 201);
    }

    // ─── Show ─────────────────────────────────────────────────

    public function show(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $level = $user->getHierarchyLevel();
        $isAdmin = $level < 100;

        $reimbursement = Reimbursement::with([
            'employee:id,name,email',
            'approver:id,name',
            'managerApprover:id,name',
            'submitter:id,name',
            'employee.groups:id,name',
            'employee.employeeWorkInfo:user_id,report_group_id,reporting_manager_id',
        ])->findOrFail($id);

        // Employees can only see their own
        if (!$isAdmin && $reimbursement->user_id !== $user->id) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        // Managers can see their direct reports' reimbursements
        if ($level >= 50 && $level < 100) {
            $directReportIds = EmployeeWorkInfo::where('reporting_manager_id', $user->id)
                ->pluck('user_id')
                ->toArray();
            $directReportIds[] = $user->id;
            if (!in_array($reimbursement->user_id, $directReportIds)) {
                return response()->json(['message' => 'Unauthorized.'], 403);
            }
        }

        return response()->json($reimbursement);
    }

    // ─── Update (employee edits own pending) ──────────────────

    public function update(int $id, Request $request): JsonResponse
    {
        $request->validate([
            'amount' => 'nullable|numeric|min:0.01',
            'currency' => 'nullable|string|size:3',
            'expense_date' => 'nullable|date',
            'description' => 'nullable|string|max:1000',
            'receipt_url' => 'nullable|string|max:500',
            'merchant_name' => 'nullable|string|max:255',
            'location' => 'nullable|string|max:255',
            'title' => 'nullable|string|max:255',
            'category' => 'nullable|string|max:64',
        ]);

        $user = $request->user();
        $reimbursement = Reimbursement::findOrFail($id);

        if ($reimbursement->user_id !== $user->id) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        if ($reimbursement->approval_level !== 'pending_manager') {
            return response()->json(['message' => 'Cannot edit reimbursement that is not pending manager approval.'], 422);
        }

        $reimbursement->fill($request->only([
            'title', 'description', 'amount', 'currency', 'expense_date',
            'receipt_url', 'merchant_name', 'location', 'category',
        ]));
        $reimbursement->save();

        return response()->json([
            'message' => 'Reimbursement updated successfully.',
            'reimbursement' => $reimbursement->fresh()->load(['employee:id,name']),
        ]);
    }

    // ─── Delete ───────────────────────────────────────────────

    public function destroy(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $level = $user->getHierarchyLevel();
        $isAdmin = $level < 100;
        $reimbursement = Reimbursement::findOrFail($id);

        if (!$isAdmin && $reimbursement->user_id !== $user->id) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        if (!$isAdmin && $reimbursement->approval_level !== 'pending_manager') {
            return response()->json(['message' => 'Cannot delete reimbursement that is no longer pending manager approval.'], 422);
        }

        $reimbursement->delete();

        return response()->json(['message' => 'Reimbursement deleted successfully.']);
    }

    // ─── Manager: Approve → forwards to admin ────────────────

    public function managerApprove(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $level = $user->getHierarchyLevel();
        $isAdmin = $level < 100;

        $reimbursement = Reimbursement::with('employee:id,name')->findOrFail($id);

        // Verify the reviewer is either the direct manager or an admin
        $directReportIds = EmployeeWorkInfo::where('reporting_manager_id', $user->id)
            ->pluck('user_id')
            ->toArray();

        if (!$isAdmin && !in_array($reimbursement->user_id, $directReportIds)) {
            return response()->json(['message' => 'You can only approve reimbursements from your direct reports.'], 403);
        }

        if ($reimbursement->approval_level !== 'pending_manager') {
            return response()->json(['message' => 'This reimbursement is not awaiting manager approval.'], 422);
        }

        $reimbursement->update([
            'manager_approved_by' => $user->id,
            'manager_approved_at' => now(),
            'approval_level' => 'pending_admin',
        ]);

        return response()->json([
            'message' => 'Approved. Reimbursement forwarded to admin for final approval.',
            'reimbursement' => $reimbursement->fresh()
                ->load(['employee:id,name', 'managerApprover:id,name']),
        ]);
    }

    // ─── Manager: Reject ──────────────────────────────────────

    public function managerReject(int $id, Request $request): JsonResponse
    {
        $request->validate([
            'reason' => 'required|string|max:1000',
        ]);

        $user = $request->user();
        $level = $user->getHierarchyLevel();
        $isAdmin = $level < 100;

        $reimbursement = Reimbursement::with('employee:id,name')->findOrFail($id);

        $directReportIds = EmployeeWorkInfo::where('reporting_manager_id', $user->id)
            ->pluck('user_id')
            ->toArray();

        if (!$isAdmin && !in_array($reimbursement->user_id, $directReportIds)) {
            return response()->json(['message' => 'You can only reject reimbursements from your direct reports.'], 403);
        }

        if ($reimbursement->approval_level !== 'pending_manager') {
            return response()->json(['message' => 'This reimbursement is not awaiting manager approval.'], 422);
        }

        $reimbursement->update([
            'approval_level' => 'rejected',
            'status' => 'rejected',
            'manager_approved_by' => $user->id,
            'manager_approved_at' => now(),
            'rejection_reason' => $request->input('reason'),
        ]);

        return response()->json([
            'message' => 'Reimbursement rejected.',
            'reimbursement' => $reimbursement->fresh()
                ->load(['employee:id,name', 'managerApprover:id,name']),
        ]);
    }

    // ─── Admin: Final Approve ─────────────────────────────────

    public function approve(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->getHierarchyLevel() <= 10;

        if (!$isAdmin) {
            return response()->json(['message' => 'Only admin can give final approval.'], 403);
        }

        $reimbursement = Reimbursement::findOrFail($id);

        if ($reimbursement->approval_level !== 'pending_admin') {
            return response()->json(['message' => 'This reimbursement is not awaiting admin approval.'], 422);
        }

        $reimbursement->update([
            'status' => 'approved',
            'approval_level' => 'approved',
            'approved_by' => $user->id,
            'approved_at' => now(),
        ]);

        return response()->json([
            'message' => 'Reimbursement approved. It will be added to the next payroll run.',
            'reimbursement' => $reimbursement->fresh()
                ->load(['employee:id,name', 'approver:id,name', 'managerApprover:id,name', 'employee.groups:id,name']),
        ]);
    }

    // ─── Admin: Reject ────────────────────────────────────────

    public function reject(int $id, Request $request): JsonResponse
    {
        $request->validate([
            'reason' => 'required|string|max:1000',
        ]);

        $user = $request->user();
        $isAdmin = $user->getHierarchyLevel() <= 10;

        if (!$isAdmin) {
            return response()->json(['message' => 'Only admin can reject.'], 403);
        }

        $reimbursement = Reimbursement::findOrFail($id);

        if ($reimbursement->approval_level !== 'pending_admin') {
            return response()->json(['message' => 'This reimbursement is not awaiting admin approval.'], 422);
        }

        $reimbursement->update([
            'status' => 'rejected',
            'approval_level' => 'rejected',
            'approved_by' => $user->id,
            'approved_at' => now(),
            'rejection_reason' => $request->input('reason'),
        ]);

        return response()->json([
            'message' => 'Reimbursement rejected.',
            'reimbursement' => $reimbursement->fresh()
                ->load(['employee:id,name', 'approver:id,name', 'managerApprover:id,name']),
        ]);
    }

    // ─── Bulk: Manager Approve (forwards to admin) ──────────

    public function bulkManagerApprove(Request $request): JsonResponse
    {
        $request->validate(['ids' => 'required|array', 'ids.*' => 'integer']);

        $user = $request->user();
        $level = $user->getHierarchyLevel();
        $isAdmin = $level < 100;
        $directReportIds = EmployeeWorkInfo::where('reporting_manager_id', $user->id)
            ->pluck('user_id')->toArray();

        $processed = 0;
        DB::transaction(function () use ($request, $user, $isAdmin, $directReportIds, &$processed) {
            foreach ($request->input('ids', []) as $id) {
                $r = Reimbursement::find($id);
                if (!$r) continue;
                if (!$isAdmin && !in_array($r->user_id, $directReportIds)) continue;
                if ($r->approval_level !== 'pending_manager') continue;
                $r->update([
                    'manager_approved_by' => $user->id,
                    'manager_approved_at' => now(),
                    'approval_level' => 'pending_admin',
                ]);
                $processed++;
            }
        });

        return response()->json(['message' => "Approved $processed claim(s).", 'processed' => $processed]);
    }

    // ─── Bulk: Manager Reject ──────────────────────────────

    public function bulkManagerReject(Request $request): JsonResponse
    {
        $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'integer',
            'reason' => 'required|string|max:1000',
        ]);

        $user = $request->user();
        $level = $user->getHierarchyLevel();
        $isAdmin = $level < 100;
        $directReportIds = EmployeeWorkInfo::where('reporting_manager_id', $user->id)
            ->pluck('user_id')->toArray();

        $processed = 0;
        DB::transaction(function () use ($request, $user, $isAdmin, $directReportIds, &$processed) {
            foreach ($request->input('ids', []) as $id) {
                $r = Reimbursement::find($id);
                if (!$r) continue;
                if (!$isAdmin && !in_array($r->user_id, $directReportIds)) continue;
                if ($r->approval_level !== 'pending_manager') continue;
                $r->update([
                    'approval_level' => 'rejected',
                    'status' => 'rejected',
                    'manager_approved_by' => $user->id,
                    'manager_approved_at' => now(),
                    'rejection_reason' => $request->input('reason'),
                ]);
                $processed++;
            }
        });

        return response()->json(['message' => "Rejected $processed claim(s).", 'processed' => $processed]);
    }

    // ─── Bulk: Admin Final Approve ─────────────────────────

    public function bulkAdminApprove(Request $request): JsonResponse
    {
        $request->validate(['ids' => 'required|array', 'ids.*' => 'integer']);

        $user = $request->user();
        if ($user->getHierarchyLevel() > 10) {
            return response()->json(['message' => 'Only admin can give final approval.'], 403);
        }

        $processed = 0;
        DB::transaction(function () use ($request, $user, &$processed) {
            foreach ($request->input('ids', []) as $id) {
                $r = Reimbursement::find($id);
                if (!$r) continue;
                if ($r->approval_level !== 'pending_admin') continue;
                $r->update([
                    'status' => 'approved',
                    'approval_level' => 'approved',
                    'approved_by' => $user->id,
                    'approved_at' => now(),
                ]);
                $processed++;
            }
        });

        return response()->json(['message' => "Approved $processed claim(s).", 'processed' => $processed]);
    }

    // ─── Bulk: Admin Reject ────────────────────────────────

    public function bulkAdminReject(Request $request): JsonResponse
    {
        $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'integer',
            'reason' => 'required|string|max:1000',
        ]);

        $user = $request->user();
        if ($user->getHierarchyLevel() > 10) {
            return response()->json(['message' => 'Only admin can reject.'], 403);
        }

        $processed = 0;
        DB::transaction(function () use ($request, $user, &$processed) {
            foreach ($request->input('ids', []) as $id) {
                $r = Reimbursement::find($id);
                if (!$r) continue;
                if ($r->approval_level !== 'pending_admin') continue;
                $r->update([
                    'status' => 'rejected',
                    'approval_level' => 'rejected',
                    'approved_by' => $user->id,
                    'approved_at' => now(),
                    'rejection_reason' => $request->input('reason'),
                ]);
                $processed++;
            }
        });

        return response()->json(['message' => "Rejected $processed claim(s).", 'processed' => $processed]);
    }

    // ─── Mark a claim as paid (finance step) ───────────────

    public function markPaid(int $id, Request $request): JsonResponse
    {
        $request->validate([
            'payout_mode' => 'required|in:payroll,outside_payroll',
            'payment_reference' => 'nullable|string|max:255',
        ]);

        $user = $request->user();
        if ($user->getHierarchyLevel() > 10) {
            return response()->json(['message' => 'Only admin can mark reimbursements as paid.'], 403);
        }

        $reimbursement = Reimbursement::findOrFail($id);

        if ($reimbursement->approval_level !== 'approved') {
            return response()->json(['message' => 'Only approved reimbursements can be marked as paid.'], 422);
        }

        if ($reimbursement->paid_at) {
            return response()->json(['message' => 'This reimbursement has already been marked as paid.'], 422);
        }

        $reimbursement->update([
            'paid_at' => now(),
            'payout_mode' => $request->input('payout_mode'),
            'payment_reference' => $request->input('payment_reference'),
        ]);

        return response()->json([
            'message' => 'Reimbursement marked as paid.',
            'reimbursement' => $reimbursement->fresh()
                ->load(['employee:id,name', 'approver:id,name', 'managerApprover:id,name']),
        ]);
    }

    // ─── Pending Payments (approved but not yet paid) ──────

    public function pendingPayments(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user->getHierarchyLevel() > 10) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $items = Reimbursement::with(['employee:id,name,email', 'approver:id,name', 'managerApprover:id,name'])
            ->where('organization_id', $user->organization_id)
            ->where('approval_level', 'approved')
            ->whereNull('paid_at')
            ->forMonth($request->input('month_year'))
            ->orderBy('approved_at', 'desc')
            ->get();

        return response()->json($items);
    }

    // ─── Remove (admin pulls approved from payroll) ────────────

    public function remove(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->getHierarchyLevel() <= 10;

        if (!$isAdmin) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $reimbursement = Reimbursement::findOrFail($id);

        if ($reimbursement->status !== 'approved') {
            return response()->json([
                'message' => 'Only approved reimbursements can be removed from the salary structure.',
            ], 422);
        }

        DB::transaction(function () use ($reimbursement) {
            $reimbursement->update(['status' => 'removed']);
            ReimbursementPayrollLink::where('reimbursement_id', $reimbursement->id)->delete();
        });

        return response()->json([
            'message' => 'Reimbursement removed from salary structure.',
            'reimbursement' => $reimbursement->fresh()
                ->load(['employee:id,name', 'approver:id,name', 'managerApprover:id,name']),
        ]);
    }

    // ─── Summary ──────────────────────────────────────────────

    public function getSummary(Request $request): JsonResponse
    {
        $user = $request->user();
        $level = $user->getHierarchyLevel();
        $isStrictAdmin = $level <= 10;
        $isManager = $level >= 10 && $level < 100;

        $query = Reimbursement::query();

        if ($isStrictAdmin) {
            // Admin — all org
        } elseif ($isManager) {
            $directReportIds = EmployeeWorkInfo::where('reporting_manager_id', $user->id)
                ->pluck('user_id')
                ->toArray();
            $directReportIds[] = $user->id;
            $query->whereIn('user_id', $directReportIds);
        } else {
            $query->where('user_id', $user->id);
        }

        $query->forMonth($request->input('month_year'));

        $totalCount = (clone $query)->count();
        $totalAmount = (clone $query)->sum('amount');
        $pendingManagerCount = (clone $query)->pendingManager()->count();
        $pendingManagerAmount = (clone $query)->pendingManager()->sum('amount');
        $pendingAdminCount = (clone $query)->pendingAdmin()->count();
        $pendingAdminAmount = (clone $query)->pendingAdmin()->sum('amount');
        $approvedCount = (clone $query)->approved()->count();
        $approvedAmount = (clone $query)->approved()->sum('amount');
        $rejectedCount = (clone $query)->rejected()->count();
        $pendingPaymentCount = (clone $query)->where('approval_level', 'approved')->whereNull('paid_at')->count();
        $pendingPaymentAmount = (clone $query)->where('approval_level', 'approved')->whereNull('paid_at')->sum('amount');

        return response()->json([
            'total_count' => $totalCount,
            'total_amount' => $totalAmount,
            'pending_manager_count' => $pendingManagerCount,
            'pending_manager_amount' => $pendingManagerAmount,
            'pending_admin_count' => $pendingAdminCount,
            'pending_admin_amount' => $pendingAdminAmount,
            'approved_count' => $approvedCount,
            'approved_amount' => $approvedAmount,
            'rejected_count' => $rejectedCount,
            'pending_payment_count' => $pendingPaymentCount,
            'pending_payment_amount' => $pendingPaymentAmount,
        ]);
    }

    // ─── Inbox badge count ────────────────────────────────────

    public function inboxCount(Request $request): JsonResponse
    {
        $user = $request->user();
        $level = $user->getHierarchyLevel();
        $isStrictAdmin = $level <= 10;
        $isManager = $level >= 10 && $level < 100;

        $managerInboxCount = 0;
        $adminInboxCount = 0;

        if ($isManager || $isStrictAdmin) {
            $managerInboxCount = Reimbursement::where('approval_level', 'pending_manager')
                ->whereNull('manager_read_at')
                ->whereIn('user_id', function ($q) use ($user) {
                    $q->select('user_id')
                      ->from('employee_work_infos')
                      ->where('reporting_manager_id', $user->id);
                })
                ->count();
        }

        if ($isStrictAdmin) {
            $adminInboxCount = Reimbursement::where('organization_id', $user->organization_id)
                ->where('approval_level', 'pending_admin')
                ->whereNull('admin_read_at')
                ->count();
        }

        return response()->json([
            'manager_inbox' => $managerInboxCount,
            'admin_inbox' => $adminInboxCount,
        ]);
    }

    // ─── Mark a claim as read (clears its inbox badge) ────────

    /**
     * When a reviewer opens a claim in their inbox we stamp the
     * matching read timestamp so the sidebar badge decrements — exactly
     * like an unread chat message.
     *
     * Body: { "role": "admin" | "manager" }
     */
    public function markInboxRead(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $level = $user->getHierarchyLevel();
        $isStrictAdmin = $level <= 10;
        $isManager = $level >= 10 && $level < 100;

        $role = $request->input('role', $isStrictAdmin ? 'admin' : 'manager');

        $reimbursement = Reimbursement::findOrFail($id);

        // Only stamp the timestamp that matches the current reviewer's role
        // and only while the claim is still awaiting that level.
        if ($role === 'admin' && $isStrictAdmin && $reimbursement->approval_level === 'pending_admin') {
            if (is_null($reimbursement->admin_read_at)) {
                $reimbursement->update(['admin_read_at' => now()]);
            }
        } elseif ($role === 'manager' && $reimbursement->approval_level === 'pending_manager') {
            // Verify the reviewer is the direct manager (or an admin).
            $directReportIds = EmployeeWorkInfo::where('reporting_manager_id', $user->id)
                ->pluck('user_id')
                ->toArray();
            if (!$isStrictAdmin && !in_array($reimbursement->user_id, $directReportIds)) {
                return response()->json(['message' => 'You can only mark your direct reports\' claims as read.'], 403);
            }
            if (is_null($reimbursement->manager_read_at)) {
                $reimbursement->update(['manager_read_at' => now()]);
            }
        }

        return response()->json([
            'message' => 'Marked as read.',
            'reimbursement' => $reimbursement->fresh(),
        ]);
    }

    // ─── Upload Receipt ──────────────────────────────────────

    public function uploadReceipt(Request $request): JsonResponse
    {
        try {
            if (!$request->hasFile('file')) {
                return response()->json(['message' => 'No file uploaded.'], 422);
            }

            $file = $request->file('file');
            if (!$file->isValid()) {
                return response()->json(['message' => 'File upload failed.'], 422);
            }

            if ($file->getSize() > 5 * 1024 * 1024) {
                return response()->json(['message' => 'File too large. Max 5MB.'], 422);
            }

            $ext = strtolower($file->getClientOriginalExtension());
            $allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf'];
            if (!in_array($ext, $allowed, true)) {
                return response()->json([
                    'message' => 'Invalid file type. Allowed: JPG, PNG, GIF, WebP, PDF.',
                ], 422);
            }

            $user = $request->user();
            $storedName = time() . '_' . preg_replace('/[^a-zA-Z0-9._-]/', '_', $file->getClientOriginalName());
            $path = $file->storeAs('reimbursement-receipts/' . $user->id, $storedName, 'public');

            return response()->json([
                'url' => '/storage/' . $path,
                'filename' => $file->getClientOriginalName(),
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'message' => 'Failed to upload receipt: ' . $e->getMessage(),
            ], 500);
        }
    }
}
