<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class EmployeeInsightsLiveCountsTest extends TestCase
{
    use RefreshDatabase;

    public function test_live_monitoring_exposes_true_counts_and_status_map(): void
    {
        $organization = Organization::create(['name' => 'CareVance Labs', 'slug' => 'carevance-labs']);
        $admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin@example.com',
            'password' => 'password123',
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $employees = collect(range(1, 12))->map(fn (int $index) => User::create([
            'name' => "Employee {$index}",
            'email' => "employee{$index}@example.com",
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]));

        // Give every employee an open timer so all 12 report a working status —
        // more than the 10-row cap on the live arrays.
        foreach ($employees as $employee) {
            TimeEntry::create([
                'user_id' => $employee->id,
                'start_time' => now()->subHours(2),
                'end_time' => null,
                'duration' => 0,
                'billable' => true,
            ]);
        }

        $response = $this->getJson(
            '/api/reports/employee-insights?start_date=' . now()->toDateString() . '&end_date=' . now()->toDateString(),
            $this->apiHeadersFor($admin)
        );

        $response->assertOk()->assertJsonStructure([
            'live_monitoring' => [
                'counts' => ['all', 'active', 'idle', 'on_break', 'on_leave', 'inactive', 'working_now'],
                'status_by_user',
            ],
        ]);

        $counts = $response->json('live_monitoring.counts');
        $statusByUser = $response->json('live_monitoring.status_by_user');

        // The true totals must see past the 10-row array cap.
        $this->assertSame(12, $counts['all']);
        $this->assertSame(12, $counts['working_now']);
        $this->assertCount(12, $statusByUser);

        // Every employee appears in the status map with a known status value.
        foreach ($employees as $employee) {
            $this->assertArrayHasKey((string) $employee->id, $statusByUser);
            $this->assertContains(
                $statusByUser[(string) $employee->id],
                ['active', 'idle', 'on_break', 'inactive', 'on_leave']
            );
        }

        // The capped arrays stay capped — the counts are the source of truth.
        $this->assertLessThanOrEqual(10, count($response->json('live_monitoring.working_now')));
    }
}
