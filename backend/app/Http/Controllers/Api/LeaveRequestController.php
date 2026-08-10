<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\User;
use App\Services\AppNotificationService;
use App\Services\Approvals\ApprovalRoutingService;
use App\Services\Audit\AuditLogService;
use App\Services\Leave\LeavePolicyService;
use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Http\Request;

class LeaveRequestController extends Controller
{
    public function __construct(
        private readonly AppNotificationService $notificationService,
        private readonly ApprovalRoutingService $approvalRoutingService,
        private readonly AuditLogService $auditLogService,
        private readonly LeavePolicyService $leavePolicyService,
    ) {
    }

    public function index(Request $request)
    {
        $request->validate([
            'status' => 'nullable|in:pending,approved,rejected,revoked,auto_cancelled',
            'user_id' => 'nullable|integer',
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date',
            'limit' => 'nullable|integer|min:1|max:500',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['data' => []]);
        }

        LeaveRequest::expirePendingRequestsForOrganization((int) $currentUser->organization_id);

        $query = LeaveRequest::with([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
                'revokeReviewer:id,name,email',
                'escalatedTo:id,name,email',
            ])
            ->where('organization_id', $currentUser->organization_id)
            ->orderByDesc('created_at');

        if (!$this->canManage($currentUser)) {
            $query->where('user_id', $currentUser->id);
        } else {
            $visibleUserIds = $this->approvalRoutingService->reviewableRequesterIds($currentUser);

            // Every user always sees their own leave requests.
            $visibleUserIds->push((int) $currentUser->id);

            // Also surface requests escalated (transferred) to this user.
            $query->where(function ($q) use ($visibleUserIds, $currentUser) {
                $q->whereIn('user_id', $visibleUserIds->unique()->values())
                    ->orWhere('escalated_to_user_id', (int) $currentUser->id);
            });

            if ($request->filled('user_id')) {
                $query->where('user_id', (int) $request->user_id);
            }
        }

        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }

        if ($request->filled('start_date') || $request->filled('end_date')) {
            $startDate = $request->filled('start_date')
                ? Carbon::parse((string) $request->start_date)->startOfDay()
                : null;
            $endDate = $request->filled('end_date')
                ? Carbon::parse((string) $request->end_date)->endOfDay()
                : null;

            if ($startDate && $endDate && $startDate->greaterThan($endDate)) {
                [$startDate, $endDate] = [$endDate->copy()->startOfDay(), $startDate->copy()->endOfDay()];
            }

            $query
                ->when($startDate, fn ($leaveQuery) => $leaveQuery->whereDate('end_date', '>=', $startDate->toDateString()))
                ->when($endDate, fn ($leaveQuery) => $leaveQuery->whereDate('start_date', '<=', $endDate->toDateString()));
        }

        $limit = (int) $request->input('limit', 10);

        // The default cap of 10 is fine, but returning the page with no idea of
        // how large the set is meant an approval badge counting this array
        // reported "10 pending" against 28 real requests — and clearing the
        // badge left the rest invisible. `total` is the count before limiting,
        // so callers can show a true figure and know when they are truncated.
        $total = (clone $query)->count();

