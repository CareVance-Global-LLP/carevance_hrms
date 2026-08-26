<?php

namespace Tests\Feature\Ai;

use App\Models\Group;
use App\Models\LeaveType;
use App\Models\Organization;
use App\Models\User;
use App\Services\Ai\Actions\ActionPreviewBuilder;
use App\Services\Ai\Actions\ActionRefusedException;
use App\Services\Ai\Actions\ActionToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The preview is the whole of what a human agrees to, so everything it says has
 * to be true of the database at the moment it is said.
 *
 * Four failures are what these tests exist to make impossible, and every one of
 * them looks like success from the outside:
 *
 *  - **`before` echoed from the model.** §4: "THE PREVIEW IS COMPUTED, NOT
 *    PROMISED." A diff quoting the model's own idea of the current value shows
 *    a change that never existed, and the person confirms it because it reads
 *    exactly like a real one.
 *  - **A value the endpoint will refuse.** Bounds are checked here, in words
 *    about days, rather than at Apply as a 422 nobody can act on — after a
 *    human has already agreed to it.
 *  - **An unauthorised person walked all the way to Apply.** §4 checks the
 *    acting user at preview so they are told immediately.
 *  - **Another tenant's row.** Resolution runs inside the global scope with no
 *    hand-written organisation filter anywhere, so a plan naming a name that
 *    belongs to somebody else finds nothing. A hand-written filter is a line
 *    somebody can forget; a scope is not.
 *
 * And one that is not a failure at all: a change to the value something already
 * holds. It is REPORTED, never tokenised. Issuing a token for it would put an
 * Apply button in front of a person for a write with no effect, and the audit
 * would then record a change that changed nothing.
 *
 * @see docs/superpowers/specs/2026-08-26-ai-write-actions.md §4, §5, §6, §7
 */
class ActionPreviewBuilderTest extends TestCase
{
    use RefreshDatabase;

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

    /**
     * @param  array<string, mixed>  $plan
     * @return array<string, mixed>
     */
    private function preview(array $plan, ?User $actor = null): array
    {
        $actor ??= $this->admin;
        $this->actingAs($actor);

        return app(ActionPreviewBuilder::class)->build($plan, $actor, 'a question somebody asked');
    }

    private function capPlan(int $to = 10, string $name = 'Casual Leave'): array
    {
        return [
            'action' => 'leave_type.update',
            'target' => ['name' => $name],
            'changes' => ['carry_forward_cap' => $to],
        ];
    }

    /**
     * §4: "`before` is read from the live row at preview time."
     *
     * Asserted by MOVING the row between two previews of the same plan. A
     * builder that read the value once, or took it from anything the model
     * said, passes the first assertion and fails the second — which is exactly
     * the shape of the bug: a diff that was true when somebody wrote the code.
     */
    public function test_before_is_read_from_the_live_row(): void
    {
        $type = $this->leaveType($this->org);

        $first = $this->preview($this->capPlan(10));

        $this->assertSame('carry_forward_cap', $first['changes'][0]['field']);
        $this->assertSame(5, $first['changes'][0]['from']);
        $this->assertSame(10, $first['changes'][0]['to']);

        // Somebody else edits the row between the two previews.
        DB::table('leave_types')->where('id', $type->id)->update(['carry_forward_cap' => 7]);

        $second = $this->preview($this->capPlan(10));

        $this->assertSame(7, $second['changes'][0]['from'], 'before was not re-read from the row');
    }

    /** A preview is not a side effect. Nothing is written until Apply. */
    public function test_building_a_preview_writes_nothing(): void
    {
        $type = $this->leaveType($this->org);

        $this->preview($this->capPlan(10));

        $this->assertSame(
            5.0,
            (float) DB::table('leave_types')->where('id', $type->id)->value('carry_forward_cap'),
            'the preview wrote to the row it was previewing',
        );
    }

    /**
     * Refused HERE, in words about days, rather than as a 422 from the endpoint
     * after a human has already agreed to it. The field is NAMED — a refusal
     * that does not say which value was wrong is a dead end.
     */
    public function test_a_value_outside_its_declared_bounds_is_refused_by_name(): void
    {
        $this->leaveType($this->org);

        try {
            $this->preview($this->capPlan(4000));
            $this->fail('a carry-forward cap of 4000 days was previewed');
        } catch (ActionRefusedException $e) {
            $this->assertStringContainsString('Carry-forward cap', $e->getDetail());
            $this->assertStringContainsString('365', $e->getDetail());
            $this->assertSame(ActionRefusedException::OUT_OF_BOUNDS, $e->refusal());
        }
    }

