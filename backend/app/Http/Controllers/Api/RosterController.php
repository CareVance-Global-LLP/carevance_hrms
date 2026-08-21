<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\RosterDay;
use App\Models\Shift;
use App\Models\ShiftRotation;
use App\Models\ShiftSwapRequest;
use App\Models\User;
use App\Services\Attendance\RosterService;
use App\Services\Attendance\ShiftSwapService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * The rota: who is on, who is off, and who wants to trade.
 *
 * Reading a roster and writing one are deliberately different gates. Anybody
 * may see the published rota — being able to find out when you are working
 * without asking your manager is the entire point of publishing it — but only a
 * manager builds or publishes one.
 *
 * Draft days never leave this controller for a non-manager. A plan somebody is
 * still working on is not something an employee should be planning their week
 * around.
 */
class RosterController extends Controller
{
    public function __construct(
        private readonly RosterService $roster,
        private readonly ShiftSwapService $swaps,
    ) {
    }

    /**
     * The rota over a range.
     *
     * A manager sees drafts; everybody else sees published days only, and their
     * own unless they can manage. Both are the same endpoint because "show me
     * the rota" is one question, and forking it into two would let a
     * permissions mistake in one path leak what the other was protecting.
     */
    public function index(Request $request): JsonResponse
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

        if ($from->diffInDays($to) > 92) {
            // A quarter is plenty for any rota view, and this walks a row per
            // person per day.
            return response()->json(['message' => 'Choose a period of three months or less.'], 422);
        }

        $canManage = $this->canManage($request->user());

        $days = RosterDay::query()
            ->where('organization_id', $request->user()->organization_id)
            ->whereDate('roster_date', '>=', $from->toDateString())
            ->whereDate('roster_date', '<=', $to->toDateString())
            // Drafts are a manager's working state, not an employee's plan.
            ->when(! $canManage, fn ($query) => $query->where('status', 'published'))
            ->when(! $canManage, fn ($query) => $query->where('user_id', $request->user()->id))
            ->when($canManage && $request->filled('user_id'),
                fn ($query) => $query->where('user_id', (int) $request->input('user_id')))
            ->with(['user:id,name', 'shift:id,name,code,start_time,end_time'])
            ->orderBy('roster_date')
            ->get()
            ->map(fn (RosterDay $day) => [
                'id' => (int) $day->id,
                'user_id' => (int) $day->user_id,
                'name' => $day->user?->name,
                'date' => $day->roster_date->toDateString(),
                'shift_id' => $day->shift_id,
                'shift' => $day->shift?->name,
                // Explicit, so a consumer cannot mistake "off" for "missing".
                'is_rest_day' => $day->isRestDay(),
                'status' => $day->status,
                'source' => $day->source,
                'note' => $day->note,
            ]);

