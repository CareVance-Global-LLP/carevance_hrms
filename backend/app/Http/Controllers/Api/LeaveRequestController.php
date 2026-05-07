<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\User;
use App\Services\AppNotificationService;
use App\Services\Approvals\ApprovalRoutingService;
use App\Services\Audit\AuditLogService;
use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Http\Request;

class LeaveRequestController extends Controller
{
    public function __construct(
        private readonly AppNotificationService $notificationService,
        private readonly ApprovalRoutingService $approvalRoutingService,
        private readonly AuditLogService $auditLogService,
    ) {
    }

    public function index(Request $request)
    {
        $request->validate([
            'status' => 'nullable|in:pending,approved,rejected,revoked',
            'user_id' => 'nullable|integer',
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date',
            'limit' => 'nullable|integer|min:1|max:500',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['data' => []]);
        }

        $query = LeaveRequest::with(['user:id,name,email,role,organization_id', 'reviewer:id,name,email', 'revokeReviewer:id,name,email'])
            ->where('organization_id', $currentUser->organization_id)
            ->orderByDesc('created_at');

        if (!$this->canManage($currentUser)) {
            $query->where('user_id', $currentUser->id);
        } else {
            $visibleUserIds = $this->approvalRoutingService->reviewableRequesterIds($currentUser)
                ->push((int) $currentUser->id)
                ->unique()
                ->values();

            $query->whereIn('user_id', $visibleUserIds);

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

        return response()->json([
            'data' => $query->limit($limit)->get()->map(fn (LeaveRequest $leave) => $this->withApprovalDestination($leave)),
        ]);
    }

    public function store(Request $request)
    {
        $request->validate([
            'start_date' => 'required|date',
            'end_date' => 'required|date|after_or_equal:start_date',
            'leave_type' => 'nullable|in:full_day,half_day',
            'reason' => 'nullable|string|max:2000',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

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
            ],
            request: $request
        );

        $this->sendSubmissionNotification($leave, $currentUser);

        return response()->json([
            'message' => 'Leave request submitted.',
            'data' => $this->withApprovalDestination($leave->load(['user:id,name,email,role,organization_id', 'reviewer:id,name,email', 'revokeReviewer:id,name,email'])),
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

        $leave = LeaveRequest::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$leave) {
            return response()->json(['message' => 'Leave request not found'], 404);
        }
        $leave->loadMissing('user.employeeWorkInfo');
        if (!$leave->user || !$this->approvalRoutingService->canReview($currentUser, $leave->user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if ($leave->status !== 'pending') {
            return response()->json(['message' => 'Only pending requests can be approved.'], 422);
        }

        $leave->update([
            'status' => 'approved',
            'reviewed_by' => $currentUser->id,
            'reviewed_at' => now(),
            'review_note' => $request->review_note,
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
            ],
            request: $request
        );

        $this->sendReviewNotification($leave->fresh()->load(['user:id,name,email,role']), $currentUser, 'approved');

        return response()->json([
            'message' => 'Leave request approved.',
            'data' => $leave->fresh()->load(['user:id,name,email,role', 'reviewer:id,name,email', 'revokeReviewer:id,name,email']),
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

        $leave = LeaveRequest::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$leave) {
            return response()->json(['message' => 'Leave request not found'], 404);
        }
        $leave->loadMissing('user.employeeWorkInfo');
        if (!$leave->user || !$this->approvalRoutingService->canReview($currentUser, $leave->user)) {
            return response()->json(['message' => 'Forbidden'], 403);
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

        $this->sendReviewNotification($leave->fresh()->load(['user:id,name,email,role']), $currentUser, 'rejected');

        return response()->json([
            'message' => 'Leave request rejected.',
            'data' => $leave->fresh()->load(['user:id,name,email,role', 'reviewer:id,name,email', 'revokeReviewer:id,name,email']),
        ]);
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
            'data' => $leave->fresh()->load(['user:id,name,email,role', 'reviewer:id,name,email', 'revokeReviewer:id,name,email']),
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
        if (!$leave->user || !$this->approvalRoutingService->canReview($currentUser, $leave->user)) {
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
            'data' => $leave->fresh()->load(['user:id,name,email,role', 'reviewer:id,name,email', 'revokeReviewer:id,name,email']),
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
        if (!$leave->user || !$this->approvalRoutingService->canReview($currentUser, $leave->user)) {
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
            'data' => $leave->fresh()->load(['user:id,name,email,role', 'reviewer:id,name,email', 'revokeReviewer:id,name,email']),
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
        return in_array($user->role, ['admin', 'manager'], true);
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

        $reviewerLabel = match ($leave->user->role) {
            'employee' => $reviewerNames->count() === 1 ? 'your group manager' : 'your group managers',
            'manager' => $reviewerNames->count() === 1 ? 'an admin' : 'admins',
            default => 'the reviewer',
        };

        $leave->setAttribute(
            'approval_destination',
            $reviewerNames->isEmpty()
                ? "Sent to {$reviewerLabel}"
                : sprintf('Sent to %s: %s', $reviewerLabel, $reviewerNames->implode(', '))
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
                'request_id' => (int) $leave->id,
                'leave_type' => $leave->leave_type,
                'status' => $status,
                'start_date' => Carbon::parse($leave->start_date)->toDateString(),
                'end_date' => Carbon::parse($leave->end_date)->toDateString(),
                'review_note' => $leave->review_note,
            ]
        );
    }
}
