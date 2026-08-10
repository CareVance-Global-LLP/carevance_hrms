<?php

namespace Tests\Feature;

use App\Models\BreakType;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Reports\WorkedTimeService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class BreakTypesTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'Org', 'slug' => 'org-break-types']);
    }

    private function makeUser(string $email, string $role = 'employee'): User
    {
        return User::create([
            'name' => ucfirst($role),
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $this->organization->id,
        ]);
    }

    public function test_types_endpoint_seeds_defaults_on_first_use(): void
    {
        $user = $this->makeUser('types-seed@example.com');

        $response = $this->getJson('/api/breaks/types', $this->apiHeadersFor($user))->assertOk();

        $names = collect($response->json('types'))->pluck('name')->all();
        $this->assertSame(['Lunch', 'Tea break', 'Personal'], $names);
        $this->assertDatabaseCount('break_types', 3);

        // Idempotent: a second call must not duplicate.
        $this->getJson('/api/breaks/types', $this->apiHeadersFor($user))->assertOk();
        $this->assertDatabaseCount('break_types', 3);
    }

    public function test_starting_a_break_with_a_type_links_both_ledgers_to_it(): void
    {
        $user = $this->makeUser('types-start@example.com');
        $headers = $this->apiHeadersFor($user);

        $typeId = collect($this->getJson('/api/breaks/types', $headers)->json('types'))
            ->firstWhere('name', 'Lunch')['id'];

        $this->postJson('/api/breaks/start', ['break_type_id' => $typeId], $headers)
            ->assertCreated()
            ->assertJsonPath('break.break_type.name', 'Lunch');

        $this->assertDatabaseHas('time_entries', [
            'user_id' => $user->id,
            'is_break' => true,
            'break_type_id' => $typeId,
        ]);
        $this->assertDatabaseHas('break_times', [
            'user_id' => $user->id,
            'break_type_id' => $typeId,
        ]);
    }

    public function test_a_foreign_orgs_break_type_is_rejected(): void
    {
        $user = $this->makeUser('types-foreign@example.com');

        $otherOrg = Organization::create(['name' => 'Other', 'slug' => 'org-break-types-other']);
        $foreignType = BreakType::create([
            'organization_id' => $otherOrg->id,
            'name' => 'Foreign lunch',
            'is_paid' => true,
        ]);

        $this->postJson('/api/breaks/start', ['break_type_id' => $foreignType->id], $this->apiHeadersFor($user))
            ->assertStatus(422);
    }

    public function test_only_admins_can_manage_break_types(): void
    {
        $manager = $this->makeUser('types-manager@example.com', 'manager');
        $admin = $this->makeUser('types-admin@example.com', 'admin');

        $this->postJson('/api/breaks/types', [
            'name' => 'Gym',
            'is_paid' => false,
        ], $this->apiHeadersFor($manager))->assertForbidden();

        $typeId = $this->postJson('/api/breaks/types', [
            'name' => 'Gym',
            'is_paid' => false,
            'max_minutes_per_day' => 45,
        ], $this->apiHeadersFor($admin))->assertCreated()->json('id');

        $this->putJson("/api/breaks/types/{$typeId}", ['is_paid' => true], $this->apiHeadersFor($manager))
            ->assertForbidden();
        $this->putJson("/api/breaks/types/{$typeId}", ['is_paid' => true], $this->apiHeadersFor($admin))
            ->assertOk()
            ->assertJsonPath('is_paid', true);

        // Deactivation is soft: the row survives for historical reporting.
        $this->deleteJson("/api/breaks/types/{$typeId}", [], $this->apiHeadersFor($admin))->assertOk();
        $this->assertDatabaseHas('break_types', ['id' => $typeId, 'is_active' => false]);
    }

    public function test_paid_breaks_count_toward_worked_time_and_unpaid_do_not(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-11 14:00:00'));

        try {
            $user = $this->makeUser('types-paid@example.com');

            $paid = BreakType::create([
                'organization_id' => $this->organization->id,
                'name' => 'Paid tea',
                'is_paid' => true,
            ]);
            $unpaid = BreakType::create([
                'organization_id' => $this->organization->id,
                'name' => 'Unpaid lunch',
                'is_paid' => false,
            ]);

            // Two hours of work.
            TimeEntry::create([
                'user_id' => $user->id,
                'timer_slot' => 'primary',
                'start_time' => '2026-05-11 09:00:00',
                'end_time' => '2026-05-11 11:00:00',
                'duration' => 7200,
                'is_break' => false,
                'billable' => true,
            ]);

            // Fifteen paid minutes, sixty unpaid minutes.
            TimeEntry::create([
                'user_id' => $user->id,
                'timer_slot' => 'break',
                'start_time' => '2026-05-11 11:00:00',
                'end_time' => '2026-05-11 11:15:00',
                'duration' => 900,
                'is_break' => true,
                'break_type_id' => $paid->id,
                'billable' => false,
            ]);
            TimeEntry::create([
                'user_id' => $user->id,
                'timer_slot' => 'break',
                'start_time' => '2026-05-11 12:00:00',
                'end_time' => '2026-05-11 13:00:00',
                'duration' => 3600,
                'is_break' => true,
                'break_type_id' => $unpaid->id,
                'billable' => false,
            ]);

            $snapshot = app(WorkedTimeService::class)->forUserToday($user, Carbon::parse('2026-05-11 14:00:00'));

            $this->assertSame(900, $snapshot['paid_break_seconds']);
            $this->assertSame(7200 + 900, $snapshot['worked_seconds'], 'Paid break is payable; unpaid is not');
            $this->assertSame(4500, $snapshot['break_seconds'], 'Both breaks still show as break time');
            $this->assertSame(7200, $snapshot['track_seconds'], 'Track time remains work-only');
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_a_break_without_a_type_stays_unpaid(): void
    {
        // Legacy rows and old desktop builds send no type. They must behave
        // exactly as before: excluded from payable time.
        Carbon::setTestNow(Carbon::parse('2026-05-11 14:00:00'));

        try {
            $user = $this->makeUser('types-legacy@example.com');

            TimeEntry::create([
                'user_id' => $user->id,
                'timer_slot' => 'primary',
                'start_time' => '2026-05-11 09:00:00',
                'end_time' => '2026-05-11 10:00:00',
                'duration' => 3600,
                'is_break' => false,
                'billable' => true,
            ]);
            TimeEntry::create([
                'user_id' => $user->id,
                'timer_slot' => 'break',
                'start_time' => '2026-05-11 10:00:00',
                'end_time' => '2026-05-11 10:30:00',
                'duration' => 1800,
                'is_break' => true,
                'break_type_id' => null,
                'billable' => false,
            ]);

            $snapshot = app(WorkedTimeService::class)->forUserToday($user, Carbon::parse('2026-05-11 14:00:00'));

            $this->assertSame(0, $snapshot['paid_break_seconds']);
            $this->assertSame(3600, $snapshot['worked_seconds']);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_types_endpoint_reports_todays_usage_per_type(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-11 14:00:00'));

        try {
            $user = $this->makeUser('types-usage@example.com');
            $headers = $this->apiHeadersFor($user);

            $types = collect($this->getJson('/api/breaks/types', $headers)->json('types'));
            $lunchId = $types->firstWhere('name', 'Lunch')['id'];

            TimeEntry::create([
                'user_id' => $user->id,
                'timer_slot' => 'break',
                'start_time' => '2026-05-11 12:00:00',
                'end_time' => '2026-05-11 12:25:00',
                'duration' => 1500,
                'is_break' => true,
                'break_type_id' => $lunchId,
                'billable' => false,
            ]);

            $lunch = collect($this->getJson('/api/breaks/types', $headers)->json('types'))
                ->firstWhere('id', $lunchId);

            $this->assertSame(1500, $lunch['used_seconds_today']);
        } finally {
            Carbon::setTestNow();
        }
    }
}
