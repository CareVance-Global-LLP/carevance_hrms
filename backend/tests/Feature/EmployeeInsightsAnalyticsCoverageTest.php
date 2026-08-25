<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Tests\TestCase;

class EmployeeInsightsAnalyticsCoverageTest extends TestCase
{
    use RefreshDatabase;

    /**
     * The defect this pins, measured 14 Aug 2026 on a 92-person organisation.
     *
     * Organisation-wide analytics took the first 50 employees by name. The only
     * person tracking that day sorted 90th, so every "all employees" figure read
     * zero while the timeline for the same day and the same filters listed 19
     * events. Selecting that person by name skipped the cap and returned real
     * numbers, which is exactly why nobody noticed the totals were partial.
     */
    public function test_organisation_totals_include_a_tracked_employee_sorting_after_the_old_cap(): void
    {
        $organization = Organization::create(['name' => 'CareVance Labs', 'slug' => 'carevance-labs']);

        $admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin@example.com',
            'password' => 'password123',
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        // 60 idle employees whose names all sort before the tracked one, so the
        // old orderBy('name')->limit(50) filled its whole window with them.
        foreach (range(1, 60) as $index) {
            User::create([
                'name' => sprintf('Aaa Employee %02d', $index),
                'email' => "aaa{$index}@example.com",
                'password' => 'password123',
                'role' => 'employee',
                'organization_id' => $organization->id,
            ]);
        }

        $tracked = User::create([
            'name' => 'zzz tracked employee',
            'email' => 'tracked@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        // Stamps organization_id the same way BelongsToOrganization would
        // from a real authenticated request.
        Auth::setUser($tracked);

        TimeEntry::create([
            'user_id' => $tracked->id,
            'start_time' => now()->setTime(9, 0),
            'end_time' => now()->setTime(9, 30),
            'duration' => 1800,
            'billable' => true,
        ]);

        $response = $this->actingAs($admin)->getJson(sprintf(
            '/api/reports/employee-insights?start_date=%s&end_date=%s',
            now()->toDateString(),
            now()->toDateString()
        ));

        $response->assertOk();

        $analyticsUsers = collect($response->json('matched_users') ?? []);
        $this->assertNotNull($response->json('analytics_users_count'));

        // The whole point: the person with data is inside the aggregated set.
        $this->assertGreaterThan(
            0,
            (int) $response->json('organization_summary.tracked_duration'),
            'Organisation tracked time is zero, so the employee who actually tracked was excluded from the aggregate.'
        );

        // Narrowing by activity should also keep the set small — 60 employees
        // recorded nothing, so aggregating over them buys nothing but load.
        $this->assertSame(
            1,
            (int) $response->json('analytics_users_count'),
            'Analytics should cover only employees with something recorded in the range.'
        );

        $this->assertFalse(
            (bool) $response->json('analytics_users_truncated'),
            'A single tracked employee is nowhere near the cap, so nothing was truncated.'
        );

        unset($analyticsUsers);
    }

    /**
     * Several panels are built for the selected employee alone. With no employee
     * chosen the default was whoever sorted first alphabetically — normally
     * somebody with no day at all — so "Time by activity kind" read "No recorded
     * activity in this range yet" while the organisation totals beside it were
     * full of data.
     */
    public function test_the_default_selected_employee_is_one_with_a_day_to_show(): void
    {
        $organization = Organization::create(['name' => 'CareVance Labs', 'slug' => 'carevance-labs']);

        $admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin@example.com',
            'password' => 'password123',
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        User::create([
            'name' => 'Aaa Quiet Employee',
            'email' => 'quiet@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $tracked = User::create([
            'name' => 'zzz tracked employee',
            'email' => 'tracked@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        // Stamps organization_id the same way BelongsToOrganization would
        // from a real authenticated request.
        Auth::setUser($tracked);

        TimeEntry::create([
            'user_id' => $tracked->id,
            'start_time' => now()->setTime(9, 0),
            'end_time' => now()->setTime(9, 30),
            'duration' => 1800,
            'billable' => true,
        ]);

        $response = $this->actingAs($admin)->getJson(sprintf(
            '/api/reports/employee-insights?start_date=%s&end_date=%s',
            now()->toDateString(),
            now()->toDateString()
        ));

        $response->assertOk();
        $this->assertSame(
            $tracked->id,
            (int) $response->json('selected_user.id'),
            'The default view opened on an employee with nothing recorded.'
        );
    }

    public function test_a_range_with_no_recorded_activity_reports_no_analytics_users(): void
    {
        $organization = Organization::create(['name' => 'Quiet Co', 'slug' => 'quiet-co']);

        $admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin@quiet.example',
            'password' => 'password123',
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        User::create([
            'name' => 'Idle Employee',
            'email' => 'idle@quiet.example',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $response = $this->actingAs($admin)->getJson(sprintf(
            '/api/reports/employee-insights?start_date=%s&end_date=%s',
            now()->toDateString(),
            now()->toDateString()
        ));

        $response->assertOk();
        $this->assertSame(0, (int) $response->json('analytics_users_count'));
        $this->assertFalse((bool) $response->json('analytics_users_truncated'));
    }
}
