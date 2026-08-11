<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Services\Monitoring\MonitoringSettingsResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MonitoringIntervalResolutionTest extends TestCase
{
    use RefreshDatabase;

    private function makeOrganization(?int $intervalMinutes, string $slug = 'carevance'): Organization
    {
        return Organization::create([
            'name' => 'CareVance',
            'slug' => $slug,
            'settings' => $intervalMinutes === null
                ? []
                : ['monitoring' => ['interval_minutes' => $intervalMinutes]],
        ]);
    }

    private function makeUser(Organization $organization, ?array $settings, string $email, string $role = 'employee'): User
    {
        return User::create([
            'name' => 'User',
            'email' => $email,
            'password' => 'password123',
            'role' => $role,
            'organization_id' => $organization->id,
            'settings' => $settings,
        ]);
    }

    public function test_per_user_override_wins_over_org_default(): void
    {
        $organization = $this->makeOrganization(5);
        $user = $this->makeUser($organization, ['monitoring_interval_minutes' => 30], 'override@example.com');

        $this->assertSame(30, app(MonitoringSettingsResolver::class)->resolveForUser($user->fresh()));
    }

    public function test_missing_override_inherits_the_org_default(): void
    {
        $organization = $this->makeOrganization(15);
        $user = $this->makeUser($organization, ['can_edit_time' => true], 'inherit@example.com');

        $this->assertSame(15, app(MonitoringSettingsResolver::class)->resolveForUser($user->fresh()));
    }

    public function test_org_without_a_default_falls_through_to_the_system_default(): void
    {
        $organization = $this->makeOrganization(null);
        $user = $this->makeUser($organization, null, 'system@example.com');

        $this->assertSame(10, app(MonitoringSettingsResolver::class)->resolveForUser($user->fresh()));
    }

    public function test_invalid_per_user_value_falls_through_to_the_org_rather_than_the_system_default(): void
    {
        // 7 is not in the allow-list. It must not short-circuit past the
        // organization's policy to the system default.
        $organization = $this->makeOrganization(30);
        $user = $this->makeUser($organization, ['monitoring_interval_minutes' => 7], 'invalid@example.com');

        $this->assertSame(30, app(MonitoringSettingsResolver::class)->resolveForUser($user->fresh()));
    }

    public function test_resolved_interval_is_serialized_on_the_user_payload(): void
    {
        $organization = $this->makeOrganization(5);
        $user = $this->makeUser($organization, null, 'serialized@example.com');

        $this->getJson('/api/auth/me', $this->apiHeadersFor($user))
            ->assertOk()
            ->assertJsonPath('effective_monitoring_interval_minutes', 5);
    }

    public function test_saving_unrelated_user_settings_does_not_pin_an_inheriting_user(): void
    {
        $organization = $this->makeOrganization(5);
        $admin = $this->makeUser($organization, null, 'admin-pin@example.com', 'admin');
        $employee = $this->makeUser($organization, ['can_edit_time' => true], 'employee-pin@example.com');

        // Toggling something unrelated must not stamp the org default onto the
        // user as a hard override — that would silently decay every inheriting
        // user into a pinned one.
        $this->putJson("/api/users/{$employee->id}", [
            'name' => $employee->name,
            'email' => $employee->email,
            'role' => 'employee',
            'settings' => ['can_edit_time' => false],
        ], $this->apiHeadersFor($admin))->assertOk();

        $employee->refresh();
        $this->assertArrayNotHasKey('monitoring_interval_minutes', (array) $employee->settings);
        $this->assertSame(5, app(MonitoringSettingsResolver::class)->resolveForUser($employee));
    }

    public function test_manager_cannot_set_the_org_monitoring_default(): void
    {
        $organization = $this->makeOrganization(null);
        $manager = $this->makeUser($organization, null, 'manager-guard@example.com', 'manager');

        $this->putJson('/api/settings/organization', [
            'name' => $organization->name,
            'slug' => $organization->slug,
            'monitoring_interval_minutes' => 15,
        ], $this->apiHeadersFor($manager))->assertForbidden();

        $this->assertNull(
            app(MonitoringSettingsResolver::class)->orgDefault($organization->fresh())
        );
    }

    public function test_manager_cannot_bypass_the_guard_through_the_organization_update_endpoint(): void
    {
        $organization = $this->makeOrganization(30);
        $manager = $this->makeUser($organization, null, 'manager-backdoor@example.com', 'manager');

        $this->putJson("/api/organizations/{$organization->id}", [
            'settings' => ['monitoring' => ['interval_minutes' => 1]],
        ], $this->apiHeadersFor($manager));

        // Whatever the response, the guarded key must be untouched.
        $this->assertSame(30, app(MonitoringSettingsResolver::class)->orgDefault($organization->fresh()));
    }

    public function test_admin_can_set_and_clear_the_org_monitoring_default(): void
    {
        $organization = $this->makeOrganization(null);
        $admin = $this->makeUser($organization, null, 'admin-set@example.com', 'admin');

        $this->putJson('/api/settings/organization', [
            'name' => $organization->name,
            'slug' => $organization->slug,
            'monitoring_interval_minutes' => 15,
        ], $this->apiHeadersFor($admin))->assertOk();

        $this->assertSame(15, app(MonitoringSettingsResolver::class)->orgDefault($organization->fresh()));

        $this->putJson('/api/settings/organization', [
            'name' => $organization->name,
            'slug' => $organization->slug,
            'monitoring_interval_minutes' => null,
        ], $this->apiHeadersFor($admin))->assertOk();

        $this->assertNull(app(MonitoringSettingsResolver::class)->orgDefault($organization->fresh()));
    }
}
