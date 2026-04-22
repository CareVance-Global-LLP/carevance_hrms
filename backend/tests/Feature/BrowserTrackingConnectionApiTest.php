<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class BrowserTrackingConnectionApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_employee_can_sync_connected_browser_tracking_health(): void
    {
        [$admin, $employee, $headers] = $this->createAdminAndEmployee();

        $this->postJson('/api/browser-tracking/connections/sync', [
            'device_id' => 'desktop-alpha',
            'device_label' => 'DESKTOP-ALPHA',
            'ready' => true,
            'last_error' => null,
            'last_event_at' => '2026-04-21T11:28:54Z',
            'connections' => [[
                'browser_name' => 'chrome',
                'profile_key' => 'profile-a',
                'extension_version' => '0.1.0',
                'paired_at' => '2026-04-21T11:20:00Z',
                'last_seen_at' => '2026-04-21T11:28:54Z',
            ]],
        ], $headers)
            ->assertOk()
            ->assertJsonPath('data.0.status', 'connected')
            ->assertJsonPath('data.0.browser_name', 'chrome')
            ->assertJsonPath('data.0.browser_profile_key', 'profile-a');

        $this->assertDatabaseHas('browser_tracking_connections', [
            'organization_id' => $employee->organization_id,
            'user_id' => $employee->id,
            'device_id' => 'desktop-alpha',
            'browser_name' => 'chrome',
            'browser_profile_key' => 'profile-a',
            'status' => 'connected',
        ]);
    }

    public function test_sync_marks_known_connections_disconnected_and_notifies_admin_only_once(): void
    {
        [$admin, $employee, $headers] = $this->createAdminAndEmployee();

        $this->postJson('/api/browser-tracking/connections/sync', [
            'device_id' => 'desktop-alpha',
            'device_label' => 'DESKTOP-ALPHA',
            'ready' => true,
            'last_error' => null,
            'last_event_at' => '2026-04-21T11:28:54Z',
            'connections' => [[
                'browser_name' => 'chrome',
                'profile_key' => 'profile-a',
                'extension_version' => '0.1.0',
                'paired_at' => '2026-04-21T11:20:00Z',
                'last_seen_at' => '2026-04-21T11:28:54Z',
            ]],
        ], $headers)->assertOk();

        $disconnectPayload = [
            'device_id' => 'desktop-alpha',
            'device_label' => 'DESKTOP-ALPHA',
            'ready' => true,
            'last_error' => null,
            'last_event_at' => '2026-04-21T11:29:40Z',
            'connections' => [],
        ];

        $this->postJson('/api/browser-tracking/connections/sync', $disconnectPayload, $headers)
            ->assertOk()
            ->assertJsonPath('data.0.status', 'disconnected');

        $this->postJson('/api/browser-tracking/connections/sync', $disconnectPayload, $headers)
            ->assertOk()
            ->assertJsonPath('data.0.status', 'disconnected');

        $this->assertDatabaseHas('browser_tracking_connections', [
            'organization_id' => $employee->organization_id,
            'user_id' => $employee->id,
            'device_id' => 'desktop-alpha',
            'browser_name' => 'chrome',
            'browser_profile_key' => 'profile-a',
            'status' => 'disconnected',
            'disconnect_reason' => 'extension_missing',
        ]);

        $notifications = AppNotification::query()
            ->where('organization_id', $admin->organization_id)
            ->where('user_id', $admin->id)
            ->where('type', 'browser_tracking_disconnected')
            ->get();

        $this->assertCount(1, $notifications);
        $this->assertSame('Browser Tracking Disconnected', $notifications->first()?->title);
    }

    private function createAdminAndEmployee(): array
    {
        $organization = Organization::create([
            'name' => 'CareVance Org',
            'slug' => 'carevance-org',
        ]);

        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin.browser-tracking@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee.browser-tracking@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        return [$admin, $employee, $this->apiHeadersFor($employee)];
    }
}
