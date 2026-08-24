<?php

namespace Tests\Feature;

use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Reports\WorkedTimeService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * A day away from a desk is not an idle day.
 *
 * Every figure WorkedTimeService publishes is derived from `time_entries`, which
 * only the desktop tracker writes. Since a phone punch stopped starting a timer
 * — see AttendanceTimerSeparationTest — somebody on site all day who never opens
 * a laptop legitimately has zero tracked seconds.
 *
 * That is the truth about their desk time and a lie about their day, and every
 * report that prints "hours worked" from the tracker would show a field employee
 * as having done nothing. `attendance_seconds` is published alongside so that
 * cannot happen.
 *
 * It is deliberately additive. Folding presence into `worked_seconds` would
 * quietly move the shift countdown, the billable reports and the productivity
 * maths onto a completely different measurement.
 */
class WorkedTimeAttendanceVisibilityTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-worked-visibility',
        ]);

        $this->employee = User::create([
            'name' => 'Farah Field',
            'email' => 'farah@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);
    }

    /** A closed attendance day with no timer of any kind. */
    private function phoneOnlyDay(Carbon $from, Carbon $to): AttendanceRecord
    {
        $record = AttendanceRecord::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'attendance_date' => $from->toDateString(),
            'check_in_at' => $from,
            'check_out_at' => $to,
            'worked_seconds' => $from->diffInSeconds($to),
            'status' => 'present',
        ]);

        AttendancePunch::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'attendance_record_id' => $record->id,
            'punch_in_at' => $from,
            'punch_out_at' => $to,
            'worked_seconds' => $from->diffInSeconds($to),
        ]);

        return $record;
    }

    public function test_a_field_employee_is_not_reported_as_having_done_nothing(): void
    {
        $this->travelTo(Carbon::parse('2026-08-24 18:30:00'));

        $this->phoneOnlyDay(
            Carbon::parse('2026-08-24 09:00:00'),
            Carbon::parse('2026-08-24 17:00:00'),
        );

        $figures = app(WorkedTimeService::class)
            ->forUserDate($this->employee, Carbon::parse('2026-08-24'));

        // The honest reading of the tracker: no desk time, because there was no desk.
        $this->assertSame(0, $figures['track_seconds']);
        $this->assertSame(0, $figures['worked_seconds']);

        // And the honest reading of the day.
        $this->assertEqualsWithDelta(8 * 3600, $figures['attendance_seconds'], 60);
    }

    public function test_an_open_punch_counts_as_it_runs(): void
    {
        // Somebody still on site. The figure has to move, or a live report shows
        // them at zero for the whole of their shift.
        $this->travelTo(Carbon::parse('2026-08-24 13:00:00'));

        $record = AttendanceRecord::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'attendance_date' => '2026-08-24',
            'check_in_at' => Carbon::parse('2026-08-24 09:00:00'),
            'status' => 'present',
        ]);

        AttendancePunch::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'attendance_record_id' => $record->id,
            'punch_in_at' => Carbon::parse('2026-08-24 09:00:00'),
        ]);

        $figures = app(WorkedTimeService::class)
            ->forUserDate($this->employee, Carbon::parse('2026-08-24'));

        $this->assertEqualsWithDelta(4 * 3600, $figures['attendance_seconds'], 60);
    }

    public function test_it_is_zero_when_there_is_no_attendance_at_all(): void
    {
        $this->travelTo(Carbon::parse('2026-08-24 18:30:00'));

        $figures = app(WorkedTimeService::class)
            ->forUserDate($this->employee, Carbon::parse('2026-08-24'));

        // Not null, not absent — consumers can add it up without guarding.
        $this->assertSame(0, $figures['attendance_seconds']);
    }

    public function test_it_does_not_disturb_the_tracked_figures_it_sits_beside(): void
    {
        /*
         * The regression that matters. worked_seconds feeds the shift countdown,
         * the billable reports and the productivity maths. Presence is published
         * next to it, never mixed into it.
         */
        $this->travelTo(Carbon::parse('2026-08-24 18:30:00'));

        $this->phoneOnlyDay(
            Carbon::parse('2026-08-24 09:00:00'),
            Carbon::parse('2026-08-24 17:00:00'),
        );

        TimeEntry::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'start_time' => Carbon::parse('2026-08-24 10:00:00'),
            'end_time' => Carbon::parse('2026-08-24 12:00:00'),
            'duration' => 2 * 3600,
            'timer_slot' => 'primary',
        ]);

        $figures = app(WorkedTimeService::class)
            ->forUserDate($this->employee, Carbon::parse('2026-08-24'));

        // Two hours at the keyboard out of eight hours present. Both true.
        $this->assertEqualsWithDelta(2 * 3600, $figures['track_seconds'], 60);
        $this->assertEqualsWithDelta(2 * 3600, $figures['worked_seconds'], 60);
        $this->assertEqualsWithDelta(8 * 3600, $figures['attendance_seconds'], 60);

        // The countdown still runs off tracked time, unchanged by presence.
        $this->assertSame(
            max(0, $figures['shift_target_seconds'] - $figures['billed_seconds']),
            $figures['remaining_seconds']
        );
    }
}
