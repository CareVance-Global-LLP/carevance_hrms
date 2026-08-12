<?php

namespace Tests\Feature;

use App\Models\Group;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * `projects.budget` used to be a number with no unit. The form said hours, the
 * data held rupees, and the ledger printed things like "500000h". These tests
 * pin the contract that replaced it: a budget always says which it is, a money
 * budget carries its own rate, and an out-of-range figure is rejected rather
 * than handed to Postgres.
 */
class ProjectBudgetTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private Group $group;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::query()->create([
            'name' => 'Budget Co',
            'slug' => 'budget-co',
        ]);

        $this->admin = User::query()->create([
            'name' => 'Project Admin',
            'email' => 'admin@budget-co.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $this->organization->id,
            'is_active' => true,
        ]);

        $this->group = Group::query()->create([
            'organization_id' => $this->organization->id,
            'name' => 'Engineering',
            'slug' => 'engineering',
            'is_active' => true,
        ]);
    }

    public function test_a_budget_beyond_the_column_precision_is_rejected_as_a_validation_error(): void
    {
        // decimal(10,2) tops out at 99999999.99. Before the bound existed this
        // reached the database and came back as SQLSTATE 22003 — a 500 for a
        // user typing too many zeroes.
        $this->actingAs($this->admin)
            ->postJson('/api/projects', $this->payload(['budget' => 100000000]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('budget');

        $this->assertSame(0, Project::query()->count());
    }

    public function test_a_negative_budget_is_rejected(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/projects', $this->payload(['budget' => -1]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('budget');
    }

    public function test_an_unknown_budget_type_is_rejected(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/projects', $this->payload(['budget_type' => 'bananas']))
            ->assertStatus(422)
            ->assertJsonValidationErrors('budget_type');
    }

    public function test_a_project_created_without_a_budget_type_defaults_to_hours(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/projects', $this->payload(['budget' => 200]))
            ->assertCreated();

        $this->assertDatabaseHas('projects', [
            'name' => 'Ledger Rebuild',
            'budget_type' => 'hours',
            'hourly_rate' => null,
        ]);
    }

    public function test_an_explicit_null_budget_type_falls_back_to_hours(): void
    {
        // The column is NOT NULL, so a client sending null must not reach it.
        $this->actingAs($this->admin)
            ->postJson('/api/projects', $this->payload(['budget_type' => null]))
            ->assertCreated();

        $this->assertDatabaseHas('projects', ['name' => 'Ledger Rebuild', 'budget_type' => 'hours']);
    }

    public function test_an_amount_budget_stores_its_hourly_rate(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/projects', $this->payload([
                'budget' => 150000,
                'budget_type' => 'amount',
                'hourly_rate' => 1200,
            ]))
            ->assertCreated();

        $project = Project::query()->firstOrFail();

        $this->assertSame('amount', $project->budget_type);
        $this->assertSame('1200.00', (string) $project->hourly_rate);
    }

    public function test_an_hours_budget_never_keeps_an_hourly_rate(): void
    {
        // A rate on an hours budget is a value nothing reads — and one that
        // reappears wrongly if the project is later switched to money.
        $this->actingAs($this->admin)
            ->postJson('/api/projects', $this->payload([
                'budget' => 200,
                'budget_type' => 'hours',
                'hourly_rate' => 1200,
            ]))
            ->assertCreated();

        $this->assertNull(Project::query()->firstOrFail()->hourly_rate);
    }

    public function test_switching_a_project_back_to_hours_clears_its_hourly_rate(): void
    {
        $project = $this->project(['budget' => 150000, 'budget_type' => 'amount', 'hourly_rate' => 1200]);

        $this->actingAs($this->admin)
            ->putJson("/api/projects/{$project->id}", ['budget_type' => 'hours'])
            ->assertOk();

        $project->refresh();

        $this->assertSame('hours', $project->budget_type);
        $this->assertNull($project->hourly_rate);
    }

    public function test_updating_with_an_oversized_budget_leaves_the_stored_value_alone(): void
    {
        $project = $this->project(['budget' => 200, 'budget_type' => 'hours']);

        $this->actingAs($this->admin)
            ->putJson("/api/projects/{$project->id}", ['budget' => 100000000])
            ->assertStatus(422)
            ->assertJsonValidationErrors('budget');

        $this->assertSame('200.00', (string) $project->fresh()->budget);
    }

    public function test_the_projects_index_exposes_budget_type_and_hourly_rate(): void
    {
        // The burn bar is computed client-side from exactly these fields, so
        // this is the contract the ledger depends on.
        $this->project(['budget' => 150000, 'budget_type' => 'amount', 'hourly_rate' => 1200]);

        $this->actingAs($this->admin)
            ->getJson('/api/projects')
            ->assertOk()
            ->assertJsonStructure([
                '*' => ['id', 'name', 'budget', 'budget_type', 'hourly_rate', 'tracked_seconds'],
            ]);
    }

    /** @param array<string, mixed> $overrides */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Ledger Rebuild',
            'group_id' => $this->group->id,
        ], $overrides);
    }

    /** @param array<string, mixed> $attributes */
    private function project(array $attributes): Project
    {
        return Project::query()->create(array_merge([
            'organization_id' => $this->organization->id,
            'group_id' => $this->group->id,
            'name' => 'Ledger Rebuild',
            'status' => 'active',
        ], $attributes));
    }
}