    public function test_a_value_of_the_wrong_kind_is_refused_by_name(): void
    {
        $this->leaveType($this->org);

        $this->expectException(ActionRefusedException::class);
        $this->expectExceptionMessageMatches('/Carry-forward cap/');

        $this->preview([
            'action' => 'leave_type.update',
            'target' => ['name' => 'Casual Leave'],
            'changes' => ['carry_forward_cap' => 'ten'],
        ]);
    }

    /**
     * §4: "PERMISSION IS CHECKED AGAINST THE ACTING USER, TWICE." The first is
     * here, so somebody who cannot do this is told before composing a change
     * rather than after confirming one.
     *
     * The permission is NAMED. "Forbidden" leaves an admin guessing which of
     * thirty capabilities to grant.
     */
    public function test_a_user_without_the_permission_is_refused_at_preview(): void
    {
        $this->leaveType($this->org);
        $manager = $this->user('manager', $this->org);

        $this->assertFalse($manager->hasPermission('settings.manage'), 'fixture no longer proves anything');

        try {
            $this->preview($this->capPlan(10), $manager);
            $this->fail('a manager previewed a leave-policy change');
        } catch (ActionRefusedException $e) {
            $this->assertStringContainsString('settings.manage', $e->getDetail());
            $this->assertSame(ActionRefusedException::NOT_PERMITTED, $e->refusal());
        }
    }

    /**
     * The capability alone is not the gate the endpoint carries.
     *
     * `settings.manage` is granted to admin, hr and payroll_manager, while the
     * leave-type route is `role:admin`. Check the capability only and an HR
     * user is walked through composing a change, shown a diff, and 403'd at
     * Apply — the precise experience the preview exists to prevent.
     */
    public function test_a_user_the_route_itself_would_turn_away_is_refused_at_preview(): void
    {
        $this->leaveType($this->org);
        $hr = $this->user('hr', $this->org);

        $this->assertTrue($hr->hasPermission('settings.manage'), 'fixture no longer proves anything');

        try {
            $this->preview($this->capPlan(10), $hr);
            $this->fail('an HR user previewed a change the route would refuse');
        } catch (ActionRefusedException $e) {
            $this->assertSame(ActionRefusedException::NOT_PERMITTED, $e->refusal());
        }
    }

    /** §6: an action refusal is never handed to the prose assistant. */
    public function test_a_refusal_never_becomes_prose(): void
    {
        $this->leaveType($this->org);

        try {
            $this->preview($this->capPlan(4000));
            $this->fail('an out-of-bounds value was previewed');
        } catch (ActionRefusedException $e) {
            $this->assertFalse(
                $e->mayAnswerInProse(),
                'a change request answered in prose reads as though something happened',
            );
        }
    }

    /**
     * §7: "Tenancy: a plan naming another organisation's row resolves to
     * nothing."
     *
     * There is no `where('organization_id', …)` anywhere in the builder — the
     * global scope is what makes this true, which is why it cannot be forgotten
     * on the fourth action.
     */
    public function test_a_target_in_another_organisation_resolves_to_nothing(): void
    {
        $theirs = $this->leaveType($this->otherOrg, ['code' => 'study', 'name' => 'Study Leave']);

        try {
            $this->preview($this->capPlan(10, 'Study Leave'));
            $this->fail("another organisation's leave type was previewed");
        } catch (ActionRefusedException $e) {
            $this->assertSame(ActionRefusedException::NOT_FOUND, $e->refusal());
            $this->assertStringContainsString('Study Leave', $e->getDetail());
        }

        $this->assertSame(
            5.0,
            (float) DB::table('leave_types')->where('id', $theirs->id)->value('carry_forward_cap'),
        );
    }

    /**
     * Two rows can genuinely share a name.
     *
     * `leave_types` is unique on (organization, CODE) and says nothing about
     * the name, so "Casual Leave" imported once and created again by hand is
     * two rows a person refers to with one phrase. Picking either is a coin
     * toss with somebody's leave policy, and the wrong one is silent — the
     * preview would look perfectly correct.
     *
     * `groups` cannot reach this state (it is unique on organization and name),
     * which is why the case is proven on the model that can.
     */
    public function test_a_target_that_matches_more_than_one_row_is_refused_rather_than_guessed(): void
    {
        $this->leaveType($this->org, ['code' => 'casual']);
        $this->leaveType($this->org, ['code' => 'casual-legacy']);

        try {
            $this->preview($this->capPlan(10));
            $this->fail('one of two identically named leave types was picked');
        } catch (ActionRefusedException $e) {
            $this->assertSame(ActionRefusedException::AMBIGUOUS, $e->refusal());
            $this->assertStringContainsString('Casual Leave', $e->getDetail());
        }
    }

