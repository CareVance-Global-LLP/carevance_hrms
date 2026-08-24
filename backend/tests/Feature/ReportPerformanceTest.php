<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ReportPerformanceTest extends TestCase
{
    use RefreshDatabase;

    private function createAdminWithEmployees(int $employeeCount): array
    {
        $organization = Organization::create([
            'name' => 'Perf Org',
            'slug' => 'perf-org-'.uniqid(),
        ]);

        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin'.uniqid().'@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $employees = [];
        for ($i = 0; $i < $employeeCount; $i++) {
            $employees[] = User::create([
                'name' => 'Emp '.$i,
                'email' => 'emp'.$i.uniqid().'@example.com',
                'password' => Hash::make('password123'),
                'role' => 'employee',
                'organization_id' => $organization->id,
            ]);
        }

        // Stamps organization_id on the entries seedWeekEntries() creates
        // below, the same way BelongsToOrganization would from a real
        // authenticated request. $admin's organization is every employee's
        // organization too.
        Auth::setUser($admin);

        return [$organization, $admin, $employees, $this->apiHeadersFor($admin)];
    }

    private function seedWeekEntries(array $employees, string $startDate, string $endDate): void
    {
        $start = Carbon::parse($startDate);
        foreach ($employees as $index => $employee) {
            // A couple of entries per user spread across the range.
            for ($d = 0; $d < 2; $d++) {
                $day = $start->copy()->addDays($d);
                TimeEntry::create([
                    'user_id' => $employee->id,
                    'start_time' => $day->copy()->setTime(9, 0, 0),
                    'end_time' => $day->copy()->setTime(11, 0, 0),
                    'duration' => 7200,
                    'billable' => true,
                ]);
            }
        }
    }

    public function test_team_endpoint_avoids_n_plus_1_and_stays_constant_with_user_count(): void
    {
        [$organization, $admin, $employees, $headers] = $this->createAdminWithEmployees(25);
        $startDate = '2026-03-09';
        $endDate = '2026-03-15';
        $this->seedWeekEntries($employees, $startDate, $endDate);

        DB::enableQueryLog();
        $response = $this->getJson(
            "/api/reports/team?start_date={$startDate}&end_date={$endDate}",
            $headers
        );
        $queryCount = count(DB::getQueryLog());
        DB::disableQueryLog();

        $response->assertOk();
        // 25 users previously triggered 1 (users) + 25 (per-user entries) = 26 queries.
        // Now it is constant: users + fingerprint + one bulk entries query.
        $this->assertLessThan(
            10,
            $queryCount,
            "team() issued {$queryCount} queries for 25 users (expected constant, small count)"
        );
        // team() includes every org user, including the requesting admin.
        $this->assertCount(26, $response->json('by_user'));
        $this->assertArrayHasKey('total_time', $response->json('by_user.0'));
        $this->assertArrayHasKey('entries', $response->json('by_user.0'));
    }

    public function test_monthly_endpoint_returns_pagination_metadata_when_paginated(): void
    {
        [$organization, $admin, $employees, $headers] = $this->createAdminWithEmployees(5);
        $startDate = '2026-03-01';
        $endDate = '2026-03-31';
        $this->seedWeekEntries($employees, $startDate, $endDate);

        $response = $this->getJson(
            "/api/reports/monthly?scope=organization&start_date={$startDate}&end_date={$endDate}&page=1&per_page=5",
            $headers
        );

        $response->assertOk();
        $response->assertJsonStructure([
            'start_date',
            'end_date',
            'by_day',
            'entries',
            'pagination' => ['current_page', 'per_page', 'total', 'last_page'],
        ]);
        $this->assertSame(5, $response->json('pagination.per_page'));
        $this->assertSame(10, $response->json('pagination.total'));
    }

    public function test_daily_endpoint_returns_pagination_metadata_when_paginated(): void
    {
        [$organization, $admin, $employees, $headers] = $this->createAdminWithEmployees(3);
        $date = '2026-03-10';
        $this->seedWeekEntries($employees, $date, $date);

        $response = $this->getJson(
            "/api/reports/daily?scope=organization&date={$date}&page=1&per_page=2",
            $headers
        );

        $response->assertOk();
        $response->assertJsonStructure([
            'date',
            'entries',
            'pagination' => ['current_page', 'per_page', 'total', 'last_page'],
        ]);
        $this->assertSame(2, $response->json('pagination.per_page'));
    }

    public function test_team_endpoint_serves_repeated_requests_from_cache(): void
    {
        [$organization, $admin, $employees, $headers] = $this->createAdminWithEmployees(10);
        $startDate = '2026-03-09';
        $endDate = '2026-03-15';
        $this->seedWeekEntries($employees, $startDate, $endDate);

        $first = $this->getJson("/api/reports/team?start_date={$startDate}&end_date={$endDate}", $headers);
        $first->assertOk();
        // team() includes every org user, including the requesting admin (10 + 1).
        $this->assertCount(11, $first->json('by_user'));

        // Second identical request should be served from cache (no data change).
        $second = $this->getJson("/api/reports/team?start_date={$startDate}&end_date={$endDate}", $headers);
        $second->assertOk();
        $this->assertCount(11, $second->json('by_user'));
        $this->assertSame($first->json('by_user.0.total_time'), $second->json('by_user.0.total_time'));
    }

    public function test_employee_dashboard_reports_monthly_seconds_and_days(): void
    {
        $organization = Organization::create([
            'name' => 'Dash Org',
            'slug' => 'dash-org-'.uniqid(),
        ]);
        $user = User::create([
            'name' => 'Emp',
            'email' => 'dash'.uniqid().'@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);
        $headers = $this->apiHeadersFor($user);

        // Stamps organization_id the same way BelongsToOrganization would
        // from a real authenticated request.
        Auth::setUser($user);

        $month = '2026-03';
        TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-03-10 09:00:00',
            'end_time' => '2026-03-10 11:00:00',
            'duration' => 7200,
            'billable' => true,
        ]);
        TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-03-12 09:00:00',
            'end_time' => '2026-03-12 10:30:00',
            'duration' => 5400,
            'billable' => true,
        ]);

        $response = $this->getJson("/api/employee/dashboard?month={$month}", $headers);

        $response->assertOk();
        $this->assertSame(12600, (int) $response->json('monthly_total_seconds'));
        $this->assertSame(2, (int) $response->json('monthly_days'));
    }
}
