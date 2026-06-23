<?php

namespace Tests\Feature;

use App\Models\Group;
use App\Models\Organization;
use App\Models\PayGroup;
use App\Models\PayGroupAssignment;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P1 tests for the Create Pay Group modal:
 *   GET  /api/payroll/all-employees
 *   POST /api/payroll/pay-groups/assign
 *
 * Covers:
 *   - Happy path: group created, all selected users get an active
 *     pay_group_assignments row, code is auto-derived.
 *   - Code collision: a second group with the same name gets a
 *     numeric suffix on its code.
 *   - Re-assign semantics: assigning a user to a new group closes
 *     their previous active row.
 *   - Cross-org rejection: a user_id from a different org is
 *     rejected (422) and no rows are created.
 *   - Validation: missing name, empty user_ids, and non-array
 *     user_ids are all rejected.
 *   - Search filter: ?search= matches name, email, and designation.
 *   - Department filter: ?department_id= restricts to members of
 *     that Group.
 *   - Unauthenticated requests are rejected.
 */
class PayGroupAssignmentTest extends TestCase
{
    use RefreshDatabase;

    protected Organization $organization;
    protected Organization $otherOrganization;
    protected Group $departmentA;
    protected Group $departmentB;
    protected User $admin;
    protected User $employee1;
    protected User $employee2;
    protected User $employee3;
    protected User $manager;
    protected User $externalUser;

