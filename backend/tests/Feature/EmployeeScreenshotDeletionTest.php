<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Screenshot;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * An employee may withdraw their own screenshot — and the minutes it stood for
 * go with it.
 *
 * Without that coupling the control is unshippable: "delete my screenshot"
 * would mean "delete the proof and keep the pay", and no organization would
 * ever enable it.
 */
class EmployeeScreenshotDeletionTest extends TestCase
{
    use RefreshDatabase;

    private function organization(bool $employeeDelete, int $intervalMinutes = 10): Organization
    {
        return Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-shot-delete-'.uniqid(),
            'settings' => [
                // Deletion requires visibility, so the fixture grants both and
                // the visibility-specific cases below vary it explicitly.
                'employee_activity_visible' => true,
                'screenshot_employee_delete' => $employeeDelete,
                'monitoring' => ['interval_minutes' => $intervalMinutes],
            ],
        ]);
    }

    private function employee(Organization $organization, string $role = 'employee'): User
    {
        return User::create([
            'name' => 'Tracked Employee',
            'email' => 'shot-'.uniqid().'@carevance.test',
            'password' => bcrypt('secret-password'),
            'role' => $role,
            'organization_id' => $organization->id,
        ]);
    }

    /** A closed one-hour entry starting `$hoursAgo` back. */
    private function closedEntry(User $user, int $hoursAgo = 3): TimeEntry
    {
        $start = now()->subHours($hoursAgo);

        return TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'duration' => 3600,
            'timer_slot' => 'primary',
        ]);
    }

    private function shot(TimeEntry $entry, $capturedAt, string $filename): Screenshot
    {
        Storage::disk('screenshots')->put($filename, 'bytes');

        return Screenshot::create([
            'time_entry_id' => $entry->id,
            'filename' => $filename,
            'captured_at' => $capturedAt,
        ]);
    }

    public function test_deleting_own_screenshot_also_removes_the_time_it_covered(): void
    {
        Storage::fake('screenshots');

        $organization = $this->organization(true);
        $user = $this->employee($organization);
        $entry = $this->closedEntry($user);

        $first = $this->shot($entry, $entry->start_time->copy()->addMinutes(10), 'a.jpg');
        $second = $this->shot($entry, $entry->start_time->copy()->addMinutes(20), 'b.jpg');

        $response = $this->deleteJson("/api/screenshots/{$second->id}", [], $this->apiHeadersFor($user))
            ->assertOk();

        // Ten minutes separate it from the previous capture.
        $this->assertSame(600, $response->json('tracked_seconds_removed'));
        $this->assertSame(3600 - 600, (int) $entry->fresh()->duration);

        $this->assertNull(Screenshot::find($second->id));
        $this->assertNotNull(Screenshot::find($first->id), 'only the requested capture is removed');
        Storage::disk('screenshots')->assertMissing('b.jpg');
    }

    public function test_a_long_gap_before_a_capture_does_not_erase_the_whole_gap(): void
    {
        Storage::fake('screenshots');

        // Privacy mode skips captures over a password manager, the machine
        // sleeps, an upload fails. A three-hour hole before a capture does not
        // mean that capture stood for three hours of work.
        $organization = $this->organization(true, 10);
        $user = $this->employee($organization);

        $start = now()->subHours(6);
        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => $start,
            'end_time' => $start->copy()->addHours(5),
            'duration' => 5 * 3600,
            'timer_slot' => 'primary',
        ]);

        $this->shot($entry, $start->copy()->addMinutes(5), 'early.jpg');
        $late = $this->shot($entry, $start->copy()->addMinutes(185), 'late.jpg');

        $response = $this->deleteJson("/api/screenshots/{$late->id}", [], $this->apiHeadersFor($user))
            ->assertOk();

        // Capped at two capture intervals, not the full three-hour gap.
        $this->assertSame(1200, $response->json('tracked_seconds_removed'));
        $this->assertSame(5 * 3600 - 1200, (int) $entry->fresh()->duration);
    }

    public function test_the_first_capture_counts_from_the_start_of_the_entry(): void
    {
        Storage::fake('screenshots');

        $organization = $this->organization(true);
        $user = $this->employee($organization);
        $entry = $this->closedEntry($user);

        $only = $this->shot($entry, $entry->start_time->copy()->addMinutes(4), 'only.jpg');

        $response = $this->deleteJson("/api/screenshots/{$only->id}", [], $this->apiHeadersFor($user))
            ->assertOk();

        $this->assertSame(240, $response->json('tracked_seconds_removed'));
    }

    public function test_deletion_can_never_drive_a_duration_negative(): void
    {
        Storage::fake('screenshots');

        $organization = $this->organization(true);
        $user = $this->employee($organization);

        // A short entry whose stored duration is smaller than the span the
        // capture nominally covers. Payroll reads this column.
        $start = now()->subHours(2);
        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => $start,
            'end_time' => $start->copy()->addMinutes(2),
            'duration' => 120,
            'timer_slot' => 'primary',
        ]);

        $shot = $this->shot($entry, $start->copy()->addMinutes(9), 'short.jpg');

        $this->deleteJson("/api/screenshots/{$shot->id}", [], $this->apiHeadersFor($user))->assertOk();

        $this->assertGreaterThanOrEqual(0, (int) $entry->fresh()->duration);
        $this->assertSame(0, (int) $entry->fresh()->duration);
    }

    public function test_an_employee_cannot_delete_when_the_organization_has_not_enabled_it(): void
    {
        Storage::fake('screenshots');

        $organization = $this->organization(false);
        $user = $this->employee($organization);
        $entry = $this->closedEntry($user);
        $shot = $this->shot($entry, $entry->start_time->copy()->addMinutes(10), 'blocked.jpg');

        $this->deleteJson("/api/screenshots/{$shot->id}", [], $this->apiHeadersFor($user))
            ->assertForbidden();

        $this->assertNotNull(Screenshot::find($shot->id));
        $this->assertSame(3600, (int) $entry->fresh()->duration, 'a refused delete changes no time');
    }

    public function test_an_employee_can_never_delete_somebody_else_s_screenshot(): void
    {
        Storage::fake('screenshots');

        $organization = $this->organization(true);
        $owner = $this->employee($organization);
        $other = $this->employee($organization);

        $entry = $this->closedEntry($owner);
        $shot = $this->shot($entry, $entry->start_time->copy()->addMinutes(10), 'theirs.jpg');

        $this->deleteJson("/api/screenshots/{$shot->id}", [], $this->apiHeadersFor($other))
            ->assertForbidden();

        $this->assertNotNull(Screenshot::find($shot->id));
    }

    public function test_an_admin_deleting_on_behalf_of_the_org_does_not_alter_worked_time(): void
    {
        Storage::fake('screenshots');

        $organization = $this->organization(true);
        $admin = $this->employee($organization, 'admin');
        $employee = $this->employee($organization);

        $entry = $this->closedEntry($employee);
        $shot = $this->shot($entry, $entry->start_time->copy()->addMinutes(10), 'admin.jpg');

        $response = $this->deleteJson("/api/screenshots/{$shot->id}", [], $this->apiHeadersFor($admin))
            ->assertOk();

        // An admin removing an image for their own reasons is not the subject
        // withdrawing evidence, so nobody's timesheet moves.
        $this->assertSame(0, $response->json('tracked_seconds_removed'));
        $this->assertSame(3600, (int) $entry->fresh()->duration);
    }

    public function test_the_policy_tells_the_client_whether_deletion_is_available(): void
    {
        $enabled = $this->employee($this->organization(true));
        $disabled = $this->employee($this->organization(false));

        $this->assertTrue(
            $this->getJson('/api/auth/me', $this->apiHeadersFor($enabled))
                ->assertOk()->json('tracker_policy.can_delete_own_screenshots')
        );

        $this->assertFalse(
            $this->getJson('/api/auth/me', $this->apiHeadersFor($disabled))
                ->assertOk()->json('tracker_policy.can_delete_own_screenshots')
        );
    }

    public function test_self_view_is_refused_unless_the_organization_enables_it(): void
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-no-selfview-'.uniqid(),
            'settings' => [],
        ]);
        $employee = $this->employee($organization);

        // Hiding a menu item is not access control; the API has to refuse too.
        $this->getJson('/api/screenshots', $this->apiHeadersFor($employee))->assertForbidden();

        $policy = $this->getJson('/api/auth/me', $this->apiHeadersFor($employee))
            ->assertOk()->json('tracker_policy');
        $this->assertFalse($policy['can_view_own_activity']);
        $this->assertFalse($policy['can_delete_own_screenshots']);
    }

    public function test_self_view_is_allowed_once_the_organization_enables_it(): void
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-selfview-'.uniqid(),
            'settings' => ['employee_activity_visible' => true],
        ]);
        $employee = $this->employee($organization);

        $this->getJson('/api/screenshots', $this->apiHeadersFor($employee))->assertOk();

        $policy = $this->getJson('/api/auth/me', $this->apiHeadersFor($employee))
            ->assertOk()->json('tracker_policy');
        $this->assertTrue($policy['can_view_own_activity']);
        // Visible, but not deletable — that is a second, separate opt-in.
        $this->assertFalse($policy['can_delete_own_screenshots']);
    }

    public function test_deletion_cannot_be_enabled_without_visibility(): void
    {
        Storage::fake('screenshots');

        // A record somebody was never shown must not be destroyable by them.
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-delete-no-view-'.uniqid(),
            'settings' => [
                'employee_activity_visible' => false,
                'screenshot_employee_delete' => true,
            ],
        ]);
        $employee = $this->employee($organization);
        $entry = $this->closedEntry($employee);
        $shot = $this->shot($entry, $entry->start_time->copy()->addMinutes(10), 'orphan.jpg');

        $this->deleteJson("/api/screenshots/{$shot->id}", [], $this->apiHeadersFor($employee))
            ->assertForbidden();

        $this->assertNotNull(Screenshot::find($shot->id));
    }

    public function test_a_supervisor_still_sees_the_console_regardless_of_the_toggle(): void
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-admin-view-'.uniqid(),
            'settings' => ['employee_activity_visible' => false],
        ]);
        $admin = $this->employee($organization, 'admin');

        // The org toggle governs whether the SUBJECT sees their record; it must
        // never switch off the monitoring console itself.
        $this->getJson('/api/screenshots', $this->apiHeadersFor($admin))->assertOk();
    }
}