        return response()->json([
            'data' => $query->limit($limit)->get()->map(fn (LeaveRequest $leave) => $this->withApprovalDestination($leave)),
            'total' => $total,
            'limit' => $limit,
            'truncated' => $total > $limit,
        ]);
    }

    public function balances(Request $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        $currentUser->loadMissing('organization');
        $policyCategories = $this->leavePolicyService->resolvePolicyCategories($currentUser->organization);
        $selfBalance = $this->leavePolicyService->buildBalanceSnapshotForUser($currentUser, $policyCategories);

        $teamBalances = collect();
        if ($this->canManage($currentUser)) {
            $teamUsersQuery = User::query()
                ->where('organization_id', $currentUser->organization_id)
                ->where('id', '!=', (int) $currentUser->id)
                ->with(['groups:id,name', 'employeeWorkInfo.department:id,name', 'employeeWorkInfo.reportingManager:id,name,email'])
                ->orderBy('name');

            $reviewableUserIds = $this->approvalRoutingService
                ->reviewableRequesterIds($currentUser)
                ->unique()
                ->values();

            if ($reviewableUserIds->isNotEmpty()) {
                $teamUsersQuery->whereIn('id', $reviewableUserIds);
            } else {
                $teamUsersQuery->whereRaw('0 = 1');
            }

            $teamUsers = $teamUsersQuery->get(['id', 'name', 'email', 'role', 'role_id', 'organization_id']);

            $teamBalances = $teamUsers->map(function (User $teamUser) use ($policyCategories) {
                $departmentName = (string) (
                    $teamUser->employeeWorkInfo?->department?->name
                    ?: $teamUser->groups->first()?->name
                    ?: 'Unassigned'
                );
                $reportingManager = $teamUser->employeeWorkInfo?->reportingManager;

                return [
                    'user' => [
                        'id' => (int) $teamUser->id,
                        'name' => (string) $teamUser->name,
                        'email' => (string) $teamUser->email,
                        'role' => (string) $teamUser->role,
                        'department' => $departmentName,
                        'reporting_manager' => $reportingManager
                            ? [
                                'id' => (int) $reportingManager->id,
                                'name' => (string) $reportingManager->name,
                                'email' => (string) $reportingManager->email,
                            ]
                            : null,
                    ],
                    'balance' => $this->leavePolicyService->buildBalanceSnapshotForUser($teamUser, $policyCategories),
                ];
            })->values();
        }

        return response()->json([
            'policy' => [
                'categories' => $policyCategories,
                'unpaid' => [
                    'code' => 'unpaid',
                    'name' => 'Unpaid Leave',
                ],
            ],
            'self' => $selfBalance,
            'team' => $teamBalances,
            'approval_scope' => [
                'can_manage' => $this->canManage($currentUser),
                'can_approve_levels' => $this->approvalRoutingService->reviewerHierarchyLevels($currentUser),
            ],
        ]);
    }

    public function store(Request $request)
    {
        $request->validate([
            'start_date' => 'required|date',
            'end_date' => 'required|date|after_or_equal:start_date',
            'leave_type' => 'nullable|in:full_day,half_day',
            'leave_category' => 'nullable|string|max:50',
            'reason' => 'nullable|string|max:2000',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        $currentUser->loadMissing('organization');
        $policyCategories = $this->leavePolicyService->resolvePolicyCategories($currentUser->organization);
        $leaveCategory = $this->leavePolicyService->normalizeRequestedCategory(
            (string) $request->input('leave_category', 'paid'),
            $policyCategories
        );

        LeaveRequest::expirePendingRequestsForOrganization((int) $currentUser->organization_id);

        $startDate = Carbon::parse($request->start_date)->startOfDay();
        $endDate = Carbon::parse($request->end_date)->startOfDay();
        $leaveType = (string) ($request->input('leave_type') ?: 'full_day');

        if ($leaveType === 'half_day' && !$startDate->isSameDay($endDate)) {
            return response()->json(['message' => 'Half day leave can only be requested for a single date.'], 422);
        }

        $overlapExists = LeaveRequest::where('organization_id', $currentUser->organization_id)
            ->where('user_id', $currentUser->id)
            ->whereIn('status', ['pending', 'approved'])
            ->whereDate('start_date', '<=', $endDate->toDateString())
            ->whereDate('end_date', '>=', $startDate->toDateString())
            ->exists();

        if ($overlapExists) {
            return response()->json(['message' => 'An overlapping leave request already exists.'], 422);
        }

        // Check leave balance for non-unpaid categories
        if ($leaveCategory !== 'unpaid') {
            $balanceSnapshot = $this->leavePolicyService->buildBalanceSnapshotForUser($currentUser, $policyCategories);
            $categoryBalance = collect($balanceSnapshot['categories'] ?? [])
                ->firstWhere('code', $leaveCategory);

            if (! $categoryBalance) {
                return response()->json([
                    'message' => "Leave category '{$leaveCategory}' is not available.",
                ], 422);
            }

            $categoryName = $categoryBalance['name'];
            $remaining = (float) $categoryBalance['remaining'];

            if ($remaining <= 0) {
                return response()->json([
                    'message' => "You have already used your {$categoryName} for this year.",
                ], 422);
            }

            // Calculate requested units using inclusive date range (CarbonPeriod includes both start and end)
            $requestedUnits = 0.0;
            $unitPerDay = $leaveType === 'half_day' ? 0.5 : 1.0;
            foreach (\Carbon\CarbonPeriod::create($startDate->copy()->startOfDay(), $endDate->copy()->startOfDay()) as $date) {
                if ($date->isWeekday()) {
                    $requestedUnits += $unitPerDay;
                }
            }

            if ($requestedUnits <= 0) {
                return response()->json([
                    'message' => 'Leave request covers no working days.',
                ], 422);
            }

            if ($requestedUnits > $remaining) {
                return response()->json([
                    'message' => "You do not have sufficient {$categoryName} balance. Remaining: {$remaining} day(s), Requested: {$requestedUnits} day(s).",
                ], 422);
            }
        }

        if (! $this->approvalRoutingService->hasEligibleReviewer($currentUser)) {
            return response()->json([
                'message' => $this->approvalRoutingService->missingReviewerMessage($currentUser),
            ], 422);
        }

        $leave = LeaveRequest::create([
            'organization_id' => $currentUser->organization_id,
            'user_id' => $currentUser->id,
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
            'leave_type' => $leaveType,
            'leave_category' => $leaveCategory,
            'reason' => $request->reason,
            'status' => 'pending',
        ]);

        $this->auditLogService->log(
            action: 'leave.requested',
            actor: $currentUser,
            target: $leave,
            metadata: [
                'start_date' => $leave->start_date,
                'end_date' => $leave->end_date,
                'leave_type' => $leave->leave_type,
                'leave_category' => $leave->leave_category,
            ],
            request: $request
        );

        $this->sendSubmissionNotification($leave, $currentUser);
        $this->sendApplicantConfirmation($leave, $currentUser);
        $this->notifyAdminsOfRequest(
            requester: $currentUser,
            kind: 'leave_request',
            action: 'submitted',
            request: $leave,
            note: null,
        );

        return response()->json([
            'message' => 'Leave request submitted.',
            'data' => $this->withApprovalDestination($leave->load([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
                'revokeReviewer:id,name,email',
                'escalatedTo:id,name,email',
                'escalatedTo:id,name,email',
            ])),
        ], 201);
    }

    public function approve(Request $request, int $id)
    {
        $request->validate([
            'review_note' => 'nullable|string|max:2000',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id || !$this->canManage($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        LeaveRequest::expirePendingRequestsForOrganization((int) $currentUser->organization_id);

        $leave = LeaveRequest::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$leave) {
            return response()->json(['message' => 'Leave request not found'], 404);
        }
        $leave->loadMissing('user.employeeWorkInfo');
        if (!$leave->user || !($this->approvalRoutingService->canReview($currentUser, $leave->user) || (int) $leave->escalated_to_user_id === (int) $currentUser->id)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if ($leave->hasExpiredPendingWindow()) {
            LeaveRequest::expirePendingRequestsForOrganization((int) $currentUser->organization_id);
            $leave->refresh();
        }

        if ($leave->status !== 'pending') {
            return response()->json(['message' => 'Only pending requests can be approved.'], 422);
        }

        $currentUser->loadMissing('organization');
        $policyCategories = $this->leavePolicyService->resolvePolicyCategories($currentUser->organization);
        $cycleStart = $this->leavePolicyService->currentCycleStart();
        $cycleEnd = $this->leavePolicyService->currentCycleEnd();
        $approvedLeavesInCycle = LeaveRequest::query()
            ->where('organization_id', $currentUser->organization_id)
            ->where('user_id', $leave->user_id)
            ->where('status', 'approved')
            ->whereDate('end_date', '>=', $cycleStart->toDateString())
            ->whereDate('start_date', '<=', $cycleEnd->toDateString())
            ->orderBy('reviewed_at')
            ->orderBy('id')
            ->get();
        $consumedBreakdown = $this->leavePolicyService->buildConsumptionBreakdown(
            $leave,
            $policyCategories,
            $approvedLeavesInCycle
        );

        $leave->update([
            'status' => 'approved',
            'reviewed_by' => $currentUser->id,
            'reviewed_at' => now(),
            'review_note' => $request->review_note,
            'consumed_breakdown' => $consumedBreakdown,
        ]);

        $this->applyApprovedLeaveToAttendance($leave);

        $this->auditLogService->log(
            action: 'leave.approved',
            actor: $currentUser,
            target: $leave,
            metadata: [
                'employee_id' => $leave->user_id,
                'start_date' => $leave->start_date,
                'end_date' => $leave->end_date,
                'leave_type' => $leave->leave_type,
                'leave_category' => $leave->leave_category,
                'consumed_breakdown' => $leave->consumed_breakdown,
            ],
            request: $request
        );

        $this->sendReviewNotification($leave->fresh()->load([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
            ]), $currentUser, 'approved');

        return response()->json([
            'message' => 'Leave request approved.',
            'data' => $leave->fresh()->load([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
                'revokeReviewer:id,name,email',
                'escalatedTo:id,name,email',
            ]),
        ]);
    }

    public function reject(Request $request, int $id)
    {
        $request->validate([
            'review_note' => 'nullable|string|max:2000',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id || !$this->canManage($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        LeaveRequest::expirePendingRequestsForOrganization((int) $currentUser->organization_id);

        $leave = LeaveRequest::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$leave) {
            return response()->json(['message' => 'Leave request not found'], 404);
        }
        $leave->loadMissing('user.employeeWorkInfo');
        if (!$leave->user || !($this->approvalRoutingService->canReview($currentUser, $leave->user) || (int) $leave->escalated_to_user_id === (int) $currentUser->id)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if ($leave->hasExpiredPendingWindow()) {
            LeaveRequest::expirePendingRequestsForOrganization((int) $currentUser->organization_id);
            $leave->refresh();
        }

        if ($leave->status !== 'pending') {
            return response()->json(['message' => 'Only pending requests can be rejected.'], 422);
        }

        $leave->update([
            'status' => 'rejected',
            'reviewed_by' => $currentUser->id,
            'reviewed_at' => now(),
            'review_note' => $request->review_note,
        ]);

        $this->auditLogService->log(
            action: 'leave.rejected',
            actor: $currentUser,
            target: $leave,
            metadata: [
                'employee_id' => $leave->user_id,
                'start_date' => $leave->start_date,
                'end_date' => $leave->end_date,
                'leave_type' => $leave->leave_type,
            ],
            request: $request
        );

        $this->sendReviewNotification($leave->fresh()->load([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
            ]), $currentUser, 'rejected');

        return response()->json([
            'message' => 'Leave request rejected.',
            'data' => $leave->fresh()->load([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
                'revokeReviewer:id,name,email',
                'escalatedTo:id,name,email',
            ]),
        ]);
    }

    public function transfer(Request $request, int $id)
    {
        $request->validate([
            'note' => 'nullable|string|max:2000',
            'to_user_id' => 'nullable|integer|exists:users,id',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        $leave = LeaveRequest::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$leave) {
            return response()->json(['message' => 'Leave request not found'], 404);
        }

        // Only the user *currently holding* the request may forward it upward,
        // enforcing a strict chain: employee -> team lead -> manager -> admin.
        // The current holder is the nearest reviewer (or the escalated target).
        $currentHolderIds = $this->approvalRoutingService->currentReviewerIds($leave->user, $leave->escalated_to_user_id);
        if (! $currentHolderIds->contains((int) $currentUser->id) && ! $this->canManage($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if ($leave->status !== 'pending') {
            return response()->json(['message' => 'Only pending requests can be transferred.'], 422);
        }

        $requester = $leave->user()->with('employeeWorkInfo', 'customRole')->firstOrFail();

        $excludeUserId = $leave->escalated_to_user_id ?? $this->immediateReviewerId($requester);

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

        $history = $leave->escalation_history ?? [];
        $history[] = [
            'from_user_id' => $excludeUserId ? (int) $excludeUserId : null,
            'to_user_id' => $targetUser->id,
            'to_level' => $targetUser->name,
            'note' => $request->note,
            'by_user_id' => (int) $currentUser->id,
            'at' => now()->toIso8601String(),
        ];

        $leave->update([
            'escalated_to_user_id' => $targetUser->id,
            'escalation_history' => $history,
        ]);

        $dateRange = sprintf(
            '%s to %s',
            Carbon::parse($leave->start_date)->toDateString(),
            Carbon::parse($leave->end_date)->toDateString()
        );

        $this->notificationService->sendToUsers(
            organizationId: (int) $leave->organization_id,
            userIds: collect([$targetUser->id]),
            senderId: (int) $requester->id,
            type: 'leave_request',
            title: 'Leave Request Forwarded to You',
            message: sprintf(
                '%s forwarded a leave request (%s) to you for approval.',
                (string) $requester->name,
                $dateRange
            ),
            meta: [
                'route' => '/approval-inbox',
                'approval_kind' => 'leave_request',
                'request_id' => (int) $leave->id,
                'employee_id' => (int) $requester->id,
                'employee_name' => (string) $requester->name,
                'start_date' => Carbon::parse($leave->start_date)->toDateString(),
                'end_date' => Carbon::parse($leave->end_date)->toDateString(),
                'escalated' => true,
            ]
        );

        $this->notifyAdminsOfRequest(
            requester: $requester,
            kind: 'leave_request',
            action: 'transferred',
            request: $leave,
            note: $request->note,
        );

        $this->auditLogService->log(
            action: 'leave.escalated',
            actor: $currentUser,
            target: $leave,
            metadata: [
                'employee_id' => $leave->user_id,
                'escalated_to_user_id' => $targetUser->id,
                'escalated_to_names' => [$targetUser->name],
            ],
            request: $request
        );

        return response()->json([
            'message' => 'Leave request transferred to the next hierarchy level.',
            'data' => $this->withApprovalDestination($leave->fresh()->load([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
                'revokeReviewer:id,name,email',
                'escalatedTo:id,name,email',
                'escalatedTo:id,name,email',
            ])),
        ]);
    }

    public function forwardTargets(Request $request, int $id)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['data' => []]);
        }

        $leave = LeaveRequest::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$leave) {
            return response()->json(['message' => 'Leave request not found'], 404);
        }

        $requester = $leave->user()->with('employeeWorkInfo', 'customRole')->firstOrFail();
        $excludeUserId = $leave->escalated_to_user_id ?? $this->immediateReviewerId($requester);

        $targets = $this->approvalRoutingService->forwardTargets($requester, $excludeUserId);

        return response()->json(['data' => $targets->all()]);
    }

    public function requestRevoke(Request $request, int $id)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        $leave = LeaveRequest::where('organization_id', $currentUser->organization_id)
            ->where('user_id', $currentUser->id)
            ->find($id);
        if (!$leave) {
            return response()->json(['message' => 'Leave request not found'], 404);
        }
        if ($leave->status !== 'approved') {
            return response()->json(['message' => 'Only approved leave can be revoked.'], 422);
        }
        if ($leave->revoke_status === 'pending') {
            return response()->json(['message' => 'Revoke request is already pending.'], 422);
        }

        $deadline = Carbon::parse($leave->start_date)->subDay()->startOfDay();
        if (now()->greaterThan($deadline)) {
            return response()->json(['message' => 'Revoke request is allowed only until 1 day before leave start date.'], 422);
        }

        $leave->update([
            'revoke_status' => 'pending',
            'revoke_requested_at' => now(),
            'revoke_reviewed_by' => null,
            'revoke_reviewed_at' => null,
            'revoke_review_note' => null,
        ]);

        $this->auditLogService->log(
            action: 'leave.revoke_requested',
            actor: $currentUser,
            target: $leave,
            metadata: [
                'start_date' => $leave->start_date,
                'end_date' => $leave->end_date,
                'leave_type' => $leave->leave_type,
            ],
            request: $request
        );

        return response()->json([
            'message' => 'Leave revoke request submitted.',
            'data' => $leave->fresh()->load([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
                'revokeReviewer:id,name,email',
                'escalatedTo:id,name,email',
            ]),
        ]);
    }

    public function approveRevoke(Request $request, int $id)
    {
        $request->validate([
            'review_note' => 'nullable|string|max:2000',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id || !$this->canManage($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $leave = LeaveRequest::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$leave) {
            return response()->json(['message' => 'Leave request not found'], 404);
        }
        $leave->loadMissing('user.employeeWorkInfo');
        if (!$leave->user || !($this->approvalRoutingService->canReview($currentUser, $leave->user) || (int) $leave->escalated_to_user_id === (int) $currentUser->id)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if ($leave->status !== 'approved' || $leave->revoke_status !== 'pending') {
            return response()->json(['message' => 'Only pending revoke requests can be approved.'], 422);
        }

        $leave->update([
            'status' => 'revoked',
            'revoke_status' => 'approved',
            'revoke_reviewed_by' => $currentUser->id,
            'revoke_reviewed_at' => now(),
            'revoke_review_note' => $request->review_note,
        ]);

        $this->rollbackApprovedLeaveFromAttendance($leave);

        $this->auditLogService->log(
            action: 'leave.revoke_approved',
            actor: $currentUser,
            target: $leave,
            metadata: [
                'employee_id' => $leave->user_id,
                'start_date' => $leave->start_date,
                'end_date' => $leave->end_date,
                'leave_type' => $leave->leave_type,
            ],
            request: $request
        );

        return response()->json([
            'message' => 'Leave revoke request approved.',
            'data' => $leave->fresh()->load([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
                'revokeReviewer:id,name,email',
                'escalatedTo:id,name,email',
            ]),
        ]);
    }

    public function rejectRevoke(Request $request, int $id)
    {
        $request->validate([
            'review_note' => 'nullable|string|max:2000',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id || !$this->canManage($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $leave = LeaveRequest::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$leave) {
            return response()->json(['message' => 'Leave request not found'], 404);
        }
        $leave->loadMissing('user.employeeWorkInfo');
        if (!$leave->user || !($this->approvalRoutingService->canReview($currentUser, $leave->user) || (int) $leave->escalated_to_user_id === (int) $currentUser->id)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if ($leave->status !== 'approved' || $leave->revoke_status !== 'pending') {
            return response()->json(['message' => 'Only pending revoke requests can be rejected.'], 422);
        }

        $leave->update([
            'revoke_status' => 'rejected',
            'revoke_reviewed_by' => $currentUser->id,
            'revoke_reviewed_at' => now(),
            'revoke_review_note' => $request->review_note,
        ]);

        $this->auditLogService->log(
            action: 'leave.revoke_rejected',
            actor: $currentUser,
            target: $leave,
            metadata: [
                'employee_id' => $leave->user_id,
                'start_date' => $leave->start_date,
                'end_date' => $leave->end_date,
                'leave_type' => $leave->leave_type,
            ],
            request: $request
        );

        return response()->json([
            'message' => 'Leave revoke request rejected.',
            'data' => $leave->fresh()->load([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
                'revokeReviewer:id,name,email',
                'escalatedTo:id,name,email',
            ]),
        ]);
    }

    private function applyApprovedLeaveToAttendance(LeaveRequest $leave): void
    {
        foreach (CarbonPeriod::create($leave->start_date, $leave->end_date) as $date) {
            $dateStr = $date->toDateString();
            if ($date->isWeekend()) {
                continue;
            }

            $record = AttendanceRecord::firstOrNew([
                'user_id' => $leave->user_id,
                'attendance_date' => $dateStr,
            ]);
            $record->organization_id = $leave->organization_id;

            // Keep real worked days untouched.
            if ($record->exists && ($record->check_in_at || (int) $record->worked_seconds > 0)) {
                continue;
            }

            $record->fill([
                'check_in_at' => null,
                'check_out_at' => null,
                'worked_seconds' => 0,
                'late_minutes' => 0,
                'status' => $leave->isHalfDay() ? 'half_leave' : 'absent',
            ]);
            $record->save();
        }
    }

    private function rollbackApprovedLeaveFromAttendance(LeaveRequest $leave): void
    {
        foreach (CarbonPeriod::create($leave->start_date, $leave->end_date) as $date) {
            if ($date->isWeekend()) {
                continue;
            }

            AttendanceRecord::where('organization_id', $leave->organization_id)
                ->where('user_id', $leave->user_id)
                ->whereDate('attendance_date', $date->toDateString())
                ->whereNull('check_in_at')
                ->whereNull('check_out_at')
                ->where('worked_seconds', 0)
                ->whereIn('status', ['absent', 'half_leave'])
                ->delete();
        }
    }

    private function canManage(User $user): bool
    {
        return ! empty($this->approvalRoutingService->reviewerHierarchyLevels($user));
    }

    private function immediateReviewerId(User $requester): ?int
    {
        return $this->approvalRoutingService->reviewerUserIds($requester)->first();
    }

    /**
     * Notify all org admins that an employee submitted/transferred a request to
     * a given hierarchy level. Mirrors the employee-side "approval_destination".
     */
    private function notifyAdminsOfRequest(User $requester, string $kind, string $action, LeaveRequest $request, ?string $note): void
    {
        $adminIds = $this->approvalRoutingService->organizationAdminIds($requester);
        if ($adminIds->isEmpty()) {
            return;
        }

        if ($request->escalated_to_user_id) {
            $destinationNames = User::query()
                ->where('id', (int) $request->escalated_to_user_id)
                ->pluck('name')
                ->map(fn ($n) => trim((string) $n))
                ->filter()
                ->values();
        } else {
            $destinationNames = User::query()
                ->whereIn('id', $this->approvalRoutingService->reviewerUserIds($requester))
                ->pluck('name')
                ->map(fn ($n) => trim((string) $n))
                ->filter()
                ->values();
        }
        // Use the actual person names (no generic "team lead"/"manager" label).
        $destination = $destinationNames->isEmpty() ? 'the approver' : $destinationNames->implode(', ');

        $dateRange = sprintf(
            '%s to %s',
            Carbon::parse($request->start_date)->toDateString(),
            Carbon::parse($request->end_date)->toDateString()
        );

        $this->notificationService->sendToUsers(
            organizationId: (int) $requester->organization_id,
            userIds: $adminIds,
            senderId: (int) $requester->id,
            type: $kind,
            title: $action === 'transferred' ? 'Leave Request Transferred' : 'Leave Request Submitted',
            message: sprintf(
                '%s %s a leave request (%s) to %s.',
                (string) $requester->name,
                $action,
                $dateRange,
                $destination
            ).(filled($note) ? ' Note: '.$note : ''),
            meta: [
                'route' => '/approval-inbox',
                'approval_kind' => 'leave_request',
                'request_id' => (int) $request->id,
                'employee_id' => (int) $requester->id,
                'employee_name' => (string) $requester->name,
                'start_date' => Carbon::parse($request->start_date)->toDateString(),
                'end_date' => Carbon::parse($request->end_date)->toDateString(),
            ]
        );
    }

    private function sendSubmissionNotification(LeaveRequest $leave, User $requester): void
    {
        $reviewerIds = $this->approvalRoutingService->reviewerUserIds($requester);
        if ($reviewerIds->isEmpty()) {
            return;
        }

        $this->notificationService->sendToUsers(
            organizationId: (int) $leave->organization_id,
            userIds: $reviewerIds,
            senderId: (int) $requester->id,
            type: 'leave_request',
            title: $leave->isHalfDay() ? 'Half Day Leave Request Submitted' : 'Leave Request Submitted',
            message: sprintf(
                '%s submitted a %s leave request from %s to %s.',
                (string) $requester->name,
                $leave->isHalfDay() ? 'half day' : 'full day',
                Carbon::parse($leave->start_date)->toDateString(),
                Carbon::parse($leave->end_date)->toDateString()
            ),
            meta: [
                'route' => '/approval-inbox',
                'approval_kind' => 'leave_request',
                'request_id' => (int) $leave->id,
                'employee_id' => (int) $leave->user_id,
                'employee_name' => (string) $requester->name,
                'leave_type' => $leave->leave_type,
                'leave_category' => $leave->leave_category,
                'start_date' => Carbon::parse($leave->start_date)->toDateString(),
                'end_date' => Carbon::parse($leave->end_date)->toDateString(),
            ]
        );
    }

    private function sendApplicantConfirmation(LeaveRequest $leave, User $requester): void
    {
        $this->notificationService->sendToUsers(
            organizationId: (int) $leave->organization_id,
            userIds: collect([(int) $requester->id]),
            senderId: (int) $requester->id,
            type: 'leave_request',
            title: $leave->isHalfDay() ? 'Half Day Leave Request Submitted' : 'Leave Request Submitted',
            message: sprintf(
                'Your %s leave request from %s to %s has been submitted and is pending approval.',
                $leave->isHalfDay() ? 'half day' : 'full day',
                Carbon::parse($leave->start_date)->toDateString(),
                Carbon::parse($leave->end_date)->toDateString()
            ),
            meta: [
                'route' => '/leave',
                'request_id' => (int) $leave->id,
                'leave_type' => $leave->leave_type,
                'leave_category' => $leave->leave_category,
                'status' => 'pending',
                'start_date' => Carbon::parse($leave->start_date)->toDateString(),
                'end_date' => Carbon::parse($leave->end_date)->toDateString(),
            ]
        );
    }

    private function withApprovalDestination(LeaveRequest $leave): LeaveRequest
    {
        $leave->loadMissing('user.employeeWorkInfo');
        if (! $leave->user) {
            $leave->setAttribute('approval_destination', 'Sent to reviewer');
            return $leave;
        }

        $reviewerNames = User::query()
            ->whereIn('id', $this->approvalRoutingService->reviewerUserIds($leave->user))
            ->pluck('name')
            ->map(fn ($name) => trim((string) $name))
            ->filter()
            ->values();

        // Once forwarded, show the actual recipient; otherwise the real
        // reviewer names (no generic "team lead"/"manager" label that ignores
        // the actual role of the person holding the request).
        if ($leave->escalated_to_user_id && $leave->escalatedTo) {
            $leave->setAttribute('approval_destination', 'Forwarded to '.$leave->escalatedTo->name);
        } else {
            $leave->setAttribute(
                'approval_destination',
                $reviewerNames->isEmpty() ? 'Sent to reviewer' : 'Sent to '.$reviewerNames->implode(', ')
            );
        }

        $leave->setAttribute('escalated_to', $leave->escalatedTo?->only(['id', 'name']));
        $leave->setAttribute('escalation_history', $leave->escalation_history ?? []);
        $leave->setAttribute(
            'current_reviewer_ids',
            $this->approvalRoutingService->currentReviewerIds($leave->user, $leave->escalated_to_user_id)->values()->all()
        );

        return $leave;
    }

    private function sendReviewNotification(LeaveRequest $leave, User $reviewer, string $status): void
    {
        $leave->loadMissing('user');
        if (! $leave->user) {
            return;
        }

        $reviewerName = trim((string) $reviewer->name);
        $reviewerLabel = $reviewerName !== '' && $reviewer->id !== $leave->user_id
            ? " by {$reviewerName}"
            : '';
        $note = filled($leave->review_note)
            ? ' Note: '.$leave->review_note
            : '';

        $this->notificationService->sendToUsers(
            organizationId: (int) $leave->organization_id,
            userIds: collect([(int) $leave->user_id]),
            senderId: (int) $reviewer->id,
            type: 'leave_request',
            title: $status === 'approved'
                ? ($leave->isHalfDay() ? 'Half Day Leave Request Approved' : 'Leave Request Approved')
                : ($leave->isHalfDay() ? 'Half Day Leave Request Rejected' : 'Leave Request Rejected'),
            message: sprintf(
                'Your %s leave request from %s to %s was %s%s.%s',
                $leave->isHalfDay() ? 'half day' : 'full day',
                Carbon::parse($leave->start_date)->toDateString(),
                Carbon::parse($leave->end_date)->toDateString(),
                $status,
                $reviewerLabel,
                $note
            ),
            meta: [
                'route' => '/leave',
                'request_id' => (int) $leave->id,
                'leave_type' => $leave->leave_type,
                'leave_category' => $leave->leave_category,
                'consumed_breakdown' => $leave->consumed_breakdown,
                'status' => $status,
                'start_date' => Carbon::parse($leave->start_date)->toDateString(),
                'end_date' => Carbon::parse($leave->end_date)->toDateString(),
                'review_note' => $leave->review_note,
            ]
        );

        // Keep admins in the loop on the final decision (accepted/rejected).
        $adminIds = $this->approvalRoutingService->organizationAdminIds($leave->user);
        if ($adminIds->isNotEmpty()) {
            $dateRange = sprintf(
                '%s to %s',
                Carbon::parse($leave->start_date)->toDateString(),
                Carbon::parse($leave->end_date)->toDateString()
            );
            $this->notificationService->sendToUsers(
                organizationId: (int) $leave->organization_id,
                userIds: $adminIds,
                senderId: (int) $reviewer->id,
                type: 'leave_request',
                title: $status === 'approved' ? 'Leave Request Approved' : 'Leave Request Rejected',
                message: sprintf(
                    '%s %s %s\'s leave request (%s).',
                    (string) $reviewer->name,
                    $status,
                    (string) $leave->user->name,
                    $dateRange
                ),
                meta: [
                    'route' => '/approval-inbox',
                    'approval_kind' => 'leave_request',
                    'request_id' => (int) $leave->id,
                    'employee_id' => (int) $leave->user_id,
                    'employee_name' => (string) $leave->user->name,
                    'start_date' => Carbon::parse($leave->start_date)->toDateString(),
                    'end_date' => Carbon::parse($leave->end_date)->toDateString(),
                    'status' => $status,
                ]
            );
        }
    }
}
