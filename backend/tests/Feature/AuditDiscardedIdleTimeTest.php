<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The audit has to separate three claims, because they license different acts.
 *
 * Giving somebody back time they did not work is as wrong as taking time they
 * did, so a span with no evidence either way must be reported and left alone
 * rather than folded into the recoverable total. That is the assertion this
 * class exists for: UNPROVEN is not a rounding error, it is a refusal.
 */
class AuditDiscardedIdleTimeTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $organization = Organization::create(['name' => 'Org Audit', 'slug' => 'org-audit']);

        $this->user = User::create([
            'name' => 'Tracked Employee',
            'email' => 'audit-idle@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        Auth::setUser($this->user);
    }

    private function entry(array $attributes): TimeEntry
    {
        return TimeEntry::create(array_merge([
            'user_id' => $this->user->id,
            'organization_id' => $this->user->organization_id,
            'timer_slot' => 'primary',
            'billable' => true,
            'auto_stopped_for_idle' => true,
        ], $attributes));
    }

    public function test_it_separates_impossible_contradicted_and_unproven_discards(): void
    {
        // IMPOSSIBLE: declared idle at the very moment it started. This is the
        // production signature -- nothing billed, the whole span discarded.
        $this->entry([
            'start_time' => now()->subHours(5),
            'end_time' => now()->subHours(5),
            'last_activity_at' => now()->subHours(5),
            'duration' => 0,
            'trailing_idle_seconds' => 600,
        ]);

        // CONTRADICTED: the entry was rewound to 4 hours ago and 900 seconds
        // discarded after it -- but a real app activity sits inside that window.
        $contradicted = $this->entry([
            'start_time' => now()->subHours(5),
            'end_time' => now()->subHours(4),
            'last_activity_at' => now()->subHours(4),
            'duration' => 3600,
            'trailing_idle_seconds' => 900,
        ]);

        Activity::create([
            'user_id' => $this->user->id,
            'time_entry_id' => $contradicted->id,
            'type' => 'app',
            'name' => 'Visual Studio Code',
            'duration' => 60,
            'recorded_at' => now()->subHours(4)->addMinutes(5),
        ]);

        // UNPROVEN: an ordinary absence. Nothing corroborates it either way, so
        // it must be reported and must NOT be counted as recoverable.
        $unproven = $this->entry([
            'start_time' => now()->subHours(3),
            'end_time' => now()->subHours(2),
            'last_activity_at' => now()->subHours(2),
            'duration' => 3600,
            'trailing_idle_seconds' => 1200,
        ]);

        // An idle row inside the window is not evidence of work -- it is the
        // record of the absence itself, and must not flip the verdict.
        Activity::create([
            'user_id' => $this->user->id,
            'time_entry_id' => $unproven->id,
            'type' => 'idle',
            'name' => 'System Idle',
            'duration' => 1200,
            'recorded_at' => now()->subHours(2)->addMinutes(3),
        ]);

        $this->artisan('timers:audit-discarded-idle', ['--days' => 7])
            ->expectsOutputToContain('entries examined       3')
            // 600 + 900 + 1200 = 2700s
            ->expectsOutputToContain('total discarded        0h 45m')
            ->expectsOutputToContain('provably impossible    0h 10m')
            ->expectsOutputToContain('contradicted by work   0h 15m')
            ->expectsOutputToContain('unproven (left alone)  0h 20m')
            ->expectsOutputToContain('RECOVERABLE            0h 25m   across 2 entries')
            ->assertExitCode(0);
    }

    public function test_it_changes_nothing(): void
    {
        $entry = $this->entry([
            'start_time' => now()->subHours(2),
            'end_time' => now()->subHours(2),
            'last_activity_at' => now()->subHours(2),
            'duration' => 0,
            'trailing_idle_seconds' => 900,
        ]);

        $before = $entry->fresh()->toArray();

        $this->artisan('timers:audit-discarded-idle', ['--days' => 7])->assertExitCode(0);

        $this->assertSame(
            $before,
            $entry->fresh()->toArray(),
            'The audit is read-only and must not touch the row it reports on'
        );
    }
}
