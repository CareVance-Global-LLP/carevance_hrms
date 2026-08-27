<?php

namespace Tests\Feature\Ai;

use App\Http\Controllers\Api\ReportGroupController;
use App\Models\AuditLog;
use App\Models\Group;
use App\Models\LeaveType;
use App\Models\Organization;
use App\Models\User;
use App\Services\Ai\Actions\ActionExecutor;
use App\Services\Ai\Actions\ActionPreviewBuilder;
use App\Services\Ai\Actions\ActionRefusedException;
use App\Services\Ai\Actions\ActionToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Routing\Events\RouteMatched;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Apply is the only moment in AI mode that changes anything, so every one of
 * these tests is about a way it could change the WRONG thing — and each of those
 * ways looks like success from the outside.
 *
 *  - **A write that bypassed the endpoint.** This codebase has zero Laravel
 *    policies: authorization, the FormRequest rules and the tenant checks all
 *    live in controllers. `$model->update()` would apply the same diff and skip
 *    every one of them, and the row would look identical afterwards. So the
 *    proof here is never "the column changed" — it is a side effect only the
 *    CONTROLLER produces: the department slug it regenerates, the validation it
 *    runs, the route the router matched.
 *  - **A signed token trusted as a decision.** A signature proves the server
 *    issued the plan, not that the catalogue, the bounds or the person's
 *    permissions still say yes. Everything is re-checked from scratch, which is
 *    why tokens minted here with an unknown action and an out-of-range value are
 *    both refused despite being perfectly valid signatures.
 *  - **A diff applied to a value that moved.** Between preview and Apply
 *    somebody else may have edited the row. Writing anyway silently erases their
 *    change and the audit records ours as if it were the only one.
 *  - **An audit that names the wrong actor.** "Who changed this?" has to stay
 *    answerable, and the answer is the human who clicked Apply — with the
 *    question they asked, because "why" is the other half of the trail.
 *
 * @see docs/superpowers/specs/2026-08-26-ai-write-actions.md §4, §5, §6, §7
 */
class ActionExecutorTest extends TestCase
{
    use RefreshDatabase;

    private const QUESTION = 'change the casual leave carry-forward to 10 days';

    private Organization $org;

    private Organization $otherOrg;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->org = Organization::create([
            'name' => 'Acme India',
            'slug' => 'acme-india',
            'settings' => [
                'timezone' => 'Asia/Kolkata',
                'attendance' => [
                    'office_start_time' => '09:00:00',
                    'late_after_time' => '09:30:00',
                ],
            ],
        ]);

        $this->otherOrg = Organization::create(['name' => 'Beta Ltd', 'slug' => 'beta-ltd']);

