<?php

namespace App\Http\Controllers\Api\WorkingTime;

use App\Http\Controllers\Api\ShiftController;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Audit\AuditLogService;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The shared shape of a working-time policy endpoint.
 *
 * Four policy kinds — weekly off, penalisation, overtime and shift allowance —
 * are catalogued and assigned identically, so the shape lives here once and each
 * subclass supplies only what genuinely differs: its models, its validation and
 * how it presents its child rows. Four hand-copied controllers would be four
 * places for the tenancy check and the delete guard to drift apart, and this is
 * exactly the code where drift is expensive.
 *
 * Everything below deliberately mirrors ShiftController and
 * ShiftAssignmentController, because these are the same decision as rostering:
 *
 *  - AUTHORISATION is inline and permission-based, not a `role:` middleware on
 *    the route. Both work for the built-in roles, but the middleware matches on
 *    the role STRING, so a custom role holding settings.manage would be refused
 *    at the door and never reach the check meant to admit it. The predicate is
 *    literally ShiftController::canManage — one definition of "may configure how
 *    time is paid", not two that can diverge.
 *  - TENANCY is pinned with forOrganization() on every read, and both ends of an
 *    assignment are re-checked against the caller's workspace rather than
 *    trusted from the payload. Another tenant's id is a 404; an assignment
 *    naming another tenant's employee is a 422 the form can point at.
 *  - CATALOGUE AND ROSTER ARE SEPARATE ACTIONS on purpose. Editing a policy
 *    changes what everyone on it is paid; assigning one changes one person.
 *
 * DELETION IS GUARDED, for the reason ShiftController spells out: the
 * assignment's foreign key CASCADES, so deleting an assigned policy would
 * silently erase the rows a payroll re-run for an earlier month resolves
 * against. Retiring a policy is is_active = false, which stops it being offered
 * without rewriting the past.
 */
abstract class WorkingTimePolicyController extends Controller
{
    public function __construct(
        protected readonly AuditLogService $auditLogService,
    ) {
    }

    /** @return class-string<Model> */
    abstract protected function policyClass(): string;

    /** @return class-string<Model> */
    abstract protected function assignmentClass(): string;

    /** The column on the assignment table naming the policy. */
    abstract protected function policyForeignKey(): string;

    /** Audit action prefix, e.g. "working_time.overtime_policy". */
    abstract protected function auditKey(): string;

    /**
     * Validation for the policy body.
     *
     * @return array<string, mixed>
     */
    abstract protected function rules(bool $creating): array;

    /**
     * A last look at the validated payload, for shapes a rules array cannot
     * express. Returns the data to store; throws ValidationException to refuse.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    protected function afterValidation(array $data): array
    {
        return $data;
    }

    /**
     * Child rows — a half-day ladder, a set of overtime scopes — written after
     * the policy exists and inside the same transaction.
     *
     * @param array<string, mixed> $data
     */
    protected function saveChildren(Model $policy, array $data): void
    {
    }

    /** Keys handled by saveChildren() rather than mass-assigned. */
    protected function childKeys(): array
    {
        return [];
    }

    /** @return array<int, string> */
    protected function eagerLoads(): array
    {
        return [];
    }

    /** @return array<string, mixed> */
    protected function present(Model $policy): array
    {
        $policy->loadCount('assignments');

        if ($this->eagerLoads() !== []) {
            $policy->load($this->eagerLoads());
        }

        return $this->presentLoaded($policy);
    }

    /**
     * The response body for a policy whose counts and children are already
     * loaded. Split from present() so the list does not re-query per row, and
     * so a subclass renames its child collection in exactly one place.
     *
     * @return array<string, mixed>
     */
    protected function presentLoaded(Model $policy): array
    {
        return array_merge($policy->toArray(), [
            'assigned_count' => (int) ($policy->assignments_count ?? 0),
        ]);
    }

    // ---- the catalogue -------------------------------------------------------

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (($guard = $this->guard($user)) !== null) {
            return $guard;
        }

