<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * A dependency edge means "task_id is blocked by depends_on_task_id", so the
 * graph has to stay acyclic. Nothing enforced that: only the self-edge A -> A
 * was refused, which left every longer loop open. A cycle is not a cosmetic
 * problem — anything that walks the graph to answer "what is ready to start"
 * either recurses forever or reports that none of the tasks in the loop can
 * ever begin.
 */
class TaskDependencyCycleTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_direct_two_task_cycle_is_refused(): void
    {
        [$admin, $tasks] = $this->makeTasks(['a', 'b']);

        // b is blocked by a.
        $this->addDependency($admin, $tasks['b'], $tasks['a'])->assertStatus(201);

        // Making a blocked by b closes the loop.
        $this->addDependency($admin, $tasks['a'], $tasks['b'])->assertStatus(422);

        $this->assertDatabaseMissing('task_dependencies', [
            'task_id' => $tasks['a']->id,
            'depends_on_task_id' => $tasks['b']->id,
        ]);
    }

    public function test_a_cycle_through_an_intermediate_task_is_refused(): void
    {
        [$admin, $tasks] = $this->makeTasks(['a', 'b', 'c']);

        // a <- b <- c, so c already reaches a by following its blockers.
        $this->addDependency($admin, $tasks['b'], $tasks['a'])->assertStatus(201);
        $this->addDependency($admin, $tasks['c'], $tasks['b'])->assertStatus(201);

        $this->addDependency($admin, $tasks['a'], $tasks['c'])->assertStatus(422);

        $this->assertDatabaseMissing('task_dependencies', [
            'task_id' => $tasks['a']->id,
            'depends_on_task_id' => $tasks['c']->id,
        ]);
    }

    /**
     * A task reachable by two different routes is a diamond, not a cycle. This
     * is the case an over-eager "have I seen this node before" check refuses by
     * mistake, so it has to stay green.
     */
    public function test_a_diamond_is_not_a_cycle(): void
    {
        [$admin, $tasks] = $this->makeTasks(['top', 'left', 'right', 'bottom']);

        $this->addDependency($admin, $tasks['left'], $tasks['bottom'])->assertStatus(201);
        $this->addDependency($admin, $tasks['right'], $tasks['bottom'])->assertStatus(201);
        $this->addDependency($admin, $tasks['top'], $tasks['left'])->assertStatus(201);
        $this->addDependency($admin, $tasks['top'], $tasks['right'])->assertStatus(201);

        $this->assertDatabaseHas('task_dependencies', [
            'task_id' => $tasks['top']->id,
            'depends_on_task_id' => $tasks['right']->id,
        ]);
    }

    public function test_a_task_still_cannot_depend_on_itself(): void
    {
        [$admin, $tasks] = $this->makeTasks(['a']);

        $this->addDependency($admin, $tasks['a'], $tasks['a'])->assertStatus(422);
    }

    private function addDependency(User $actor, Task $task, Task $blocker)
    {
        return $this->postJson(
            "/api/tasks/{$task->id}/dependencies",
            ['depends_on_task_id' => $blocker->id],
            $this->apiHeadersFor($actor)
        );
    }

    /**
     * @param  array<int, string>  $names
     * @return array{0: User, 1: array<string, Task>}
     */
    private function makeTasks(array $names): array
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);

        $admin = User::create([
            'name' => 'CareVance Admin',
            'email' => 'admin@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $project = Project::create([
            'organization_id' => $organization->id,
            'name' => 'Website Redesign',
            'status' => 'active',
        ]);

        $tasks = [];
        foreach ($names as $name) {
            $tasks[$name] = Task::create([
                'group_id' => null,
                'project_id' => $project->id,
                'title' => 'Task '.$name,
                'status' => 'todo',
                'priority' => 'medium',
                'assignee_id' => $admin->id,
            ]);
        }

        return [$admin, $tasks];
    }
}
