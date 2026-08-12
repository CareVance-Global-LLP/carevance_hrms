<?php

namespace Tests\Feature;

use App\Models\Group;
use App\Models\Organization;
use App\Models\Project;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The demo-budget backfill relabels ten seeded projects as money budgets.
 *
 * RefreshDatabase gives every test an empty database, so that migration is a
 * no-op during a normal run and nothing would ever exercise it. These tests
 * load and run it directly.
 *
 * The assertion that matters is the second one: a project that merely shares a
 * name with a demo row must survive untouched. That is the entire reason the
 * migration matches on the exact (name, budget) pair rather than doing the
 * obvious `WHERE budget IS NOT NULL` — every existing budget was typed into a
 * form labelled "hours", so a blanket update would reinterpret somebody's real
 * 240-hour budget as ₹240.
 */
class ProjectBudgetBackfillTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private Group $group;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::query()->create([
            'name' => 'Backfill Co',
            'slug' => 'backfill-co',
        ]);

        $this->group = Group::query()->create([
            'organization_id' => $this->organization->id,
            'name' => 'Delivery',
            'slug' => 'delivery',
            'is_active' => true,
        ]);
    }

    public function test_it_relabels_seeded_rows_and_leaves_look_alikes_alone(): void
    {
        $seeded = $this->project('Website Redesign', 150000);
        $lookAlike = $this->project('Website Redesign', 240);
        $unrelated = $this->project('Internal Tooling', 150000);

        $this->runBackfill();

        $this->assertSame('amount', $seeded->fresh()->budget_type);
        $this->assertSame('1200.00', (string) $seeded->fresh()->hourly_rate);

        // Same name, different budget: a real 240-hour project, untouched.
        $this->assertSame('hours', $lookAlike->fresh()->budget_type);
        $this->assertNull($lookAlike->fresh()->hourly_rate);

        // Same budget, different name: also untouched.
        $this->assertSame('hours', $unrelated->fresh()->budget_type);
    }

    public function test_running_it_twice_is_the_same_as_running_it_once(): void
    {
        $seeded = $this->project('Mobile App v2', 500000);

        $this->runBackfill();
        $afterFirstRun = $seeded->fresh()->only(['budget_type', 'hourly_rate']);

        $this->runBackfill();

        $this->assertSame($afterFirstRun, $seeded->fresh()->only(['budget_type', 'hourly_rate']));
    }

    public function test_it_can_be_rolled_back(): void
    {
        $seeded = $this->project('Data Migration', 80000);

        $this->runBackfill();
        $this->migration()->down();

        $this->assertSame('hours', $seeded->fresh()->budget_type);
        $this->assertNull($seeded->fresh()->hourly_rate);
    }

    private function runBackfill(): void
    {
        $this->migration()->up();
    }

    private function migration(): object
    {
        return require database_path(
            'migrations/2026_08_10_000005_mark_demo_project_budgets_as_amounts.php'
        );
    }

    private function project(string $name, float $budget): Project
    {
        return Project::query()->create([
            'organization_id' => $this->organization->id,
            'group_id' => $this->group->id,
            'name' => $name,
            'budget' => $budget,
            'budget_type' => 'hours',
            'status' => 'active',
        ]);
    }
}
