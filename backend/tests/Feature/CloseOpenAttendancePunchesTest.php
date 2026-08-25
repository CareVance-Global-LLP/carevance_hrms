<?php

namespace Tests\Feature;

use App\Console\Commands\CloseOpenAttendancePunches;
use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\Organization;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Closing a day nobody checked out of.
 *
 * Attendance used to be closed as a side effect of the timer's idle sweep.
 * Removing that coupling — see AttendanceTimerSeparationTest — left nothing to
 * close a forgotten check-out, so a punch stayed open indefinitely and the day
 * never totalled.
 *
 * The end time is the whole risk here, and it can be wrong in two opposite and
 * equally expensive directions:
 *
 *   - closing at `now()` credits somebody who left at 18:00 until the sweeper
 *     runs at 02:30, inflating the day by hours
 *   - closing at `punch_in_at` records nothing at all, which is what the idle
 *     sweep used to do and reads to payroll as an absence
 *
 * Both cost real money. These tests pin the middle: shift end where known, a
 * generous cap where not, and never outside those bounds.
 */
class CloseOpenAttendancePunchesTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-autoclose',
        ]);

        $this->employee = User::create([
            'name' => 'Ava Employee',
            'email' => 'ava@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);
    }

    /** An open punch made `$hoursAgo` hours ago. */
    private function openPunch(float $hoursAgo): AttendancePunch
    {
        $punchInAt = now()->subMinutes((int) round($hoursAgo * 60));

        $record = AttendanceRecord::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'attendance_date' => $punchInAt->toDateString(),
            'check_in_at' => $punchInAt,
            'status' => 'present',
        ]);

        return AttendancePunch::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'attendance_record_id' => $record->id,
            'punch_in_at' => $punchInAt,
        ]);
    }

    // ------------------------------------------------------ it closes the day

    public function test_a_punch_left_open_past_the_cap_is_closed(): void
    {
        $punch = $this->openPunch(20);

        $this->artisan('attendance:close-open-punches')->assertExitCode(0);

        $punch->refresh();

        $this->assertNotNull($punch->punch_out_at, 'A forgotten check-out must not stay open forever.');
        $this->assertSame(CloseOpenAttendancePunches::REASON_MAX_HOURS, $punch->auto_closed_reason);
    }

    public function test_it_credits_the_cap_rather_than_the_time_the_sweeper_ran(): void
    {
        // Punched in 20 hours ago with a 16-hour cap: the day is worth 16 hours,
        // not 20. Closing at now() would hand over four hours nobody worked.
        $punch = $this->openPunch(20);
        $punchInAt = Carbon::parse($punch->punch_in_at);

        $this->artisan('attendance:close-open-punches')->assertExitCode(0);

        $punch->refresh();

        $this->assertEqualsWithDelta(
            $punchInAt->copy()->addHours(16)->timestamp,
            Carbon::parse($punch->punch_out_at)->timestamp,
            60
        );
        $this->assertEqualsWithDelta(16 * 3600, (int) $punch->worked_seconds, 60);
    }

    public function test_it_never_records_a_zero_day(): void
    {
        /*
         * The failure this whole change exists to prevent. The idle sweep closed
         * a punch at its own punch-in, so the day recorded nothing and payroll
         * read it as an absence.
         */
        $punch = $this->openPunch(20);

        $this->artisan('attendance:close-open-punches')->assertExitCode(0);

        $this->assertGreaterThan(0, (int) $punch->refresh()->worked_seconds);
    }

    public function test_the_day_total_moves_with_the_punch(): void
    {
        // Writing the punch and leaving the record stale is how a cron-closed
        // day previously reported no work at all.
        $punch = $this->openPunch(20);

        $this->artisan('attendance:close-open-punches')->assertExitCode(0);

        $record = AttendanceRecord::findOrFail($punch->attendance_record_id);

        $this->assertGreaterThan(0, (int) $record->worked_seconds);
        $this->assertNotNull($record->check_out_at);
    }

    // ------------------------------------------- it leaves working days alone

    public function test_somebody_still_at_work_is_left_alone(): void
    {
        // Two hours in, on no shift, with a 16-hour cap. Nothing is due.
        $punch = $this->openPunch(2);

        $this->artisan('attendance:close-open-punches')->assertExitCode(0);

        $this->assertNull(
            $punch->refresh()->punch_out_at,
            'Sweeping an in-progress day would clock people out while they work.'
        );
    }

    public function test_a_punch_from_minutes_ago_is_never_touched(): void
    {
        // The guard against the old five-minute kill reappearing in a new shape.
        $punch = $this->openPunch(0.1);

        $this->artisan('attendance:close-open-punches')->assertExitCode(0);

        $this->assertNull($punch->refresh()->punch_out_at);
    }

    public function test_a_real_check_out_is_not_reopened_or_remarked(): void
    {
        $punch = $this->openPunch(20);
        $punch->update([
            'punch_out_at' => now()->subHours(12),
            'worked_seconds' => 8 * 3600,
        ]);

        $this->artisan('attendance:close-open-punches')->assertExitCode(0);

        $punch->refresh();

        $this->assertSame(8 * 3600, (int) $punch->worked_seconds);
        $this->assertNull(
            $punch->auto_closed_reason,
            'A day somebody actually closed must not be marked as assumed.'
        );
    }

    // ------------------------------------------------------------- dry run

    public function test_a_dry_run_changes_nothing(): void
    {
        $punch = $this->openPunch(20);

        $this->artisan('attendance:close-open-punches', ['--dry-run' => true])->assertExitCode(0);

        $this->assertNull($punch->refresh()->punch_out_at);
    }

    public function test_the_cap_is_configurable(): void
    {
        // An organisation running very long shifts must be able to move this
        // without a code change, or the sweeper truncates real days.
        $punch = $this->openPunch(20);
        $punchInAt = Carbon::parse($punch->punch_in_at);

        $this->artisan('attendance:close-open-punches', ['--max-hours' => 10])->assertExitCode(0);

        $this->assertEqualsWithDelta(
            $punchInAt->copy()->addHours(10)->timestamp,
            Carbon::parse($punch->refresh()->punch_out_at)->timestamp,
            60
        );
    }
}
