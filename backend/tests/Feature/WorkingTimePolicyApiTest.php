<?php

namespace Tests\Feature;

use App\Models\EmployeeShift;
use App\Models\EmployeeShiftAllowancePolicy;
use App\Models\Organization;
use App\Models\OvertimePolicy;
use App\Models\OvertimePolicyScope;
use App\Models\PenalisationHalfDayRule;
use App\Models\PenalisationPolicy;
use App\Models\Shift;
use App\Models\ShiftAllowancePolicy;
use App\Models\User;
use App\Models\WeeklyOffPolicy;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The working-time policy API: four policy kinds, each created, versioned and
 * assigned independently.
 *
 * The same two things fail in opposite directions here as in the shift API, and
 * for the same reasons:
 *
 *  - Authorisation. A penalisation policy decides whether a day is paid and an
 *    overtime policy decides what an hour is worth, so creating or assigning
 *    either is a settings-manage operation. An employee reaching one is a
 *    privilege escalation; an employee unable to read their OWN assigned
 *    policies is a screen that cannot render.
 *  - Tenancy. Every table carries organization_id. Another tenant's policy id
 *    must be a 404, and an assignment must never bind one workspace's policy to
 *    another workspace's employee.
 *
 * Plus the guard the shift API already proves is necessary: deleting a policy
 * somebody is assigned to would cascade the assignment away, and those rows are
 * what a payroll re-run for an earlier month resolves against. Refuse, and say
 * to deactivate instead.
 */
class WorkingTimePolicyApiTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private Organization $otherOrganization;
    private User $admin;
    private User $employee;
    private User $colleague;

    protected function setUp(): void
    {
        parent::setUp();

        Carbon::setTestNow('2026-08-19 11:00:00'); // a Wednesday

        $this->organization = Organization::create(['name' => 'Acme', 'slug' => 'acme-wt']);
        $this->otherOrganization = Organization::create(['name' => 'Rival', 'slug' => 'rival-wt']);

        $this->admin = $this->makeUser($this->organization, 'wt-admin@example.com', 'admin');
        $this->employee = $this->makeUser($this->organization, 'wt-employee@example.com', 'employee');
        $this->colleague = $this->makeUser($this->organization, 'wt-colleague@example.com', 'employee');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    private function makeUser(Organization $organization, string $email, string $role): User
    {
        return User::create([
            'name' => ucfirst($role),
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $organization->id,
        ]);
    }

    /**
     * The four kinds, as [url segment, model class, create payload].
     *
     * @return array<string, array{0: string, 1: class-string<Model>, 2: array<string, mixed>}>
     */
    private function kinds(): array
    {
        return [
            'weekly_off' => ['weekly-off-policies', WeeklyOffPolicy::class, [
                'name' => 'Sunday and alternate Saturday',
                'day_rules' => ['sunday' => 'every', 'saturday' => [2, 4]],
            ]],
            'penalisation' => ['penalisation-policies', PenalisationPolicy::class, [
                'name' => 'Standard lateness',
                'grace_period_minutes' => 15,
                'late_rule_type' => 'incident',
                'late_threshold' => 3,
                'exemptions_per_cycle' => 1,
                'cycle' => 'monthly',
                'ignore_late_when_hours_met' => true,
                'hours_basis' => 'effective',
                'no_show_below_hours' => 4,
                'treat_penalties_as_lop' => true,
            ]],
            'overtime' => ['overtime-policies', OvertimePolicy::class, [
                'name' => 'Standard overtime',
                'hours_basis' => 'gross',
                'minimum_minutes_before_accrual' => 30,
                'rounding' => 'nearest',
                'rounding_increment_minutes' => 15,
                'requires_approval' => true,
                'pay_code' => 'OT',
            ]],
            'shift_allowance' => ['shift-allowance-policies', ShiftAllowancePolicy::class, [
                'name' => 'Night premium',
                'night_allowance_type' => 'percentage',
                'night_percentage' => 15,
                'night_window_start' => '22:00',
                'night_window_end' => '06:00',
                'weekend_allowance_type' => 'fixed',
                'weekend_fixed' => 300,
            ]],
        ];
    }

    private function url(string $segment, string $suffix = ''): string
    {
        return '/api/working-time/'.$segment.$suffix;
    }

    /** @param array<string, mixed> $attributes */
    private function policyFor(string $modelClass, Organization $organization, array $attributes = []): Model
    {
        static $sequence = 0;
        $sequence++;

        return $modelClass::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $organization->id,
            'name' => 'Policy '.$sequence,
            'is_active' => true,
        ], $attributes));
    }

    // ---- creation -----------------------------------------------------------

    public function test_an_admin_can_create_every_policy_kind(): void
    {
        foreach ($this->kinds() as $kind => [$segment, $modelClass, $payload]) {
            $response = $this->postJson($this->url($segment), $payload, $this->apiHeadersFor($this->admin))
                ->assertCreated();

            $id = $response->json('data.id');
            $this->assertNotNull($id, "No id came back for {$kind}.");
            $this->assertSame(0, $response->json('data.assigned_count'));

            $stored = $modelClass::withoutOrganizationScope()->find($id);
            $this->assertNotNull($stored, "The {$kind} policy was not stored.");
            $this->assertSame((int) $this->organization->id, (int) $stored->organization_id);
        }
    }

    public function test_a_half_day_ladder_is_stored_as_ordered_rungs_not_a_threshold(): void
    {
        [$segment, , $payload] = $this->kinds()['penalisation'];

        // Posted highest band first on purpose: the ladder is read lowest band
        // first, and a response that echoed the input order would hide it.
        $payload['half_day_rules'] = [
            ['percent_of_shift_hours' => 50, 'leaves_deducted' => 0.5, 'sort_order' => 2],
            ['percent_of_shift_hours' => 25, 'leaves_deducted' => 1, 'sort_order' => 1],
        ];

        $response = $this->postJson($this->url($segment), $payload, $this->apiHeadersFor($this->admin))
            ->assertCreated();

        $rungs = $response->json('data.half_day_rules');
        $this->assertCount(2, $rungs);
        $this->assertSame('25.00', (string) $rungs[0]['percent_of_shift_hours']);
        $this->assertSame('1.00', (string) $rungs[0]['leaves_deducted']);
        $this->assertSame('50.00', (string) $rungs[1]['percent_of_shift_hours']);
        $this->assertSame('0.50', (string) $rungs[1]['leaves_deducted']);

        $this->assertSame(2, PenalisationHalfDayRule::withoutOrganizationScope()
            ->where('penalisation_policy_id', $response->json('data.id'))->count());
    }

    public function test_an_overtime_policy_carries_three_independent_scopes_and_editing_replaces_them(): void
    {
        [$segment, , $payload] = $this->kinds()['overtime'];

        $payload['scopes'] = [
            ['scope' => 'working_day', 'treatment' => 'pay', 'multiplier' => 1.5],
            ['scope' => 'weekly_off', 'treatment' => 'comp_off', 'multiplier' => 1],
            ['scope' => 'holiday', 'treatment' => 'pay', 'multiplier' => 2],
        ];

        $created = $this->postJson($this->url($segment), $payload, $this->apiHeadersFor($this->admin))
            ->assertCreated();

        $id = $created->json('data.id');
        $this->assertCount(3, $created->json('data.scopes'));
        $this->assertSame(3, OvertimePolicyScope::withoutOrganizationScope()
            ->where('overtime_policy_id', $id)->count());

        // Editing the set replaces it. Appending would leave the old holiday
        // rate live alongside the new one, and a resolver reading both would
        // pick one by accident.
        $this->putJson($this->url($segment, '/'.$id), [
            'scopes' => [
                ['scope' => 'working_day', 'treatment' => 'pay', 'multiplier' => 1.75],
            ],
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $scopes = OvertimePolicyScope::withoutOrganizationScope()->where('overtime_policy_id', $id)->get();
        $this->assertCount(1, $scopes);
        $this->assertSame('1.75', (string) $scopes->first()->multiplier);
    }

    public function test_a_duplicate_policy_name_in_the_same_workspace_is_refused(): void
    {
        [$segment, , $payload] = $this->kinds()['weekly_off'];

        $this->postJson($this->url($segment), $payload, $this->apiHeadersFor($this->admin))->assertCreated();

        $this->postJson($this->url($segment), $payload, $this->apiHeadersFor($this->admin))
            ->assertStatus(422)
            ->assertJsonValidationErrors('name');
    }

    public function test_an_unreadable_weekly_off_rule_is_refused_rather_than_stored(): void
    {
        [$segment, , $payload] = $this->kinds()['weekly_off'];
        $payload['day_rules'] = ['saturday' => 'sometimes'];

        $this->postJson($this->url($segment), $payload, $this->apiHeadersFor($this->admin))
            ->assertStatus(422)
            ->assertJsonValidationErrors('day_rules.saturday');

        // A rule the model cannot read is a day silently never marked off. It
        // must not reach the table.
        $this->assertSame(0, WeeklyOffPolicy::withoutOrganizationScope()->count());
    }

    // ---- authorisation ------------------------------------------------------

    public function test_an_employee_can_neither_list_nor_create_any_policy(): void
    {
        foreach ($this->kinds() as $kind => [$segment, $modelClass, $payload]) {
            $this->policyFor($modelClass, $this->organization);

            $this->getJson($this->url($segment), $this->apiHeadersFor($this->employee))
                ->assertStatus(403);

            $this->postJson($this->url($segment), $payload, $this->apiHeadersFor($this->employee))
                ->assertStatus(403);
        }
    }

    public function test_an_employee_cannot_assign_a_policy(): void
    {
        $policy = $this->policyFor(ShiftAllowancePolicy::class, $this->organization);

        $this->postJson($this->url('shift-allowance-policies', '/assignments'), [
            'user_id' => $this->employee->id,
            'policy_id' => $policy->id,
            'effective_from' => '2026-09-01',
        ], $this->apiHeadersFor($this->employee))->assertStatus(403);

        $this->assertSame(0, EmployeeShiftAllowancePolicy::withoutOrganizationScope()->count());
    }

    // ---- tenancy ------------------------------------------------------------

    public function test_another_organizations_policy_is_a_404_to_edit_and_to_delete(): void
    {
        foreach ($this->kinds() as $kind => [$segment, $modelClass]) {
            $theirs = $this->policyFor($modelClass, $this->otherOrganization, ['name' => 'Theirs '.$kind]);
            $mine = $this->policyFor($modelClass, $this->organization, ['name' => 'Mine '.$kind]);

            // The same verb against the caller's OWN policy has to work, or the
            // 404 below would only be proving the route is missing.
            $this->putJson($this->url($segment, '/'.$mine->id), ['name' => 'Renamed '.$kind], $this->apiHeadersFor($this->admin))
                ->assertOk();

            $this->putJson($this->url($segment, '/'.$theirs->id), ['name' => 'Hijacked'], $this->apiHeadersFor($this->admin))
                ->assertNotFound();

            $this->deleteJson($this->url($segment, '/'.$theirs->id), [], $this->apiHeadersFor($this->admin))
                ->assertNotFound();

            $this->assertSame(
                'Theirs '.$kind,
                $modelClass::withoutOrganizationScope()->find($theirs->id)->name,
                "The other organization's {$kind} policy was modified."
            );
        }
    }

    public function test_assigning_a_policy_to_another_organizations_employee_is_refused(): void
    {
        $policy = $this->policyFor(ShiftAllowancePolicy::class, $this->organization);
        $outsider = $this->makeUser($this->otherOrganization, 'outsider@example.com', 'employee');

        $this->postJson($this->url('shift-allowance-policies', '/assignments'), [
            'user_id' => $outsider->id,
            'policy_id' => $policy->id,
            'effective_from' => '2026-09-01',
        ], $this->apiHeadersFor($this->admin))
            ->assertStatus(422)
            ->assertJsonValidationErrors('user_id');

        $this->assertSame(0, EmployeeShiftAllowancePolicy::withoutOrganizationScope()->count());
    }

    // ---- the delete guard ---------------------------------------------------

    public function test_an_unassigned_policy_can_be_deleted(): void
    {
        $policy = $this->policyFor(OvertimePolicy::class, $this->organization);

        $this->deleteJson($this->url('overtime-policies', '/'.$policy->id), [], $this->apiHeadersFor($this->admin))
            ->assertOk();

        $this->assertNull(OvertimePolicy::withoutOrganizationScope()->find($policy->id));
    }

    public function test_deleting_an_assigned_policy_is_refused_rather_than_cascading(): void
    {
        $policy = $this->policyFor(ShiftAllowancePolicy::class, $this->organization);

        $this->postJson($this->url('shift-allowance-policies', '/assignments'), [
            'user_id' => $this->employee->id,
            'policy_id' => $policy->id,
            'effective_from' => '2026-01-01',
        ], $this->apiHeadersFor($this->admin))->assertCreated();

        $response = $this->deleteJson($this->url('shift-allowance-policies', '/'.$policy->id), [], $this->apiHeadersFor($this->admin))
            ->assertStatus(409);

        $this->assertSame(1, $response->json('assignments_count'));
        $this->assertStringContainsString('Deactivate', $response->json('message'));

        // The foreign key cascades, so a permitted delete would erase the
        // assignment history a payroll re-run for an earlier month reads.
        $this->assertNotNull(ShiftAllowancePolicy::withoutOrganizationScope()->find($policy->id));
        $this->assertSame(1, EmployeeShiftAllowancePolicy::withoutOrganizationScope()->count());
    }

    // ---- assignment ---------------------------------------------------------

    public function test_reassignment_appends_and_each_date_resolves_the_policy_in_force_then(): void
    {
        $january = $this->policyFor(ShiftAllowancePolicy::class, $this->organization, ['name' => 'January premium']);
        $august = $this->policyFor(ShiftAllowancePolicy::class, $this->organization, ['name' => 'August premium']);

        foreach ([[$january, '2026-01-01'], [$august, '2026-08-01']] as [$policy, $from]) {
            $this->postJson($this->url('shift-allowance-policies', '/assignments'), [
                'user_id' => $this->employee->id,
                'policy_id' => $policy->id,
                'effective_from' => $from,
            ], $this->apiHeadersFor($this->admin))->assertCreated();
        }

        // Two rows, not one edited row — the history is the point.
        $this->assertSame(2, EmployeeShiftAllowancePolicy::withoutOrganizationScope()->count());

        $july = $this->getJson('/api/working-time/my-policies?date=2026-07-15', $this->apiHeadersFor($this->employee))
            ->assertOk();
        $this->assertSame((int) $january->id, $july->json('data.policies.shift_allowance.policy.id'));
        $this->assertSame('assignment', $july->json('data.policies.shift_allowance.source'));

        $today = $this->getJson('/api/working-time/my-policies?date=2026-08-19', $this->apiHeadersFor($this->employee))
            ->assertOk();
        $this->assertSame((int) $august->id, $today->json('data.policies.shift_allowance.policy.id'));
    }

    public function test_an_assignment_can_be_removed(): void
    {
        $policy = $this->policyFor(ShiftAllowancePolicy::class, $this->organization);

        $created = $this->postJson($this->url('shift-allowance-policies', '/assignments'), [
            'user_id' => $this->employee->id,
            'policy_id' => $policy->id,
            'effective_from' => '2026-01-01',
        ], $this->apiHeadersFor($this->admin))->assertCreated();

        $this->deleteJson(
            $this->url('shift-allowance-policies', '/assignments/'.$created->json('data.id')),
            [],
            $this->apiHeadersFor($this->admin)
        )->assertOk();

        $this->assertSame(0, EmployeeShiftAllowancePolicy::withoutOrganizationScope()->count());
    }

    public function test_the_assignment_list_is_readable_by_a_manager_and_filterable_by_employee(): void
    {
        $policy = $this->policyFor(ShiftAllowancePolicy::class, $this->organization);

        foreach ([$this->employee, $this->colleague] as $person) {
            $this->postJson($this->url('shift-allowance-policies', '/assignments'), [
                'user_id' => $person->id,
                'policy_id' => $policy->id,
                'effective_from' => '2026-01-01',
            ], $this->apiHeadersFor($this->admin))->assertCreated();
        }

        $all = $this->getJson($this->url('shift-allowance-policies', '/assignments'), $this->apiHeadersFor($this->admin))
            ->assertOk();
        $this->assertCount(2, $all->json('data'));

        $mine = $this->getJson(
            $this->url('shift-allowance-policies', '/assignments?user_id='.$this->employee->id),
            $this->apiHeadersFor($this->admin)
        )->assertOk();
        $this->assertCount(1, $mine->json('data'));
    }

    // ---- what an employee may read about themselves -------------------------

    public function test_an_employee_reads_their_own_policies_but_not_a_colleagues(): void
    {
        $this->getJson('/api/working-time/my-policies', $this->apiHeadersFor($this->employee))
            ->assertOk()
            ->assertJsonPath('data.user_id', (int) $this->employee->id);

        $this->getJson(
            '/api/working-time/my-policies?user_id='.$this->colleague->id,
            $this->apiHeadersFor($this->employee)
        )->assertStatus(403);

        $this->getJson(
            '/api/working-time/my-policies?user_id='.$this->colleague->id,
            $this->apiHeadersFor($this->admin)
        )->assertOk()->assertJsonPath('data.user_id', (int) $this->colleague->id);
    }

    public function test_my_policies_quotes_the_shift_allowance_the_engine_computes(): void
    {
        $shift = Shift::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'name' => 'Night',
            'code' => 'NGT',
            'type' => 'night',
            'start_time' => '22:00:00',
            'end_time' => '06:00:00',
            'duration_minutes' => 480,
            'break_duration_minutes' => 0,
            'is_night_shift' => true,
            'is_active' => true,
        ]);

        EmployeeShift::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);

        [$segment, , $payload] = $this->kinds()['shift_allowance'];
        $policy = $this->postJson($this->url($segment), $payload, $this->apiHeadersFor($this->admin))
            ->assertCreated();

        $this->postJson($this->url($segment, '/assignments'), [
            'user_id' => $this->employee->id,
            'policy_id' => $policy->json('data.id'),
            'effective_from' => '2026-01-01',
        ], $this->apiHeadersFor($this->admin))->assertCreated();

        $response = $this->getJson(
            '/api/working-time/my-policies?date=2026-08-19&base_amount=1000.00',
            $this->apiHeadersFor($this->employee)
        )->assertOk();

        // 15% of 1000, for a shift that sits entirely inside the 22:00-06:00
        // window. A decimal string, not a float.
        $this->assertSame(480, $response->json('data.shift_allowance_estimate.night.minutes_in_window'));
        $this->assertSame('150.00', $response->json('data.shift_allowance_estimate.night.amount'));
    }
}