        return response()->json([
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'can_manage' => $canManage,
            'data' => $days,
        ]);
    }

    /** Who is covering one date. */
    public function coverage(Request $request): JsonResponse
    {
        $validated = $request->validate(['date' => 'required|date']);

        return response()->json([
            'date' => Carbon::parse($validated['date'])->toDateString(),
            'data' => $this->roster->coverageFor(
                (int) $request->user()->organization_id,
                $validated['date'],
            ),
        ]);
    }

    public function rotations(Request $request): JsonResponse
    {
        return response()->json([
            'data' => ShiftRotation::query()
                ->where('organization_id', $request->user()->organization_id)
                ->with('steps.shift:id,name,code')
                ->orderBy('name')
                ->get(),
        ]);
    }

    /** Build the rota for a range. Writes drafts; publishes nothing. */
    public function generate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'user_ids' => 'required|array|min:1|max:500',
            'user_ids.*' => 'integer',
            'from' => 'required|date',
            'to' => 'required|date',
        ]);

        $users = User::query()
            ->where('organization_id', $request->user()->organization_id)
            ->whereIn('id', $validated['user_ids'])
            ->get();

        $totals = ['created' => 0, 'updated' => 0, 'skipped_manual' => 0, 'skipped_past' => 0];

        try {
            foreach ($users as $user) {
                $result = $this->roster->generateForUser($user, $validated['from'], $validated['to']);

                foreach ($totals as $key => $value) {
                    $totals[$key] = $value + $result[$key];
                }
            }
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        /*
         * The skipped counts are returned rather than swallowed. "We generated
         * 120 days and left 3 alone because somebody had set them by hand" is
         * the sentence a manager needs; a bare success count hides the one
         * thing they might want to check.
         */
        return response()->json(['data' => $totals]);
    }

    public function publish(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from' => 'required|date',
            'to' => 'required|date',
            'user_ids' => 'nullable|array',
            'user_ids.*' => 'integer',
        ]);

        $moved = $this->roster->publish(
            $request->user(),
            $validated['from'],
            $validated['to'],
            $validated['user_ids'] ?? null,
        );

        return response()->json([
            // A publish that affected nothing looks identical to one that
            // worked unless it says so.
            'published' => $moved,
        ]);
    }

    /** Set one person's day by hand. */
    public function setDay(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'user_id' => 'required|integer',
            'date' => 'required|date',
            // Null is a rest day, and is a real answer rather than a missing
            // one — see RosterDay.
            'shift_id' => 'nullable|integer',
            'note' => 'nullable|string|max:255',
        ]);

        $user = User::query()
            ->where('organization_id', $request->user()->organization_id)
            ->find($validated['user_id']);

        $shift = $validated['shift_id']
            ? Shift::query()->where('organization_id', $request->user()->organization_id)->find($validated['shift_id'])
            : null;

        if (! $user || ($validated['shift_id'] && ! $shift)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        try {
            return response()->json([
                'data' => $this->roster->setDay($user, $validated['date'], $shift, $request->user(), $validated['note'] ?? null),
            ]);
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    // ----------------------------------------------------------------- swaps

    public function swaps(Request $request): JsonResponse
    {
        $canManage = $this->canManage($request->user());

        $rows = ShiftSwapRequest::query()
            ->where('organization_id', $request->user()->organization_id)
            // An employee sees only swaps they are part of. Everybody else's
            // shift trades are not their business.
            ->when(! $canManage, fn ($query) => $query->where(function ($scope) use ($request) {
                $scope->where('requested_by', $request->user()->id)
                    ->orWhere('requested_with', $request->user()->id);
            }))
            ->when($request->filled('status'), fn ($query) => $query->where('status', $request->string('status')))
            ->with([
                'requester:id,name', 'counterparty:id,name',
                'requesterDay:id,roster_date,shift_id', 'counterpartyDay:id,roster_date,shift_id',
            ])
            ->orderByDesc('id')
            ->paginate(25);

        return response()->json($rows);
    }

    public function requestSwap(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'own_roster_day_id' => 'required|integer',
            'their_roster_day_id' => 'required|integer',
            'reason' => 'nullable|string|max:500',
        ]);

        $mine = $this->rosterDay($request, (int) $validated['own_roster_day_id']);
        $theirs = $this->rosterDay($request, (int) $validated['their_roster_day_id']);

        if (! $mine || ! $theirs) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        return $this->guard(fn () => response()->json([
            'data' => $this->swaps->request($request->user(), $mine, $theirs, $validated['reason'] ?? null),
        ], 201));
    }

    public function respondToSwap(Request $request, ShiftSwapRequest $shiftSwapRequest): JsonResponse
    {
        if (! $this->owns($request, $shiftSwapRequest->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $request->validate([
            'action' => 'required|in:accept,decline,cancel,approve',
            'reason' => 'required_if:action,decline|nullable|string|max:500',
        ]);

        // Approving is a manager's act; the other three are the parties' own.
        if ($validated['action'] === 'approve' && ! $this->canManage($request->user())) {
            return response()->json(['message' => 'Only a manager can approve a swap.'], 403);
        }

        return $this->guard(fn () => response()->json([
            'data' => match ($validated['action']) {
                'accept' => $this->swaps->accept($shiftSwapRequest, $request->user()),
                'approve' => $this->swaps->approve($shiftSwapRequest, $request->user()),
                'cancel' => $this->swaps->cancel($shiftSwapRequest, $request->user()),
                default => $this->swaps->decline($shiftSwapRequest, $request->user(), (string) $validated['reason']),
            },
        ]));
    }

    // --------------------------------------------------------------- helpers

    private function guard(callable $work): JsonResponse
    {
        try {
            return $work();
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    private function owns(Request $request, ?int $organizationId): bool
    {
        return (int) $organizationId === (int) $request->user()->organization_id;
    }

    /**
     * Mirrors ShiftController's own gate — settings.manage, or hierarchy under
     * 100. Gating this differently would hide a screen the API would serve.
     */
    private function canManage(User $user): bool
    {
        return $user->getHierarchyLevel() < 100;
    }

    private function rosterDay(Request $request, int $id): ?RosterDay
    {
        return RosterDay::query()
            ->where('organization_id', $request->user()->organization_id)
            ->find($id);
    }
}