        $policies = $this->policyClass()::forOrganization((int) $user->organization_id)
            ->withCount('assignments')
            ->with($this->eagerLoads())
            ->orderBy('name')
            ->get();

        return response()->json([
            'data' => $policies->map(fn (Model $policy) => $this->presentLoaded($policy))->values(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (($guard = $this->guard($user)) !== null) {
            return $guard;
        }

        $data = $this->afterValidation($request->validate($this->rules(true)));
        $this->assertNameIsFree($user, (string) $data['name']);

        $policy = DB::transaction(function () use ($user, $data) {
            $policy = $this->policyClass()::create(array_merge(
                $this->storableAttributes($data),
                ['organization_id' => $user->organization_id],
            ));

            $this->saveChildren($policy, $data);

            return $policy;
        });

        $this->auditLogService->log(
            action: $this->auditKey().'.created',
            actor: $user,
            target: $policy,
            metadata: ['name' => $policy->name],
            request: $request,
        );

        return response()->json(['data' => $this->present($policy->fresh())], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (($guard = $this->guard($user)) !== null) {
            return $guard;
        }

        $policy = $this->policyClass()::forOrganization((int) $user->organization_id)->find($id);
        if (! $policy) {
            return response()->json(['message' => 'Policy not found.'], 404);
        }

        $data = $this->afterValidation($request->validate($this->rules(false)));

        if (array_key_exists('name', $data)) {
            $this->assertNameIsFree($user, (string) $data['name'], (int) $policy->id);
        }

        DB::transaction(function () use ($policy, $data) {
            $attributes = $this->storableAttributes($data);

            if ($attributes !== []) {
                $policy->update($attributes);
            }

            $this->saveChildren($policy, $data);
        });

        $this->auditLogService->log(
            action: $this->auditKey().'.updated',
            actor: $user,
            target: $policy,
            metadata: ['name' => $policy->name, 'changed' => array_keys($data)],
            request: $request,
        );

        return response()->json(['data' => $this->present($policy->fresh())]);
    }

    /**
     * Refused while anybody is assigned — see the class docblock.
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (($guard = $this->guard($user)) !== null) {
            return $guard;
        }

        $policy = $this->policyClass()::forOrganization((int) $user->organization_id)->find($id);
        if (! $policy) {
            return response()->json(['message' => 'Policy not found.'], 404);
        }

        $assignments = $this->assignmentClass()::forOrganization((int) $user->organization_id)
            ->where($this->policyForeignKey(), $policy->id)
            ->count();

        if ($assignments > 0) {
            return response()->json([
                'message' => "This policy is assigned to {$assignments} employee(s). Deactivate it instead so past attendance still resolves.",
                'assignments_count' => $assignments,
            ], 409);
        }

        $snapshot = ['name' => $policy->name];
        $policy->delete();

        $this->auditLogService->log(
            action: $this->auditKey().'.deleted',
            actor: $user,
            target: $policy,
            metadata: $snapshot,
            request: $request,
        );

        return response()->json(['message' => 'Policy deleted.']);
    }

    // ---- assignment ----------------------------------------------------------

    public function assignments(Request $request): JsonResponse
    {
        $user = $request->user();
        if (($guard = $this->guard($user)) !== null) {
            return $guard;
        }

        $request->validate([
            'user_id' => ['nullable', 'integer'],
            'policy_id' => ['nullable', 'integer'],
        ]);

        $assignments = $this->assignmentClass()::forOrganization((int) $user->organization_id)
            ->with(['policy', 'user:id,name,email'])
            ->when($request->filled('user_id'), fn ($query) => $query->where('user_id', (int) $request->query('user_id')))
            ->when(
                $request->filled('policy_id'),
                fn ($query) => $query->where($this->policyForeignKey(), (int) $request->query('policy_id'))
            )
            ->orderByDesc('effective_from')
            ->orderByDesc('id')
            ->get();

        return response()->json(['data' => $assignments]);
    }

    public function assign(Request $request): JsonResponse
    {
        $user = $request->user();
        if (($guard = $this->guard($user)) !== null) {
            return $guard;
        }

        $data = $request->validate([
            'user_id' => ['required', 'integer'],
            'policy_id' => ['required', 'integer'],
            'effective_from' => ['required', 'date'],
            'effective_to' => ['nullable', 'date', 'after_or_equal:effective_from'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        // User is deliberately outside BelongsToOrganization — its scope
        // resolves the acting user through Auth — so the tenant filter is
        // written out here, as it is everywhere else that looks a colleague up
        // by id.
        $employee = User::where('organization_id', $user->organization_id)->find((int) $data['user_id']);
        if (! $employee) {
            throw ValidationException::withMessages([
                'user_id' => 'That employee is not in this workspace.',
            ]);
        }

        $policy = $this->policyClass()::forOrganization((int) $user->organization_id)->find((int) $data['policy_id']);
        if (! $policy) {
            throw ValidationException::withMessages([
                'policy_id' => 'That policy is not in this workspace.',
            ]);
        }

        // A NEW ROW, never an edit of the one in force. The previous assignment
        // stays open-ended and keeps resolving for the months it actually
        // covered, which is what a payroll re-run for an earlier month reads.
        $assignment = $this->assignmentClass()::create([
            'organization_id' => $user->organization_id,
            'user_id' => $employee->id,
            $this->policyForeignKey() => $policy->id,
            'effective_from' => $data['effective_from'],
            'effective_to' => $data['effective_to'] ?? null,
            'is_active' => (bool) ($data['is_active'] ?? true),
        ]);

        $this->auditLogService->log(
            action: $this->auditKey().'.assigned',
            actor: $user,
            target: $assignment,
            metadata: [
                'user_id' => (int) $employee->id,
                'policy_id' => (int) $policy->id,
                'policy_name' => $policy->name,
                'effective_from' => $assignment->effective_from?->toDateString(),
                'effective_to' => $assignment->effective_to?->toDateString(),
            ],
            request: $request,
        );

        return response()->json([
            'data' => $assignment->fresh(['policy', 'user:id,name,email']),
        ], 201);
    }

    public function unassign(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (($guard = $this->guard($user)) !== null) {
            return $guard;
        }

        $assignment = $this->assignmentClass()::forOrganization((int) $user->organization_id)->find($id);
        if (! $assignment) {
            return response()->json(['message' => 'Assignment not found.'], 404);
        }

        $snapshot = [
            'user_id' => (int) $assignment->user_id,
            'policy_id' => (int) $assignment->{$this->policyForeignKey()},
            'effective_from' => $assignment->effective_from?->toDateString(),
        ];
        $assignment->delete();

        $this->auditLogService->log(
            action: $this->auditKey().'.unassigned',
            actor: $user,
            target: $assignment,
            metadata: $snapshot,
            request: $request,
        );

        return response()->json(['message' => 'Assignment removed.']);
    }

    // ---- shared plumbing -----------------------------------------------------

    /**
     * The two refusals every action starts with, in one place so none of them
     * can be forgotten in one method and present in the other five.
     */
    protected function guard(?User $user): ?JsonResponse
    {
        if (! $user || ! $user->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if (! ShiftController::canManage($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return null;
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    protected function storableAttributes(array $data): array
    {
        return array_diff_key($data, array_flip($this->childKeys()));
    }

    /**
     * Every policy table carries a unique index on (organization_id, name), so
     * this is a 422 the form can point at rather than a 500 from the driver.
     * Compared case-insensitively, because "Night" and "night" are the same
     * policy to everyone except the index.
     */
    protected function assertNameIsFree(User $user, string $name, ?int $ignoreId = null): void
    {
        $clash = $this->policyClass()::forOrganization((int) $user->organization_id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower(trim($name))])
            ->when($ignoreId, fn ($query) => $query->whereKeyNot($ignoreId))
            ->exists();

        if ($clash) {
            throw ValidationException::withMessages([
                'name' => 'Another policy in this workspace already uses that name.',
            ]);
        }
    }
}