    /**
     * §5's token exists so Apply carries a plan the server issued. A change
     * with nothing to change must not get one: the button would offer a write
     * with no effect, and the audit would record a change that changed nothing.
     */
    public function test_a_change_to_the_value_already_stored_is_reported_not_tokenised(): void
    {
        $this->leaveType($this->org, ['carry_forward_cap' => 10]);

        $preview = $this->preview($this->capPlan(10));

        $this->assertNull($preview['token'], 'a no-op was handed an Apply button');
        $this->assertSame([], $preview['changes'], 'a no-op was rendered as a diff');
        $this->assertSame('carry_forward_cap', $preview['unchanged'][0]['field']);
        $this->assertSame(10, $preview['unchanged'][0]['value']);
        $this->assertStringContainsString('already', strtolower($preview['message']));
    }

    /**
     * A plan touching two fields where only one has moved previews the one that
     * moved and SAYS why the other is absent. Dropping it silently leaves a
     * person wondering whether it was understood at all.
     */
    public function test_a_field_already_at_its_requested_value_is_dropped_from_the_diff_and_named(): void
    {
        $this->leaveType($this->org, ['carry_forward_cap' => 5, 'annual_quota' => 12]);

        $preview = $this->preview([
            'action' => 'leave_type.update',
            'target' => ['name' => 'Casual Leave'],
            'changes' => ['carry_forward_cap' => 10, 'annual_quota' => 12],
        ]);

        $this->assertCount(1, $preview['changes']);
        $this->assertSame('carry_forward_cap', $preview['changes'][0]['field']);
        $this->assertSame('annual_quota', $preview['unchanged'][0]['field']);
        $this->assertNotNull($preview['token']);

        $opened = ActionToken::open($preview['token'], $this->admin->id);

        $this->assertSame(
            ['carry_forward_cap' => 10],
            $opened['plan']['changes'],
            'the token carries a write that would do nothing',
        );
    }

    /**
     * The token is what ties Apply to a preview a human saw, so it has to carry
     * the plan AS PREVIEWED and the before-values the diff was computed
     * against — the staleness check has nothing to compare the live row with
     * otherwise.
     *
     * The target travels as an ID rather than as the phrase it was found by:
     * `department.rename` changes the very column it resolves on, so a
     * re-lookup by name at Apply would find nothing the moment the rename
     * succeeded, and would find the WRONG row if somebody else took the name.
     */
    public function test_the_token_carries_the_previewed_plan_the_target_id_and_the_before_values(): void
    {
        $type = $this->leaveType($this->org);

        $preview = $this->preview($this->capPlan(10));
        $opened = ActionToken::open($preview['token'], $this->admin->id);

        $this->assertNotNull($opened);
        $this->assertSame('leave_type.update', $opened['plan']['action']);
        $this->assertSame($type->id, $opened['plan']['target']['id']);
        $this->assertSame(['carry_forward_cap' => 10], $opened['plan']['changes']);
        $this->assertSame(5, $opened['before']['carry_forward_cap']);
        $this->assertSame('a question somebody asked', $opened['plan']['question']);
    }

    /**
     * §4's re-read at Apply compares the token's before-values against the row,
     * and both sides have to be produced the same way or the comparison is
     * meaningless.
     *
     * `carry_forward_cap` reads back from a `decimal:2` cast as the string
     * "5.00" while the token holds 5. A staleness check written with its own
     * normalisation would find those different on an untouched row and refuse
     * every apply — a guard that can never be satisfied, looking exactly like a
     * guard that is working.
     */
    public function test_the_live_values_the_staleness_check_reads_match_the_tokens_before_values(): void
    {
        $type = $this->leaveType($this->org);

        $preview = $this->preview($this->capPlan(10));
        $before = ActionToken::open($preview['token'], $this->admin->id)['before'];

        $this->assertSame(
            $before,
            app(ActionPreviewBuilder::class)->liveValuesFor(
                $type->fresh(),
                'leave_type.update',
                array_keys($before),
            ),
            'an untouched row reads as stale',
        );

        DB::table('leave_types')->where('id', $type->id)->update(['carry_forward_cap' => 6]);

        $this->assertNotSame(
            $before,
            app(ActionPreviewBuilder::class)->liveValuesFor(
                $type->fresh(),
                'leave_type.update',
                array_keys($before),
            ),
            'a row somebody else moved reads as unchanged',
        );
    }

