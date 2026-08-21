<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LeaveLedgerEntry;
use App\Models\LeaveType;
use App\Models\User;
use App\Services\Leave\LeavePolicyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Leave types, and the ledger behind a balance.
 *
 * Administrative except for the breakdown, which anybody may read about
 * themselves — being able to see why your own balance is what it is should not
 * require asking HR.
 */
class LeaveTypeController extends Controller
{
    public function __construct(
        private readonly LeavePolicyService $policyService,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        return response()->json([
            'data' => LeaveType::query()
                ->where('organization_id', $request->user()->organization_id)
                ->orderBy('position')
                ->orderBy('name')
                ->get(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $this->validated($request);

        $type = LeaveType::query()->create($validated + [
            'organization_id' => $request->user()->organization_id,
        ]);

        return response()->json(['data' => $type], 201);
    }

    public function update(Request $request, LeaveType $leaveType): JsonResponse
    {
        if ((int) $leaveType->organization_id !== (int) $request->user()->organization_id) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $leaveType->update($this->validated($request, $leaveType));

        return response()->json(['data' => $leaveType->fresh()]);
    }

    /**
     * The dated rows behind somebody's balance.
     *
     * The reason the ledger exists. HR does not ask "what is my balance", they
     * ask "why is it that" — and a number nobody can expand into rows is one
     * you end up arguing about with a customer's HR team holding a spreadsheet.
     *
     * An employee may only read their own; anybody else needs to be able to
     * manage leave, because a balance breakdown reveals when a colleague was
     * off and for what.
     */
    public function ledger(Request $request, int $userId): JsonResponse
    {
        $viewer = $request->user();
        $isSelf = (int) $viewer->id === $userId;

        if (! $isSelf && $viewer->getHierarchyLevel() >= 100) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $subject = User::query()
            ->where('organization_id', $viewer->organization_id)
            ->find($userId);

        if (! $subject) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $cycleStart = $this->policyService->currentCycleStart();
        $cycleEnd = $this->policyService->currentCycleEnd();

        $entries = LeaveLedgerEntry::query()
            ->where('user_id', $subject->id)
            ->whereDate('effective_on', '>=', $cycleStart->toDateString())
            ->whereDate('effective_on', '<=', $cycleEnd->toDateString())
            ->with('leaveType:id,code,name')
            ->orderBy('effective_on')
            ->orderBy('id')
            ->get();

        return response()->json([
            'cycle' => [
                'start_date' => $cycleStart->toDateString(),
                'end_date' => $cycleEnd->toDateString(),
            ],
            'entries' => $entries,
            /*
             * Sent alongside so the UI never adds the rows up itself. Two places
             * computing a balance is how a breakdown ends up not matching the
             * figure it is explaining.
             */
            'balance' => $this->policyService->buildLedgerBalanceSnapshotForUser(
                $subject,
                $this->policyService->resolvePolicyCategories($viewer->organization),
            ),
        ]);
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, ?LeaveType $existing = null): array
    {
        return $request->validate([
            'code' => [
                $existing ? 'sometimes' : 'required',
                'string',
                'max:40',
                'regex:/^[a-z0-9_\-]+$/',
            ],
            'name' => ($existing ? 'sometimes|' : 'required|').'string|max:255',
            'annual_quota' => 'sometimes|numeric|min:0|max:365',
            'accrual_frequency' => 'sometimes|in:'.implode(',', LeaveType::FREQUENCIES),
            // When in its period the credit lands. period_end is restrictive -
            // somebody joining on the 1st can take nothing until the 31st.
            'accrual_timing' => 'sometimes|in:'.implode(',', LeaveType::TIMINGS),
            // What happens to what is left when the leave year closes.
            'year_end_action' => 'sometimes|in:'.implode(',', LeaveType::YEAR_END_ACTIONS),
            // Null means the normal rate, never zero - see annualQuotaFor().
            'notice_period_annual_quota' => 'sometimes|nullable|numeric|min:0|max:365',
            'pro_rate_on_join' => 'sometimes|boolean',
            // A cutoff outside 1-28 cannot apply in February, so a policy set to
            // 30 would silently behave differently in one month of the year.
            'joining_cutoff_day' => 'sometimes|integer|min:1|max:28',
            'probation_annual_quota' => 'sometimes|nullable|numeric|min:0|max:365',
            'carry_forward_cap' => 'sometimes|numeric|min:0|max:365',
            'carry_forward_expiry_months' => 'sometimes|nullable|integer|min:1|max:24',
            'is_encashable' => 'sometimes|boolean',
            'is_paid' => 'sometimes|boolean',
            'is_active' => 'sometimes|boolean',
            'position' => 'sometimes|integer|min:0',
        ]);
    }
}