        $this->admin = $this->user('admin', $this->org);
    }

    // ---------------------------------------------------------------- fixtures

    private function user(string $role, Organization $organization): User
    {
        return User::create([
            'name' => ucfirst($role).' '.$organization->id,
            'email' => $role.'-'.$organization->id.'-'.uniqid().'@test.local',
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $organization->id,
        ]);
    }

    private function leaveType(Organization $organization, array $attributes = []): LeaveType
    {
        return LeaveType::create(array_merge([
            'organization_id' => $organization->id,
            'code' => 'casual',
            'name' => 'Casual Leave',
            'annual_quota' => 12,
            'carry_forward_cap' => 5,
        ], $attributes));
    }

    private function department(string $name, ?Organization $organization = null): Group
    {
        $organization ??= $this->org;

        return Group::create([
            'organization_id' => $organization->id,
            'name' => $name,
            'slug' => strtolower(str_replace(' ', '-', $name)),
            'is_active' => true,
        ]);
    }

    private function capPlan(int $to = 10, string $name = 'Casual Leave'): array
    {
        return [
            'action' => 'leave_type.update',
            'target' => ['name' => $name],
            'changes' => ['carry_forward_cap' => $to],
        ];
    }

    // ------------------------------------------------------------------ driver

    /**
     * The request the executor forwards the acting user's own credential from.
     *
     * The internal dispatch runs the real `api.token` middleware, which reads a
     * bearer and knows nothing about a test's session guard — so the origin
     * request has to carry one, exactly as the real `/api/search/act` request
     * does.
     */
    private function originRequest(User $actor): Request
    {
        $request = Request::create('/api/search/act', 'POST', [], [], [], [
            'HTTP_AUTHORIZATION' => 'Bearer '.$this->issueApiToken($actor),
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_USER_AGENT' => 'CareVance/tests',
            'REMOTE_ADDR' => '203.0.113.7',
        ]);

        $request->setUserResolver(fn () => $actor);

        return $request;
    }

    private function tokenFor(array $plan, ?User $actor = null): string
    {
        $actor ??= $this->admin;
        $this->actingAs($actor);

        $preview = app(ActionPreviewBuilder::class)->build($plan, $actor, self::QUESTION);

        $this->assertNotNull($preview['token'], 'the preview issued no token, so there is nothing to apply');

        return $preview['token'];
    }

    /** @return array<string, mixed> */
    private function apply(string $token, ?User $actor = null): array
    {
        $actor ??= $this->admin;
        $this->actingAs($actor);

        return app(ActionExecutor::class)->execute($token, $actor, $this->originRequest($actor));
    }

    private function refuse(string $token, ?User $actor = null): ActionRefusedException
    {
        try {
            $this->apply($token, $actor);
        } catch (ActionRefusedException $e) {
            return $e;
        }

        $this->fail('the change was applied when it should have been refused');
    }

    private function cap(int $id): float
    {
        return (float) DB::table('leave_types')->where('id', $id)->value('carry_forward_cap');
    }

    // --------------------------------------------- the write goes through HTTP

    /**
     * §4: "EXECUTION GOES THROUGH THE REAL ENDPOINT, NEVER ELOQUENT."
     *
     * Proved by a side effect that belongs to the CONTROLLER and to nothing
     * else. `ReportGroupController::update` regenerates the slug from the new
     * name; `$group->update(['name' => …])` does not, and leaves a row that is
     * otherwise identical. Asserting on the name alone would pass for both.
     *
     * The matched route is captured as well, because the slug proves the
     * controller's code ran and the route proves the ROUTER put it there —
     * middleware, model binding and all.
     */
    public function test_the_write_goes_through_the_route_and_the_controller(): void
    {
        $design = $this->department('Design');

        $matched = [];
        Event::listen(RouteMatched::class, function (RouteMatched $event) use (&$matched): void {
            $matched[] = $event->route->getActionName();
        });

        $result = $this->apply($this->tokenFor([
            'action' => 'department.rename',
            'target' => ['name' => 'Design'],
            'changes' => ['name' => 'Product Design'],
        ]));

        $this->assertTrue($result['applied']);

        $row = DB::table('groups')->where('id', $design->id)->first();

        $this->assertSame('Product Design', $row->name);
        $this->assertSame(
            'product-design',
            $row->slug,
            'the slug was not regenerated, so the write did not go through ReportGroupController::update',
        );

        $this->assertContains(
            ReportGroupController::class.'@update',
            $matched,
            'no route was matched, so nothing was dispatched through the router',
        );
    }

    /**
     * The endpoint's own validation is the point of going through it.
     *
     * `assertUniqueGroupName` lives in the controller and nowhere else — a
     * direct model write would happily create the duplicate this codebase
     * already suffers from ("HR" and "Human Resources" splitting every
     * department report). A refusal here is the endpoint doing its job, and it
     * must not be reported as an applied change.
     */
    public function test_a_write_the_endpoint_refuses_is_reported_as_a_refusal_and_changes_nothing(): void
    {
        $this->department('Engineering');
        $design = $this->department('Design');

        $refusal = $this->refuse($this->tokenFor([
            'action' => 'department.rename',
            'target' => ['name' => 'Design'],
            'changes' => ['name' => 'Engineering'],
        ]));

        $this->assertSame(ActionRefusedException::REJECTED, $refusal->refusal());
        $this->assertStringContainsString('already exists', $refusal->getDetail());

        $this->assertSame(
            'Design',
            DB::table('groups')->where('id', $design->id)->value('name'),
            'a refused write still moved the row',
        );
    }

    /**
     * A leave-type change comes back in the endpoint's own response envelope.
     *
     * `LeaveTypeController::update` answers `{"data": …}` with the row re-read
     * after the write. Reporting the value we sent instead would hide anything
     * the controller changed on the way through.
     */
    public function test_a_leave_type_change_is_applied_and_reported_from_the_stored_row(): void
    {
        $type = $this->leaveType($this->org);

        $result = $this->apply($this->tokenFor($this->capPlan(10)));

        $this->assertTrue($result['applied']);
        $this->assertSame('leave_type.update', $result['action']);
        $this->assertSame($type->id, $result['target']['id']);
        $this->assertSame(10.0, $this->cap($type->id));
        $this->assertSame(5, $result['changes'][0]['from']);
        $this->assertSame(10, $result['changes'][0]['to']);
        $this->assertStringContainsString('Casual Leave', $result['message']);
        $this->assertSame('/settings?pane=leave-types', $result['route']);
    }

    /**
     * `required_by_endpoint` is why a one-field change is not a 422.
     *
     * `UpdateOrganizationRequest` marks `name` and `slug` required whatever is
     * being edited, so the executor has to echo the live value of whichever the
     * plan does not touch. Without it the whole feature fails at its last step,
     * after a human has already confirmed.
     */
    public function test_a_field_the_endpoint_requires_but_the_plan_does_not_touch_is_echoed(): void
    {
        $result = $this->apply($this->tokenFor([
            'action' => 'organization.update',
            'target' => [],
            'changes' => ['timezone' => 'Asia/Dubai'],
        ]));

        $this->assertTrue($result['applied']);

        $organization = Organization::find($this->org->id);

        $this->assertSame('Asia/Dubai', $organization->settings['timezone']);
        $this->assertSame('Acme India', $organization->name, 'the echoed name overwrote the real one');
    }

    /**
     * The internal request is authenticated by `api.token`, not by whoever this
     * process happens to think is signed in.
     *
     * Proved by taking the credential away and leaving everything else intact —
     * the session guard still holds the admin, the token is still valid, the
     * permission check still passes. The write is refused anyway, because the
     * middleware is real. Anything that made the sub-request trusted by virtue
     * of running inside the application would sail through here, and would be
     * trusting exactly the ambient state this design routes around.
     */
    public function test_the_internal_request_is_authenticated_by_the_real_middleware(): void
    {
        $type = $this->leaveType($this->org);
        $token = $this->tokenFor($this->capPlan(10));

        $anonymous = Request::create('/api/search/act', 'POST');
        $anonymous->setUserResolver(fn () => $this->admin);

        try {
            app(ActionExecutor::class)->execute($token, $this->admin, $anonymous);
            $this->fail('an unauthenticated internal request wrote to the row');
        } catch (ActionRefusedException $e) {
            $this->assertSame(ActionRefusedException::NOT_PERMITTED, $e->refusal());
        }

        $this->assertSame(5.0, $this->cap($type->id));
    }

    // ------------------------------------------------- re-validated from scratch

    /**
     * §4: "THE PREVIEWED PLAN IS WHAT EXECUTES … re-validated from scratch."
     *
     * A signature proves the server issued the plan. It says nothing about
     * whether the catalogue still contains the action — and the catalogue is
     * where "no payroll state transitions" is enforced. Trusting the signature
     * alone would make a token minted before an action was withdrawn still
     * executable after it.
     */
    public function test_a_validly_signed_token_naming_an_action_outside_the_catalogue_is_refused(): void
    {
        $token = ActionToken::issue([
            'action' => 'payroll_run.approve',
            'target' => ['id' => 1, 'label' => 'August 2026'],
            'changes' => ['status' => 'approved'],
            'question' => self::QUESTION,
        ], ['status' => 'locked'], $this->admin->id);

        $refusal = $this->refuse($token);

        $this->assertSame(ActionRefusedException::UNKNOWN_ACTION, $refusal->refusal());
        $this->assertStringContainsString('payroll_run.approve', $refusal->getDetail());
    }

    /**
     * The field bounds are re-read from the catalogue too, not carried in the
     * token. A cap of 4000 days is refused at Apply exactly as it is at preview,
     * with the same sentence — which is what "a client that edits the payload
     * gets the same refusal a fresh request would" means in practice.
     */
    public function test_a_validly_signed_token_carrying_an_out_of_range_value_is_refused(): void
    {
        $type = $this->leaveType($this->org);

        $token = ActionToken::issue([
            'action' => 'leave_type.update',
            'target' => ['id' => $type->id, 'label' => 'Casual Leave'],
            'changes' => ['carry_forward_cap' => 4000],
            'question' => self::QUESTION,
        ], ['carry_forward_cap' => 5], $this->admin->id);

        $refusal = $this->refuse($token);

        $this->assertSame(ActionRefusedException::OUT_OF_BOUNDS, $refusal->refusal());
        $this->assertStringContainsString('365', $refusal->getDetail());
        $this->assertSame(5.0, $this->cap($type->id));
    }

    /** A field the catalogue does not expose is refused however it got into the plan. */
    public function test_a_validly_signed_token_naming_a_field_the_action_cannot_change_is_refused(): void
    {
        $type = $this->leaveType($this->org);

        $token = ActionToken::issue([
            'action' => 'leave_type.update',
            'target' => ['id' => $type->id, 'label' => 'Casual Leave'],
            'changes' => ['is_active' => false],
            'question' => self::QUESTION,
        ], ['is_active' => true], $this->admin->id);

        $refusal = $this->refuse($token);

        $this->assertStringContainsString('is_active', $refusal->getDetail());
        $this->assertTrue((bool) DB::table('leave_types')->where('id', $type->id)->value('is_active'));
    }

    // ------------------------------------------------------------- bad tokens

    /**
     * §7: "A tampered token is refused."
     *
     * Tampered the way it would really happen — the payload edited to a
     * different value, the signature left as issued. The refusal is the ONE
     * token refusal, identical to an expired or a foreign token, because
     * distinguishing them tells somebody probing tokens which part they got
     * right.
     */
    public function test_a_tampered_token_is_refused_and_writes_nothing(): void
    {
        $type = $this->leaveType($this->org);
        $token = $this->tokenFor($this->capPlan(10));

        [$body, $signature] = explode('.', $token);
        $payload = json_decode($this->base64UrlDecode($body), true);
        $payload['plan']['changes']['carry_forward_cap'] = 365;

        $refusal = $this->refuse($this->base64UrlEncode(json_encode($payload)).'.'.$signature);

        $this->assertSame(ActionRefusedException::NO_PREVIEW, $refusal->refusal());
        $this->assertSame(5.0, $this->cap($type->id), 'a tampered token wrote to the row');
    }

    /** §7: "An expired token is refused." A preview walked away from is not consent. */
    public function test_an_expired_token_is_refused_and_writes_nothing(): void
    {
        $type = $this->leaveType($this->org);
        $token = $this->tokenFor($this->capPlan(10));

        Carbon::setTestNow(Carbon::now()->addSeconds(ActionToken::TTL_SECONDS + 1));

        try {
            $refusal = $this->refuse($token);
        } finally {
            Carbon::setTestNow();
        }

        $this->assertSame(ActionRefusedException::NO_PREVIEW, $refusal->refusal());
        $this->assertSame(5.0, $this->cap($type->id));
    }

    /**
     * A token is not a forwardable capability. The audit's "who confirmed this"
     * would otherwise name whoever the preview was built for rather than the
     * person who applied it.
     */
    public function test_a_token_issued_to_somebody_else_is_refused(): void
    {
        $type = $this->leaveType($this->org);
        $token = $this->tokenFor($this->capPlan(10));

        $other = $this->user('admin', $this->org);

        $refusal = $this->refuse($token, $other);

        $this->assertSame(ActionRefusedException::NO_PREVIEW, $refusal->refusal());
        $this->assertSame(5.0, $this->cap($type->id));
    }

    // -------------------------------------------------------------- staleness

    /**
     * §4: "RE-READ BEFORE WRITING … Applying a diff to a value that has moved is
     * how one person's change silently erases another's."
     *
     * The row is moved by somebody else between preview and Apply. The write is
     * refused, the other person's value survives, and the message names both
     * numbers so the asker can see what changed under them.
     */
    public function test_a_before_that_no_longer_matches_the_live_row_refuses_and_writes_nothing(): void
    {
        $type = $this->leaveType($this->org);
        $token = $this->tokenFor($this->capPlan(10));

        // Somebody else edits the row while the preview is on screen.
        DB::table('leave_types')->where('id', $type->id)->update(['carry_forward_cap' => 7]);

        $refusal = $this->refuse($token);

        $this->assertSame(ActionRefusedException::STALE, $refusal->refusal());
        $this->assertStringContainsString('Carry-forward cap', $refusal->getDetail());
        $this->assertSame(7.0, $this->cap($type->id), "the other person's change was erased");
    }

    /**
     * Somebody else making the very change that was asked for is still stale.
     *
     * The diff no longer exists, so re-sending it is not "already done" — the
     * row moved, and the honest answer is to say so rather than to report a
     * change this Apply did not make.
     */
    public function test_a_row_already_moved_to_the_requested_value_is_stale_rather_than_applied(): void
    {
        $type = $this->leaveType($this->org);
        $token = $this->tokenFor($this->capPlan(10));

        DB::table('leave_types')->where('id', $type->id)->update(['carry_forward_cap' => 10]);

        $refusal = $this->refuse($token);

        $this->assertSame(ActionRefusedException::STALE, $refusal->refusal());
        $this->assertSame(0, AuditLog::query()->where('action', ActionExecutor::AUDIT_ACTION)->count());
    }

    /** A refusal from the write path is never handed to the prose assistant. */
    public function test_a_refusal_never_becomes_prose(): void
    {
        $this->leaveType($this->org);
        $token = $this->tokenFor($this->capPlan(10));

        Carbon::setTestNow(Carbon::now()->addSeconds(ActionToken::TTL_SECONDS + 1));

        try {
            $refusal = $this->refuse($token);
        } finally {
            Carbon::setTestNow();
        }

        $this->assertFalse(
            $refusal->mayAnswerInProse(),
            'a change request answered in prose reads as though something happened',
        );
    }

    // ------------------------------------------------------------ permissions

    /**
     * §4: "PERMISSION IS CHECKED AGAINST THE ACTING USER, TWICE … because the
     * two are separate requests and a role can change between them."
     *
     * The token stays perfectly valid — it is bound to this user and has not
     * expired. What changed is the person, and that is checked at execution
     * rather than assumed from the preview.
     */
    public function test_a_user_who_has_lost_the_permission_is_refused_at_execution(): void
    {
        $type = $this->leaveType($this->org);
        $token = $this->tokenFor($this->capPlan(10));

        DB::table('users')->where('id', $this->admin->id)->update(['role' => 'manager']);
        $this->admin->refresh();

        $this->assertFalse($this->admin->hasPermission('settings.manage'), 'fixture no longer proves anything');

        $refusal = $this->refuse($token);

        $this->assertSame(ActionRefusedException::NOT_PERMITTED, $refusal->refusal());
        $this->assertStringContainsString('settings.manage', $refusal->getDetail());
        $this->assertSame(5.0, $this->cap($type->id));
    }

    /**
     * The capability is not the only gate. `settings.manage` is granted to
     * admin, hr and payroll_manager while the leave-type route is `role:admin`,
     * so somebody moved into HR keeps the capability and loses the route.
     */
    public function test_a_user_the_route_would_turn_away_is_refused_at_execution(): void
    {
        $type = $this->leaveType($this->org);
        $token = $this->tokenFor($this->capPlan(10));

        DB::table('users')->where('id', $this->admin->id)->update(['role' => 'hr']);
        $this->admin->refresh();

        $this->assertTrue($this->admin->hasPermission('settings.manage'), 'fixture no longer proves anything');

        $refusal = $this->refuse($token);

        $this->assertSame(ActionRefusedException::NOT_PERMITTED, $refusal->refusal());
        $this->assertSame(5.0, $this->cap($type->id));
    }

    // --------------------------------------------------------------- tenancy

    /**
     * §7: "a plan naming another organisation's row resolves to nothing."
     *
     * The target is re-resolved at execution through the model's ordinary query,
     * so `BelongsToOrganization` applies. A row that has moved tenant since the
     * preview is simply not there any more.
     */
    public function test_a_target_that_now_belongs_to_another_organisation_resolves_to_nothing(): void
    {
        $type = $this->leaveType($this->org);
        $token = $this->tokenFor($this->capPlan(10));

        DB::table('leave_types')->where('id', $type->id)->update(['organization_id' => $this->otherOrg->id]);

        $refusal = $this->refuse($token);

        $this->assertSame(ActionRefusedException::NOT_FOUND, $refusal->refusal());
        $this->assertSame(5.0, $this->cap($type->id));
    }

    /**
     * `Organization` is the one target the global scope cannot protect.
     *
     * It is deliberately outside `BelongsToOrganization` — the scope resolves
     * the tenant *through* it — so `Organization::query()->whereKey(…)` finds
     * anybody's. There is exactly one addressable organisation, the acting
     * user's own, and a plan naming another is refused rather than quietly
     * applied to whichever one the caller happens to be in.
     */
    public function test_a_plan_naming_another_organisation_cannot_reach_it(): void
    {
        $token = ActionToken::issue([
            'action' => 'organization.update',
            'target' => ['id' => $this->otherOrg->id, 'label' => 'Beta Ltd'],
            'changes' => ['timezone' => 'Asia/Dubai'],
            'question' => self::QUESTION,
        ], ['timezone' => null], $this->admin->id);

        $refusal = $this->refuse($token);

        $this->assertSame(ActionRefusedException::NOT_FOUND, $refusal->refusal());
        $this->assertNull(Organization::find($this->otherOrg->id)->settings['timezone'] ?? null);
    }

    // ----------------------------------------------------------------- audit

    /**
     * §4: "THE AUDIT RECORDS THAT IT WAS AI-INITIATED, AND WHO CONFIRMED."
     *
     * The actor is the human who clicked Apply — never a service account — and
     * the question they typed is stored beside it, because "who" without "why"
     * cannot explain a change nobody remembers making.
     */
    public function test_the_audit_names_the_confirming_human_the_question_and_the_diff(): void
    {
        $type = $this->leaveType($this->org);

        $this->apply($this->tokenFor($this->capPlan(10)));

        $entry = AuditLog::query()->where('action', ActionExecutor::AUDIT_ACTION)->sole();

        $this->assertSame($this->admin->id, $entry->actor_user_id, 'the audit does not name the human who confirmed');
        $this->assertSame($this->org->id, $entry->organization_id);
        $this->assertSame('LeaveType', $entry->target_type);
        $this->assertSame($type->id, (int) $entry->target_id);

        $this->assertSame(self::QUESTION, $entry->metadata['question']);
        $this->assertSame('leave_type.update', $entry->metadata['action']);
        $this->assertTrue($entry->metadata['ai_initiated']);
        $this->assertSame(5, $entry->metadata['before']['carry_forward_cap']);
        $this->assertSame(10, $entry->metadata['after']['carry_forward_cap']);
        $this->assertStringContainsString('/api/leave-types/', $entry->metadata['endpoint']);
    }

    /** Nothing was written, so nothing is claimed in the trail. */
    public function test_a_refused_apply_writes_no_audit_row(): void
    {
        $this->leaveType($this->org);
        $token = $this->tokenFor($this->capPlan(10));

        DB::table('leave_types')->update(['carry_forward_cap' => 7]);

        $this->refuse($token);

        $this->assertSame(0, AuditLog::query()->where('action', ActionExecutor::AUDIT_ACTION)->count());
    }

    /**
     * A token is single-use in the only sense that matters: the second Apply
     * finds the row already holding the new value, which no longer matches the
     * token's before, and is refused as stale. Nothing is written twice and the
     * trail carries one row, not two.
     */
    public function test_applying_the_same_token_twice_writes_once(): void
    {
        $type = $this->leaveType($this->org);
        $token = $this->tokenFor($this->capPlan(10));

        $this->apply($token);
        $this->refuse($token);

        $this->assertSame(10.0, $this->cap($type->id));
        $this->assertSame(1, AuditLog::query()->where('action', ActionExecutor::AUDIT_ACTION)->count());
    }

    // ----------------------------------------------------------------- helpers

    private function base64UrlDecode(string $value): string
    {
        return (string) base64_decode(strtr($value, '-_', '+/'), true);
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
