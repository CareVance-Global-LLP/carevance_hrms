<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The customer-facing read API.
 *
 * Authenticated by API key, not by user session — so there is no acting user,
 * and every query below relies on the tenant AuthenticateApiClient pinned into
 * TenantContext. That is what keeps these endpoints inside one organisation.
 *
 * Read-only on purpose. A first integration surface that can create payroll
 * runs is a far larger security question than one that can read them, and it
 * is much easier to add a scope later than to withdraw one.
 */
class PublicApiController extends Controller
{
    private const MAX_PER_PAGE = 200;

    /**
     * The tenant this request belongs to, from the API key.
     *
     * Every query in this controller must be constrained by it. Most models
     * are constrained automatically by BelongsToOrganization reading the pin
     * AuthenticateApiClient set — but NOT all of them, which is the point of
     * making it explicit here. See employees() below.
     */
    private function organizationId(Request $request): int
    {
        $client = $request->attributes->get('api_client');

        // Fail closed. Reaching a controller without the middleware having run
        // should be impossible; if it ever happens, serving nothing is the only
        // acceptable outcome.
        abort_if($client === null, 401, 'No API client on this request.');

        return (int) $client->organization_id;
    }

    public function employees(Request $request): JsonResponse
    {
        $perPage = min((int) $request->integer('per_page', 50) ?: 50, self::MAX_PER_PAGE);

        /*
         * Scoped by hand, and it has to be.
         *
         * User is deliberately excluded from BelongsToOrganization — the trait's
         * own scope resolves the acting user through Auth, so applying it to
         * User would be circular. That exclusion means User::query() carries no
         * tenant filter of any kind, and the tenant pin does nothing for it.
         *
         * Written without this line, this endpoint returned every employee of
         * every customer to any valid API key. IntegrationApiTest covers it.
         */
        $employees = User::query()
            ->where('organization_id', $this->organizationId($request))
            ->with('employeeWorkInfo:id,user_id,designation,joining_date,reporting_manager_id')
            ->whereNull('deactivated_at')
            ->orderBy('id')
            ->paginate($perPage);

        return $this->paginated($employees, fn (User $user) => [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role,
            'designation' => $user->employeeWorkInfo?->designation,
            'joining_date' => $user->employeeWorkInfo?->joining_date?->toDateString(),
            'reporting_manager_id' => $user->employeeWorkInfo?->reporting_manager_id,
        ]);
    }

    public function attendance(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'user_id' => ['nullable', 'integer'],
        ]);

        $perPage = min((int) $request->integer('per_page', 50) ?: 50, self::MAX_PER_PAGE);

        // AttendanceRecord does carry BelongsToOrganization, so the pin already
        // constrains this. Stated again anyway: on a public API surface the
        // tenant filter should be visible in the query, not inferred from a
        // trait three files away.
        $records = AttendanceRecord::query()
            ->where('organization_id', $this->organizationId($request))
            ->when($validated['from'] ?? null, fn ($q, $from) => $q->whereDate('check_in_at', '>=', $from))
            ->when($validated['to'] ?? null, fn ($q, $to) => $q->whereDate('check_in_at', '<=', $to))
            ->when($validated['user_id'] ?? null, fn ($q, $userId) => $q->where('user_id', $userId))
            ->orderByDesc('check_in_at')
            ->paginate($perPage);

        return $this->paginated($records, fn (AttendanceRecord $record) => [
            'id' => $record->id,
            'user_id' => $record->user_id,
            'check_in_at' => $record->check_in_at?->toIso8601String(),
            'check_out_at' => $record->check_out_at?->toIso8601String(),
            'status' => $record->status,
        ]);
    }

    public function leave(Request $request): JsonResponse
    {
        $perPage = min((int) $request->integer('per_page', 50) ?: 50, self::MAX_PER_PAGE);

        $requests = LeaveRequest::query()
            ->where('organization_id', $this->organizationId($request))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->orderByDesc('id')
            ->paginate($perPage);

        return $this->paginated($requests, fn (LeaveRequest $leave) => [
            'id' => $leave->id,
            'user_id' => $leave->user_id,
            'type' => $leave->leave_type ?? $leave->type ?? null,
            'status' => $leave->status,
            'start_date' => $leave->start_date?->toDateString(),
            'end_date' => $leave->end_date?->toDateString(),
        ]);
    }

    /**
     * One envelope for every list endpoint, so a client writes its pagination
     * handling once.
     */
    private function paginated(mixed $paginator, callable $transform): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => collect($paginator->items())->map($transform)->values()->all(),
            'meta' => [
                'page' => $paginator->currentPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
                'last_page' => $paginator->lastPage(),
            ],
        ]);
    }
}
