<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Attendance\OvertimeRegisterService;
use App\Services\Attendance\StatutoryComplianceService;
use App\Services\Attendance\StatutoryWorkingTime;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The overtime register and the working-hours breach list.
 *
 * Both read other people's hours across the organization, so both are
 * administrative. The register in particular is the document an inspector asks
 * for, and it prices overtime — which makes it a payroll-shaped disclosure, not
 * an attendance one.
 */
class StatutoryComplianceController extends Controller
{
    /** A month either side is plenty and keeps one request from walking a year. */
    private const MAX_RANGE_DAYS = 186;

    public function __construct(
        private readonly StatutoryComplianceService $compliance,
        private readonly OvertimeRegisterService $register,
        private readonly StatutoryWorkingTime $statute,
    ) {
    }

    /**
     * The overtime register for a period.
     *
     * Capped at MAX_RANGE_DAYS because this walks every attendance row for every
     * employee and assesses each one against a policy. A year of a five-hundred
     * person factory is not a request that should succeed slowly — it is one
     * that should be refused clearly.
     */
    public function register(Request $request): JsonResponse
    {
        $validated = $this->validatedRange($request);

        if ($validated instanceof JsonResponse) {
            return $validated;
        }

        [$from, $to] = $validated;

        $users = $this->subjects($request);

        return response()->json(
            $this->register->build($users, $from, $to)
        );
    }

    /**
     * Working-hour breaches over a period.
     *
     * Returns per-employee results rather than one flat list, because the
     * question an admin has is "who", and a list of 400 breaches with names
     * repeated is not an answer to it.
     */
    public function breaches(Request $request): JsonResponse
    {
        $validated = $this->validatedRange($request);

        if ($validated instanceof JsonResponse) {
            return $validated;
        }

        [$from, $to] = $validated;

        $employees = [];
        $unregulated = 0;
        $total = 0;

        foreach ($this->subjects($request) as $user) {
            $result = $this->compliance->forUser($user, $from, $to);

            if (! $result['is_regulated']) {
                $unregulated++;

                continue;
            }

            if ($result['breaches'] === []) {
                continue;
            }

            $total += count($result['breaches']);

            $employees[] = [
                'user_id' => (int) $user->id,
                'name' => (string) $user->name,
                'establishment_type' => $result['limits']['establishment_type'],
                'breaches' => $result['breaches'],
            ];
        }

        return response()->json([
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'employees' => $employees,
            'totals' => [
                'breaches' => $total,
                'employees_in_breach' => count($employees),
                /*
                 * Reported, not hidden. An employee whose entity has no
                 * establishment type set is not compliant — they are unassessed,
                 * and a screen that silently excludes them looks clean for the
                 * wrong reason.
                 */
                'employees_not_assessed' => $unregulated,
            ],
        ]);
    }

    /** What the law requires of the caller's own establishment. */
    public function limits(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->statute->forUser($request->user())->toArray(),
        ]);
    }

    /**
     * Whose hours to read.
     *
     * Scoped to the caller's organization by the global scope; `user_id`
     * narrows to one person. Deactivated people are included on purpose — an
     * overtime register covers the period, and somebody who left in the middle
     * of it still worked the first half of it.
     *
     * @return \Illuminate\Support\Collection<int, User>
     */
    private function subjects(Request $request): \Illuminate\Support\Collection
    {
        return User::query()
            ->where('organization_id', $request->user()->organization_id)
            ->when($request->filled('user_id'), fn ($query) => $query->where('id', (int) $request->input('user_id')))
            ->with(['employeeWorkInfo', 'employeePayrollTemplate'])
            ->orderBy('name')
            ->get();
    }

    /** @return array{0: Carbon, 1: Carbon}|JsonResponse */
    private function validatedRange(Request $request): array|JsonResponse
    {
        $validated = $request->validate([
            'from' => 'required|date',
            'to' => 'required|date',
            'user_id' => 'nullable|integer',
        ]);

        $from = Carbon::parse($validated['from'])->startOfDay();
        $to = Carbon::parse($validated['to'])->startOfDay();

        if ($to->lessThan($from)) {
            return response()->json(['message' => 'The end date is before the start date.'], 422);
        }

        if ($from->diffInDays($to) > self::MAX_RANGE_DAYS) {
            return response()->json([
                'message' => 'Choose a period of six months or less.',
            ], 422);
        }

        return [$from, $to];
    }
}
