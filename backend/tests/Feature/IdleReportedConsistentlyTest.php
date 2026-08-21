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

/**
 * One idle period, one number, wherever it is shown.
 *
 * Reported 21 Aug 2026: the desktop said ten minutes, the dashboard said five
 * and the auto-stop email said fifteen — for the same afternoon. They were not
 * three measurements disagreeing. The desktop reports the OS idle at the moment
 * it prompts, the email reports the resolved idle at the moment it stops, and
 * the dashboard was reporting something else entirely.
 *
 * The dashboard figure was idle CLIPPED to entry windows. That clipping is
 * correct for arithmetic — an idle auto-stop rewinds the entry to the last
 * keypress, so the tail is already excluded and subtracting it again would
 * remove it twice — but it is wrong as an answer to "how long were they idle".
 *
 * Measured on live data: a five-minute idle span sat entirely outside its own
 * entry, so the dashboard showed ZERO while the email correctly said five.
 */
class IdleReportedConsistentlyTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-idle-report']);

        $this->employee = User::create([
            'name' => 'Employee',
            'email' => 'employee@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);
    }

    /**
     * The exact shape found in production: the entry ends where the idle
     * begins, because the auto-stop rewound it to the last keypress.
     */
    private function anAutoStoppedAfternoon(): array
    {
        $entryStart = Carbon::parse('2026-08-20 11:42:06');
        $lastKeypress = Carbon::parse('2026-08-20 11:45:03');
        $idleEnd = Carbon::parse('2026-08-20 11:50:02');

        TimeEntry::create([
            'user_id' => $this->employee->id,
            'organization_id' => $this->organization->id,
            'start_time' => $entryStart,
            'end_time' => $lastKeypress,
            'duration' => (int) $entryStart->diffInSeconds($lastKeypress),
            'is_break' => false,
            'auto_stopped_for_idle' => true,
        ]);

        Activity::create([
            'user_id' => $this->employee->id,
            'type' => 'idle',
            'name' => 'System Idle',
            // recorded_at is the END of the idle window; duration is its length.
            'duration' => (int) $lastKeypress->diffInSeconds($idleEnd),
            'recorded_at' => $idleEnd,
        ]);

        return [$entryStart, $lastKeypress, $idleEnd];
    }

    private function summary(): array
    {
        return app(WorkTimeSummaryService::class)->forUserRange(
            $this->employee->id,
            Carbon::parse('2026-08-20')->startOfDay(),
            Carbon::parse('2026-08-20')->endOfDay(),
            Carbon::parse('2026-08-20 23:00:00'),
        );
    }

    public function test_idle_is_reported_as_the_time_the_person_was_actually_idle(): void
    {
        // The bug: this read zero, because the whole span sat outside the entry.
        [, $lastKeypress, $idleEnd] = $this->anAutoStoppedAfternoon();

        $summary = $this->summary();

        $this->assertSame(
            (int) $lastKeypress->diffInSeconds($idleEnd),
            (int) $summary['idle_time'],
            'the dashboard did not report the idle the person actually experienced',
        );
    }

    public function test_idle_is_not_reported_as_zero_when_somebody_was_plainly_idle(): void
    {
        // Stated separately from the exact-figure test: whatever the arithmetic,
        // "they were idle for five minutes" must never render as "0h 0m".
        $this->anAutoStoppedAfternoon();

        $this->assertGreaterThan(0, (int) $this->summary()['idle_time']);
    }

    public function test_worked_time_does_not_change(): void
    {
        /*
         * The safety property, and the reason displayed idle and billable idle
         * are now separate numbers. Worked time feeds payroll. Correcting what
         * is SHOWN must not alter what is PAID.
         *
         * The entry already ends at the last keypress, so the idle tail is
         * outside it and nothing further is owed: worked time is the whole
         * entry.
         */
        [$entryStart, $lastKeypress] = $this->anAutoStoppedAfternoon();

        $summary = $this->summary();

        $this->assertSame((int) $entryStart->diffInSeconds($lastKeypress), (int) $summary['track_time']);
        $this->assertSame(
            (int) $entryStart->diffInSeconds($lastKeypress),
            (int) $summary['work_time'],
            'worked time moved - this change must not touch what anybody is paid',
        );
    }

    public function test_the_billable_figure_is_still_available_for_reconciliation(): void
    {
        // work_time is derived from the clipped value, so anything reconciling
        // against it needs that number rather than the displayed one.
        $this->anAutoStoppedAfternoon();

        $summary = $this->summary();

        $this->assertArrayHasKey('idle_time_billable', $summary);
        $this->assertSame(
            (int) $summary['track_time'] - (int) $summary['idle_time_billable'],
            (int) $summary['work_time'],
            'work_time no longer equals track minus billable idle',
        );
    }

    public function test_idle_inside_a_running_entry_is_unaffected(): void
    {
        /*
         * The ordinary case, which must not change: somebody idle in the middle
         * of a session that kept running. Here the span is inside the entry, so
         * clipped and measured agree and the idle is genuinely deducted.
         */
        $start = Carbon::parse('2026-08-20 09:00:00');
        $end = Carbon::parse('2026-08-20 17:00:00');

        TimeEntry::create([
            'user_id' => $this->employee->id,
            'organization_id' => $this->organization->id,
            'start_time' => $start,
            'end_time' => $end,
            'duration' => (int) $start->diffInSeconds($end),
            'is_break' => false,
        ]);

        Activity::create([
            'user_id' => $this->employee->id,
            'type' => 'idle',
            'name' => 'System Idle',
            'duration' => 600,
            'recorded_at' => Carbon::parse('2026-08-20 12:10:00'),
        ]);

        $summary = $this->summary();

        $this->assertSame(600, (int) $summary['idle_time']);
        $this->assertSame(600, (int) $summary['idle_time_billable']);
        $this->assertSame(
            (int) $start->diffInSeconds($end) - 600,
            (int) $summary['work_time'],
            'idle inside a live entry stopped being deducted',
        );
    }
}
