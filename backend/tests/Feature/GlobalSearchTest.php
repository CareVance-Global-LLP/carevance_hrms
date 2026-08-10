<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\Group;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The command bar's search endpoint.
 *
 * The behaviour worth guarding here is not "does it find things" but "does it
 * refuse to find things the caller may not see" — a search box is the easiest
 * accidental way to leak another organization's data.
 */
class GlobalSearchTest extends TestCase
{
    use RefreshDatabase;

    private function organization(string $name, string $slug, string $plan = 'professional_payroll'): Organization
    {
        return Organization::create(['name' => $name, 'slug' => $slug, 'plan_code' => $plan]);
    }

    private function user(Organization $organization, string $name, string $email, string $role): User
    {
        return User::create([
            'name' => $name,
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $organization->id,
        ]);
    }

    private function group(Organization $organization, string $name): Group
    {
        return Group::create([
            'organization_id' => $organization->id,
            'name' => $name,
            'slug' => str($name)->slug()->toString(),
            'is_active' => true,
        ]);
    }

    /** @return array<int, array<string, mixed>> */
    private function search(User $actor, string $query, ?string $types = null): array
    {
        $url = '/api/search?q=' . urlencode($query) . ($types ? '&types=' . $types : '');

        return $this->getJson($url, $this->apiHeadersFor($actor))
            ->assertOk()
            ->json('data');
    }

    public function test_it_never_returns_another_organizations_people(): void
    {
        $mine = $this->organization('CareVance', 'carevance');
        $theirs = $this->organization('Rival', 'rival');

        $admin = $this->user($mine, 'Admin', 'admin@carevance.test', 'admin');
        $this->user($mine, 'Priya Nair', 'priya@carevance.test', 'employee');
        $this->user($theirs, 'Priya Sharma', 'priya@rival.test', 'employee');

        $titles = array_column($this->search($admin, 'priya', 'people'), 'title');

        $this->assertContains('Priya Nair', $titles);
        $this->assertNotContains('Priya Sharma', $titles);
    }

    public function test_an_employee_can_only_find_themselves(): void
    {
        $organization = $this->organization('CareVance', 'carevance');

        $employee = $this->user($organization, 'Sam Employee', 'sam@carevance.test', 'employee');
        $this->user($organization, 'Sara Colleague', 'sara@carevance.test', 'employee');

        $titles = array_column($this->search($employee, 'sa', 'people'), 'title');

        $this->assertSame(['Sam Employee'], $titles);
    }

    public function test_an_admin_can_find_anyone_in_their_organization(): void
    {
        $organization = $this->organization('CareVance', 'carevance');

        $admin = $this->user($organization, 'Admin', 'admin@carevance.test', 'admin');
        $this->user($organization, 'Sara Colleague', 'sara@carevance.test', 'employee');

        $titles = array_column($this->search($admin, 'sara', 'people'), 'title');

        $this->assertContains('Sara Colleague', $titles);
    }

    public function test_people_can_be_found_by_email_as_well_as_name(): void
    {
        $organization = $this->organization('CareVance', 'carevance');
        $admin = $this->user($organization, 'Admin', 'admin@carevance.test', 'admin');
        $this->user($organization, 'Priya Nair', 'pnair@carevance.test', 'employee');

        $titles = array_column($this->search($admin, 'pnair@', 'people'), 'title');

        $this->assertContains('Priya Nair', $titles);
    }

    public function test_a_wildcard_in_the_query_matches_nothing_instead_of_dumping_the_table(): void
    {
        $organization = $this->organization('CareVance', 'carevance');
        $admin = $this->user($organization, 'Admin', 'admin@carevance.test', 'admin');
        $this->user($organization, 'Priya Nair', 'priya@carevance.test', 'employee');

        // Unescaped, "%" would match every row in the table.
        $this->assertSame([], $this->search($admin, '%', 'people'));
        $this->assertSame([], $this->search($admin, '%%', 'people'));
        $this->assertSame([], $this->search($admin, '__', 'people'));
    }

    public function test_a_one_character_query_returns_nothing(): void
    {
        $organization = $this->organization('CareVance', 'carevance');
        $admin = $this->user($organization, 'Admin', 'admin@carevance.test', 'admin');

        $this->assertSame([], $this->search($admin, 'a'));
    }

    public function test_an_empty_query_is_rejected(): void
    {
        $organization = $this->organization('CareVance', 'carevance');
        $admin = $this->user($organization, 'Admin', 'admin@carevance.test', 'admin');

        $this->getJson('/api/search?q=', $this->apiHeadersFor($admin))->assertStatus(422);
    }

    public function test_it_requires_authentication(): void
    {
        $this->getJson('/api/search?q=priya')->assertStatus(401);
    }

    public function test_tasks_follow_the_same_group_visibility_as_the_tasks_page(): void
    {
        $organization = $this->organization('CareVance', 'carevance');

        $employee = $this->user($organization, 'Sam', 'sam@carevance.test', 'employee');
        $mine = $this->group($organization, 'Digital');
        $theirs = $this->group($organization, 'Finance');
        $employee->groups()->attach($mine->id);

        Task::create(['group_id' => $mine->id, 'title' => 'Migrate payroll exports', 'status' => 'todo', 'priority' => 'medium', 'assignee_id' => $employee->id]);
        Task::create(['group_id' => $theirs->id, 'title' => 'Migrate finance ledger', 'status' => 'todo', 'priority' => 'medium', 'assignee_id' => null]);

        $titles = array_column($this->search($employee, 'migrate', 'tasks'), 'title');

        $this->assertContains('Migrate payroll exports', $titles);
        $this->assertNotContains('Migrate finance ledger', $titles);
    }

