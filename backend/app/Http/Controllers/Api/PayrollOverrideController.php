<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmployeePayrollTemplate;
use App\Models\PayrollOverride;
use App\Models\SalaryComponent;
use App\Models\User;
use App\Services\Payroll\OverrideApplicationService;
use App\Services\Payroll\OverrideAuditTrail;
use App\Services\Payroll\OverrideBalancingService;
use App\Services\Payroll\OverrideChangeAssessor;
use App\Services\Payroll\OverrideGridService;
use App\Services\Payroll\OverrideImportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The override register, and the preview no vendor in this market ships.
 *
 * Across Keka, greytHR, Zoho and RazorpayX, not one shows the consequence of an
 * override before it is saved. Every preview that exists is breakup-only and
 * revision-only. That matters here more than it would elsewhere, because this
 * salary structure is residual and the delta is amplified: raising basic by
 * 10,000 costs the residual 16,681, and an admin has no way to know that from
 * an input box.
 *
 * Validation is synchronous, at save. RazorpayX accepts an override, persists
 * an invalid state, and rejects it at finalisation — potentially weeks later,
 * as a batch-wide "all employees are showing as skipped and I cannot finalise
 * payroll" event, at the worst point in the payroll calendar. The admin is
 * looking at the screen now; now is when the fix is cheap.
 */
class PayrollOverrideController extends Controller
{
    /**
     * Phase 1 writes component and statutory overrides only.
     *
     * The other three scopes exist in the schema because the shape is the same
     * and splitting the table later would be worse than carrying the column
     * now. They are refused at the door rather than half-accepted: an ad-hoc
     * or LOP override that stores cleanly and then does nothing at process
     * time is a worse failure than one that never stored.
     */
    private const WRITABLE_SCOPES = ['component', 'statutory'];

    public function __construct(
        private readonly OverrideBalancingService $balancer,
        private readonly OverrideAuditTrail $audit,
    ) {
    }

