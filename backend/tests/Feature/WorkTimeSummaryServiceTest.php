<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Reports\WorkTimeSummaryService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class WorkTimeSummaryServiceTest extends TestCase
{
    use RefreshDatabase;

    private function makeUser(): User
    {
        $organization = Organization::create([
            'name' => 'CareVance Org',
            'slug' => 'carevance-org-' . uniqid('', true),
        ]);

        return User::create([
            'name' => 'Ayush',
            'email' => 'ayush-' . uniqid('', true) . '@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);
    }

    public function test_track_time_excludes_break_and_work_time_equals_track_minus_idle(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-10 12:00:00'));

        try {
            $user = $this->makeUser();

            // 2h worked session (not a break)
            $entry = TimeEntry::create([
                'user_id' => $user->id,
                'start_time' => '2026-05-10 09:00:00',
                'end_time' => '2026-05-10 11:00:00',
                'duration' => 7200,
                'billable' => true,
                'is_break' => false,
            ]);

            // 30m break session — must NOT count toward Track/Work/Idle
            TimeEntry::create([
                'user_id' => $user->id,
                'start_time' => '2026-05-10 11:00:00',
                'end_time' => '2026-05-10 11:30:00',
                'duration' => 1800,
                'billable' => false,
                'is_break' => true,
            ]);

            // 30m of detected idle inside the worked session
            Activity::create([
                'user_id' => $user->id,
                'time_entry_id' => $entry->id,
                'type' => 'idle',
                'name' => 'System Idle - Test',
                'duration' => 1800,
                'recorded_at' => '2026-05-10 10:00:00',
            ]);

            $service = app(WorkTimeSummaryService::class);
            $summary = $service->forUserRange(
                $user->id,
                Carbon::parse('2026-05-10 00:00:00'),
                Carbon::parse('2026-05-10 23:59:59')
            );

            $this->assertSame(7200, $summary['track_time'], 'Track Time must exclude break entries');
            $this->assertSame(1800, $summary['idle_time'], 'Idle Time must be detected inactivity');
            $this->assertSame(5400, $summary['work_time'], 'Work Time = Track - Idle');
            $this->assertSame(1800, $summary['break_time'], 'Break Time is its own bucket');
            $this->assertSame($summary['track_time'], $summary['work_time'] + $summary['idle_time']);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_for_users_returns_per_user_breakdown(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-11 12:00:00'));

        try {
            $user = $this->makeUser();
            $other = $this->makeUser();

            TimeEntry::create([
                'user_id' => $user->id,
                'start_time' => '2026-05-11 09:00:00',
                'end_time' => '2026-05-11 10:00:00',
                'duration' => 3600,
                'billable' => true,
                'is_break' => false,
            ]);

            TimeEntry::create([
                'user_id' => $other->id,
                'start_time' => '2026-05-11 09:00:00',
                'end_time' => '2026-05-11 11:00:00',
                'duration' => 7200,
                'billable' => true,
                'is_break' => false,
            ]);

            $service = app(WorkTimeSummaryService::class);
            $summaries = $service->forUsers(
                collect([$user->id, $other->id]),
                Carbon::parse('2026-05-11 00:00:00'),
                Carbon::parse('2026-05-11 23:59:59')
            );

            $this->assertArrayHasKey($user->id, $summaries);
            $this->assertArrayHasKey($other->id, $summaries);
            $this->assertSame(3600, $summaries[$user->id]['track_time']);
            $this->assertSame(7200, $summaries[$other->id]['track_time']);
            $this->assertSame(
                $summaries[$user->id]['track_time'],
                $summaries[$user->id]['work_time'] + $summaries[$user->id]['idle_time']
            );
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_empty_range_returns_zeroed_breakdown(): void
    {
        $user = $this->makeUser();

        $service = app(WorkTimeSummaryService::class);
        $summary = $service->forUserRange(
            $user->id,
            Carbon::parse('2026-01-01 00:00:00'),
            Carbon::parse('2026-01-01 23:59:59')
        );

        $this->assertSame(0, $summary['track_time']);
        $this->assertSame(0, $summary['work_time']);
        $this->assertSame(0, $summary['idle_time']);
        $this->assertSame(0, $summary['break_time']);
    }
}
