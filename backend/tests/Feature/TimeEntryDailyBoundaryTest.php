<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class TimeEntryDailyBoundaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_active_endpoint_closes_previous_day_primary_timer_at_today_boundary(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-04-21 10:33:00'));

        try {
            [$user, $headers] = $this->createAuthenticatedEmployee();

            $entry = TimeEntry::create([
                'user_id' => $user->id,
                'start_time' => '2026-04-20 18:20:00',
                'end_time' => null,
                'duration' => 0,
                'billable' => true,
                'timer_slot' => 'primary',
            ]);

            $this->getJson('/api/time-entries/active?timer_slot=primary', $headers)
                ->assertOk()
                ->assertContent('{}');

            $entry->refresh();
            $this->assertNotNull($entry->end_time);
            $this->assertSame('2026-04-21T00:00:00+00:00', $entry->end_time?->toIso8601String());
            $this->assertSame(20400, (int) $entry->duration);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_dashboard_summary_does_not_carry_previous_day_open_timer_into_new_day(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-04-21 10:33:00'));

        try {
            [$user, $headers] = $this->createAuthenticatedEmployee();

            $entry = TimeEntry::create([
                'user_id' => $user->id,
                'start_time' => '2026-04-20 18:20:00',
                'end_time' => null,
                'duration' => 0,
                'billable' => true,
                'timer_slot' => 'primary',
            ]);

            $this->getJson('/api/dashboard', $headers)
                ->assertOk()
                ->assertJsonPath('active_timer', null)
                ->assertJsonPath('today_total_elapsed_duration', 0)
                ->assertJsonPath('today_entries', []);

            $entry->refresh();
            $this->assertNotNull($entry->end_time);
            $this->assertSame('2026-04-21T00:00:00+00:00', $entry->end_time?->toIso8601String());
            $this->assertSame(20400, (int) $entry->duration);
        } finally {
            Carbon::setTestNow();
        }
    }

    private function createAuthenticatedEmployee(): array
    {
        $organization = Organization::create([
            'name' => 'CareVance Org',
            'slug' => 'carevance-org',
        ]);

        $user = User::create([
            'name' => 'Employee',
            'email' => 'employee@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        return [$user, $this->apiHeadersFor($user)];
    }
}