    /** A token issued to one person is not a capability anybody else holds. */
    public function test_the_token_is_bound_to_the_person_who_previewed_it(): void
    {
        $this->leaveType($this->org);
        $other = $this->user('admin', $this->org);

        $preview = $this->preview($this->capPlan(10));

        $this->assertNull(ActionToken::open($preview['token'], $other->id));
    }

    /**
     * §3: the impact "answers 'and who does this land on?' — a COUNT, never a
     * list of names". A preview is not a directory export.
     */
    public function test_the_impact_is_a_count_of_people_and_never_their_names(): void
    {
        $this->leaveType($this->org);
        $this->user('employee', $this->org);
        $this->user('employee', $this->org);
        $this->user('employee', $this->otherOrg);

        $preview = $this->preview($this->capPlan(10));

        // The admin plus two employees. The fourth belongs to another tenant.
        $this->assertSame('Affects 3 employees', $preview['impact']);
    }

    public function test_the_impact_of_renaming_a_department_counts_that_department(): void
    {
        $group = Group::factory()->create(['organization_id' => $this->org->id, 'name' => 'Support']);
        $group->users()->attach($this->user('employee', $this->org)->id);

        $preview = $this->preview([
            'action' => 'department.rename',
            'target' => ['name' => 'Support'],
            'changes' => ['name' => 'Customer Support'],
        ]);

        $this->assertStringContainsString('1 employee', $preview['impact']);
        $this->assertSame($group->id, $preview['target']['id']);
        $this->assertSame('Support', $preview['target']['label']);
    }

    public function test_an_action_that_is_not_in_the_catalogue_is_refused_by_name(): void
    {
        try {
            $this->preview([
                'action' => 'employee.delete',
                'target' => ['name' => 'Priya Sharma'],
                'changes' => ['deleted' => true],
            ]);
            $this->fail('an action outside the catalogue was previewed');
        } catch (ActionRefusedException $e) {
            $this->assertSame(ActionRefusedException::UNKNOWN_ACTION, $e->refusal());
            $this->assertStringContainsString('employee.delete', $e->getDetail());
        }
    }

    /**
     * `is_active` is a real column on `leave_types` and is deliberately not a
     * field of this action. A lookup that happens to find it on the table would
     * make the catalogue advisory rather than authoritative.
     */
    public function test_a_field_the_action_does_not_declare_is_refused_by_name(): void
    {
        $this->leaveType($this->org);

        try {
            $this->preview([
                'action' => 'leave_type.update',
                'target' => ['name' => 'Casual Leave'],
                'changes' => ['is_active' => false],
            ]);
            $this->fail('a field outside the action was previewed');
        } catch (ActionRefusedException $e) {
            $this->assertStringContainsString('is_active', $e->getDetail());
        }
    }

    public function test_a_lookup_the_action_does_not_declare_is_refused_by_name(): void
    {
        $this->leaveType($this->org);

        $this->expectException(ActionRefusedException::class);
        $this->expectExceptionMessageMatches('/is_active/');

        $this->preview([
            'action' => 'leave_type.update',
            'target' => ['is_active' => true],
            'changes' => ['carry_forward_cap' => 10],
        ]);
    }

    /** The model's own refusal is carried, not swallowed and not answered. */
    public function test_a_planner_refusal_is_carried_through_as_the_refusal_it_is(): void
    {
        try {
            $this->preview(['error' => 'There is no action for deleting an employee.']);
            $this->fail('a refusal was turned into a preview');
        } catch (ActionRefusedException $e) {
            $this->assertSame('There is no action for deleting an employee.', $e->getDetail());
            $this->assertFalse($e->mayAnswerInProse());
        }
    }

