<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceHoliday;
use App\Models\AttendanceRecord;
use App\Models\AttendanceTimeEditRequest;
use App\Models\User;
use App\Services\AppNotificationService;
use App\Services\Approvals\ApprovalRoutingService;
use App\Services\Audit\AuditLogService;
use App\Services\Payroll\PayrollPeriodGuard;
use Carbon\Carbon;
use Illuminate\Http\Request;

class AttendanceTimeEditRequestController extends Controller
{
    public function __construct(
        private readonly AppNotificationService $notificationService,
        private readonly ApprovalRoutingService $approvalRoutingService,
        private readonly AuditLogService $auditLogService,
        private readonly PayrollPeriodGuard $payrollPeriodGuard,
    ) {
    }

    public function index(Request $request)
    {
        $request->validate([
            'status' => 'nullable|in:pending,approved,rejected',
            'user_id' => 'nullable|integer',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['data' => []]);
        }

        $query = AttendanceTimeEditRequest::with([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
                'escalatedTo:id,name,email',
            ])
            ->where('organization_id', $currentUser->organization_id)
            ->orderByDesc('created_at');

        if (!$this->canManage($currentUser)) {
            $query->where('user_id', $currentUser->id);
        } else {
            $visibleUserIds = $this->approvalRoutingService->reviewableRequesterIds($currentUser);

            // Only admins see their own requests in the approval inbox
            if ($currentUser->getHierarchyLevel() <= 10) {
                $visibleUserIds->push((int) $currentUser->id);
            }

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

        return response()->json([
            'data' => $query->limit(200)->get()->map(fn (AttendanceTimeEditRequest $item) => $this->withApprovalDestination($item)),
        ]);
    }

    public function store(Request $request)
    {
        $request->validate([
            'attendance_date' => 'required|date',
            'extra_minutes' => 'required|integer|min:1|max:600',
            'message' => 'nullable|string|max:2000',
            'worked_seconds' => 'nullable|integer|min:0|max:172800',
            'overtime_seconds' => 'nullable|integer|min:0|max:86400',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if (array_key_exists('can_edit_time', $currentUser->settings ?? []) && $currentUser->settings['can_edit_time'] === false) {
            return response()->json(['message' => 'Time edit requests are disabled for your account.'], 403);
        }

        $date = Carbon::parse($request->attendance_date)->toDateString();
        $extraSeconds = (int) $request->extra_minutes * 60;

        $userCountry = AttendanceHoliday::countryForSettings($currentUser->settings);
        $isHoliday = AttendanceHoliday::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereDate('holiday_date', $date)
            ->whereIn('country', ['ALL', $userCountry])
            ->exists();
        if ($isHoliday) {
            return response()->json(['message' => 'Time edit request is not allowed on holidays.'], 422);
        }

        $hasPending = AttendanceTimeEditRequest::where('organization_id', $currentUser->organization_id)
            ->where('user_id', $currentUser->id)
            ->whereDate('attendance_date', $date)
            ->where('status', 'pending')
            ->exists();
        if ($hasPending) {
            return response()->json(['message' => 'A pending time edit request already exists for this date.'], 422);
        }

        if (! $this->approvalRoutingService->hasEligibleReviewer($currentUser)) {
            return response()->json([
                'message' => $this->approvalRoutingService->missingReviewerMessage($currentUser),
            ], 422);
        }

        $created = AttendanceTimeEditRequest::create([
            'organization_id' => $currentUser->organization_id,
            'user_id' => $currentUser->id,
            'attendance_date' => $date,
            'extra_seconds' => $extraSeconds,
            'message' => $request->message,
            'status' => 'pending',
        ]);

        $record = AttendanceRecord::query()
            ->where('organization_id', $currentUser->organization_id)
            ->where('user_id', $currentUser->id)
            ->whereDate('attendance_date', $date)
            ->first();
        $recordWorkedSeconds = (int) (($record?->worked_seconds ?? 0) + ($record?->manual_adjustment_seconds ?? 0));
        $workedSeconds = max($recordWorkedSeconds, (int) $request->integer('worked_seconds', 0));
        $overtimeSeconds = (int) max(
            $request->integer('overtime_seconds', 0),
            $extraSeconds,
            max(0, $workedSeconds - $this->shiftTargetSeconds())
        );

        $reviewerIds = $this->approvalRoutingService->reviewerUserIds($currentUser);
        $reviewers = User::query()
            ->whereIn('id', $reviewerIds)
            ->get(['id', 'name']);

        $this->notificationService->sendToUsers(
            organizationId: (int) $currentUser->organization_id,
            userIds: $reviewerIds,
            senderId: (int) $currentUser->id,
            type: 'time_edit',
            title: 'Time Edit Request Submitted',
            message: sprintf(
                '%s submitted a time edit request for %s. Worked: %s, Requested overtime: %s.',
                (string) $currentUser->name,
                $date,
                $this->formatDuration($workedSeconds),
                $this->formatDuration($overtimeSeconds)
            ),
            meta: [
                'route' => '/approval-inbox',
                'approval_kind' => 'time_edit',
                'request_id' => $created->id,
                'employee_id' => (int) $currentUser->id,
                'employee_name' => (string) $currentUser->name,
                'attendance_date' => $date,
                'worked_seconds' => $workedSeconds,
                'overtime_seconds' => $overtimeSeconds,
                'extra_seconds' => $extraSeconds,
            ]
        );

        $this->auditLogService->log(
            action: 'attendance.time_edit_requested',
            actor: $currentUser,
            target: $created,
            metadata: [
                'attendance_date' => $date,
                'extra_minutes' => (int) $request->extra_minutes,
                'worked_seconds' => $workedSeconds,
                'overtime_seconds' => $overtimeSeconds,
            ],
            request: $request
        );

        $this->notifyAdminsOfRequest(
            requester: $currentUser,
            kind: 'time_edit',
            action: 'submitted',
            request: $created,
            note: $request->message,
        );

        return response()->json([
            'message' => $this->submissionMessage($currentUser, $reviewers->pluck('name')->all()),
            'data' => $this->withApprovalDestination($created->load([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
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

        $item = AttendanceTimeEditRequest::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$item) {
            return response()->json(['message' => 'Time edit request not found'], 404);
        }
        $item->loadMissing('user.employeeWorkInfo');
        if (!$item->user || !($this->approvalRoutingService->canReview($currentUser, $item->user) || (int) $item->escalated_to_user_id === (int) $currentUser->id)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if ($item->status !== 'pending') {
            return response()->json(['message' => 'Only pending requests can be approved.'], 422);
        }

        /*
         * Refuse once that month's payroll has been locked. Approving here
         * writes manual_adjustment_seconds onto attendance the run has already
         * consumed, and nothing downstream recomputes — so the money paid and
         * the attendance backing it would silently disagree.
         */
        $closedRun = $this->payrollPeriodGuard->closedRunFor(
            (int) $item->organization_id,
            $item->attendance_date
        );
        if ($closedRun) {
            return response()->json([
                'message' => $this->payrollPeriodGuard->refusalMessage($closedRun),
            ], 422);
        }

        $item->update([
            'status' => 'approved',
            'reviewed_by' => $currentUser->id,
            'reviewed_at' => now(),
            'review_note' => $request->review_note,
        ]);

        $record = AttendanceRecord::firstOrNew([
            'user_id' => $item->user_id,
            'attendance_date' => Carbon::parse($item->attendance_date)->toDateString(),
        ]);
        $record->organization_id = $item->organization_id;
        $record->manual_adjustment_seconds = (int) ($record->manual_adjustment_seconds ?? 0) + (int) $item->extra_seconds;
        $record->save();

        $this->sendReviewNotification(
            item: $item->fresh([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
                'escalatedTo:id,name,email',
            ]),
            reviewer: $currentUser,
            status: 'approved'
        );

        $this->auditLogService->log(
            action: 'attendance.time_edit_approved',
            actor: $currentUser,
            target: $item,
            metadata: [
                'employee_id' => $item->user_id,
                'attendance_date' => $item->attendance_date,
                'extra_seconds' => (int) $item->extra_seconds,
            ],
            request: $request
        );

        return response()->json([
            'message' => 'Time edit request approved and applied.',
            'data' => $item->fresh()->load([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
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

        $item = AttendanceTimeEditRequest::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$item) {
            return response()->json(['message' => 'Time edit request not found'], 404);
        }
        $item->loadMissing('user.employeeWorkInfo');
        if (!$item->user || !($this->approvalRoutingService->canReview($currentUser, $item->user) || (int) $item->escalated_to_user_id === (int) $currentUser->id)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if ($item->status !== 'pending') {
            return response()->json(['message' => 'Only pending requests can be rejected.'], 422);
        }

        $item->update([
            'status' => 'rejected',
            'reviewed_by' => $currentUser->id,
            'reviewed_at' => now(),
            'review_note' => $request->review_note,
        ]);

        $this->sendReviewNotification(
            item: $item->fresh([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
                'escalatedTo:id,name,email',
            ]),
            reviewer: $currentUser,
            status: 'rejected'
        );

        $this->auditLogService->log(
            action: 'attendance.time_edit_rejected',
            actor: $currentUser,
            target: $item,
            metadata: [
                'employee_id' => $item->user_id,
                'attendance_date' => $item->attendance_date,
                'extra_seconds' => (int) $item->extra_seconds,
            ],
            request: $request
        );

        return response()->json([
            'message' => 'Time edit request rejected.',
            'data' => $item->fresh()->load([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
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

        $item = AttendanceTimeEditRequest::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$item) {
            return response()->json(['message' => 'Time edit request not found'], 404);
        }

        // Only the user *currently holding* the request may forward it upward,
        // enforcing a strict chain: employee -> team lead -> manager -> admin.
        // The current holder is the nearest reviewer (or the escalated target).
        $currentHolderIds = $this->approvalRoutingService->currentReviewerIds($item->user, $item->escalated_to_user_id);
        if (! $currentHolderIds->contains((int) $currentUser->id) && ! $this->canManage($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if ($item->status !== 'pending') {
            return response()->json(['message' => 'Only pending requests can be transferred.'], 422);
        }

        $item->loadMissing('user.employeeWorkInfo');
        $requester = $item->user;

        $excludeUserId = $item->escalated_to_user_id ?? $this->immediateReviewerId($requester);

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

        $history = $item->escalation_history ?? [];
        $history[] = [
            'from_user_id' => $excludeUserId ? (int) $excludeUserId : null,
            'to_user_id' => $targetUser->id,
            'to_level' => $targetUser->name,
            'note' => $request->note,
            'by_user_id' => (int) $currentUser->id,
            'at' => now()->toIso8601String(),
        ];

        $item->update([
            'escalated_to_user_id' => $targetUser->id,
            'escalation_history' => $history,
        ]);

        $date = Carbon::parse($item->attendance_date)->toDateString();

        $this->notificationService->sendToUsers(
            organizationId: (int) $item->organization_id,
            userIds: collect([$targetUser->id]),
            senderId: (int) $requester->id,
            type: 'time_edit',
            title: 'Time Edit Request Escalated to You',
            message: sprintf(
                '%s escalated a time edit request (%s) to you for approval.',
                (string) $requester->name,
                $date
            ),
            meta: [
                'route' => '/approval-inbox',
                'approval_kind' => 'time_edit',
                'request_id' => (int) $item->id,
                'employee_id' => (int) $requester->id,
                'employee_name' => (string) $requester->name,
                'attendance_date' => $date,
                'escalated' => true,
            ]
        );

        $this->notifyAdminsOfRequest(
            requester: $requester,
            kind: 'time_edit',
            action: 'transferred',
            request: $item,
            note: $request->note,
        );

        $this->auditLogService->log(
            action: 'attendance.time_edit_escalated',
            actor: $currentUser,
            target: $item,
            metadata: [
                'employee_id' => $item->user_id,
                'escalated_to_user_id' => $targetUser->id,
                'escalated_to_names' => [$targetUser->name],
            ],
            request: $request
        );

        return response()->json([
            'message' => 'Time edit request transferred to the next hierarchy level.',
            'data' => $this->withApprovalDestination($item->fresh()->load([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
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

        $item = AttendanceTimeEditRequest::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$item) {
            return response()->json(['message' => 'Time edit request not found'], 404);
        }

        $requester = $item->user()->with('employeeWorkInfo', 'customRole')->firstOrFail();
        $excludeUserId = $item->escalated_to_user_id ?? $this->immediateReviewerId($requester);

        $targets = $this->approvalRoutingService->forwardTargets($requester, $excludeUserId);

        return response()->json(['data' => $targets->all()]);
    }

    private function canManage(User $user): bool
    {
        return ! empty($this->approvalRoutingService->reviewerHierarchyLevels($user));
    }

    private function immediateReviewerId(User $requester): ?int
    {
        return $this->approvalRoutingService->reviewerUserIds($requester)->first();
    }

    private function notifyAdminsOfRequest(User $requester, string $kind, string $action, AttendanceTimeEditRequest $request, ?string $note): void
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
        $label = $this->approvalRoutingService->reviewerLabel($requester, $destinationNames->count());
        $destination = $destinationNames->isEmpty()
            ? $label
            : sprintf('%s: %s', $label, $destinationNames->implode(', '));

        $date = Carbon::parse($request->attendance_date)->toDateString();

        $this->notificationService->sendToUsers(
            organizationId: (int) $requester->organization_id,
            userIds: $adminIds,
            senderId: (int) $requester->id,
            type: $kind,
            title: $action === 'transferred' ? 'Time Edit Request Transferred' : 'Time Edit Request Submitted',
            message: sprintf(
                '%s %s a time edit request (%s) to %s.',
                (string) $requester->name,
                $action,
                $date,
                $destination
            ).(filled($note) ? ' Note: '.$note : ''),
            meta: [
                'route' => '/approval-inbox',
                'approval_kind' => 'time_edit',
                'request_id' => (int) $request->id,
                'employee_id' => (int) $requester->id,
                'employee_name' => (string) $requester->name,
                'attendance_date' => $date,
            ]
        );
    }

    private function shiftTargetSeconds(): int
    {
        return max(1, (int) env('ATTENDANCE_SHIFT_SECONDS', 8 * 3600));
    }

    private function formatDuration(int $seconds): string
    {
        $hours = intdiv(max(0, $seconds), 3600);
        $minutes = intdiv(max(0, $seconds) % 3600, 60);

        return sprintf('%dh %02dm', $hours, $minutes);
    }

    /**
     * @param array<int, string|null> $reviewerNames
     */
    private function submissionMessage(User $requester, array $reviewerNames): string
    {
        $names = collect($reviewerNames)
            ->map(fn ($name) => trim((string) $name))
            ->filter()
            ->values();

        $reviewerLabel = $this->approvalRoutingService->reviewerLabel($requester, $names->count());

        if ($names->isEmpty()) {
            return sprintf('Time edit request submitted and sent to %s.', $reviewerLabel);
        }

        return sprintf(
            'Time edit request submitted and sent to %s: %s.',
            $reviewerLabel,
            $names->implode(', ')
        );
    }

    private function withApprovalDestination(AttendanceTimeEditRequest $item): AttendanceTimeEditRequest
    {
        $item->loadMissing('user.employeeWorkInfo');
        if (! $item->user) {
            $item->setAttribute('approval_destination', 'Sent to reviewer');
            return $item;
        }

        $reviewerNames = User::query()
            ->whereIn('id', $this->approvalRoutingService->reviewerUserIds($item->user))
            ->pluck('name')
            ->map(fn ($name) => trim((string) $name))
            ->filter()
            ->values();

        $reviewerLabel = $this->approvalRoutingService->reviewerLabel($item->user, $reviewerNames->count());

        $item->setAttribute(
            'approval_destination',
            $reviewerNames->isEmpty()
                ? "Sent to {$reviewerLabel}"
                : sprintf('Sent to %s: %s', $reviewerLabel, $reviewerNames->implode(', '))
        );

        $item->setAttribute('escalated_to', $item->escalatedTo?->only(['id', 'name']));
        $item->setAttribute('escalation_history', $item->escalation_history ?? []);
        $item->setAttribute(
            'current_reviewer_ids',
            $this->approvalRoutingService->currentReviewerIds($item->user, $item->escalated_to_user_id)->values()->all()
        );

        return $item;
    }

    private function sendReviewNotification(AttendanceTimeEditRequest $item, User $reviewer, string $status): void
    {
        $date = Carbon::parse($item->attendance_date)->toDateString();
        $reviewerName = trim((string) $reviewer->name);
        $reviewerLabel = $reviewerName !== '' && $reviewer->id !== $item->user_id
            ? " by {$reviewerName}"
            : '';
        $note = filled($item->review_note)
            ? ' Note: '.$item->review_note
            : '';

        $this->notificationService->sendToUsers(
            organizationId: (int) $item->organization_id,
            userIds: collect([(int) $item->user_id]),
            senderId: (int) $reviewer->id,
            type: 'time_edit',
            title: $status === 'approved' ? 'Time Edit Request Approved' : 'Time Edit Request Rejected',
            message: sprintf(
                'Your time edit request for %s (%s) was %s%s.%s',
                $date,
                $this->formatDuration((int) $item->extra_seconds),
                $status,
                $reviewerLabel,
                $note
            ),
            meta: [
                'request_id' => (int) $item->id,
                'attendance_date' => $date,
                'status' => $status,
                'extra_seconds' => (int) $item->extra_seconds,
                'review_note' => $item->review_note,
            ]
        );
    }
}