    protected function setUp(): void
    {
        parent::setUp();

        $suffix = uniqid();
        $this->organization = Organization::create([
            'name' => 'Test Organization',
            'slug' => 'test-org-' . $suffix,
        ]);

        $this->otherOrganization = Organization::create([
            'name' => 'Other Organization',
            'slug' => 'other-org-' . $suffix,
        ]);

        $this->departmentA = Group::create([
            'organization_id' => $this->organization->id,
            'name' => 'Engineering',
            'slug' => 'engineering-' . $suffix,
            'is_active' => true,
        ]);
        $this->departmentB = Group::create([
            'organization_id' => $this->organization->id,
            'name' => 'Quality Assurance',
            'slug' => 'quality-assurance-' . $suffix,
            'is_active' => true,
        ]);

        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
            'name' => 'Admin User',
            'email' => 'admin-' . $suffix . '@company.com',
        ]);

        $this->employee1 = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
            'name' => 'Irbaz',
            'email' => 'irbaz-' . $suffix . '@test.com',
        ]);
        $this->employee2 = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
            'name' => 'Manan',
            'email' => 'manan-' . $suffix . '@test.com',
        ]);
        $this->employee3 = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'manager',
            'name' => 'Brijeaj',
            'email' => 'brijeaj-' . $suffix . '@test.com',
        ]);
        $this->manager = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'manager',
            'name' => 'Riya',
            'email' => 'riya-' . $suffix . '@test.com',
        ]);
        $this->externalUser = User::factory()->create([
            'organization_id' => $this->otherOrganization->id,
            'role' => 'employee',
            'name' => 'External Person',
            'email' => 'external-' . $suffix . '@other.com',
        ]);

        // Place department members via the pivot table used by
        // User->groups.
        \DB::table('group_user')->insert([
            ['group_id' => $this->departmentA->id, 'user_id' => $this->employee1->id, 'created_at' => now(), 'updated_at' => now()],
            ['group_id' => $this->departmentA->id, 'user_id' => $this->employee2->id, 'created_at' => now(), 'updated_at' => now()],
            ['group_id' => $this->departmentA->id, 'user_id' => $this->manager->id, 'created_at' => now(), 'updated_at' => now()],
            ['group_id' => $this->departmentB->id, 'user_id' => $this->employee3->id, 'created_at' => now(), 'updated_at' => now()],
        ]);

        // Set a designation on one employee so we can test the
        // search-by-designation path.
        \App\Models\EmployeeWorkInfo::create([
            'user_id' => $this->employee1->id,
            'organization_id' => $this->organization->id,
            'designation' => 'Lead Engineer',
        ]);
    }

    public function test_admin_can_list_all_employees(): void
    {
        $response = $this->withHeaders($this->apiHeadersFor($this->admin))
            ->getJson('/api/payroll/all-employees');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'employees',
            'total',
            'current_page',
            'last_page',
            'per_page',
        ]);

        $emails = collect($response->json('employees'))->pluck('email')->all();
        $this->assertContains($this->employee1->email, $emails);
        $this->assertContains($this->employee2->email, $emails);
        $this->assertContains($this->employee3->email, $emails);
        $this->assertContains($this->manager->email, $emails);

        // Cross-org users must never appear in our org's list.
        $this->assertNotContains($this->externalUser->email, $emails);

        $first = collect($response->json('employees'))->firstWhere('email', $this->employee1->email);
        $this->assertNotNull($first);
        $this->assertEquals('Lead Engineer', $first['designation']);
        $this->assertEquals($this->departmentA->id, $first['department_id']);
        $this->assertEquals('Engineering', $first['department']);

        // Default page size is 50 and we're well under that.
        $this->assertEquals(50, $response->json('per_page'));
        $this->assertEquals(1, $response->json('current_page'));
        $this->assertEquals(1, $response->json('last_page'));
    }

    public function test_pagination_per_page_can_be_overridden(): void
    {
        $response = $this->withHeaders($this->apiHeadersFor($this->admin))
            ->getJson('/api/payroll/all-employees?per_page=2');

        $response->assertStatus(200);
        $this->assertEquals(2, $response->json('per_page'));
        // 5 employees in our org (admin + employee1-3 + manager) →
        // last_page should be 3 with per_page=2.
        $this->assertEquals(3, $response->json('last_page'));
        $this->assertCount(2, $response->json('employees'));
    }

    public function test_pagination_per_page_is_capped_at_200(): void
    {
        $response = $this->withHeaders($this->apiHeadersFor($this->admin))
            ->getJson('/api/payroll/all-employees?per_page=999');

        $response->assertStatus(200);
        $this->assertEquals(200, $response->json('per_page'));
    }

    public function test_pagination_page_param_is_respected(): void
    {
        $headers = $this->apiHeadersFor($this->admin);

        $page1 = $this->withHeaders($headers)
            ->getJson('/api/payroll/all-employees?per_page=2&page=1');
        $this->assertEquals(1, $page1->json('current_page'));
        $this->assertEquals(3, $page1->json('last_page'));
        $page1Ids = collect($page1->json('employees'))->pluck('id')->all();

        $page2 = $this->withHeaders($headers)
            ->getJson('/api/payroll/all-employees?per_page=2&page=2');
        $this->assertEquals(2, $page2->json('current_page'));
        $page2Ids = collect($page2->json('employees'))->pluck('id')->all();

        // Page 1 and Page 2 must return different employees.
        $this->assertEmpty(array_intersect($page1Ids, $page2Ids));
    }

    public function test_search_filter_matches_name_email_and_designation(): void
    {
        $headers = $this->apiHeadersFor($this->admin);

        // Match by name
        $byName = $this->withHeaders($headers)
            ->getJson('/api/payroll/all-employees?search=Irbaz')
            ->json('employees');
        $this->assertCount(1, $byName);
        $this->assertEquals($this->employee1->email, $byName[0]['email']);

        // Match by email (use a unique fragment of the local part)
        $emailFragment = explode('@', $this->employee2->email)[0];
        $byEmail = $this->withHeaders($headers)
            ->getJson('/api/payroll/all-employees?search=' . urlencode($emailFragment))
            ->json('employees');
        $this->assertCount(1, $byEmail);
        $this->assertEquals($this->employee2->email, $byEmail[0]['email']);

        // Match by designation
        $byDesignation = $this->withHeaders($headers)
            ->getJson('/api/payroll/all-employees?search=Lead')
            ->json('employees');
        $this->assertCount(1, $byDesignation);
        $this->assertEquals($this->employee1->email, $byDesignation[0]['email']);
    }

    public function test_department_filter_restricts_results(): void
    {
        $engineeringOnly = $this->withHeaders($this->apiHeadersFor($this->admin))
            ->getJson('/api/payroll/all-employees?department_id=' . $this->departmentA->id)
            ->json('employees');

        $emails = collect($engineeringOnly)->pluck('email')->all();
        $this->assertContains($this->employee1->email, $emails);
        $this->assertContains($this->employee2->email, $emails);
        $this->assertContains($this->manager->email, $emails);
        $this->assertNotContains($this->employee3->email, $emails);
    }

    public function test_can_create_pay_group_and_assign_employees(): void
    {
        $response = $this->withHeaders($this->apiHeadersFor($this->admin))
            ->postJson('/api/payroll/pay-groups/assign', [
                'name' => 'QA Monthly',
                'user_ids' => [$this->employee1->id, $this->employee2->id, $this->employee3->id],
            ]);

        $response->assertStatus(201);
        $response->assertJson([
            'success' => true,
            'pay_group_name' => 'QA Monthly',
            'pay_group_code' => 'qa_monthly',
            'assigned_count' => 3,
        ]);

        $groupId = $response->json('pay_group_id');
        $this->assertNotNull($groupId);

        $group = PayGroup::findOrFail($groupId);
        $this->assertEquals('QA Monthly', $group->name);
        $this->assertEquals('qa_monthly', $group->code);
        $this->assertEquals('monthly', $group->pay_frequency);
        $this->assertEquals($this->organization->id, $group->organization_id);

        $assignments = PayGroupAssignment::where('pay_group_id', $groupId)->get();
        $this->assertCount(3, $assignments);
        $this->assertEquals(0, $assignments->where('is_active', false)->count());
    }

    public function test_code_collision_appends_numeric_suffix(): void
    {
        $headers = $this->apiHeadersFor($this->admin);

        $first = $this->withHeaders($headers)
            ->postJson('/api/payroll/pay-groups/assign', [
                'name' => 'QA Monthly',
                'user_ids' => [$this->employee1->id],
            ])->json('pay_group_code');
        $this->assertEquals('qa_monthly', $first);

        $second = $this->withHeaders($headers)
            ->postJson('/api/payroll/pay-groups/assign', [
                'name' => 'QA Monthly',
                'user_ids' => [$this->employee2->id],
            ])->json('pay_group_code');
        $this->assertEquals('qa_monthly_1', $second);

        $third = $this->withHeaders($headers)
            ->postJson('/api/payroll/pay-groups/assign', [
                'name' => 'QA Monthly',
                'user_ids' => [$this->employee3->id],
            ])->json('pay_group_code');
        $this->assertEquals('qa_monthly_2', $third);
    }

    public function test_reassigning_a_user_closes_their_previous_active_assignment(): void
    {
        $headers = $this->apiHeadersFor($this->admin);

        $firstGroupId = $this->withHeaders($headers)
            ->postJson('/api/payroll/pay-groups/assign', [
                'name' => 'Group A',
                'user_ids' => [$this->employee1->id],
            ])->json('pay_group_id');

        $this->assertEquals(1, PayGroupAssignment::where('pay_group_id', $firstGroupId)
            ->where('user_id', $this->employee1->id)
            ->where('is_active', true)
            ->count());

        // Now move the same user into a new group.
        $secondGroupId = $this->withHeaders($headers)
            ->postJson('/api/payroll/pay-groups/assign', [
                'name' => 'Group B',
                'user_ids' => [$this->employee1->id],
            ])->json('pay_group_id');

        // The original row must be closed.
        $first = PayGroupAssignment::where('pay_group_id', $firstGroupId)
            ->where('user_id', $this->employee1->id)
            ->firstOrFail();
        $this->assertFalse((bool) $first->is_active);
        $this->assertNotNull($first->effective_to);

        // The user has exactly one active assignment, on the new group.
        $activeAssignments = PayGroupAssignment::where('user_id', $this->employee1->id)
            ->where('is_active', true)
            ->get();
        $this->assertCount(1, $activeAssignments);
        $this->assertEquals($secondGroupId, $activeAssignments->first()->pay_group_id);
    }

    public function test_cannot_assign_user_from_a_different_organization(): void
    {
        $beforeCount = PayGroup::count();

        $response = $this->withHeaders($this->apiHeadersFor($this->admin))
            ->postJson('/api/payroll/pay-groups/assign', [
                'name' => 'Cross Org',
                'user_ids' => [$this->employee1->id, $this->externalUser->id],
            ]);

        $response->assertStatus(422);
        $response->assertJson(['success' => false]);

        $this->assertEquals($beforeCount, PayGroup::count());
        $this->assertEquals(0, PayGroupAssignment::count());
    }

    public function test_validation_rejects_missing_name(): void
    {
        $this->withHeaders($this->apiHeadersFor($this->admin))
            ->postJson('/api/payroll/pay-groups/assign', [
                'user_ids' => [$this->employee1->id],
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['name']);
    }

    public function test_validation_rejects_empty_user_ids(): void
    {
        $this->withHeaders($this->apiHeadersFor($this->admin))
            ->postJson('/api/payroll/pay-groups/assign', [
                'name' => 'Empty Group',
                'user_ids' => [],
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['user_ids']);
    }

    public function test_validation_rejects_non_array_user_ids(): void
    {
        $this->withHeaders($this->apiHeadersFor($this->admin))
            ->postJson('/api/payroll/pay-groups/assign', [
                'name' => 'Bad Group',
                'user_ids' => 'not-an-array',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['user_ids']);
    }

    public function test_unauthenticated_user_gets_401(): void
    {
        $this->getJson('/api/payroll/all-employees')->assertStatus(401);
    }

    // =====================================================================
    // P1 tests for getPayGroupEmployees (Pay Group → employee list view)
    // =====================================================================

    public function test_get_pay_group_employees_returns_active_members(): void
    {
        $this->actingAs($this->admin);

        $group = PayGroup::create([
            'organization_id' => $this->organization->id,
            'name' => 'Team Care',
            'code' => 'team_care',
            'pay_frequency' => 'monthly',
            'pay_day_type' => 'specific',
            'is_active' => true,
        ]);

        // Active: employee1 + employee2; inactive: externalUser shouldn't appear.
        PayGroupAssignment::create([
            'organization_id' => $this->organization->id,
            'pay_group_id' => $group->id,
            'user_id' => $this->employee1->id,
            'effective_from' => '2026-06-01',
            'is_active' => true,
        ]);
        PayGroupAssignment::create([
            'organization_id' => $this->organization->id,
            'pay_group_id' => $group->id,
            'user_id' => $this->employee2->id,
            'effective_from' => '2026-06-01',
            'is_active' => true,
        ]);

        $response = $this->withHeaders($this->apiHeadersFor($this->admin))
            ->getJson("/api/payroll/pay-groups/{$group->id}/employees");

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'pay_group' => ['id', 'name', 'code', 'pay_frequency'],
            'employees',
        ]);

        $this->assertEquals('Team Care', $response->json('pay_group.name'));
        $this->assertEquals('team_care', $response->json('pay_group.code'));

        $emails = collect($response->json('employees'))->pluck('email')->all();
        $this->assertContains($this->employee1->email, $emails);
        $this->assertContains($this->employee2->email, $emails);
        $this->assertNotContains($this->externalUser->email, $emails);
    }

    public function test_get_pay_group_employees_includes_per_month_payroll_status(): void
    {
        $this->actingAs($this->admin);
        $monthYear = '2026-06';

        $group = PayGroup::create([
            'organization_id' => $this->organization->id,
            'name' => 'Team Care',
            'code' => 'team_care',
            'pay_frequency' => 'monthly',
            'pay_day_type' => 'specific',
            'is_active' => true,
        ]);

        // Pre-create the template with a known annual_ctc. The endpoint
        // now sources annual_ctc from the template (like DepartmentEmployees
        // does) rather than from PayrollItem.gross_salary * 12. The
        // PayrollItem below is a separate concern: it provides the
        // monthly payroll status fields.
        \App\Models\EmployeePayrollTemplate::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee1->id,
            'annual_ctc' => 600000,
        ]);

        PayGroupAssignment::create([
            'organization_id' => $this->organization->id,
            'pay_group_id' => $group->id,
            'user_id' => $this->employee1->id,
            'effective_from' => $monthYear,
            'is_active' => true,
        ]);

        // Create a payroll item for employee1 in this month (paid).
        $run = \App\Models\PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => $monthYear,
            'status' => 'processing',
            'created_by' => $this->admin->id,
        ]);
        \App\Models\PayrollItem::create([
            'payroll_run_id' => $run->id,
            'month_year' => $monthYear,
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee1->id,
            'gross_salary' => 50000,
            'total_deductions' => 10000,
            'net_pay' => 40000,
            'payment_status' => 'paid',
            'paid_at' => now(),
        ]);

        $response = $this->withHeaders($this->apiHeadersFor($this->admin))
            ->getJson("/api/payroll/pay-groups/{$group->id}/employees?month_year={$monthYear}");

        $response->assertStatus(200);
        $first = collect($response->json('employees'))
            ->firstWhere('email', $this->employee1->email);

        $this->assertNotNull($first);
        // annual_ctc comes from the template (set above), NOT from
        // PayrollItem.gross_salary. The two are independent — the
        // template is the canonical CTC; PayrollItem is the monthly
        // processed amount.
        $this->assertEquals(600000, $first['annual_ctc']);
        $this->assertEquals(40000, $first['payroll_status']['net_pay']);
        $this->assertEquals('paid', $first['payroll_status']['payment_status']);
        $this->assertTrue($first['payroll_status']['is_processed']);
    }

    public function test_get_pay_group_employees_returns_404_for_cross_org(): void
    {
        $this->actingAs($this->admin);

        $otherGroup = PayGroup::create([
            'organization_id' => $this->otherOrganization->id,
            'name' => 'Foreign Group',
            'code' => 'foreign_group',
            'pay_frequency' => 'monthly',
            'pay_day_type' => 'specific',
            'is_active' => true,
        ]);

        $this->withHeaders($this->apiHeadersFor($this->admin))
            ->getJson("/api/payroll/pay-groups/{$otherGroup->id}/employees")
            ->assertStatus(404);
    }

    public function test_get_pay_group_employees_returns_empty_for_group_with_no_members(): void
    {
        $this->actingAs($this->admin);

        $group = PayGroup::create([
            'organization_id' => $this->organization->id,
            'name' => 'Empty Group',
            'code' => 'empty_group',
            'pay_frequency' => 'monthly',
            'pay_day_type' => 'specific',
            'is_active' => true,
        ]);

        $response = $this->withHeaders($this->apiHeadersFor($this->admin))
            ->getJson("/api/payroll/pay-groups/{$group->id}/employees");

        $response->assertStatus(200);
        $this->assertEquals(0, count($response->json('employees')));
    }

    public function test_process_pay_group_selected_filters_non_members(): void
    {
        $this->actingAs($this->admin);
        $monthYear = '2026-06';

        $group = PayGroup::create([
            'organization_id' => $this->organization->id,
            'name' => 'Team Care',
            'code' => 'team_care',
            'pay_frequency' => 'monthly',
            'pay_day_type' => 'specific',
            'is_active' => true,
        ]);

        // None of the submitted user_ids are members of this pay group
        // (no PayGroupAssignment rows for any of them). The controller
        // must reject with 422 BEFORE invoking processEmployeePayroll,
        // regardless of how many template/bulk-process issues might
        // exist further down the pipeline.
        $response = $this->withHeaders($this->apiHeadersFor($this->admin))
            ->postJson("/api/payroll/pay-groups/{$group->id}/process-selected", [
                'month_year' => $monthYear,
                'user_ids' => [
                    $this->employee1->id,
                    $this->employee2->id,
                    $this->externalUser->id,
                ],
                'working_days' => 22,
            ]);

        $response->assertStatus(422);
        $response->assertJson(['success' => false]);
    }

    public function test_process_pay_group_selected_rejects_users_not_in_group(): void
    {
        $this->actingAs($this->admin);

        $group = PayGroup::create([
            'organization_id' => $this->organization->id,
            'name' => 'Team Care',
            'code' => 'team_care',
            'pay_frequency' => 'monthly',
            'pay_day_type' => 'specific',
            'is_active' => true,
        ]);

        $this->withHeaders($this->apiHeadersFor($this->admin))
            ->postJson("/api/payroll/pay-groups/{$group->id}/process-selected", [
                'month_year' => '2026-06',
                'user_ids' => [$this->employee1->id, $this->employee2->id],
                'working_days' => 22,
            ])
            ->assertStatus(422)
            ->assertJson(['success' => false]);
    }
}
