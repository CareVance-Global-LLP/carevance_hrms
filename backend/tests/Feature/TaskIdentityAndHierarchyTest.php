<?php

namespace Tests\Feature;

use App\Models\Group;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A task now has an identity, a classification and a place in a hierarchy.
 *
 * Every assertion here stands for something the model could not previously
 * express: who raised the work, what kind of work it is, how it ended, what it
 * is part of, and a name a person can say out loud.
 */
class TaskIdentityAndHierarchyTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private Group $group;
    private Project $project;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-tasks']);

        $this->admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $this->organization->id,
        ]);

        $this->group = Group::create([
            'name' => 'Engineering',
            'organization_id' => $this->organization->id,
        ]);

        $this->project = Project::create([
            'name' => 'Tracker',
            'organization_id' => $this->organization->id,
            'group_id' => $this->group->id,
            'status' => 'active',
        ]);
    }

    private function createTask(array $overrides = []): TestResponse
    {
        return $this->postJson('/api/tasks', array_merge([
            'title' => 'Write the thing',
            'group_id' => $this->group->id,
            'project_id' => $this->project->id,
        ], $overrides), $this->apiHeadersFor($this->admin));
    }

    private function latestTask(): Task
    {
        return Task::withoutOrganizationScope()->latest('id')->first();
    }

    public function test_a_task_records_who_raised_it(): void
    {
        // "Why does this exist?" had no answer anywhere in the system.
        $this->createTask()->assertCreated();

        $this->assertSame($this->admin->id, (int) $this->latestTask()->created_by);
    }

    public function test_the_reporter_is_the_caller_and_not_whatever_the_client_sent(): void
    {
        // A reporter a client can nominate is not a record of anything.
        $other = User::create([
            'name' => 'Someone Else',
            'email' => 'else@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        $this->createTask(['created_by' => $other->id])->assertCreated();

        $this->assertSame(
            $this->admin->id,
            (int) $this->latestTask()->created_by,
            'the reporter was taken from the request body',
        );
    }

    public function test_a_task_carries_a_type_and_defaults_to_task(): void
    {
        $this->createTask()->assertCreated();
        $this->assertSame('task', $this->latestTask()->type);

        $this->createTask(['title' => 'Crash on save', 'type' => 'bug'])->assertCreated();
        $this->assertSame('bug', $this->latestTask()->type);
    }

    public function test_an_unknown_type_is_refused(): void
    {
        $this->createTask(['type' => 'incident'])->assertStatus(422);
    }

    public function test_a_task_gets_a_shareable_key(): void
    {
        // A bare database id cannot be pasted into a conversation.
        $this->createTask()->assertCreated();

        $task = $this->latestTask();
        $this->assertNotNull($task->number);
        $this->assertSame('CV-'.$task->number, $task->key);
    }

    public function test_numbers_are_sequential_within_an_organization(): void
    {
        $this->createTask(['title' => 'One'])->assertCreated();
        $this->createTask(['title' => 'Two'])->assertCreated();

        $numbers = Task::withoutOrganizationScope()
            ->where('organization_id', $this->organization->id)
            ->orderBy('id')
            ->pluck('number')
            ->map(fn ($number) => (int) $number)
            ->all();

        $this->assertSame([1, 2], $numbers);
    }

    public function test_two_organizations_both_start_at_one(): void
    {
        // The number is per TENANT. Two organizations both having a #1 is the point.
        $this->createTask()->assertCreated();

        $otherOrg = Organization::create(['name' => 'Other', 'slug' => 'other-tasks']);
        $otherAdmin = User::create([
            'name' => 'Other Admin',
            'email' => 'other@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $otherOrg->id,
        ]);
        $otherGroup = Group::create(['name' => 'Ops', 'organization_id' => $otherOrg->id]);
        $otherProject = Project::create([
            'name' => 'Other Project',
            'organization_id' => $otherOrg->id,
            'group_id' => $otherGroup->id,
            'status' => 'active',
        ]);

        $this->postJson('/api/tasks', [
            'title' => 'Their first task',
            'group_id' => $otherGroup->id,
            'project_id' => $otherProject->id,
        ], $this->apiHeadersFor($otherAdmin))->assertCreated();

        $theirs = Task::withoutOrganizationScope()->where('organization_id', $otherOrg->id)->first();
        $this->assertSame(1, (int) $theirs->number);
    }

    public function test_a_task_can_be_a_piece_of_another(): void
    {
        $this->createTask(['title' => 'Ship the feature'])->assertCreated();
        $parent = $this->latestTask();

        $this->createTask(['title' => 'Design it', 'parent_id' => $parent->id])->assertCreated();
        $child = $this->latestTask();

        $this->assertSame($parent->id, (int) $child->parent_id);
        $this->assertTrue($parent->children()->where('tasks.id', $child->id)->exists());
    }

    public function test_the_hierarchy_is_one_level_deep(): void
    {
        // Depth is easy to add later and very hard to remove once people have
        // built structures on it.
        $this->createTask(['title' => 'Parent'])->assertCreated();
        $parent = $this->latestTask();

        $this->createTask(['title' => 'Child', 'parent_id' => $parent->id])->assertCreated();
        $child = $this->latestTask();

        $this->createTask(['title' => 'Grandchild', 'parent_id' => $child->id])->assertStatus(422);
    }

    public function test_a_parent_in_another_organization_is_refused(): void
    {
        $otherOrg = Organization::create(['name' => 'Other', 'slug' => 'other-parent']);
        $foreign = Task::withoutOrganizationScope()->create([
            'organization_id' => $otherOrg->id,
            'title' => 'Not yours',
            'status' => 'todo',
        ]);

        $this->createTask(['parent_id' => $foreign->id])->assertStatus(422);
    }

    public function test_a_task_cannot_become_its_own_parent(): void
    {
        $this->createTask()->assertCreated();
        $task = $this->latestTask();

        $this->putJson("/api/tasks/{$task->id}", ['parent_id' => $task->id], $this->apiHeadersFor($this->admin))
            ->assertStatus(422);
    }

    public function test_the_api_sends_the_fields_the_ui_renders(): void
    {
        /*
         * Three of the four bugs in the last Work-section rebuild were a UI
         * reading a key the API never sent. The detail panel now renders the
         * key, the reporter, the parent and the pieces — so the payload has to
         * actually carry them, eager-loaded rather than lazily per row.
         */
        $this->createTask(['title' => 'Ship the feature', 'type' => 'story'])->assertCreated();
        $parent = $this->latestTask();

        $this->createTask(['title' => 'Design it', 'parent_id' => $parent->id])->assertCreated();

        $detail = $this->getJson("/api/tasks/{$parent->id}", $this->apiHeadersFor($this->admin))
            ->assertOk()
            ->json();

        $this->assertSame('CV-'.$parent->number, $detail['key'] ?? null, 'the shareable key was missing');
        $this->assertSame('story', $detail['type'] ?? null);
        $this->assertSame($this->admin->name, $detail['creator']['name'] ?? null, 'the reporter was missing');
        $this->assertCount(1, $detail['children'] ?? [], 'the pieces of the task were missing');
        $this->assertSame('Design it', $detail['children'][0]['title'] ?? null);

        // And the row the list renders carries the reporter too, since it is
        // shown per row rather than fetched on demand.
        $row = collect($this->getJson('/api/tasks', $this->apiHeadersFor($this->admin))->assertOk()->json())
            ->firstWhere('id', $parent->id);

        $this->assertNotNull($row, 'the task was missing from the list');
        $this->assertSame('CV-'.$parent->number, $row['key'] ?? null);
        $this->assertSame($this->admin->name, $row['creator']['name'] ?? null);
    }

    public function test_the_primary_assignee_is_always_inside_the_assignee_set(): void
    {
        /*
         * Ownership has two representations and they can disagree. When they do,
         * a task is owned by one person according to the board and a different
         * set according to the detail panel.
         */
        $owner = User::create([
            'name' => 'Owner',
            'email' => 'owner@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);
        $helper = User::create([
            'name' => 'Helper',
            'email' => 'helper@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        $this->createTask()->assertCreated();
        $task = $this->latestTask();
        $task->update(['assignee_id' => $owner->id]);

        // Sync a set that leaves the primary out entirely.
        $task->syncAssignees([$helper->id]);

        $ids = $task->fresh()->assignees->pluck('id')->map(fn ($id) => (int) $id)->all();
        $this->assertContains($owner->id, $ids, 'the primary assignee was dropped from the assignee set');
        $this->assertContains($helper->id, $ids);
    }

    public function test_syncing_assignees_does_not_duplicate_the_primary(): void
    {
        $owner = User::create([
            'name' => 'Owner Two',
            'email' => 'owner2@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        $this->createTask()->assertCreated();
        $task = $this->latestTask();
        $task->update(['assignee_id' => $owner->id]);

        $task->syncAssignees([$owner->id, $owner->id]);

        $this->assertSame([$owner->id], $task->fresh()->assignees->pluck('id')->map(fn ($id) => (int) $id)->all());
    }

    public function test_finishing_a_task_records_how_it_ended(): void
    {
        // `done` alone cannot tell shipped from abandoned from duplicate.
        $this->createTask()->assertCreated();
        $task = $this->latestTask();

        $this->putJson("/api/tasks/{$task->id}", [
            'status' => 'done',
            'resolution' => 'duplicate',
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $this->assertSame('duplicate', $task->fresh()->resolution);
    }

    public function test_closing_without_saying_how_defaults_to_fixed(): void
    {
        $this->createTask()->assertCreated();
        $task = $this->latestTask();

        $this->putJson("/api/tasks/{$task->id}", ['status' => 'done'], $this->apiHeadersFor($this->admin))->assertOk();

        $this->assertSame('fixed', $task->fresh()->resolution);
    }

    public function test_reopening_clears_the_resolution(): void
    {
        /*
         * The case that matters most. Without this, a task reopened after being
         * marked `duplicate` keeps claiming it is a duplicate while sitting in
         * progress — and every report counting resolutions believes it.
         */
        $this->createTask()->assertCreated();
        $task = $this->latestTask();

        $this->putJson("/api/tasks/{$task->id}", ['status' => 'done', 'resolution' => 'duplicate'], $this->apiHeadersFor($this->admin))->assertOk();
        $this->assertSame('duplicate', $task->fresh()->resolution);

        $this->putJson("/api/tasks/{$task->id}", ['status' => 'in_progress'], $this->apiHeadersFor($this->admin))->assertOk();
        $this->assertNull($task->fresh()->resolution, 'a reopened task still claimed an outcome');
    }
}
