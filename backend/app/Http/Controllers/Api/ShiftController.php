<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmployeeShift;
use App\Models\Shift;
use App\Models\User;
use App\Services\Attendance\ShiftResolver;
use App\Services\Audit\AuditLogService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * The shift catalogue: the patterns an organization runs.
 *
 * Assignment lives next door in ShiftAssignmentController, because the two are
 * different decisions with different blast radius — editing a pattern changes
 * what everybody on it is expected to work, rostering one person changes only
 * that person.
 *
 * Authorisation is inline and permission-based rather than a `role:` middleware
 * on the routes. Both would work for the built-in roles, but the middleware
 * matches on the role string, so a custom role holding settings.manage would be
 * refused at the door and never reach the check that was supposed to admit it.
 * The predicate below is the same one SettingsController uses for the
 * organization form, which is the decision shifts belong with: hours, grace and
 * differentials are workspace policy.
 */
class ShiftController extends Controller
{
    /**
     * A fixed weekday to evaluate the pattern against when reporting whether it
     * rolls over midnight. The answer is a property of the times, not of today,
     * so anchoring it to now() would make the same shift report differently on
     * different days.
     */
    private const REFERENCE_DATE = '2000-01-03'; // a Monday

    public function __construct(
        private readonly AuditLogService $auditLogService,
        private readonly ShiftResolver $shiftResolver,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if (!self::canManage($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $shifts = Shift::forOrganization((int) $user->organization_id)
            ->withCount('employeeShifts')
            ->orderBy('name')
            ->get();

        return response()->json([
            'data' => $shifts->map(fn (Shift $shift) => $this->present($shift))->values(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if (!self::canManage($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $this->validatePayload($request, true);
        $this->assertCodeIsFree($user, (string) $data['code']);

        $attributes = $this->attributesFrom($data, null);
        $attributes['organization_id'] = $user->organization_id;

        $shift = Shift::create($attributes);

        $this->auditLogService->log(
            action: 'shift.created',
            actor: $user,
            target: $shift,
            metadata: [
                'code' => $shift->code,
                'name' => $shift->name,
                'start_time' => $shift->start_time,
                'end_time' => $shift->end_time,
                'duration_minutes' => (int) $shift->duration_minutes,
            ],
            request: $request,
        );

        return response()->json(['data' => $this->present($shift->fresh())], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if (!self::canManage($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $shift = Shift::forOrganization((int) $user->organization_id)->find($id);
        if (!$shift) {
            return response()->json(['message' => 'Shift not found.'], 404);
        }

        $data = $this->validatePayload($request, false);
        if (array_key_exists('code', $data)) {
            $this->assertCodeIsFree($user, (string) $data['code'], $shift->id);
        }

        $shift->update($this->attributesFrom($data, $shift));

        $this->auditLogService->log(
            action: 'shift.updated',
            actor: $user,
            target: $shift,
            metadata: ['code' => $shift->code, 'changed' => array_keys($data)],
            request: $request,
        );

        return response()->json(['data' => $this->present($shift->fresh())]);
    }

    /**
     * Deleting a pattern that anybody is rostered on is refused.
     *
     * employee_shifts.shift_id is a cascading foreign key, so allowing it would
     * erase the roster history silently — and that history is what a payroll
     * re-run for an earlier month resolves against. Retiring a shift is
     * is_active = false, which stops it being offered without rewriting the
     * past.
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if (!self::canManage($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $shift = Shift::forOrganization((int) $user->organization_id)->find($id);
        if (!$shift) {
            return response()->json(['message' => 'Shift not found.'], 404);
        }

        $assignments = EmployeeShift::forOrganization((int) $user->organization_id)
            ->where('shift_id', $shift->id)
            ->count();

        if ($assignments > 0) {
            return response()->json([
                'message' => "This shift is rostered to {$assignments} assignment(s). Deactivate it instead so past attendance still resolves.",
                'assignments_count' => $assignments,
            ], 409);
        }

        $snapshot = ['code' => $shift->code, 'name' => $shift->name];
        $shift->delete();

        $this->auditLogService->log(
            action: 'shift.deleted',
            actor: $user,
            target: $shift,
            metadata: $snapshot,
            request: $request,
        );

        return response()->json(['message' => 'Shift deleted.']);
    }

    /**
     * The shift a person is on, for a date.
     *
     * Anyone may ask about themselves — this is what the employee's own screen
     * renders from. Asking about somebody else is a management view and gated
     * as one.
     */
    public function my(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        $request->validate([
            'date' => ['nullable', 'date'],
            'user_id' => ['nullable', 'integer'],
        ]);

        $target = $user;
        $requestedId = (int) $request->query('user_id', 0);

        if ($requestedId > 0 && $requestedId !== (int) $user->id) {
            if (!self::canManage($user)) {
                return response()->json(['message' => 'Forbidden'], 403);
            }

            // User is deliberately outside BelongsToOrganization — the scope
            // resolves the acting user through Auth — so the tenant filter is
            // written out here, as it is everywhere else that looks a colleague
            // up by id.
            $target = User::where('organization_id', $user->organization_id)->find($requestedId);
            if (!$target) {
                return response()->json(['message' => 'Employee not found.'], 404);
            }
        }

        $resolved = $this->shiftResolver->resolve($target, $request->query('date'));

        return response()->json([
            'data' => $resolved?->toArray(),
            'user_id' => (int) $target->id,
        ]);
    }

    /**
     * Who may create, edit and roster shifts.
     *
     * Same predicate as SettingsController::canManageOrg — the custom-role
     * permission first, hierarchy as the fallback for the built-in roles, so
     * line managers can roster their team and plain employees cannot.
     */
    public static function canManage(User $user): bool
    {
        return $user->hasPermission('settings.manage') || $user->getHierarchyLevel() < 100;
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function attributesFrom(array $data, ?Shift $existing): array
    {
        $attributes = [];

        foreach (['name', 'code', 'type', 'description'] as $key) {
            if (array_key_exists($key, $data)) {
                $attributes[$key] = $data[$key];
            }
        }

        foreach (['start_time', 'end_time', 'night_shift_start', 'night_shift_end'] as $key) {
            if (array_key_exists($key, $data)) {
                $attributes[$key] = Shift::normalizeTime($data[$key]);
            }
        }

        foreach (['break_duration_minutes', 'grace_period_minutes', 'early_exit_grace_minutes'] as $key) {
            if (array_key_exists($key, $data)) {
                $attributes[$key] = (int) $data[$key];
            }
        }

        if (array_key_exists('is_active', $data)) {
            $attributes['is_active'] = (bool) $data['is_active'];
        }

        if (array_key_exists('applicable_days', $data)) {
            $days = is_array($data['applicable_days']) ? array_values($data['applicable_days']) : [];
            // An empty list means "every day" to Shift::appliesOn, and null is
            // the encoding the column already uses for that. Storing [] would
            // read the same but only by accident.
            $attributes['applicable_days'] = $days === [] ? null : $days;
        }

        $start = $attributes['start_time'] ?? $existing?->start_time;
        $end = $attributes['end_time'] ?? $existing?->end_time;

        // duration_minutes is NOT NULL and is what every span calculation reads
        // first, so it is derived from the times whenever the caller did not
        // declare one — a shift saved without it would otherwise be a shift of
        // length zero.
        if (array_key_exists('duration_minutes', $data) && $data['duration_minutes'] !== null) {
            $attributes['duration_minutes'] = (int) $data['duration_minutes'];
        } elseif (array_key_exists('start_time', $attributes) || array_key_exists('end_time', $attributes) || $existing === null) {
            $attributes['duration_minutes'] = self::spanMinutesBetween($start, $end);
        }

        if (array_key_exists('is_night_shift', $data)) {
            $attributes['is_night_shift'] = (bool) $data['is_night_shift'];
        } elseif (array_key_exists('duration_minutes', $attributes)) {
            // Derived, not asked for: a 22:00→06:00 shift is a night shift
            // whether or not whoever typed it remembered to tick the box, and
            // the differential rules downstream key off this flag.
            $attributes['is_night_shift'] = self::crossesMidnight(
                $start,
                (int) $attributes['duration_minutes']
            );
        }

        return $attributes;
    }

    /** @return array<string, mixed> */
    private function validatePayload(Request $request, bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';

        return $request->validate([
            'name' => [$required, 'string', 'max:255'],
            'code' => [$required, 'string', 'max:50'],
            'type' => ['sometimes', 'in:general,morning,evening,night,rotating'],
            'description' => ['nullable', 'string', 'max:2000'],
            'start_time' => [$required, 'date_format:H:i,H:i:s'],
            'end_time' => [$required, 'date_format:H:i,H:i:s'],
            'duration_minutes' => ['nullable', 'integer', 'min:1', 'max:1440'],
            'break_duration_minutes' => ['sometimes', 'integer', 'min:0', 'max:720'],
            'grace_period_minutes' => ['sometimes', 'integer', 'min:0', 'max:240'],
            'early_exit_grace_minutes' => ['sometimes', 'integer', 'min:0', 'max:240'],
            'is_night_shift' => ['sometimes', 'boolean'],
            'night_shift_start' => ['nullable', 'date_format:H:i,H:i:s'],
            'night_shift_end' => ['nullable', 'date_format:H:i,H:i:s'],
            'is_active' => ['sometimes', 'boolean'],
            'applicable_days' => ['sometimes', 'array'],
            'applicable_days.*' => ['string', 'max:16'],
        ]);
    }

    /**
     * shifts carries a unique index on (organization_id, code), so this is a
     * 422 with a field the form can point at rather than a 500 from the driver.
     * Codes are compared case-insensitively because "GEN" and "gen" are the
     * same roster code to everyone except the index.
     */
    private function assertCodeIsFree(User $user, string $code, ?int $ignoreId = null): void
    {
        $clash = Shift::forOrganization((int) $user->organization_id)
            ->whereRaw('LOWER(code) = ?', [mb_strtolower(trim($code))])
            ->when($ignoreId, fn ($query) => $query->whereKeyNot($ignoreId))
            ->exists();

        if ($clash) {
            throw ValidationException::withMessages([
                'code' => 'Another shift in this workspace already uses that code.',
            ]);
        }
    }

    /** @return array<string, mixed> */
    private function present(Shift $shift): array
    {
        $reference = Carbon::parse(self::REFERENCE_DATE);

        return array_merge($shift->toArray(), [
            'span_minutes' => $shift->spanMinutes(),
            'expected_work_seconds' => $shift->expectedWorkSeconds(),
            'crosses_midnight' => $shift->crossesMidnightFrom($reference),
            'assigned_count' => (int) ($shift->employee_shifts_count ?? 0),
        ]);
    }

    private static function spanMinutesBetween(?string $start, ?string $end): int
    {
        $draft = new Shift([
            'start_time' => Shift::normalizeTime($start) ?? '00:00:00',
            'end_time' => Shift::normalizeTime($end) ?? '00:00:00',
        ]);

        return $draft->spanMinutes();
    }

    private static function crossesMidnight(?string $start, int $durationMinutes): bool
    {
        $reference = Carbon::parse(self::REFERENCE_DATE);
        $draft = new Shift([
            'start_time' => Shift::normalizeTime($start) ?? '00:00:00',
            'duration_minutes' => $durationMinutes,
        ]);

        return $draft->crossesMidnightFrom($reference);
    }
}
