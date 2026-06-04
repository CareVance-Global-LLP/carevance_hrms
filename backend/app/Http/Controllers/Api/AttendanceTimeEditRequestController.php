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
use Carbon\Carbon;
use Illuminate\Http\Request;

class AttendanceTimeEditRequestController extends Controller
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

            $query->whereIn('user_id', $visibleUserIds->unique()->values());

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

        return response()->json([
            'message' => $this->submissionMessage($currentUser, $reviewers->pluck('name')->all()),
            'data' => $this->withApprovalDestination($created->load([
                'user:id,name,email,role,role_id,organization_id',
                'user.customRole:id,hierarchy_level',
                'reviewer:id,name,email',
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
        if (!$item->user || !$this->approvalRoutingService->canReview($currentUser, $item->user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if ($item->status !== 'pending') {
            return response()->json(['message' => 'Only pending requests can be approved.'], 422);
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
        if (!$item->user || !$this->approvalRoutingService->canReview($currentUser, $item->user)) {
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
            ]),
        ]);
    }

    private function canManage(User $user): bool
    {
        return ! empty($this->approvalRoutingService->reviewerHierarchyLevels($user));
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