    /**
     * What this override would do, without persisting anything.
     *
     * Returns the refusal as a 200 rather than a 422: the caller asked what
     * would happen, and "it would be refused, here is the maximum that would
     * not be" is a successful answer to that question. The 422 belongs on
     * store(), where something was actually attempted.
     */
    public function preview(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => 'required|integer',
            'target' => 'required|string|max:64',
            'value' => 'required|numeric',
            'balance_mode' => 'nullable|in:preserve_ctc,increase_gross',
        ]);

        $organizationId = (int) $request->user()->organization_id;

        $template = EmployeePayrollTemplate::where('user_id', $data['user_id'])
            ->where('organization_id', $organizationId)
            ->first();

        if (! $template || ! $template->annual_ctc) {
            return response()->json([
                'success' => false,
                'message' => 'This employee has no annual CTC on their payroll template, so there is nothing to balance against.',
            ], 422);
        }

        if ($this->balancer->hasAmbiguousResidual($organizationId)) {
            return response()->json([
                'success' => false,
                'message' => 'More than one salary component is marked as the residual. '
                    .'The balancer cannot know which should absorb the delta — mark exactly one.',
            ], 422);
        }

        $assessment = $this->balancer->assess(
            (float) $template->annual_ctc / 12,
            $this->configFor($template),
            (float) $data['value'],
            $data['balance_mode'] ?? OverrideBalancingService::MODE_PRESERVE_CTC,
        );

        $residual = $this->balancer->resolveResidual($organizationId);

        return response()->json([
            'success' => true,
            'preview' => $assessment + [
                'balancing_target' => $residual?->name,
                'balancing_target_id' => $residual?->id,
            ],
            // The sentence an admin can forward to the employee. When CTC holds
            // and basic rises, take-home falls and the employee asks why — and
            // no product in this market gives the admin anything to send.
            'employee_explanation' => $this->explain($assessment, (float) $template->annual_ctc),
        ]);
    }

    /**
     * The override register: what is in force, and what is pending.
     */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'month' => 'nullable|string|date_format:Y-m',
            'user_id' => 'nullable|integer',
        ]);

        $query = PayrollOverride::query()
            ->when($data['user_id'] ?? null, fn ($q, $userId) => $q->where('user_id', $userId))
            ->when($data['month'] ?? null, fn ($q, $month) => $q->inForceFor($month))
            ->orderByDesc('effective_from');

        return response()->json([
            'success' => true,
            'data' => $query->get()->map(fn (PayrollOverride $override) => $this->rowFor($override)),
        ]);
    }

    /**
     * Raise an override. Nothing about payroll moves as a result.
     *
     * Saving is a request, not an effect: the row lands as `pending`, an
     * approver who is not its author releases it, and the figures change the
     * next time the run is processed. Keka states the same rule from the other
     * side — "Perform Process Payroll to update the override information in the
     * system" — and it is what keeps a closed month closed.
     *
     * What is NOT deferred is whether the override is arithmetically possible.
     * That is settled here, synchronously, while the admin is still looking at
     * the screen.
     */
    public function store(Request $request): JsonResponse
    {
        // Two shapes on one route, as the grid and the dialog each need. The
        // presence of `items` is the discriminator; the single-item form below
        // is unchanged and still what OverrideDialog posts.
        if ($request->has('items')) {
            return $this->storeBatch($request);
        }

        $data = $request->validate([
            'user_id' => 'required|integer',
            'scope' => 'required|in:component,statutory,adhoc,lop,hold',
            'target' => 'required|string|max:64',
            'mode' => 'nullable|in:fixed,percentage',
            'value' => 'required|numeric|min:0|max:100000000',
            'balance_mode' => 'nullable|in:preserve_ctc,increase_gross',
            'effective_from' => 'required|date_format:Y-m-d',
            'effective_to' => 'nullable|date_format:Y-m-d|after_or_equal:effective_from',
            'reason' => 'required|string|min:5',
        ]);

        $organizationId = (int) $request->user()->organization_id;
        $scope = $data['scope'];

        if (! in_array($scope, self::WRITABLE_SCOPES, true)) {
            return $this->refuse(sprintf(
                "The '%s' override scope is not yet supported. Component and statutory overrides can be raised today.",
                $scope,
            ));
        }

        // User is one of the four models deliberately OUTSIDE
        // BelongsToOrganization — its scope would have to resolve the acting
        // user through Auth to stamp itself, so the trait is not applied. The
        // organisation filter is therefore explicit here, exactly as it is on
        // every other payroll lookup of a user by id. Leaving it to the trait
        // let an admin raise an override against an employee of another tenant.
        $employee = User::where('organization_id', $organizationId)
            ->where('id', $data['user_id'])
            ->first();

        if (! $employee) {
            return $this->refuse('That employee is not in this organisation.');
        }

        /*
         * Raising a change to your own pay is allowed only when somebody else
         * could approve it.
         *
         * Approval refuses a self-targeting override outright, with no
         * exception — so a sole admin who queued one would be creating a row
         * that can never leave 'pending'. Refusing it here says why now,
         * rather than letting it sit in the register as permanent evidence of
         * a request nobody can action.
         */
        if ((int) $employee->id === (int) $request->user()->id && $this->isSolePayrollAdmin($request->user())) {
            return $this->refuse(
                'You cannot raise a change to your own pay while you are the only payroll admin — '
                .'nobody else could approve it. Add a second admin first.'
            );
        }

        // A statutory head the engine does not produce is refused here rather
        // than accepted and ignored at process time.
        if ($scope === 'statutory' && ! in_array($data['target'], OverrideApplicationService::STATUTORY_TARGETS, true)) {
            return $this->refuse(sprintf(
                "'%s' is not a statutory head this engine computes. Use one of: %s.",
                $data['target'],
                implode(', ', OverrideApplicationService::STATUTORY_TARGETS),
            ));
        }

        if ($scope === 'component' && ($data['balance_mode'] ?? null) === null) {
            return $this->refuse(
                'A component override has to say what funds it: hold CTC and let the residual absorb '
                .'the change, or increase gross.'
            );
        }

        // (a) The per-component gate. Keka's wording is "Allow this component to
        // be customized and overridden at the employee level", and the point of
        // it is that an ungated component is not offered at all rather than
        // offered and then refused. This is the server half of that.
        if ($scope === 'component') {
            $component = $this->resolveGatedComponent($data['target'], $organizationId);

            if (! $component) {
                return $this->refuse(sprintf(
                    "'%s' is not open to employee-level override. Enable \"Allow this component to be overridden "
                    .'at employee level" on the component in Pay Group Settings first.',
                    $data['target'],
                ));
            }
        }

        // (b) Two residuals is not a preference the balancer can resolve — it
        // genuinely cannot know which component absorbs the delta.
        if ($this->balancer->hasAmbiguousResidual($organizationId)) {
            return $this->refuse(
                'More than one salary component is marked as the residual. '
                .'The balancer cannot know which should absorb the delta — mark exactly one.'
            );
        }

        $balanceMode = $data['balance_mode'] ?? null;

        // (c) The arithmetic. Refusing here is the whole design: RazorpayX
        // accepts a structure that cannot balance and surfaces it weeks later
        // at finalisation, as a batch-wide failure at the worst point in the
        // payroll calendar.
        if ($scope === 'component' && $balanceMode === OverrideBalancingService::MODE_PRESERVE_CTC) {
            $template = EmployeePayrollTemplate::where('user_id', $employee->id)
                ->where('organization_id', $organizationId)
                ->first();

            if (! $template || ! $template->annual_ctc) {
                return $this->refuse(
                    'This employee has no annual CTC on their payroll template, so there is nothing to balance against.'
                );
            }

            $assessment = $this->balancer->assess(
                (float) $template->annual_ctc / 12,
                $this->configFor($template),
                (float) $data['value'],
                OverrideBalancingService::MODE_PRESERVE_CTC,
            );

            if (! $assessment['permitted']) {
                return response()->json([
                    'success' => false,
                    'message' => $assessment['message'],
                    // Named explicitly rather than left in the prose, so the
                    // dialog can offer it as a one-click correction instead of
                    // making the admin parse a sentence for a number.
                    'max_permitted' => $assessment['max_permitted'],
                ], 422);
            }
        }

        // (d) One override per target at a time. Two overlapping overrides on
        // the same component are not additive and not ordered — whichever the
        // engine reached last would win, which is a coin toss dressed as a
        // rule.
        if ($this->overlapExists($employee->id, $scope, $data['target'], $data['effective_from'], $data['effective_to'] ?? null)) {
            return $this->refuse(sprintf(
                "An override on '%s' already covers part of that period for this employee. "
                .'Close the existing override first.',
                $data['target'],
            ));
        }

        $override = PayrollOverride::create([
            'organization_id' => $organizationId,
            'user_id' => $employee->id,
            'scope' => $scope,
            'target' => $data['target'],
            'mode' => $data['mode'] ?? 'fixed',
            'value' => $data['value'],
            'balance_mode' => $balanceMode,
            // Snapshotted now, because the component that absorbs this delta
            // must stay knowable even if the structure's residual is reassigned
            // later. computed_value is deliberately NOT set here — only the
            // engine knows what it would have produced.
            'balancing_target_id' => $scope === 'component'
                ? $this->balancer->resolveResidual($organizationId)?->id
                : null,
            'effective_from' => $data['effective_from'],
            'effective_to' => $data['effective_to'] ?? null,
            'reason' => $data['reason'],
            'status' => PayrollOverride::STATUS_PENDING,
            'created_by' => $request->user()->id,
        ]);

        $this->audit->created($override, (int) $request->user()->id);
        $autoApproved = $this->autoApproveIfUncontested($override, $request->user());

        return response()->json([
            'success' => true,
            'message' => $autoApproved
                ? 'Override approved. It applies the next time payroll is processed for an open run.'
                : 'Override raised. It applies the next time payroll is processed for an open run.',
            'data' => $this->rowFor($override->fresh()),
        ], 201);
    }

    /**
     * Release a pending override.
     *
     * Two separate controls here, and they guard different things.
     *
     * SELF-DEALING is about the TARGET, and it is absolute. Nobody approves a
     * change to their own pay — not a sole admin, not one of five. Note that
     * this is just as much a hole in a large organisation as a small one:
     * admin A raises an override on admin A's salary and admin B rubber-stamps
     * it. Counting approvers does nothing about that; refusing on the target
     * does.
     *
     * MAKER-CHECKER is about the AUTHOR, and it has one audited exception. In
     * an organisation with a single payroll admin, an absolute rule does not
     * produce control — it produces a dead feature, with every override stuck
     * pending. What the admin does then is what admins in that position always
     * do: they go around it, editing annual_ctc or custom_deductions[]
     * directly, neither of which requires a reason, an approver, or leaves an
     * audit row. Blocking the sole admin does not remove the capability; it
     * moves the change onto the one path that leaves no evidence. The exception
     * keeps it on the governed path and records itself in its own words.
     */
    public function approve(Request $request, int $id): JsonResponse
    {
        $override = PayrollOverride::find($id);

        if (! $override) {
            return response()->json(['success' => false, 'message' => 'Override not found.'], 404);
        }

        // A decided override is not silently re-decidable. 409, not 422: the
        // request is well-formed, it conflicts with the state of the resource.
        if (in_array($override->status, [
            PayrollOverride::STATUS_REJECTED,
            PayrollOverride::STATUS_CANCELLED,
        ], true)) {
            return response()->json([
                'success' => false,
                'message' => "This override was already {$override->status} and cannot be approved.",
            ], 409);
        }

        if ($override->status !== PayrollOverride::STATUS_PENDING) {
            return $this->refuse("Cannot approve an override in '{$override->status}' status.");
        }

        if ((int) $override->user_id === (int) $request->user()->id) {
            return $this->refuse('You cannot approve a change to your own pay.');
        }

        $soleAdmin = $this->isSolePayrollAdmin($request->user());

        if ((int) $override->created_by === (int) $request->user()->id && ! $soleAdmin) {
            return $this->refuse('You cannot approve an override you raised yourself. Ask another approver.');
        }

        $selfApproved = (int) $override->created_by === (int) $request->user()->id;

        $before = $this->audit->snapshot($override);

        $override->update([
            'status' => PayrollOverride::STATUS_APPROVED,
            'approved_by' => $request->user()->id,
            'approved_at' => now(),
        ]);

        $this->audit->approved(
            $override,
            (int) $request->user()->id,
            $before,
            // Said plainly on the row rather than inferred later from the fact
            // that two columns happen to match.
            $selfApproved ? 'self-approved: sole payroll admin' : null,
        );

        return response()->json([
            'success' => true,
            'message' => $selfApproved
                ? 'Override approved. Recorded as self-approved: you are the only payroll admin in this organisation.'
                : 'Override approved. It applies at the next payroll process.',
            'data' => $this->rowFor($override),
        ]);
    }

    /**
     * Is this the only person in the organisation who could approve anything?
     *
     * Strict admin means hierarchy level 10 or better — the same boundary
     * EnsureUserHasRole uses for `role:admin`. Counted over the organisation,
     * excluding deactivated accounts, because a disabled admin cannot approve.
     */
    private function isSolePayrollAdmin(User $actor): bool
    {
        $admins = User::query()
            ->where('organization_id', $actor->organization_id)
            ->whereNull('deactivated_at')
            ->with('customRole')
            ->get()
            ->filter(fn (User $user) => $user->getHierarchyLevel() <= 10);

        return $admins->count() <= 1;
    }

    /**
     * Refuse a pending override, with a reason.
     *
     * The note is required and lands on the audit row rather than on the
     * override, because a rejection is a decision about a request and belongs
     * in the history of that request.
     */
    public function reject(Request $request, int $id): JsonResponse
    {
        $data = $request->validate([
            'note' => 'required|string|min:5',
        ]);

        $override = PayrollOverride::find($id);

        if (! $override) {
            return response()->json(['success' => false, 'message' => 'Override not found.'], 404);
        }

        if (in_array($override->status, [
            PayrollOverride::STATUS_REJECTED,
            PayrollOverride::STATUS_CANCELLED,
        ], true)) {
            return response()->json([
                'success' => false,
                'message' => "This override was already {$override->status}.",
            ], 409);
        }

        if ($override->status !== PayrollOverride::STATUS_PENDING) {
            return $this->refuse("Cannot reject an override in '{$override->status}' status.");
        }

        // Refusing your own pay change is harmless, so the target rule does not
        // apply here — only the author rule, and a sole admin rejecting their
        // own request is just a withdrawal.
        if ((int) $override->created_by === (int) $request->user()->id
            && ! $this->isSolePayrollAdmin($request->user())) {
            return $this->refuse('You cannot decide on an override you raised yourself. Ask another approver.');
        }

        $before = $this->audit->snapshot($override);

        $override->update(['status' => PayrollOverride::STATUS_REJECTED]);

        $this->audit->rejected($override, (int) $request->user()->id, $before, $data['note']);

        return response()->json([
            'success' => true,
            'message' => 'Override rejected.',
            'data' => $this->rowFor($override),
        ]);
    }

    /**
     * Stop an override, without rewriting the months it already paid.
     *
     * An approved open-ended override is CLOSED at today rather than marked
     * cancelled. Cancelling would drop it out of scopeInForceFor() for every
     * month, including months already processed and disbursed under it, so a
     * recomputed March would silently pay a figure March never paid. Closing it
     * ends the override going forward and leaves history intact.
     *
     * // DECISION: an approved override that already carries an effective_to is
     * // cancelled outright, per the brief. The alternative — truncating every
     * // approved override to today regardless of whether it was open-ended —
     * // would protect bounded overrides that have already applied to a past
     * // month in the same way. It is the more consistent rule and probably the
     * // right one, but it is a wider change than this brief authorises.
     */
    public function cancel(Request $request, int $id): JsonResponse
    {
        $override = PayrollOverride::find($id);

        if (! $override) {
            return response()->json(['success' => false, 'message' => 'Override not found.'], 404);
        }

        if (! in_array($override->status, [PayrollOverride::STATUS_PENDING, PayrollOverride::STATUS_APPROVED], true)) {
            return $this->refuse("Cannot cancel an override in '{$override->status}' status.");
        }

        // An approved override that has already run out is closed, not
        // cancellable. Without this, closing an open-ended override at today
        // and then cancelling it again would fall through to the branch below
        // and mark it cancelled — dropping it out of inForceFor() for the very
        // months it was closed at today to protect.
        if ($override->status === PayrollOverride::STATUS_APPROVED
            && ! $override->isOpenEnded()
            && $override->effective_to->lte(Carbon::now()->endOfDay())) {
            return $this->refuse(sprintf(
                'This override already ended on %s. Months processed under it stay as paid.',
                $override->effective_to->toDateString(),
            ));
        }

        $before = $this->audit->snapshot($override);
        $closedRatherThanCancelled = $override->status === PayrollOverride::STATUS_APPROVED
            && $override->isOpenEnded();

        if ($closedRatherThanCancelled) {
            // The last day of the last CLOSED month, not today.
            //
            // Closing at today leaves the override in force for the remainder
            // of the current month, which is the month still being processed —
            // so "cancel" would silently still apply to the next payslip run.
            // Ending it at the last closed month stops it from the first month
            // anyone can still change, and leaves every month already paid
            // under it exactly as paid.
            $override->update(['effective_to' => $this->lastClosedMonthEnd($override->organization_id)]);
        } else {
            $override->update(['status' => PayrollOverride::STATUS_CANCELLED]);
        }

        $this->audit->cancelled(
            $override,
            (int) $request->user()->id,
            $before,
            $closedRatherThanCancelled
                ? 'Closed at today rather than cancelled: months already processed under this override are left as paid.'
                : null,
        );

        return response()->json([
            'success' => true,
            'message' => $closedRatherThanCancelled
                ? 'Override closed with effect from today. Months already processed under it are unchanged.'
                : 'Override cancelled.',
            'data' => $this->rowFor($override),
        ]);
    }

    /**
     * Raise many overrides in one act — the grid's Update button.
     *
     * ALL OR NOTHING. Every item is judged before anything is written, and one
     * failing item fails the request. A partial write is how a grid silently
     * drifts from the file it came from: the officer sees "3 of 12 applied",
     * has no way to tell which 3, and their next export disagrees with what
     * they thought they had done.
     *
     * The arithmetic is OverrideChangeAssessor's — the same one the CSV
     * importer uses — so a value the grid accepts is a value the file would
     * accept, and vice versa.
     */
    private function storeBatch(Request $request): JsonResponse
    {
        $data = $request->validate([
            'month' => 'nullable|date_format:Y-m',
            'reason' => 'required|string|min:3|max:255',
            'balance_mode' => 'nullable|in:preserve_ctc,increase_gross',
            'effective_from' => 'required|date_format:Y-m-d',
            'effective_to' => 'nullable|date_format:Y-m-d|after_or_equal:effective_from',
            'items' => 'required|array|min:1|max:500',
            'items.*.user_id' => 'required|integer',
            'items.*.target' => 'required|in:basic,hra',
            'items.*.value_annual' => 'required|numeric|min:0|max:100000000',
        ]);

        $organizationId = (int) $request->user()->organization_id;
        $actorId = (int) $request->user()->id;
        $balanceMode = $data['balance_mode'] ?? OverrideBalancingService::MODE_PRESERVE_CTC;

        if ($this->balancer->hasAmbiguousResidual($organizationId)) {
            return $this->refuse(
                'More than one salary component is marked as the residual. '
                .'The balancer cannot know which should absorb the delta — mark exactly one.'
            );
        }

        $grid = app(OverrideGridService::class);
        $assessor = app(OverrideChangeAssessor::class);
        $overridable = $grid->overridableTargets($organizationId);

        /*
         * Grouped by employee first. Two items for the same person — a raise to
         * basic and a pin on HRA — have to be judged together, because pinning
         * HRA changes what a rupee of basic costs. Judged separately, a pair
         * that balances would be refused on the basic alone.
         */
        $byUser = collect($data['items'])->groupBy('user_id');
        $errors = [];
        $planned = [];

        foreach ($byUser as $userId => $items) {
            $index = (int) $items->keys()->first();

            $fail = function (string $message) use (&$errors, $userId, $index) {
                $errors[] = ['index' => $index, 'user_id' => (int) $userId, 'message' => $message];
            };

            $employee = User::where('organization_id', $organizationId)->find($userId);

            if (! $employee) {
                $fail('That employee is not in this organisation.');

                continue;
            }

            if ((int) $employee->id === $actorId && $this->isSolePayrollAdmin($request->user())) {
                $fail('You cannot raise a change to your own pay while you are the only payroll admin.');

                continue;
            }

            $template = EmployeePayrollTemplate::where('user_id', $employee->id)
                ->where('organization_id', $organizationId)
                ->first();

            if (! $template || ! $template->annual_ctc) {
                $fail(sprintf('%s has no annual CTC, so there is nothing to balance against.', $employee->name));

                continue;
            }

            $values = [];
            $ungated = null;
            foreach ($items as $item) {
                if (! in_array($item['target'], $overridable, true)) {
                    $ungated = $item['target'];
                    break;
                }
                $values[$item['target']] = (int) round((float) $item['value_annual']);
            }

            if ($ungated !== null) {
                $fail(sprintf(
                    "'%s' is not open to employee-level override. Enable it in Pay Group Settings first.",
                    $ungated,
                ));

                continue;
            }

            $assessment = $assessor->assess($template, $values, $balanceMode);

            if (! $assessment['permitted']) {
                $fail(sprintf(
                    '%s: this would leave the residual at ₹%s. Basic can go up to ₹%s while holding CTC.',
                    $employee->name,
                    number_format($assessment['residual_after']),
                    number_format($assessment['max_basic_annual']),
                ));

                continue;
            }

            foreach ($values as $target => $valueAnnual) {
                $planned[] = [
                    'user_id' => (int) $employee->id,
                    'target' => $target,
                    'value_annual' => $valueAnnual,
                    'computed_annual' => $assessor->computedAnnual($template, $target),
                    'assessment' => $assessment,
                ];
            }
        }

        if ($errors !== []) {
            return response()->json([
                'success' => false,
                'message' => sprintf('%d of these changes cannot be applied. Nothing was saved.', count($errors)),
                'errors' => $errors,
            ], 422);
        }

        $created = [];

        DB::transaction(function () use ($planned, $data, $balanceMode, $actorId, &$created) {
            foreach ($planned as $entry) {
                $effectiveFrom = Carbon::parse($data['effective_from']);

                // Supersede rather than duplicate: the prior override is closed
                // the day before this one starts, so the months it already paid
                // stay exactly as paid.
                $prior = PayrollOverride::query()
                    ->where('user_id', $entry['user_id'])
                    ->where('scope', 'component')
                    ->where('target', $entry['target'])
                    ->whereIn('status', [PayrollOverride::STATUS_PENDING, PayrollOverride::STATUS_APPROVED])
                    ->get();

                foreach ($prior as $row) {
                    $before = $this->audit->snapshot($row);
                    $row->update(['effective_to' => $effectiveFrom->copy()->subDay()->toDateString()]);
                    $this->audit->cancelled($row, $actorId, $before, 'Superseded by a newer override.');
                }

                $override = PayrollOverride::create([
                    'user_id' => $entry['user_id'],
                    'scope' => 'component',
                    'target' => $entry['target'],
                    'mode' => 'fixed',
                    // Stored monthly, as every override is.
                    'value' => round($entry['value_annual'] / 12, 2),
                    'balance_mode' => $balanceMode,
                    'effective_from' => $data['effective_from'],
                    'effective_to' => $data['effective_to'] ?? null,
                    'reason' => $data['reason'],
                    'status' => PayrollOverride::STATUS_PENDING,
                    'created_by' => $actorId,
                    'source' => 'ui',
                ]);

                $this->audit->created($override, $actorId);
                $this->autoApproveIfUncontested($override, auth()->user());

                // The consequence travels back with the row, so the grid can
                // show what the change did without a second round trip.
                $created[] = $this->rowFor($override->fresh()) + [
                    'preview' => [
                        'residual_before' => $entry['assessment']['residual_before'],
                        'residual_after' => $entry['assessment']['residual_after'],
                        'amplification' => $entry['assessment']['amplification'],
                        'hra_moves_to' => $entry['assessment']['hra_moves_to'],
                        'computed_annual' => $entry['computed_annual'],
                    ],
                ];
            }
        });

        return response()->json([
            'success' => true,
            'message' => sprintf(
                '%d override%s raised. They apply at the next payroll process, once approved.',
                count($created),
                count($created) === 1 ? '' : 's',
            ),
            'data' => $created,
        ], 201);
    }

    /**
     * The grid: every employee, what the structure produces, what will be paid.
     */
    public function grid(Request $request): JsonResponse
    {
        $data = $request->validate([
            'page' => 'nullable|integer|min:1',
            'per_page' => 'nullable|integer|min:1|max:100',
            'q' => 'nullable|string|max:120',
            'salary_template_id' => 'nullable|integer',
            'month' => 'nullable|date_format:Y-m',
        ]);

        $organizationId = (int) $request->user()->organization_id;
        $grid = app(OverrideGridService::class);

        $month = $data['month'] ?? $grid->earliestOpenMonth($organizationId);
        $perPage = (int) ($data['per_page'] ?? 10);
        $page = (int) ($data['page'] ?? 1);

        $rows = $grid->rows($organizationId, $month, [
            'q' => $data['q'] ?? null,
            'salary_template_id' => $data['salary_template_id'] ?? null,
        ]);

        $total = $rows->count();

        return response()->json([
            'success' => true,
            'meta' => [
                'month' => $month,
                'total' => $total,
                'page' => $page,
                'per_page' => $perPage,
                'last_page' => max(1, (int) ceil($total / $perPage)),
                'earliest_open_month' => $grid->earliestOpenMonth($organizationId),
            ] + $grid->residualMeta($organizationId),
            'data' => $rows->forPage($page, $perPage)->values(),
        ]);
    }

    /** The append-only trail for one override. */
    public function audit(Request $request, int $id): JsonResponse
    {
        $override = PayrollOverride::find($id);

        if (! $override) {
            return response()->json(['success' => false, 'message' => 'Override not found.'], 404);
        }

        $entries = \App\Models\PayrollOverrideAudit::query()
            ->where('payroll_override_id', $override->id)
            ->with('actor:id,name')
            ->orderBy('id')
            ->get()
            ->map(fn (\App\Models\PayrollOverrideAudit $entry) => [
                'id' => $entry->id,
                'action' => $entry->action,
                'actor' => $entry->actor?->name,
                'note' => $entry->note,
                'before' => $entry->before_json,
                'after' => $entry->after_json,
                'created_at' => $entry->created_at?->toIso8601String(),
            ]);

        return response()->json(['success' => true, 'data' => $entries]);
    }

    /** The whole filtered set as CSV — never just the page on screen. */
    public function export(Request $request)
    {
        $data = $request->validate([
            'q' => 'nullable|string|max:120',
            'salary_template_id' => 'nullable|integer',
            'month' => 'nullable|date_format:Y-m',
        ]);

        $organizationId = (int) $request->user()->organization_id;
        $importer = app(OverrideImportService::class);
        $month = $data['month'] ?? app(OverrideGridService::class)->earliestOpenMonth($organizationId);

        $slug = Str::slug((string) ($request->user()->organization?->name ?? 'organisation')) ?: 'organisation';

        return response($importer->export($organizationId, $month, [
            'q' => $data['q'] ?? null,
            'salary_template_id' => $data['salary_template_id'] ?? null,
        ]), 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$importer->exportFilename($slug, $month).'"',
        ]);
    }

    public function template(Request $request)
    {
        return response(app(OverrideImportService::class)->template(), 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="component-overrides-template.csv"',
        ]);
    }

    /** Judge a file and park the result. Writes nothing. */
    public function importValidate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'file' => 'required|file|max:5120',
            'default_effective_from' => 'nullable|date_format:Y-m-d',
            'default_reason' => 'nullable|string|max:255',
            'month' => 'nullable|date_format:Y-m',
        ]);

        $organizationId = (int) $request->user()->organization_id;
        $month = $data['month'] ?? app(OverrideGridService::class)->earliestOpenMonth($organizationId);

        $result = app(OverrideImportService::class)->validate(
            $organizationId,
            $request->file('file'),
            $data['default_effective_from'] ?? null,
            $data['default_reason'] ?? null,
            $month,
        );

        return response()->json($result['payload'], $result['status']);
    }

    /**
     * Apply a validated batch.
     *
     * Re-validated inside the transaction: a payroll month can close, or
     * another admin can raise an override, between validate and commit. The
     * cached batch is a convenience, never the authority.
     */
    public function importCommit(Request $request): JsonResponse
    {
        $data = $request->validate([
            'batch_id' => 'required|string|uuid',
            'skip_errors' => 'nullable|boolean',
            'supersede' => 'nullable|boolean',
        ]);

        $importer = app(OverrideImportService::class);

        // Idempotent: the same batch committed twice returns the first answer
        // and writes nothing. A double-click must not double-apply a raise.
        $already = $importer->committedResult($data['batch_id']);
        if ($already !== null) {
            return response()->json($already);
        }

        $batch = $importer->batch($data['batch_id']);

        if ($batch === null) {
            return response()->json([
                'success' => false,
                'message' => 'This import expired. Upload the file again.',
            ], 410);
        }

        if ((int) $batch['organization_id'] !== (int) $request->user()->organization_id) {
            return response()->json(['success' => false, 'message' => 'This import belongs to another organisation.'], 404);
        }

        $rows = $batch['valid'];

        if ($rows === []) {
            return response()->json(['success' => false, 'message' => 'That import has no rows to apply.'], 422);
        }

        $importBatchId = (string) Str::uuid();
        $actorId = (int) $request->user()->id;
        $created = [];
        $superseded = 0;

        DB::transaction(function () use ($rows, $importBatchId, $actorId, &$created, &$superseded) {
            foreach ($rows as $entry) {
                foreach ($entry['changes'] as $change) {
                    $effectiveFrom = Carbon::parse($entry['effective_from']);

                    // Supersede rather than duplicate: the prior override is
                    // closed the day before this one starts, so the months it
                    // already paid stay exactly as paid.
                    $prior = PayrollOverride::query()
                        ->where('user_id', $entry['user_id'])
                        ->where('scope', 'component')
                        ->where('target', $change['target'])
                        ->whereIn('status', [PayrollOverride::STATUS_PENDING, PayrollOverride::STATUS_APPROVED])
                        ->get();

                    foreach ($prior as $row) {
                        $before = $this->audit->snapshot($row);
                        $row->update(['effective_to' => $effectiveFrom->copy()->subDay()->toDateString()]);
                        $this->audit->cancelled($row, $actorId, $before, 'Superseded by CSV import.');
                        $superseded++;
                    }

                    $override = PayrollOverride::create([
                        'user_id' => $entry['user_id'],
                        'scope' => 'component',
                        'target' => $change['target'],
                        'mode' => 'fixed',
                        // Stored monthly, as every other override is.
                        'value' => round($change['to'] / 12, 2),
                        'balance_mode' => $entry['balance_mode'],
                        'effective_from' => $entry['effective_from'],
                        'effective_to' => $entry['effective_to'],
                        'reason' => $entry['reason'],
                        'status' => PayrollOverride::STATUS_PENDING,
                        'created_by' => $actorId,
                        'import_batch_id' => $importBatchId,
                        'source_row' => $entry['spreadsheet_row'],
                        'source' => 'import',
                    ]);

                    $this->audit->created($override, $actorId);
                    // Same rule as the grid and the single-create path. An
                    // override that arrived by spreadsheet is not a different
                    // kind of decision, and leaving imports pending while the
                    // grid released immediately meant the same change needed
                    // a different number of clicks depending on how it was
                    // entered.
                    $this->autoApproveIfUncontested($override, auth()->user());
                    $created[] = $this->rowFor($override->fresh());
                }
            }
        });

        $result = [
            'success' => true,
            'batch_id' => $importBatchId,
            'created' => count($created),
            'skipped' => 0,
            'superseded' => $superseded,
            'overrides' => $created,
        ];

        $importer->rememberCommit($data['batch_id'], $result);
        $importer->forget($data['batch_id']);

        return response()->json($result);
    }

    /**
     * The last day of the most recent month whose payroll run is finished.
     *
     * Falls back to the day before today when no run has ever been closed —
     * an organisation mid-first-month has nothing paid to protect, and dating
     * the close in the future would extend the override rather than end it.
     */
    private function lastClosedMonthEnd(int $organizationId): string
    {
        $closed = \App\Models\PayrollMonthlyRun::query()
            ->where('organization_id', $organizationId)
            ->whereIn('status', ['disbursed', 'released', 'approved'])
            ->orderByDesc('month_year')
            ->value('month_year');

        if (! $closed) {
            return Carbon::now()->subDay()->toDateString();
        }

        return Carbon::createFromFormat('Y-m', $closed)->endOfMonth()->toDateString();
    }

    /**
     * The gated component behind a target, or null.
     *
     * // DECISION: the stored `target` is the ENGINE's key for the component
     * // ('basic', 'hra', 'conveyance', 'special_allowance') rather than the
     * // salary_components code ('BASIC', 'HRA', 'CONV', 'SPL'), because the
     * // engine looks the target up in the component map it computed and a code
     * // it cannot resolve is silently a no-op. The gate is therefore checked by
     * // mapping each of the organisation's components onto its engine key and
     * // asking whether the one matching this target is open to override.
     * // The alternative — storing the code and translating at apply time —
     * // moves the same map into the engine, where a failed translation costs a
     * // wrong payslip instead of a 422.
     */
    private function resolveGatedComponent(string $target, int $organizationId): ?SalaryComponent
    {
        return SalaryComponent::query()
            ->where('organization_id', $organizationId)
            ->where('is_active', true)
            ->where('allow_employee_override', true)
            ->get()
            ->first(fn (SalaryComponent $component) => OverrideApplicationService::engineKeyFor($component) === $target);
    }

    /**
     * Does an override already cover any part of this period for this target?
     *
     * Rejected and cancelled rows are ignored — they are history, not cover.
     * Open-ended on either side counts as reaching forever, which is why the
     * null cases are written out rather than left to a date comparison.
     */
    private function overlapExists(
        int $userId,
        string $scope,
        string $target,
        string $effectiveFrom,
        ?string $effectiveTo
    ): bool {
        return PayrollOverride::query()
            ->where('user_id', $userId)
            ->where('scope', $scope)
            ->where('target', $target)
            ->whereNotIn('status', [PayrollOverride::STATUS_REJECTED, PayrollOverride::STATUS_CANCELLED])
            // The existing override starts before this one ends...
            ->when(
                $effectiveTo !== null,
                fn ($q) => $q->whereDate('effective_from', '<=', $effectiveTo),
            )
            // ...and ends after this one starts.
            ->where(function ($q) use ($effectiveFrom) {
                $q->whereNull('effective_to')
                    ->orWhereDate('effective_to', '>=', $effectiveFrom);
            })
            ->exists();
    }

    /**
     * One row shape, shared by the register and every write response, so the
     * client never has to reconcile two versions of the same override.
     *
     * @return array<string, mixed>
     */
    private function rowFor(PayrollOverride $override): array
    {
        return [
            'id' => $override->id,
            'user_id' => $override->user_id,
            'scope' => $override->scope,
            'target' => $override->target,
            'value' => (float) $override->value,
            // Both values, which is what makes the register explain itself
            // rather than merely list what was changed.
            'computed_value' => $override->computed_value === null ? null : (float) $override->computed_value,
            'delta' => $override->delta(),
            'effective_from' => $override->effective_from?->toDateString(),
            // Shown even when null, so "this never ends" is visible on the
            // row rather than being something the officer has to infer.
            'effective_to' => $override->effective_to?->toDateString(),
            'open_ended' => $override->isOpenEnded(),
            'status' => $override->status,
            'reason' => $override->reason,
            'created_by' => $override->created_by,
        ] + $this->decisionRights($override);
    }

    /**
     * Release an override the moment it is raised, where the approval step
     * would have been a formality.
     *
     * The condition is exactly the one approve() would apply a second later:
     * the raiser must not be the subject, and there must be nobody else who
     * could have approved it. In a one-admin organisation that makes the
     * pending state pure friction — the officer raises a change, then approves
     * their own change, and no second pair of eyes was ever involved. Two
     * clicks, one judgement.
     *
     * It is NOT a removal of maker-checker. Add a second admin and every
     * override goes back to waiting for them, because at that point the
     * pending state is buying real review rather than ceremony.
     *
     * Self-dealing is untouched: a change to your own pay stays pending
     * whatever the admin count, because nobody may ever release that.
     */
    private function autoApproveIfUncontested(PayrollOverride $override, User $actor): bool
    {
        if ((int) $override->user_id === (int) $actor->id) {
            return false;
        }

        if (! $this->isSolePayrollAdmin($actor)) {
            return false;
        }

        $before = $this->audit->snapshot($override);

        $override->update([
            'status' => PayrollOverride::STATUS_APPROVED,
            'approved_by' => $actor->id,
            'approved_at' => now(),
        ]);

        // Said in the trail's own words, and distinct from a manual
        // self-approval so a reader can tell which happened.
        $this->audit->approved($override, (int) $actor->id, $before, 'auto-approved on creation: sole payroll admin');

        return true;
    }

    /**
     * Whether the acting user may decide this override, and why not.
     *
     * Computed HERE rather than in the client. The register used to re-derive
     * "can I approve this?" from created_by alone, which was right until the
     * sole-admin exception was added server-side — after which the only payroll
     * admin in an organisation could approve through the API and was shown no
     * button to do it with. Two implementations of one rule, and they drifted
     * the moment the rule changed.
     *
     * The reason travels with the answer so the UI can disable the control and
     * say why, rather than hiding it. A control that silently vanishes is
     * indistinguishable from a feature that is broken.
     *
     * @return array<string, mixed>
     */
    private function decisionRights(PayrollOverride $override): array
    {
        $actor = auth()->user();

        if (! $actor || $override->status !== PayrollOverride::STATUS_PENDING) {
            return ['can_approve' => false, 'can_reject' => false, 'decision_blocked_reason' => null];
        }

        // Self-dealing: about the TARGET, and absolute. No exception, no
        // matter how many admins the organisation has.
        if ((int) $override->user_id === (int) $actor->id) {
            return [
                'can_approve' => false,
                'can_reject' => false,
                'decision_blocked_reason' => 'You cannot decide on a change to your own pay.',
            ];
        }

        $isAuthor = (int) $override->created_by === (int) $actor->id;

        if ($isAuthor && ! $this->isSolePayrollAdmin($actor)) {
            return [
                'can_approve' => false,
                'can_reject' => false,
                'decision_blocked_reason' => 'You raised this. Another admin has to approve it.',
            ];
        }

        return [
            'can_approve' => true,
            'can_reject' => true,
            // Named on the row, so the officer knows before pressing it that
            // this approval will be recorded as a self-approval.
            'decision_blocked_reason' => $isAuthor
                ? 'You raised this, and you are the only payroll admin — approving will be recorded as a self-approval.'
                : null,
        ];
    }

    private function refuse(string $message): JsonResponse
    {
        return response()->json(['success' => false, 'message' => $message], 422);
    }

    /**
     * The structure percentages the balancer works against.
     *
     * Falls back to the engine's own defaults so a template that has never had
     * them customised behaves exactly as the payroll run does.
     */
    private function configFor(EmployeePayrollTemplate $template): array
    {
        return [
            'basic_percentage' => (float) ($template->basic_percentage ?? 40) / 100,
            'hra_percentage_of_basic' => (float) ($template->hra_percentage ?? 50) / 100,
            'conveyance_allowance' => (float) ($template->conveyance_allowance ?? 1600),
        ];
    }

    /**
     * "My CTC did not change but my take-home went down" is the most
     * predictable support ticket this feature will generate, and the largest
     * unserved gap found across five products. Generating the answer alongside
     * the preview turns it into a proactive message.
     */
    private function explain(array $assessment, float $annualCtc): string
    {
        if (! $assessment['permitted']) {
            return $assessment['message'];
        }

        if ($assessment['mode'] === OverrideBalancingService::MODE_INCREASE_GROSS) {
            return 'Your CTC increases to fund this change; nothing else in your structure moves.';
        }

        return sprintf(
            'Your CTC is unchanged at %s. Your basic has changed, which moves your PF and gratuity — '
            .'both long-term savings that stay yours — and your special allowance absorbs the difference. '
            .'Each rupee of basic shifts %s of allowance, because HRA is calculated from basic and '
            .'employer PF and gratuity sit inside your CTC.',
            number_format($annualCtc, 2),
            number_format($assessment['amplification'], 3),
        );
    }
}
