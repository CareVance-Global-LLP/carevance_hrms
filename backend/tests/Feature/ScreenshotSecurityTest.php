<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Group;
use App\Models\Screenshot;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ScreenshotSecurityTest extends TestCase
{
    use RefreshDatabase;

    public function test_screenshot_path_uses_configured_ttl_minutes(): void
    {
        try {
            Carbon::setTestNow(Carbon::parse('2026-04-02 11:00:00'));
            config()->set('screenshots.url_ttl_minutes', 12);

            $organization = Organization::create([
                'name' => 'CareVance',
                'slug' => 'carevance',
            ]);

            $user = User::create([
                'name' => 'Employee User',
                'email' => 'employee-ttl@example.com',
                'password' => 'password123',
                'role' => 'employee',
                'organization_id' => $organization->id,
            ]);

            $timeEntry = TimeEntry::create([
                'user_id' => $user->id,
                'start_time' => now()->subHour(),
                'end_time' => now(),
                'duration' => 3600,
                'billable' => true,
            ]);

            $screenshot = Screenshot::create([
                'time_entry_id' => $timeEntry->id,
                'filename' => 'ttl-check.png',
            ]);

            $query = [];
            parse_str((string) parse_url($screenshot->path, PHP_URL_QUERY), $query);

            $this->assertSame(now()->addMinutes(12)->timestamp, (int) ($query['expires'] ?? 0));
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_screenshot_path_uses_current_request_host_even_when_app_url_is_different(): void
    {
        Storage::fake('screenshots');
        config()->set('app.url', 'https://wrong-host.invalid');

        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        $user = User::create([
            'name' => 'Employee User',
            'email' => 'employee-host@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $timeEntry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => now()->subHour(),
            'end_time' => now(),
            'duration' => 3600,
            'billable' => true,
        ]);

        $response = $this->post('/api/screenshots', [
            'time_entry_id' => $timeEntry->id,
            'image' => UploadedFile::fake()->create('capture.png', 64, 'image/png'),
        ], $this->apiHeadersFor($user));

        $response->assertCreated();
        $this->assertStringContainsString('http://localhost:8000/api/screenshots/', (string) $response->json('path'));
        $this->assertStringNotContainsString('wrong-host.invalid', (string) $response->json('path'));
    }

    public function test_expired_signed_screenshot_url_returns_helpful_forbidden_message(): void
    {
        Storage::fake('screenshots');

        try {
            Carbon::setTestNow(Carbon::parse('2026-04-02 11:00:00'));
            config()->set('screenshots.url_ttl_minutes', 1);

            $organization = Organization::create([
                'name' => 'CareVance',
                'slug' => 'carevance',
            ]);

            $user = User::create([
                'name' => 'Employee User',
                'email' => 'employee-expired-link@example.com',
                'password' => 'password123',
                'role' => 'employee',
                'organization_id' => $organization->id,
            ]);

            $timeEntry = TimeEntry::create([
                'user_id' => $user->id,
                'start_time' => now()->subHour(),
                'end_time' => now(),
                'duration' => 3600,
                'billable' => true,
            ]);

            $screenshot = Screenshot::create([
                'time_entry_id' => $timeEntry->id,
                'filename' => 'expired-link.png',
            ]);

            Storage::disk('screenshots')->put('expired-link.png', 'fake-image-content');

            $signedUrl = $screenshot->path;

            Carbon::setTestNow(now()->addMinutes(2));

            $this->get($signedUrl)
                ->assertForbidden()
                ->assertJsonPath('message', 'Screenshot link expired. Refresh screenshots and try again.')
                ->assertJsonPath('error_code', 'FORBIDDEN');
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_screenshot_paths_are_signed_and_files_are_not_written_to_public_disk(): void
    {
        Storage::fake('screenshots');
        Storage::fake('public');

        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        $user = User::create([
            'name' => 'Employee User',
            'email' => 'employee@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $timeEntry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => now()->subHour(),
            'end_time' => now(),
            'duration' => 3600,
            'billable' => true,
        ]);

        $response = $this->post('/api/screenshots', [
            'time_entry_id' => $timeEntry->id,
            'image' => UploadedFile::fake()->create('capture.png', 64, 'image/png'),
        ], $this->apiHeadersFor($user));

        $response->assertCreated();

        $screenshot = Screenshot::query()->latest('id')->firstOrFail();
        $signedUrl = (string) $response->json('path');

        Storage::disk('screenshots')->assertExists($screenshot->filename);
        Storage::disk('public')->assertMissing('screenshots/'.$screenshot->filename);
        $this->assertStringContainsString('/api/screenshots/'.$screenshot->id.'/file', $signedUrl);
        $this->assertStringContainsString('signature=', $signedUrl);

        $this->get($signedUrl)->assertOk();
    }

    public function test_desktop_style_png_upload_with_generic_client_mime_is_still_accepted(): void
    {
        Storage::fake('screenshots');

        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        $user = User::create([
            'name' => 'Employee User',
            'email' => 'employee-generic-mime@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $timeEntry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => now()->subHour(),
            'end_time' => now(),
            'duration' => 3600,
            'billable' => true,
        ]);

        $response = $this->post('/api/screenshots', [
            'time_entry_id' => $timeEntry->id,
            'image' => UploadedFile::fake()->create('capture.png', 64, 'application/octet-stream'),
        ], $this->apiHeadersFor($user));

        $response->assertCreated();

        $screenshot = Screenshot::query()->latest('id')->firstOrFail();
        Storage::disk('screenshots')->assertExists($screenshot->filename);
    }

    public function test_desktop_screenshot_data_url_upload_is_accepted(): void
    {
        Storage::fake('screenshots');

        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        $user = User::create([
            'name' => 'Employee User',
            'email' => 'employee-data-url@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $timeEntry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => now()->subHour(),
            'end_time' => now(),
            'duration' => 3600,
            'billable' => true,
        ]);

        $response = $this->postJson('/api/screenshots', [
            'time_entry_id' => $timeEntry->id,
            'filename' => 'capture.png',
            'image_data_url' => 'data:image/png;base64,'.base64_encode('fake-image-content'),
        ], $this->apiHeadersFor($user));

        $response->assertCreated();

        $screenshot = Screenshot::query()->latest('id')->firstOrFail();
        Storage::disk('screenshots')->assertExists($screenshot->filename);
    }

    public function test_desktop_screenshot_jpeg_data_url_upload_is_accepted(): void
    {
        Storage::fake('screenshots');

        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        $user = User::create([
            'name' => 'Employee User',
            'email' => 'employee-data-url-jpeg@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $timeEntry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => now()->subHour(),
            'end_time' => now(),
            'duration' => 3600,
            'billable' => true,
        ]);

        $response = $this->postJson('/api/screenshots', [
            'time_entry_id' => $timeEntry->id,
            'filename' => 'capture.jpg',
            'image_data_url' => 'data:image/jpeg;base64,'.base64_encode('fake-jpeg-content'),
        ], $this->apiHeadersFor($user));

        $response->assertCreated();

        $screenshot = Screenshot::query()->latest('id')->firstOrFail();
        Storage::disk('screenshots')->assertExists($screenshot->filename);
        $this->assertStringEndsWith('.jpg', (string) $screenshot->filename);
    }

    public function test_admin_screenshot_index_filters_by_employee_and_date_range(): void
    {
        try {
            Carbon::setTestNow(Carbon::parse('2026-03-16 09:00:00'));

            $organization = Organization::create([
                'name' => 'CareVance',
                'slug' => 'carevance',
            ]);

            $admin = User::create([
                'name' => 'Admin User',
                'email' => 'admin@example.com',
                'password' => 'password123',
                'role' => 'admin',
                'organization_id' => $organization->id,
            ]);

            $employee = User::create([
                'name' => 'Employee User',
                'email' => 'employee@example.com',
                'password' => 'password123',
                'role' => 'employee',
                'organization_id' => $organization->id,
            ]);

            $anotherEmployee = User::create([
                'name' => 'Another Employee',
                'email' => 'another@example.com',
                'password' => 'password123',
                'role' => 'employee',
                'organization_id' => $organization->id,
            ]);

            $matchingEntry = TimeEntry::create([
                'user_id' => $employee->id,
                'start_time' => '2026-03-16 09:00:00',
                'end_time' => '2026-03-16 10:00:00',
                'duration' => 3600,
                'billable' => true,
            ]);

            $olderEntry = TimeEntry::create([
                'user_id' => $employee->id,
                'start_time' => '2026-03-10 09:00:00',
                'end_time' => '2026-03-10 10:00:00',
                'duration' => 3600,
                'billable' => true,
            ]);

            $otherUserEntry = TimeEntry::create([
                'user_id' => $anotherEmployee->id,
                'start_time' => '2026-03-16 09:00:00',
                'end_time' => '2026-03-16 10:00:00',
                'duration' => 3600,
                'billable' => true,
            ]);

            Carbon::setTestNow(Carbon::parse('2026-03-16 09:30:00'));
            $matchingScreenshot = Screenshot::create([
                'time_entry_id' => $matchingEntry->id,
                'filename' => 'matching.png',
            ]);

            Carbon::setTestNow(Carbon::parse('2026-03-10 09:30:00'));
            Screenshot::create([
                'time_entry_id' => $olderEntry->id,
                'filename' => 'older.png',
            ]);

            Carbon::setTestNow(Carbon::parse('2026-03-16 09:45:00'));
            Screenshot::create([
                'time_entry_id' => $otherUserEntry->id,
                'filename' => 'other-user.png',
            ]);

            $this->getJson(
                "/api/screenshots?user_id={$employee->id}&start_date=2026-03-16&end_date=2026-03-16&per_page=8",
                $this->apiHeadersFor($admin)
            )
                ->assertOk()
                ->assertJsonPath('total', 1)
                ->assertJsonCount(1, 'data')
                ->assertJsonPath('data.0.id', $matchingScreenshot->id)
                ->assertJsonPath('data.0.time_entry_id', $matchingEntry->id)
                ->assertJsonPath('data.0.user_id', $employee->id)
                ->assertJsonPath('data.0.user.name', $employee->name)
                ->assertJsonPath('data.0.user.email', $employee->email)
                ->assertJsonPath('data.0.user.role', $employee->role);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_admin_can_bulk_delete_selected_screenshots(): void
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        $admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin@example.com',
            'password' => 'password123',
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $employee = User::create([
            'name' => 'Employee User',
            'email' => 'employee@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $timeEntry = TimeEntry::create([
            'user_id' => $employee->id,
            'start_time' => '2026-03-16 09:00:00',
            'end_time' => '2026-03-16 10:00:00',
            'duration' => 3600,
            'billable' => true,
        ]);

        $first = Screenshot::create([
            'time_entry_id' => $timeEntry->id,
            'filename' => 'selected-1.png',
        ]);
        $second = Screenshot::create([
            'time_entry_id' => $timeEntry->id,
            'filename' => 'selected-2.png',
        ]);
        $remaining = Screenshot::create([
            'time_entry_id' => $timeEntry->id,
            'filename' => 'remaining.png',
        ]);

        $this->postJson('/api/screenshots/bulk-delete', [
            'screenshot_ids' => [$first->id, $second->id],
        ], $this->apiHeadersFor($admin))
            ->assertOk()
            ->assertJsonPath('deleted_count', 2);

        $this->assertDatabaseMissing('screenshots', ['id' => $first->id]);
        $this->assertDatabaseMissing('screenshots', ['id' => $second->id]);
        $this->assertDatabaseHas('screenshots', ['id' => $remaining->id]);
    }

    public function test_admin_can_bulk_delete_all_screenshots_in_employee_date_range(): void
    {
        try {
            Carbon::setTestNow(Carbon::parse('2026-03-16 09:00:00'));

            $organization = Organization::create([
                'name' => 'CareVance',
                'slug' => 'carevance',
            ]);

            $admin = User::create([
                'name' => 'Admin User',
                'email' => 'admin@example.com',
                'password' => 'password123',
                'role' => 'admin',
                'organization_id' => $organization->id,
            ]);

            $employee = User::create([
                'name' => 'Employee User',
                'email' => 'employee@example.com',
                'password' => 'password123',
                'role' => 'employee',
                'organization_id' => $organization->id,
            ]);

            $anotherEmployee = User::create([
                'name' => 'Another Employee',
                'email' => 'another@example.com',
                'password' => 'password123',
                'role' => 'employee',
                'organization_id' => $organization->id,
            ]);

            $matchingEntry = TimeEntry::create([
                'user_id' => $employee->id,
                'start_time' => '2026-03-16 09:00:00',
                'end_time' => '2026-03-16 10:00:00',
                'duration' => 3600,
                'billable' => true,
            ]);

            $olderEntry = TimeEntry::create([
                'user_id' => $employee->id,
                'start_time' => '2026-03-10 09:00:00',
                'end_time' => '2026-03-10 10:00:00',
                'duration' => 3600,
                'billable' => true,
            ]);

            $otherUserEntry = TimeEntry::create([
                'user_id' => $anotherEmployee->id,
                'start_time' => '2026-03-16 09:00:00',
                'end_time' => '2026-03-16 10:00:00',
                'duration' => 3600,
                'billable' => true,
            ]);

            Carbon::setTestNow(Carbon::parse('2026-03-16 09:30:00'));
            $matchingOne = Screenshot::create([
                'time_entry_id' => $matchingEntry->id,
                'filename' => 'matching-one.png',
            ]);
            $matchingTwo = Screenshot::create([
                'time_entry_id' => $matchingEntry->id,
                'filename' => 'matching-two.png',
            ]);

            Carbon::setTestNow(Carbon::parse('2026-03-10 09:30:00'));
            $olderScreenshot = Screenshot::create([
                'time_entry_id' => $olderEntry->id,
                'filename' => 'older.png',
            ]);

            Carbon::setTestNow(Carbon::parse('2026-03-16 09:45:00'));
            $otherUserScreenshot = Screenshot::create([
                'time_entry_id' => $otherUserEntry->id,
                'filename' => 'other-user.png',
            ]);

            $this->postJson('/api/screenshots/bulk-delete', [
                'delete_all_in_range' => true,
                'user_id' => $employee->id,
                'start_date' => '2026-03-16',
                'end_date' => '2026-03-16',
            ], $this->apiHeadersFor($admin))
                ->assertOk()
                ->assertJsonPath('deleted_count', 2);

            $this->assertDatabaseMissing('screenshots', ['id' => $matchingOne->id]);
            $this->assertDatabaseMissing('screenshots', ['id' => $matchingTwo->id]);
            $this->assertDatabaseHas('screenshots', ['id' => $olderScreenshot->id]);
            $this->assertDatabaseHas('screenshots', ['id' => $otherUserScreenshot->id]);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_manager_cannot_bulk_delete_screenshots(): void
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        $manager = User::create([
            'name' => 'Manager User',
            'email' => 'manager-delete@example.com',
            'password' => 'password123',
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);

        $employee = User::create([
            'name' => 'Employee User',
            'email' => 'employee-delete@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $timeEntry = TimeEntry::create([
            'user_id' => $employee->id,
            'start_time' => '2026-03-16 09:00:00',
            'end_time' => '2026-03-16 10:00:00',
            'duration' => 3600,
            'billable' => true,
        ]);

        $screenshot = Screenshot::create([
            'time_entry_id' => $timeEntry->id,
            'filename' => 'manager-cannot-bulk-delete.png',
        ]);

        $this->postJson('/api/screenshots/bulk-delete', [
            'screenshot_ids' => [$screenshot->id],
        ], $this->apiHeadersFor($manager))
            ->assertForbidden();

        $this->assertDatabaseHas('screenshots', ['id' => $screenshot->id]);
    }

    public function test_manager_cannot_delete_individual_screenshot(): void
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        $manager = User::create([
            'name' => 'Manager User',
            'email' => 'manager-delete-single@example.com',
            'password' => 'password123',
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);

        $employee = User::create([
            'name' => 'Employee User',
            'email' => 'employee-delete-single@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $timeEntry = TimeEntry::create([
            'user_id' => $employee->id,
            'start_time' => '2026-03-16 09:00:00',
            'end_time' => '2026-03-16 10:00:00',
            'duration' => 3600,
            'billable' => true,
        ]);

        $screenshot = Screenshot::create([
            'time_entry_id' => $timeEntry->id,
            'filename' => 'manager-cannot-delete.png',
        ]);

        $this->deleteJson("/api/screenshots/{$screenshot->id}", [], $this->apiHeadersFor($manager))
            ->assertForbidden();

        $this->assertDatabaseHas('screenshots', ['id' => $screenshot->id]);
    }

    public function test_manager_screenshot_index_only_returns_employee_screenshots(): void
    {
        try {
            Carbon::setTestNow(Carbon::parse('2026-03-16 09:00:00'));

            $organization = Organization::create([
                'name' => 'CareVance',
                'slug' => 'carevance',
            ]);

            $manager = User::create([
                'name' => 'Manager User',
                'email' => 'manager@example.com',
                'password' => 'password123',
                'role' => 'manager',
                'organization_id' => $organization->id,
            ]);

            $primaryGroup = Group::create([
                'name' => 'Primary Group',
                'slug' => 'primary-group',
                'organization_id' => $organization->id,
            ]);

            $otherGroup = Group::create([
                'name' => 'Other Group',
                'slug' => 'other-group',
                'organization_id' => $organization->id,
            ]);

            $manager->groups()->attach($primaryGroup->id);

            $employee = User::create([
                'name' => 'Employee User',
                'email' => 'employee@example.com',
                'password' => 'password123',
                'role' => 'employee',
                'organization_id' => $organization->id,
            ]);
            $employee->groups()->attach($primaryGroup->id);

            $otherEmployee = User::create([
                'name' => 'Other Employee',
                'email' => 'other-employee@example.com',
                'password' => 'password123',
                'role' => 'employee',
                'organization_id' => $organization->id,
            ]);
            $otherEmployee->groups()->attach($otherGroup->id);

            $anotherManager = User::create([
                'name' => 'Another Manager',
                'email' => 'another-manager@example.com',
                'password' => 'password123',
                'role' => 'manager',
                'organization_id' => $organization->id,
            ]);

            $employeeEntry = TimeEntry::create([
                'user_id' => $employee->id,
                'start_time' => '2026-03-16 09:00:00',
                'end_time' => '2026-03-16 10:00:00',
                'duration' => 3600,
                'billable' => true,
            ]);

            $otherEmployeeEntry = TimeEntry::create([
                'user_id' => $otherEmployee->id,
                'start_time' => '2026-03-16 09:00:00',
                'end_time' => '2026-03-16 10:00:00',
                'duration' => 3600,
                'billable' => true,
            ]);

            $managerEntry = TimeEntry::create([
                'user_id' => $anotherManager->id,
                'start_time' => '2026-03-16 09:00:00',
                'end_time' => '2026-03-16 10:00:00',
                'duration' => 3600,
                'billable' => true,
            ]);

            $employeeScreenshot = Screenshot::create([
                'time_entry_id' => $employeeEntry->id,
                'filename' => 'employee.png',
            ]);

            Screenshot::create([
                'time_entry_id' => $managerEntry->id,
                'filename' => 'manager.png',
            ]);

            Screenshot::create([
                'time_entry_id' => $otherEmployeeEntry->id,
                'filename' => 'other-employee.png',
            ]);

            $this->getJson('/api/screenshots?start_date=2026-03-16&end_date=2026-03-16', $this->apiHeadersFor($manager))
                ->assertOk()
                ->assertJsonPath('total', 1)
                ->assertJsonCount(1, 'data')
                ->assertJsonPath('data.0.id', $employeeScreenshot->id)
                ->assertJsonPath('data.0.user.role', 'employee');
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_manager_cannot_open_other_group_employee_screenshot_directly(): void
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        $manager = User::create([
            'name' => 'Manager User',
            'email' => 'manager-group-scope@example.com',
            'password' => 'password123',
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);

        $managerGroup = Group::create([
            'name' => 'Manager Group',
            'slug' => 'manager-group',
            'organization_id' => $organization->id,
        ]);

        $otherGroup = Group::create([
            'name' => 'Other Group',
            'slug' => 'other-group-access',
            'organization_id' => $organization->id,
        ]);

        $manager->groups()->attach($managerGroup->id);

        $otherEmployee = User::create([
            'name' => 'Other Employee',
            'email' => 'other-group-employee@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);
        $otherEmployee->groups()->attach($otherGroup->id);

        $timeEntry = TimeEntry::create([
            'user_id' => $otherEmployee->id,
            'start_time' => now()->subHour(),
            'end_time' => now(),
            'duration' => 3600,
            'billable' => true,
        ]);

        $screenshot = Screenshot::create([
            'time_entry_id' => $timeEntry->id,
            'filename' => 'other-group-employee.png',
        ]);

        $this->getJson("/api/screenshots/{$screenshot->id}", $this->apiHeadersFor($manager))
            ->assertForbidden();
    }

    public function test_manager_cannot_open_manager_screenshot_directly_but_admin_can(): void
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        $admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin-direct@example.com',
            'password' => 'password123',
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $managerViewer = User::create([
            'name' => 'Manager Viewer',
            'email' => 'manager-viewer@example.com',
            'password' => 'password123',
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);

        $managerOwner = User::create([
            'name' => 'Manager Owner',
            'email' => 'manager-owner@example.com',
            'password' => 'password123',
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);

        $timeEntry = TimeEntry::create([
            'user_id' => $managerOwner->id,
            'start_time' => now()->subHour(),
            'end_time' => now(),
            'duration' => 3600,
            'billable' => true,
        ]);

        $screenshot = Screenshot::create([
            'time_entry_id' => $timeEntry->id,
            'filename' => 'manager-direct.png',
        ]);

        $this->getJson("/api/screenshots/{$screenshot->id}", $this->apiHeadersFor($managerViewer))
            ->assertForbidden();

        $this->getJson("/api/screenshots/{$screenshot->id}", $this->apiHeadersFor($admin))
            ->assertOk()
            ->assertJsonPath('id', $screenshot->id)
            ->assertJsonPath('user.role', 'manager');
    }
}
