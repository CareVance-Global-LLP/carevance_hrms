<?php

namespace Tests\Feature;

use App\Models\MonitoringAlertRule;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MonitoringAlertRuleApiTest extends TestCase
{
    use RefreshDatabase;

    private function orgWithAdmin(string $slug): array
    {
        $organization = Organization::create(['name' => 'Org '.$slug, 'slug' => $slug]);
        $admin = User::create([
            'name' => 'Admin '.$slug,
            'email' => 'admin@'.$slug.'.example',
            'password' => 'password123',
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        return [$organization, $admin];
    }

    public function test_an_admin_can_create_and_list_a_rule(): void
    {
        [, $admin] = $this->orgWithAdmin('alpha');

        $this->actingAs($admin)->postJson('/api/monitoring/alert-rules', [
            'name' => 'Short days',
            'metric' => MonitoringAlertRule::METRIC_TRACKED_BELOW,
            'threshold' => 6 * 3600,
        ])
            ->assertCreated()
            ->assertJsonPath('name', 'Short days')
            // The rule explains itself, so a list is readable without decoding
            // metric names and raw second counts.
            ->assertJsonPath('description', 'tracked less than 6h');

        $this->actingAs($admin)->getJson('/api/monitoring/alert-rules')
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Short days')
            ->assertJsonCount(3, 'metrics');
    }

    public function test_an_employee_cannot_manage_alerts(): void
    {
        // A rule decides who gets told what about whom.
        [$organization] = $this->orgWithAdmin('beta');
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee@beta.example',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $this->actingAs($employee)->getJson('/api/monitoring/alert-rules')->assertForbidden();
        $this->actingAs($employee)->postJson('/api/monitoring/alert-rules', [
            'name' => 'Sneaky',
            'metric' => MonitoringAlertRule::METRIC_NO_ACTIVITY,
            'threshold' => 0,
        ])->assertForbidden();
    }

    public function test_a_rule_from_another_organization_is_not_reachable(): void
    {
        [$orgA, $adminA] = $this->orgWithAdmin('gamma');
        [, $adminB] = $this->orgWithAdmin('delta');

        $rule = MonitoringAlertRule::withoutGlobalScopes()->create([
            'organization_id' => $orgA->id,
            'name' => 'Alpha only',
            'metric' => MonitoringAlertRule::METRIC_NO_ACTIVITY,
            'threshold' => 0,
        ]);

        // The other tenant's admin can neither see nor touch it.
        $this->actingAs($adminB)->getJson('/api/monitoring/alert-rules')
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->actingAs($adminB)->deleteJson("/api/monitoring/alert-rules/{$rule->id}")->assertNotFound();

        $this->actingAs($adminA)->getJson('/api/monitoring/alert-rules')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_an_unknown_metric_is_refused(): void
    {
        // The evaluator matches on the metric name; an unrecognised one would
        // save happily and then never fire, which looks configured and is not.
        [, $admin] = $this->orgWithAdmin('epsilon');

        $this->actingAs($admin)->postJson('/api/monitoring/alert-rules', [
            'name' => 'Nonsense',
            'metric' => 'vibes_below',
            'threshold' => 10,
        ])->assertStatus(422);
    }

    public function test_a_rule_can_be_disabled_without_deleting_it(): void
    {
        [, $admin] = $this->orgWithAdmin('zeta');

        $id = $this->actingAs($admin)->postJson('/api/monitoring/alert-rules', [
            'name' => 'Idle days',
            'metric' => MonitoringAlertRule::METRIC_IDLE_SHARE_ABOVE,
            'threshold' => 60,
        ])->json('id');

        $this->actingAs($admin)->putJson("/api/monitoring/alert-rules/{$id}", ['is_enabled' => false])
            ->assertOk()
            ->assertJsonPath('is_enabled', false)
            ->assertJsonPath('name', 'Idle days');
    }
}