    /**
     * The organisation's timezone and working day live inside its `settings`
     * JSON, not in columns of their own. `before` still has to be the LIVE
     * value — a diff that reports the stored 09:00 as null, or as whatever the
     * model assumed, is the failure this whole section is about.
     *
     * It is also normalised to the format the field declares, so `09:00:00`
     * from the store and `09:30` from the plan are comparable at all.
     */
    public function test_a_live_value_stored_inside_the_settings_blob_is_read_and_normalised(): void
    {
        $preview = $this->preview([
            'action' => 'organization.update',
            'target' => [],
            'changes' => ['office_start_time' => '09:30', 'timezone' => 'Asia/Kolkata'],
        ]);

        $this->assertCount(1, $preview['changes'], 'the unchanged timezone was rendered as a diff');
        $this->assertSame('office_start_time', $preview['changes'][0]['field']);
        $this->assertSame('09:00', $preview['changes'][0]['from']);
        $this->assertSame('09:30', $preview['changes'][0]['to']);
        $this->assertSame('timezone', $preview['unchanged'][0]['field']);
        $this->assertSame($this->org->id, $preview['target']['id']);
    }

    public function test_a_timezone_the_system_does_not_recognise_is_refused_by_name(): void
    {
        $this->expectException(ActionRefusedException::class);
        $this->expectExceptionMessageMatches('/Timezone/');

        $this->preview([
            'action' => 'organization.update',
            'target' => [],
            'changes' => ['timezone' => 'Asia/Kolkatta'],
        ]);
    }

    /**
     * There is exactly one addressable organisation and it is the acting user's
     * own. A plan naming a different one is a CLAIM about which row this is,
     * and a claim that does not match is refused rather than quietly applied to
     * whichever organisation the caller happens to be in.
     */
    public function test_an_organization_plan_naming_somebody_elses_organisation_is_refused(): void
    {
        try {
            $this->preview([
                'action' => 'organization.update',
                'target' => ['name' => 'Beta Ltd'],
                'changes' => ['timezone' => 'Asia/Dubai'],
            ]);
            $this->fail("a plan naming another organisation was previewed against the actor's own");
        } catch (ActionRefusedException $e) {
            $this->assertStringContainsString('Beta Ltd', $e->getDetail());
        }

        $this->assertSame('Beta Ltd', $this->otherOrg->fresh()->name);
    }

    /**
     * `settings` is a real attribute of an organisation and holds an array.
     * Comparing it against a claimed value as a string is a PHP warning, not a
     * claim anybody made, so it is refused as what it is: not a way to name a
     * row.
     */
    public function test_a_target_naming_an_attribute_that_is_not_a_name_is_refused(): void
    {
        $this->expectException(ActionRefusedException::class);
        $this->expectExceptionMessageMatches('/settings/');

        $this->preview([
            'action' => 'organization.update',
            'target' => ['settings' => 'anything'],
            'changes' => ['timezone' => 'Asia/Dubai'],
        ]);
    }

    public function test_an_organization_plan_naming_the_acting_organisation_is_accepted(): void
    {
        $preview = $this->preview([
            'action' => 'organization.update',
            'target' => ['name' => 'Acme India'],
            'changes' => ['timezone' => 'Asia/Dubai'],
        ]);

        $this->assertSame('Asia/Kolkata', $preview['changes'][0]['from']);
        $this->assertSame('Asia/Dubai', $preview['changes'][0]['to']);
    }

    public function test_a_plan_with_no_changes_at_all_is_refused(): void
    {
        $this->leaveType($this->org);

        $this->expectException(ActionRefusedException::class);

        $this->preview([
            'action' => 'leave_type.update',
            'target' => ['name' => 'Casual Leave'],
            'changes' => [],
        ]);
    }

    /** A target nothing was said about cannot be found, and says so. */
    public function test_a_missing_target_is_refused_rather_than_matching_the_first_row(): void
    {
        $this->leaveType($this->org);
        $this->leaveType($this->org, ['code' => 'sick', 'name' => 'Sick Leave']);

        $this->expectException(ActionRefusedException::class);

        $this->preview([
            'action' => 'leave_type.update',
            'target' => [],
            'changes' => ['carry_forward_cap' => 10],
        ]);
    }

    /** Case is how a person types a name, not a different row. */
    public function test_a_target_is_matched_without_regard_to_case(): void
    {
        $type = $this->leaveType($this->org);

        $preview = $this->preview($this->capPlan(10, 'casual leave'));

        $this->assertSame($type->id, $preview['target']['id']);
        $this->assertSame('Casual Leave', $preview['target']['label']);
    }

    /** The label is the action's, so the confirmation says what it will do. */
    public function test_the_preview_names_the_action_it_would_run(): void
    {
        $this->leaveType($this->org);

        $preview = $this->preview($this->capPlan(10));

        $this->assertSame('leave_type.update', $preview['key']);
        $this->assertSame('Update a leave type', $preview['label']);
        $this->assertSame('Carry-forward cap', $preview['changes'][0]['label']);
    }
}
