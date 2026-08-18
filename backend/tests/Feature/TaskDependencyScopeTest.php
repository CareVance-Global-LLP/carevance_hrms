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
 * Task dependencies are the one place a task id crosses the API boundary as a
 * bare integer rather than as a route-model binding, so the organization scope
 * has to be re-applied by hand. `exists:tasks,id` does NOT do it: validation
 * runs its own query and never sees the BelongsToOrganization global scope.
 */
class TaskDependencyScopeTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_task_cannot_depend_on_a_task_in_another_organization(): void
    {
        [$organization, $admin] = $this->makeOrganizationWithAdmin('CareVance', 'carevance');
        [$rival, $rivalAdmin] = $this->makeOrganizationWithAdmin('Rival', 'rival');

        $ownTask = $this->makeTask($organization, $admin, 'Ship the new header');
        $foreignTask = $this->makeTask($rival, $rivalAdmin, 'Rival secret work');

        $response = $this->postJson(
            "/api/tasks/{$ownTask->id}/dependencies",
            ['depends_on_task_id' => $foreignTask->id],
            $this->apiHeadersFor($admin)
        );

        $response->assertStatus(422);

        $this->assertDatabaseMissing('task_dependencies', [
            'task_id' => $ownTask->id,
            'depends_on_task_id' => $foreignTask->id,
        ]);
    }

    public function test_a_task_can_still_depend_on_a_task_in_its_own_organization(): void
    {
        [$organization, $admin] = $this->makeOrganizationWithAdmin('CareVance', 'carevance');

        $task = $this->makeTask($organization, $admin, 'Ship the new header');
        $blocker = $this->makeTask($organization, $admin, 'Agree the copy');

        $this->postJson(
            "/api/tasks/{$task->id}/dependencies",
            ['depends_on_task_id' => $blocker->id],
            $this->apiHeadersFor($admin)
        )->assertStatus(201);

        $this->assertDatabaseHas('task_dependencies', [
            'task_id' => $task->id,
            'depends_on_task_id' => $blocker->id,
        ]);
    }

    /** @return array{0: Organization, 1: User} */
    private function makeOrganizationWithAdmin(string $name, string $slug): array
    {
        $organization = Organization::create(['name' => $name, 'slug' => $slug]);

        $admin = User::create([
            'name' => $name.' Admin',
            'email' => 'admin@'.$slug.'.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        return [$organization, $admin];
    }

    private function makeTask(Organization $organization, User $owner, string $title): Task
    {
        $project = Project::create([
            'organization_id' => $organization->id,
            'name' => $title.' project',
            'status' => 'active',
        ]);

        return Task::create([
            'group_id' => null,
            'project_id' => $project->id,
            'title' => $title,
            'status' => 'todo',
            'priority' => 'medium',
            'assignee_id' => $owner->id,
        ]);
    }
}
