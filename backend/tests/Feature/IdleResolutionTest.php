<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Idle is a signal, not an automatic deduction.
 *
 * Both Hubstaff and Time Doctor put the choice to the person and keep the
 * minutes unless told otherwise — Time Doctor is explicit that idle is never
 * subtracted from worked hours. Nothing here may move time until somebody has
 * actually answered.
 */
class IdleResolutionTest extends TestCase
{
    use RefreshDatabase;

    private array $headers = [];

    private function employee(): User
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-idle-'.uniqid(),
        ]);

        $user = User::create([
            'name' => 'Tracked Employee',
            'email' => 'idle-'.uniqid().'@carevance.test',
            'password' => bcrypt('secret-password'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $this->headers = $this->apiHeadersFor($user);

        return $user;
    }

    private function closedEntry(User $user, int $durationSeconds = 3600): TimeEntry
    {
        $start = now()->subHours(3);

        return TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => $start,
            'end_time' => $start->copy()->addSeconds($durationSeconds),
            'duration' => $durationSeconds,
            'timer_slot' => 'primary',
        ]);
    }

    private function idleRow(User $user, TimeEntry $entry, int $seconds): Activity
    {
        return Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'idle',
            'name' => 'System Idle - Active Input',
            'duration' => $seconds,
            'recorded_at' => $entry->start_time->copy()->addMinutes(20),
        ]);
    }

    public function test_keeping_idle_time_leaves_worked_hours_untouched(): void
    {
        $user = $this->employee();
        $entry = $this->closedEntry($user);
        $idle = $this->idleRow($user, $entry, 600);

        $response = $this->postJson(
            "/api/activities/{$idle->id}/resolve-idle",
            ['action' => 'kept'],
            $this->headers
        )->assertOk();

        $this->assertSame('kept', $response->json('resolution'));
        $this->assertSame(0, $response->json('seconds_removed'));
        // The person returned before any auto-stop, so the minutes were already
        // counted. "Keep" only records the answer.
        $this->assertSame(3600, (int) $entry->fresh()->duration);
        $this->assertSame('kept', $idle->fresh()->idle_resolution);
        $this->assertNotNull($idle->fresh()->idle_resolved_at);
    }

    public function test_discarding_idle_time_takes_it_back_off_the_entry(): void
    {
        $user = $this->employee();
        $entry = $this->closedEntry($user);
        $idle = $this->idleRow($user, $entry, 600);

        $response = $this->postJson(
            "/api/activities/{$idle->id}/resolve-idle",
            ['action' => 'discarded'],
            $this->headers
        )->assertOk();

        $this->assertSame('discarded', $response->json('resolution'));
        $this->assertSame(600, $response->json('seconds_removed'));
        $this->assertSame(3000, (int) $entry->fresh()->duration);
    }

    public function test_answering_twice_does_not_deduct_the_time_twice(): void
    {
        $user = $this->employee();
        $entry = $this->closedEntry($user);
        $idle = $this->idleRow($user, $entry, 600);

        $this->postJson("/api/activities/{$idle->id}/resolve-idle", ['action' => 'discarded'], $this->headers)
            ->assertOk();

        // The desktop retries when a response is lost. A second discard must
        // not remove the same ten minutes again.
        $second = $this->postJson(
            "/api/activities/{$idle->id}/resolve-idle",
            ['action' => 'discarded'],
            $this->headers
        )->assertOk();

        $this->assertSame(0, $second->json('seconds_removed'));
        $this->assertSame(3000, (int) $entry->fresh()->duration);
    }

    public function test_a_later_answer_cannot_overturn_the_first_one(): void
    {
        $user = $this->employee();
        $entry = $this->closedEntry($user);
        $idle = $this->idleRow($user, $entry, 600);

        $this->postJson("/api/activities/{$idle->id}/resolve-idle", ['action' => 'discarded'], $this->headers)
            ->assertOk();

        $response = $this->postJson(
            "/api/activities/{$idle->id}/resolve-idle",
            ['action' => 'kept'],
            $this->headers
        )->assertOk();

        // The first answer stands, and nothing is given back.
        $this->assertSame('discarded', $response->json('resolution'));
        $this->assertSame(3000, (int) $entry->fresh()->duration);
    }

    public function test_discarding_can_never_drive_a_duration_negative(): void
    {
        $user = $this->employee();
        $entry = $this->closedEntry($user, 300);
        $idle = $this->idleRow($user, $entry, 900);

        $this->postJson("/api/activities/{$idle->id}/resolve-idle", ['action' => 'discarded'], $this->headers)
            ->assertOk();

        $this->assertSame(0, (int) $entry->fresh()->duration);
    }

    public function test_a_running_timer_is_not_adjusted(): void
    {
        $user = $this->employee();

        // A live entry's duration is derived from start_time on read, so a
        // write here would be overwritten on the next tick.
        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => now()->subHour(),
            'end_time' => null,
            'duration' => 0,
            'timer_slot' => 'primary',
        ]);
        $idle = $this->idleRow($user, $entry, 600);

        $response = $this->postJson(
            "/api/activities/{$idle->id}/resolve-idle",
            ['action' => 'discarded'],
            $this->headers
        )->assertOk();

        $this->assertSame(0, $response->json('seconds_removed'));
        $this->assertSame('discarded', $idle->fresh()->idle_resolution, 'the answer is still recorded');
    }

    public function test_nobody_can_answer_for_somebody_else(): void
    {
        $owner = $this->employee();
        $entry = $this->closedEntry($owner);
        $idle = $this->idleRow($owner, $entry, 600);

        // A manager deciding on someone's behalf that they were slacking is
        // exactly the dynamic the prompt exists to remove.
        $other = $this->employee();

        $this->postJson("/api/activities/{$idle->id}/resolve-idle", ['action' => 'discarded'], $this->headers)
            ->assertForbidden();

        $this->assertNull($idle->fresh()->idle_resolution);
        $this->assertSame(3600, (int) $entry->fresh()->duration);
        $this->assertNotSame($owner->id, $other->id);
    }

    public function test_a_non_idle_activity_cannot_be_resolved(): void
    {
        $user = $this->employee();
        $entry = $this->closedEntry($user);

        $appRow = Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'app',
            'name' => 'Visual Studio Code',
            'duration' => 600,
            'recorded_at' => now()->subHour(),
        ]);

        $this->postJson("/api/activities/{$appRow->id}/resolve-idle", ['action' => 'discarded'], $this->headers)
            ->assertStatus(422);

        $this->assertSame(3600, (int) $entry->fresh()->duration);
    }

    public function test_an_unknown_action_is_rejected(): void
    {
        $user = $this->employee();
        $entry = $this->closedEntry($user);
        $idle = $this->idleRow($user, $entry, 600);

        $this->postJson("/api/activities/{$idle->id}/resolve-idle", ['action' => 'whatever'], $this->headers)
            ->assertStatus(422);

        $this->assertNull($idle->fresh()->idle_resolution);
    }
}
