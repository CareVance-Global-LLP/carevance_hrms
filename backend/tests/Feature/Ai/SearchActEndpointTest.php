<?php

namespace Tests\Feature\Ai;

use App\Models\AuditLog;
use App\Models\Group;
use App\Models\LeaveType;
use App\Models\Organization;
use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use App\Services\Ai\Actions\ActionCatalogue;
use App\Services\Ai\Actions\ActionExecutor;
use App\Services\Ai\Actions\ActionToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The two endpoints, over HTTP, as a browser reaches them.
 *
 * `ActionPreviewBuilderTest` and `ActionExecutorTest` already prove the engine
 * in isolation. What could still be wrong is everything BETWEEN them and a
 * person: whether a change request reaches the write path at all, whether a
 * preview leaks a side effect on the way to the screen, whether an Apply is
 * authenticated as the human who clicked it, and — the property that matters
 * most — whether asking an ordinary question still answers it.
 *
 * Four things are being defended here, and each of them looks fine from the
 * outside when it is broken:
 *
 *  - **The read path is untouched.** A question must still come back as a
 *    table and a non-data question must still come back as prose. The write
 *    branch sits inside the read path's own refusal handler, so a routing
 *    mistake there does not produce an error — it produces "I can't change
 *    that" for a question that used to be answered.
 *  - **A preview writes nothing.** Asserted as bytes, not as a spot check on
 *    the column that was going to move: a preview that touched a timestamp, a
 *    slug or a neighbouring row would pass any narrower assertion.
 *  - **Every token failure is one refusal.** Tampered, expired and somebody
 *    else's must be indistinguishable, or a caller probing tokens learns which
 *    part of one they got right.
 *  - **A refusal is never a paragraph.** §6: a person who asked for a change
 *    and received prose would reasonably believe something happened. "Delete
 *    all employees" has to come back refused BY NAME.
 *
 * @see docs/superpowers/specs/2026-08-26-ai-write-actions.md §5, §6, §7
 */
class SearchActEndpointTest extends TestCase
{
    use RefreshDatabase;

    /** The words a person types, carried all the way into the audit row. */
    private const QUESTION = 'change the casual leave carry-forward to 10 days';

    private Organization $org;

    private Organization $otherOrg;

    private User $admin;

    private LeaveType $casual;

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
        $this->casual = $this->leaveType($this->org);