    public function test_projects_are_scoped_to_the_organization(): void
    {
        $mine = $this->organization('CareVance', 'carevance');
        $theirs = $this->organization('Rival', 'rival');
        $admin = $this->user($mine, 'Admin', 'admin@carevance.test', 'admin');

        Project::create(['organization_id' => $mine->id, 'name' => 'Northwind Rollout', 'status' => 'active']);
        Project::create(['organization_id' => $theirs->id, 'name' => 'Northwind Migration', 'status' => 'active']);

        $titles = array_column($this->search($admin, 'northwind', 'projects'), 'title');

        $this->assertSame(['Northwind Rollout'], $titles);
    }

    public function test_an_employee_only_finds_their_own_leave_requests(): void
    {
        $organization = $this->organization('CareVance', 'carevance');
        $employee = $this->user($organization, 'Sam', 'sam@carevance.test', 'employee');
        $colleague = $this->user($organization, 'Sara', 'sara@carevance.test', 'employee');

        LeaveRequest::create([
            'organization_id' => $organization->id,
            'user_id' => $employee->id,
            'start_date' => '2026-08-12',
            'end_date' => '2026-08-14',
            'leave_category' => 'casual',
            'reason' => 'Family wedding trip',
            'status' => 'pending',
        ]);

        LeaveRequest::create([
            'organization_id' => $organization->id,
            'user_id' => $colleague->id,
            'start_date' => '2026-08-12',
            'end_date' => '2026-08-14',
            'leave_category' => 'casual',
            'reason' => 'Family wedding guest',
            'status' => 'pending',
        ]);

        $this->assertCount(1, $this->search($employee, 'wedding', 'leave'));
        $this->assertCount(2, $this->search(
            $this->user($organization, 'Admin', 'admin@carevance.test', 'admin'),
            'wedding',
            'leave'
        ));
    }

    public function test_assets_need_the_assets_permission(): void
    {
        $organization = $this->organization('CareVance', 'carevance');
        $admin = $this->user($organization, 'Admin', 'admin@carevance.test', 'admin');
        $employee = $this->user($organization, 'Sam', 'sam@carevance.test', 'employee');

        Asset::create([
            'organization_id' => $organization->id,
            'asset_tag' => 'CV-0142',
            'name' => 'MacBook Pro 14',
            'category' => 'laptop',
            'status' => 'available',
        ]);

        $this->assertCount(1, $this->search($admin, 'macbook', 'assets'));
        $this->assertSame([], $this->search($employee, 'macbook', 'assets'));
    }

    public function test_assets_can_be_found_by_tag_and_serial(): void
    {
        $organization = $this->organization('CareVance', 'carevance');
        $admin = $this->user($organization, 'Admin', 'admin@carevance.test', 'admin');

        Asset::create([
            'organization_id' => $organization->id,
            'asset_tag' => 'CV-0142',
            'name' => 'MacBook Pro 14',
            'category' => 'laptop',
            'serial_number' => 'C02XY1234',
            'status' => 'available',
        ]);

        $this->assertCount(1, $this->search($admin, 'CV-0142', 'assets'));
        $this->assertCount(1, $this->search($admin, 'c02xy', 'assets'));
    }

    public function test_the_plan_gate_decides_whether_a_type_is_searchable_at_all(): void
    {
        // basic_tracking does not include task_tracking; advance_tracking does.
        $basic = $this->organization('Basic Co', 'basic-co', 'basic_tracking');
        $basicAdmin = $this->user($basic, 'Admin', 'admin@basic.test', 'admin');
        $basicGroup = $this->group($basic, 'Digital');
        Task::create(['group_id' => $basicGroup->id, 'title' => 'Migrate exports', 'status' => 'todo', 'priority' => 'medium', 'assignee_id' => $basicAdmin->id]);

        $this->assertSame([], $this->search($basicAdmin, 'migrate', 'tasks'));

        $advanced = $this->organization('Advance Co', 'advance-co', 'advance_tracking');
        $advancedAdmin = $this->user($advanced, 'Admin', 'admin@advance.test', 'admin');
        $advancedGroup = $this->group($advanced, 'Digital');
        Task::create(['group_id' => $advancedGroup->id, 'title' => 'Migrate exports', 'status' => 'todo', 'priority' => 'medium', 'assignee_id' => $advancedAdmin->id]);

        $this->assertCount(1, $this->search($advancedAdmin, 'migrate', 'tasks'));
    }

    public function test_unknown_types_are_ignored_rather_than_widening_the_search(): void
    {
        $organization = $this->organization('CareVance', 'carevance');
        $admin = $this->user($organization, 'Admin', 'admin@carevance.test', 'admin');
        $this->user($organization, 'Priya Nair', 'priya@carevance.test', 'employee');

        $this->assertSame([], $this->search($admin, 'priya', 'not_a_type'));
    }

    public function test_results_carry_a_uniform_shape(): void
    {
        $organization = $this->organization('CareVance', 'carevance');
        $admin = $this->user($organization, 'Admin', 'admin@carevance.test', 'admin');
        $this->user($organization, 'Priya Nair', 'priya@carevance.test', 'employee');

        $hit = $this->search($admin, 'priya', 'people')[0];

        $this->assertSame(['type', 'id', 'title', 'subtitle', 'url'], array_keys($hit));
        $this->assertSame('person', $hit['type']);
        $this->assertStringStartsWith('/employees/', $hit['url']);
    }
}
