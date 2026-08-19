<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmployeeShift;
use App\Models\Shift;
use App\Models\User;
use App\Services\Audit\AuditLogService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Rostering: which person is on which shift, from when.
 *
 * The assignment key is the employee. Department and location are how a
 * manager decides whom to put on a shift; they are never what the assignment
 * hangs off, because the moment one person moves team the roster would follow
 * the team rather than the person.
 *
 * A re-roster is a NEW row with a later effective_from, not an edit of the
 * existing one. ShiftResolver takes the latest window containing the date, so
 * the previous assignment can be left open-ended and still resolve correctly
 * for the months it was actually in force — which is what a payroll re-run for
 * an earlier month needs.
 */
class ShiftAssignmentController extends Controller
{
    public function __construct(
        private readonly AuditLogService $auditLogService,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if (!ShiftController::canManage($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $request->validate([
            'user_id' => ['nullable', 'integer'],
            'shift_id' => ['nullable', 'integer'],
        ]);

        $assignments = EmployeeShift::forOrganization((int) $user->organization_id)
            ->with(['shift:id,name,code,type,start_time,end_time,duration_minutes,break_duration_minutes', 'user:id,name,email'])
            ->when($request->filled('user_id'), fn ($query) => $query->where('user_id', (int) $request->query('user_id')))
            ->when($request->filled('shift_id'), fn ($query) => $query->where('shift_id', (int) $request->query('shift_id')))
            ->orderByDesc('effective_from')
            ->orderByDesc('id')
            ->get();

        return response()->json(['data' => $assignments]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if (!ShiftController::canManage($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'user_id' => ['required', 'integer'],
            'shift_id' => ['required', 'integer'],
            'effective_from' => ['required', 'date'],
            'effective_to' => ['nullable', 'date', 'after_or_equal:effective_from'],
            'custom_differential_rate' => ['nullable', 'numeric', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        // Both ends of the assignment are checked against the caller's tenant
        // rather than trusted from the payload. A 422 naming the field is what
        // the form can act on; a silent create would bind one org's pattern to
        // another org's employee and stay invisible until payroll.
        $employee = User::where('organization_id', $user->organization_id)->find((int) $data['user_id']);
        if (!$employee) {
            throw ValidationException::withMessages([
                'user_id' => 'That employee is not in this workspace.',
            ]);
        }

        $shift = Shift::forOrganization((int) $user->organization_id)->find((int) $data['shift_id']);
        if (!$shift) {
            throw ValidationException::withMessages([
                'shift_id' => 'That shift is not in this workspace.',
            ]);
        }

        $assignment = EmployeeShift::create([
            'organization_id' => $user->organization_id,
            'user_id' => $employee->id,
            'shift_id' => $shift->id,
            'effective_from' => $data['effective_from'],
            'effective_to' => $data['effective_to'] ?? null,
            'is_active' => (bool) ($data['is_active'] ?? true),
            'custom_differential_rate' => $data['custom_differential_rate'] ?? null,
        ]);

        $this->auditLogService->log(
            action: 'shift.assigned',
            actor: $user,
            target: $assignment,
            metadata: [
                'user_id' => $employee->id,
                'shift_code' => $shift->code,
                'effective_from' => $assignment->effective_from?->toDateString(),
                'effective_to' => $assignment->effective_to?->toDateString(),
            ],
            request: $request,
        );

        return response()->json([
            'data' => $assignment->fresh(['shift:id,name,code,type,start_time,end_time,duration_minutes,break_duration_minutes', 'user:id,name,email']),
        ], 201);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if (!ShiftController::canManage($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $assignment = EmployeeShift::forOrganization((int) $user->organization_id)->find($id);
        if (!$assignment) {
            return response()->json(['message' => 'Assignment not found.'], 404);
        }

        $snapshot = [
            'user_id' => (int) $assignment->user_id,
            'shift_id' => (int) $assignment->shift_id,
            'effective_from' => $assignment->effective_from?->toDateString(),
        ];
        $assignment->delete();

        $this->auditLogService->log(
            action: 'shift.unassigned',
            actor: $user,
            target: $assignment,
            metadata: $snapshot,
            request: $request,
        );

        return response()->json(['message' => 'Assignment removed.']);
    }
}