        config()->set('services.ai.secondary_base_url', 'https://openrouter.test/api/v1');
        config()->set('services.ai.secondary_api_key', 'k');
        config()->set('services.ai.secondary_models', 'stealth/ox-alpha');
    }

    // ---------------------------------------------------------------- fixtures

    private function user(string $role, Organization $organization): User
    {
        return User::create([
            'name' => ucfirst($role).' '.uniqid(),
            'email' => $role.'-'.uniqid().'@act.test',
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $organization->id,
        ]);
    }

    private function leaveType(Organization $organization, array $attributes = []): LeaveType
    {
        return LeaveType::withoutGlobalScopes()->create(array_merge([
            'organization_id' => $organization->id,
            'code' => 'casual',
            'name' => 'Casual Leave',
            'annual_quota' => 12,
            'carry_forward_cap' => 5,
        ], $attributes));
    }

    /**
     * Both planners answer on one faked transport, told apart by their prompt.
     *
     * They share `PlanningClient` and therefore share a provider, so a URL-keyed
     * fake cannot tell the read path's call from the write path's — and this
     * endpoint makes both, in that order, for every change request. Keying on
     * the system prompt is what lets one test say "the query planner declines,
     * and then the action planner says this".
     */
    private function fakePlanners(string $actionJson, string $queryJson = '{"error":"That is not something I can answer from your data."}'): void
    {
        Http::fake(function ($request) use ($actionJson, $queryJson) {
            $system = (string) data_get($request->data(), 'messages.0.content');

            return Http::response([
                'choices' => [[
                    'message' => [
                        'content' => str_contains($system, 'ONE action plan') ? $actionJson : $queryJson,
                    ],
                ]],
            ], 200);
        });
    }

    private function capPlan(int $to = 10, string $name = 'Casual Leave'): string
    {
        return json_encode([
            'action' => 'leave_type.update',
            'target' => ['name' => $name],
            'changes' => ['carry_forward_cap' => $to],
        ]);
    }

    /** The preview a person is shown, as the endpoint returns it. */
    private function preview(?string $question = null, ?User $actor = null): array
    {
        $this->actingAs($actor ?? $this->admin);

        $response = $this->postJson('/api/search/ask', ['question' => $question ?? self::QUESTION]);

        $response->assertOk()->assertJsonPath('kind', 'action');

        return $response->json('action');
    }

    private function tokenFor(?string $question = null, ?User $actor = null): string
    {
        $preview = $this->preview($question, $actor);

        $this->assertNotNull($preview['token'], 'the preview issued no token, so there is nothing to apply');

        return $preview['token'];
    }

    private function apply(string $token, ?User $actor = null)
    {
        $this->actingAs($actor ?? $this->admin);

        return $this->postJson('/api/search/act', ['token' => $token]);
    }

    private function cap(?int $id = null): float
    {
        return (float) DB::table('leave_types')->where('id', $id ?? $this->casual->id)->value('carry_forward_cap');
    }

    /** Every row of every table an action in the catalogue can reach, as bytes. */
    private function snapshot(): string
    {
        return json_encode([
            'leave_types' => DB::table('leave_types')->orderBy('id')->get()->toArray(),
            'groups' => DB::table('groups')->orderBy('id')->get()->toArray(),
            'organizations' => DB::table('organizations')->orderBy('id')->get()->toArray(),
        ]);
    }

    // --------------------------------------------------------------- preview

    /**
     * §5: a change request comes back as an action, with the diff computed
     * against the row as it actually is.
     *
     * `from` is asserted against the seeded 5 rather than against whatever the
     * planner said, because §4's "THE PREVIEW IS COMPUTED, NOT PROMISED" is the
     * difference between a diff and a claim. A model-supplied `from` would
     * render identically and describe a change that never existed.
     */
    public function test_a_change_question_returns_an_action_preview_read_from_the_live_row(): void
    {
        $this->fakePlanners($this->capPlan(10));

        $action = $this->preview();

        $this->assertSame('leave_type.update', $action['key']);
        $this->assertSame('Update a leave type', $action['label']);
        $this->assertSame($this->casual->id, $action['target']['id']);
        $this->assertSame('Casual Leave', $action['target']['label']);

        $this->assertCount(1, $action['changes']);
        $this->assertSame('carry_forward_cap', $action['changes'][0]['field']);
        $this->assertSame('Carry-forward cap', $action['changes'][0]['label']);
        $this->assertSame(5, $action['changes'][0]['from'], 'the before-value was not read from the live row');
        $this->assertSame(10, $action['changes'][0]['to']);

        $this->assertSame('Affects 1 employee', $action['impact']);
        $this->assertNotNull($action['token']);
    }

    /**
     * §1: "A preview is not a side effect."
     *
     * Asserted as BYTES across every table the catalogue can reach, not as a
     * check on the one column that was about to move. A preview that bumped an
     * `updated_at`, regenerated a slug or touched a neighbouring row would pass
     * a narrower assertion and would still be a write nobody consented to.
     */
    public function test_a_preview_writes_nothing(): void
    {
        $this->fakePlanners($this->capPlan(10));

        $before = $this->snapshot();

        $action = $this->preview();

        $this->assertNotNull($action['token'], 'nothing was previewed, so this proves nothing');
        $this->assertSame($before, $this->snapshot(), 'previewing a change modified the data');
        $this->assertSame(
            0,
            AuditLog::query()->where('action', ActionExecutor::AUDIT_ACTION)->count(),
            'a preview recorded an applied change in the audit trail',
        );

        /*
         * The ONE row a preview does write, asserted rather than left implicit.
         *
         * Every ask has been logged since AI mode existed, and a change request
         * is an ask — dropping it would leave the record of what people typed
         * with a hole in exactly the half that can write. It is a log of the
         * question, not a change to anything the question was about, which is
         * why the snapshot above is the assertion that matters.
         */
        $this->assertSame(1, DB::table('ai_chat_logs')->where('message', self::QUESTION)->count());
    }

    // ----------------------------------------------------------------- apply

    /** §5: Apply changes the row and says where to go and look at it. */
    public function test_applying_a_valid_token_changes_the_row_and_returns_the_route(): void
    {
        $this->fakePlanners($this->capPlan(10));

        $response = $this->apply($this->tokenFor());

        $response->assertOk()
            ->assertJsonPath('applied', true)
            ->assertJsonPath('route', '/settings?pane=leave-types');

        $this->assertStringContainsString('Casual Leave', $response->json('message'));
        $this->assertStringContainsString('10', $response->json('message'));
        $this->assertSame(10.0, $this->cap());
    }

    /**
     * §4: "THE AUDIT RECORDS THAT IT WAS AI-INITIATED, AND WHO CONFIRMED."
     *
     * The actor is the human who posted to `/search/act`, never a service
     * account, and the question they typed is stored beside it — "who" without
     * "why" cannot explain a change nobody remembers making. The question comes
     * out of the signed token rather than off the Apply request, so it is not
     * something the audited party can compose.
     */
    public function test_the_audit_names_the_confirming_human_and_carries_the_original_question(): void
    {
        $this->fakePlanners($this->capPlan(10));

        $this->apply($this->tokenFor())->assertOk();

        $entry = AuditLog::query()->where('action', ActionExecutor::AUDIT_ACTION)->sole();

        $this->assertSame($this->admin->id, $entry->actor_user_id);
        $this->assertSame($this->org->id, $entry->organization_id);
        $this->assertSame($this->casual->id, (int) $entry->target_id);

        $this->assertSame(self::QUESTION, $entry->metadata['question']);
        $this->assertTrue($entry->metadata['ai_initiated']);
        $this->assertSame($this->admin->id, $entry->metadata['confirmed_by']['id']);
        $this->assertSame($this->admin->name, $entry->metadata['confirmed_by']['name']);
        $this->assertSame(5, $entry->metadata['before']['carry_forward_cap']);
        $this->assertSame(10, $entry->metadata['after']['carry_forward_cap']);
    }

    /**
     * A token is single-use — as STALENESS, not as a consumed nonce, and the
     * distinction is deliberate.
     *
     * A nonce would need a store, a sweep and a decision about what a crashed
     * request leaves behind. The re-read check already refuses the second Apply
     * for a truer reason: the row no longer holds the value the preview was
     * computed against, because the first Apply moved it. That also catches the
     * case a nonce never would — somebody ELSE having made the same change in
     * between — and it costs no state at all.
     */
    public function test_re_applying_the_same_token_is_refused_as_stale_and_writes_once(): void
    {
        $this->fakePlanners($this->capPlan(10));

        $token = $this->tokenFor();

        $this->apply($token)->assertOk();

        $this->apply($token)
            ->assertStatus(422)
            ->assertJsonPath('error', 'action_refused')
            ->assertJsonPath('refusal', 'stale');

        $this->assertSame(10.0, $this->cap());
        $this->assertSame(1, AuditLog::query()->where('action', ActionExecutor::AUDIT_ACTION)->count());
    }

    // ------------------------------------------------------------ bad tokens

    /**
     * §7: a tampered, an expired and a foreign token are all refused — and are
     * refused IDENTICALLY.
     *
     * Asserted as one comparison of the three response bodies rather than three
     * separate status checks, because the property is not "each is refused", it
     * is "none of them can be told apart". A caller feeding tokens to this
     * endpoint must learn nothing about which part of one they got right, and a
     * message that differed by a word would be exactly that oracle.
     */
    public function test_a_tampered_an_expired_and_another_users_token_get_the_same_refusal(): void
    {
        $this->fakePlanners($this->capPlan(10));

        $token = $this->tokenFor();

        // Tampered the way it would really happen: the payload edited to a
        // different value, the signature left as issued.
        [$body, $signature] = explode('.', $token);
        $payload = json_decode((string) base64_decode(strtr($body, '-_', '+/'), true), true);
        $payload['plan']['changes']['carry_forward_cap'] = 365;
        $forged = rtrim(strtr(base64_encode(json_encode($payload)), '+/', '-_'), '=').'.'.$signature;

        $tampered = $this->apply($forged);

        $somebodyElse = $this->apply($token, $this->user('admin', $this->org));

        Carbon::setTestNow(Carbon::now()->addSeconds(ActionToken::TTL_SECONDS + 1));

        try {
            $expired = $this->apply($token);
        } finally {
            Carbon::setTestNow();
        }

        foreach (['tampered' => $tampered, 'expired' => $expired, 'foreign' => $somebodyElse] as $name => $response) {
            $response->assertStatus(422)->assertJsonPath('refusal', 'no_preview');
            $this->assertSame(5.0, $this->cap(), "a {$name} token wrote to the row");
        }

        $this->assertSame(
            $tampered->json(),
            $expired->json(),
            'a tampered token is distinguishable from an expired one',
        );
        $this->assertSame(
            $tampered->json(),
            $somebodyElse->json(),
            "a tampered token is distinguishable from somebody else's",
        );
    }

    /**
     * §4: "RE-READ BEFORE WRITING … Applying a diff to a value that has moved
     * is how one person's change silently erases another's."
     *
     * The refusal NAMES the field, because "something changed" leaves the
     * reader with nothing to check, and it names both numbers so they can see
     * what moved under them.
     */
    public function test_a_stale_before_value_refuses_and_names_the_field(): void
    {
        $this->fakePlanners($this->capPlan(10));

        $token = $this->tokenFor();

        // Somebody else edits the row while the preview is on screen.
        DB::table('leave_types')->where('id', $this->casual->id)->update(['carry_forward_cap' => 7]);

        $response = $this->apply($token);

        $response->assertStatus(422)->assertJsonPath('refusal', 'stale');

        $this->assertStringContainsString('Carry-forward cap', $response->json('message'));
        $this->assertSame(7.0, $this->cap(), "the other person's change was erased");
        $this->assertSame(0, AuditLog::query()->where('action', ActionExecutor::AUDIT_ACTION)->count());
    }

    // ------------------------------------------------------------ permission

    /**
     * §4: "PERMISSION IS CHECKED AGAINST THE ACTING USER, TWICE."
     *
     * The user here is deliberately awkward: a custom role ranked at the AI-mode
     * door's own level, so `mayAsk()` lets them in, holding none of the
     * capabilities. Anything less contrived would be turned away by the 403 on
     * the mode itself and would prove only that the door works.
     *
     * Refused at PREVIEW so they are told before composing a change, and
     * refused again at ACT with a token minted directly for them — because the
     * two are separate requests, and a preview permission check that the
     * executor trusted would be a check a client could skip by not asking for
     * one.
     */
    public function test_an_unauthorised_user_is_refused_at_preview_and_at_act(): void
    {
        $this->fakePlanners($this->capPlan(10));

        $stranger = $this->unprivilegedInsider();

        $this->actingAs($stranger);

        $preview = $this->postJson('/api/search/ask', ['question' => self::QUESTION]);

        $preview->assertStatus(422)->assertJsonPath('refusal', 'not_permitted');
        $this->assertStringContainsString('settings.manage', $preview->json('message'));

        // A token they could never have been issued, handed to them anyway.
        $minted = ActionToken::issue([
            'action' => 'leave_type.update',
            'target' => ['id' => $this->casual->id, 'label' => 'Casual Leave'],
            'changes' => ['carry_forward_cap' => 10],
            'question' => self::QUESTION,
        ], ['carry_forward_cap' => 5], $stranger->id);

        $this->apply($minted, $stranger)
            ->assertStatus(422)
            ->assertJsonPath('refusal', 'not_permitted');

        $this->assertSame(5.0, $this->cap());
    }

    /** AI mode's own door, on both halves of the feature. */
    public function test_a_non_admin_cannot_reach_either_endpoint(): void
    {
        $this->fakePlanners($this->capPlan(10));

        $token = $this->tokenFor();

        $employee = $this->user('employee', $this->org);

        $this->actingAs($employee);
        $this->postJson('/api/search/ask', ['question' => self::QUESTION])->assertStatus(403);
        $this->apply($token, $employee)->assertStatus(403);

        $this->assertSame(5.0, $this->cap());
    }

    // --------------------------------------------------------------- tenancy

    /**
     * §7: "a plan naming another organisation's row resolves to nothing."
     *
     * No organisation filter is written anywhere in the action path — the
     * resolution runs through the model's ordinary query, so
     * `BelongsToOrganization` applies structurally. The refusal is the same
     * "I couldn't find it" a genuinely absent row produces, which is also the
     * only answer that tells the caller nothing about another tenant's records.
     */
    public function test_another_organisations_row_is_unreachable(): void
    {
        $theirs = $this->leaveType($this->otherOrg, ['code' => 'sabbatical', 'name' => 'Sabbatical']);

        $this->fakePlanners($this->capPlan(10, 'Sabbatical'));

        $this->actingAs($this->admin);

        $response = $this->postJson('/api/search/ask', [
            'question' => 'change the sabbatical carry-forward to 10 days',
        ]);

        $response->assertStatus(422)->assertJsonPath('refusal', 'not_found');
        $this->assertStringContainsString('Sabbatical', $response->json('message'));

        $this->assertSame(5.0, $this->cap($theirs->id), "another tenant's row was changed");
    }

    // -------------------------------------------------------------- refusals

    /**
     * §6.1: "Not in the catalogue — 'I can't change that.' Named, so it is
     * actionable."
     *
     * The assertion that matters is the one about PROSE. Before write actions
     * existed this question fell through to the assistant, which would explain
     * how employee records work — a paragraph, in response to a request to
     * delete everybody, from which any reader would conclude something had
     * happened. The refusal has to be terminal and it has to name the thing.
     */
    public function test_delete_all_employees_is_refused_by_name(): void
    {
        $this->fakePlanners('{"error":"There is no action for deleting an employee."}');

        $this->actingAs($this->admin);

        $before = DB::table('users')->count();

        $response = $this->postJson('/api/search/ask', ['question' => 'delete all employees']);

        $response->assertStatus(422)
            ->assertJsonPath('kind', 'refusal')
            ->assertJsonPath('error', 'action_refused');

        $this->assertStringContainsString('deleting an employee', $response->json('message'));
        $this->assertNotSame('prose', $response->json('kind'), 'a deletion request was answered with a paragraph');
        $this->assertSame($before, DB::table('users')->count(), 'a deletion request removed people');
    }

    /**
     * §4: "PAYROLL IS READ, NAVIGATE AND PREPARE ONLY."
     *
     * Two ways in, both closed. The planner has no payroll key to emit because
     * the catalogue never showed it one; and a caller who mints a signed token
     * naming `payroll_run.approve` anyway is refused at Apply, because the
     * catalogue is re-read there rather than trusted from the signature.
     */
    public function test_approving_a_payroll_run_is_refused_and_no_payroll_action_exists(): void
    {
        foreach (ActionCatalogue::keys() as $key) {
            $this->assertStringNotContainsString('payroll', $key, "'{$key}' puts payroll in reach of AI mode");
        }

        $this->fakePlanners('{"error":"Payroll runs cannot be approved from here."}');

        $this->actingAs($this->admin);

        $this->postJson('/api/search/ask', ['question' => 'approve the payroll run for July'])
            ->assertStatus(422)
            ->assertJsonPath('error', 'action_refused')
            ->assertJsonPath('refusal', 'unknown_action');

        $forged = ActionToken::issue([
            'action' => 'payroll_run.approve',
            'target' => ['id' => 1, 'label' => 'July 2026'],
            'changes' => ['status' => 'approved'],
            'question' => 'approve the payroll run for July',
        ], ['status' => 'locked'], $this->admin->id);

        $response = $this->apply($forged);

        $response->assertStatus(422)->assertJsonPath('refusal', 'unknown_action');
        $this->assertStringContainsString('payroll_run.approve', $response->json('message'));
    }

    // ------------------------------------------------- the read path survives

    /**
     * THE PRIMARY SAFETY PROPERTY. The write branch lives inside the read
     * path's own refusal handler, so getting the routing wrong does not raise
     * an error — it quietly turns answered questions into "I can't change
     * that".
     */
    public function test_a_plain_question_still_returns_a_table(): void
    {
        $this->fakePlanners(
            '{"error":"unused"}',
            '{"entity":"employees","metric":"headcount","group_by":"department"}',
        );

        $this->actingAs($this->admin);

        $this->postJson('/api/search/ask', ['question' => 'headcount by department'])
            ->assertOk()
            ->assertJsonPath('kind', 'table')
            ->assertJsonPath('plan.entity', 'employees')
            ->assertJsonStructure(['plan', 'columns', 'rows', 'notes', 'summary', 'truncated']);
    }

    /**
     * And a question the data path cannot take is still answered in prose,
     * including one that contains a change verb — "how do I change the cap?"
     * is an enquiry, and answering it with "I can't change that" is the
     * narrowness the one-assistant design exists to prevent.
     */
    public function test_a_non_data_question_still_returns_prose(): void
    {
        $this->fakePlanners('{"error":"unused"}', '{"error":"Nationality is not stored in this system."}');

        $this->actingAs($this->admin);

        $this->postJson('/api/search/ask', ['question' => 'how do I change the carry-forward cap?'])
            ->assertOk()
            ->assertJsonPath('kind', 'prose')
            ->assertJsonPath('detail', 'Nationality is not stored in this system.');
    }

    /** A department rename, to prove the branch is not leave-type shaped. */
    public function test_a_department_rename_previews_and_applies_through_its_own_endpoint(): void
    {
        $design = Group::create([
            'organization_id' => $this->org->id,
            'name' => 'Design',
            'slug' => 'design',
            'is_active' => true,
        ]);

        $this->fakePlanners(json_encode([
            'action' => 'department.rename',
            'target' => ['name' => 'Design'],
            'changes' => ['name' => 'Product Design'],
        ]));

        $token = $this->tokenFor('rename the Design department to Product Design');

        $this->apply($token)->assertOk()->assertJsonPath('route', '/employees/teams');

        $row = DB::table('groups')->where('id', $design->id)->first();

        $this->assertSame('Product Design', $row->name);
        $this->assertSame(
            'product-design',
            $row->slug,
            'the slug was not regenerated, so the write did not go through ReportGroupController::update',
        );
    }

    // ---------------------------------------------------------------- helpers

    /**
     * Somebody the AI-mode door admits and the action must not.
     *
     * A custom role pinned to the door's own hierarchy level with no
     * permissions attached: `getHierarchyLevel()` reads the custom role, so
     * `mayAsk()` passes, and `hasPermission()` reads the same custom role, so
     * every capability is false.
     */
    private function unprivilegedInsider(): User
    {
        $role = Role::create([
            'organization_id' => $this->org->id,
            'name' => 'Read Only Admin',
            'slug' => 'read-only-admin',
            'hierarchy_level' => 10,
            'is_system' => false,
            'is_active' => true,
        ]);

        // Attached so the role is a real one with a real permission set that
        // simply does not include settings.manage — an empty set could be read
        // as "unconfigured" rather than "not granted".
        $permission = Permission::query()->where('key', '!=', 'settings.manage')->first();

        if ($permission !== null) {
            $role->permissions()->attach($permission->id);
        }

        $user = $this->user('employee', $this->org);
        $user->forceFill(['role_id' => $role->id])->save();

        return $user->fresh();
    }
}
