<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\BreakTime;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class BreakTimeEntryTest extends TestCase
{
    use RefreshDatabase;

    private function makeUser(): User
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        return User::create([
            'name' => 'Employee',
            'email' => 'employee@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);
    }

    public function test_starting_and_ending_a_break_creates_an_is_break_time_entry(): void
    {
        $user = $this->makeUser();
        $headers = $this->apiHeadersFor($user);

        // Start a work timer first.
        $this->postJson('/api/time-entries/start', ['timer_slot' => 'primary'], $headers)->assertCreated();

        // Start a break.
        $this->postJson('/api/breaks/start', [], $headers)->assertCreated();
        $this->assertDatabaseHas('break_times', ['user_id' => $user->id, 'end_at' => null]);

        $breakEntry = TimeEntry::where('user_id', $user->id)
            ->where('is_break', true)
            ->whereNull('end_time')
            ->first();
        $this->assertNotNull($breakEntry, 'An open is_break TimeEntry should be created on break start');
        $this->assertEquals('break', $breakEntry->timer_slot);

        // Work timer should be paused (primary entry closed).
        $this->assertDatabaseHas('time_entries', [
            'user_id' => $user->id,
            'timer_slot' => 'primary',
        ]);
        $primaryClosed = TimeEntry::where('user_id', $user->id)
            ->where('timer_slot', 'primary')
            ->whereNotNull('end_time')
            ->exists();
        $this->assertTrue($primaryClosed, 'The primary work timer should be stopped when a break starts');

        // End the break.
        $this->postJson('/api/breaks/end', [], $headers)->assertOk();

        $closedBreakEntry = TimeEntry::where('user_id', $user->id)
            ->where('is_break', true)
            ->whereNotNull('end_time')
            ->first();
        $this->assertNotNull($closedBreakEntry, 'The is_break TimeEntry should be closed on break end');
        $this->assertGreaterThanOrEqual(0, (int) $closedBreakEntry->duration);

        $break = BreakTime::where('user_id', $user->id)->first();
        $this->assertNotNull($break->end_at);
        $this->assertGreaterThanOrEqual(0, (int) $break->duration_seconds);
    }

    public function test_attendance_break_seconds_are_derived_from_is_break_entries(): void
    {
        $user = $this->makeUser();
        $headers = $this->apiHeadersFor($user);

        $record = AttendanceRecord::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'attendance_date' => now()->toDateString(),
            'status' => 'present',
            'worked_seconds' => 3600,
        ]);

        // Seed an is_break TimeEntry for today.
        TimeEntry::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'timer_slot' => 'break',
            'start_time' => now()->subMinutes(20),
            'end_time' => now()->subMinutes(5),
            'duration' => 900,
            'is_break' => true,
            'description' => 'Break',
        ]);

        $response = $this->getJson('/api/attendance/today', $headers)->assertOk();
        $response->assertJsonPath('record.total_break_seconds', 900);
    }
}
