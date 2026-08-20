<?php

namespace App\Http\Controllers\Api\WorkingTime;

use App\Http\Controllers\Api\ShiftController;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Attendance\PolicyAssignmentResolver;
use App\Services\Attendance\ResolvedPolicy;
use App\Services\Attendance\ShiftAllowanceEngine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The working-time setup one person is actually on, for one date.
 *
 * Anyone may ask about themselves — this is what the employee's own screen
 * renders from, and being unable to see which late rule or which weekly off
 * applies to you is the kind of opacity that turns a payslip query into a
 * grievance. Asking about somebody else is a management view and is gated as
 * one, exactly as ShiftController::my does it.
 *
 * The answer carries the SOURCE alongside each policy — assigned, workspace
 * default, or nothing — because "you are on the default" and "somebody put you
 * on this" are different facts to whoever is explaining a deduction.
 *
 * base_amount is optional and quantifies the shift-allowance estimate. Without
 * it a percentage premium reports its rate and a null amount rather than zero:
 * the premium is earned, and only a caller holding the salary structure can say
 * what it bites on.
 */
class MyWorkingTimePolicyController extends Controller
{
    public function __construct(
        private readonly PolicyAssignmentResolver $policies,
        private readonly ShiftAllowanceEngine $allowances,
    ) {
    }

    public function show(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user || ! $user->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        $request->validate([
            'date' => ['nullable', 'date'],
            'user_id' => ['nullable', 'integer'],
            'base_amount' => ['nullable', 'numeric', 'min:0'],
        ]);

        $target = $user;
        $requestedId = (int) $request->query('user_id', 0);

        if ($requestedId > 0 && $requestedId !== (int) $user->id) {
            if (! ShiftController::canManage($user)) {
                return response()->json(['message' => 'Forbidden'], 403);
            }

            // User is deliberately outside BelongsToOrganization, so the tenant
            // filter is written out here.
            $target = User::where('organization_id', $user->organization_id)->find($requestedId);
            if (! $target) {
                return response()->json(['message' => 'Employee not found.'], 404);
            }
        }

        $date = $request->query('date');
        $baseAmount = $request->query('base_amount');

        $resolved = $this->policies->resolveAll($target, $date);
        $estimate = $this->allowances->computeFor($target, $date, is_string($baseAmount) ? $baseAmount : null);

        return response()->json([
            'data' => [
                'user_id' => (int) $target->id,
                // The date the engine actually resolved, so a caller that sent
                // nothing sees which day it was answered for.
                'date' => $estimate->attendanceDate,
                'policies' => array_map(
                    fn (ResolvedPolicy $policy) => $policy->toArray(),
                    $resolved,
                ),
                'shift_allowance_estimate' => $estimate->toArray(),
            ],
        ]);
    }
}
