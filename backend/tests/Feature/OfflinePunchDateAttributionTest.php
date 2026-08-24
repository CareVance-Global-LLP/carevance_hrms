<?php

namespace Tests\Feature;

use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\Organization;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * A buffered punch is filed on the day it happened, not the day it arrived.
 *
 * `checkIn` resolved `punch_at` into `check_in_at` correctly, then filed the
 * record under `now()->toDateString()` — the moment the request landed. Those
 * are the same date almost always, and different exactly when it matters: a
 * punch made at 23:50 with no signal and synced at 00:10 produced a record
 * dated the 25th whose own `check_in_at` was the 24th.
 *
 * That record is self-contradictory whatever the shift rules are. It splits one
 * day across two rows, hides the 24th's attendance from every date-ranged
 * report, and judges the punch against the wrong day's late threshold.
 *
 * Timestamps here are built with Carbon rather than written as literals with a
 * UTC offset: app.timezone is Asia/Kolkata, so a hardcoded "+00:00" lands on a
 * different calendar day than it reads as, which is the very thing under test.
 *
 * The mobile offline queue makes this reachable rather than theoretical: a punch
 * is now stored on the phone and replayed whenever the network returns, so the
 * gap between punching and syncing is no longer a fraction of a second.
 *
 * Deliberately NOT the shift-attribution rule. Whether a punch at 01:30 belongs
 * to the previous night's shift is `ShiftResolver::attendanceDateFor()`'s
 * question, and moving record creation onto it stays the separate migration the
 * comment in `todayPayload()` reserves. This is the narrower, unarguable half:
 * file the punch on the calendar day it was made.
 */
class OfflinePunchDateAttributionTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-punch-attribution',
        ]);

        $this->employee = User::create([
            'name' => 'Omar Offline',
            'email' => 'omar@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);
    }

    public function test_a_punch_buffered_across_midnight_is_filed_on_the_day_it_was_made(): void
    {
        // Punched at 23:50 in a basement car park; synced twenty minutes later,
        // by which time the calendar has moved on.
        $this->travelTo(Carbon::parse('2026-08-25 00:10:00'));

        $this->actingAs($this->employee)->postJson('/api/attendance/check-in', [
            'punch_at' => Carbon::parse('2026-08-24 23:50:00')->toIso8601String(),
            'local_id' => 'queued-midnight-1',
            'device_id' => 'phone-1',
        ])->assertOk();

        $record = AttendanceRecord::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertSame(
            '2026-08-24',
            Carbon::parse($record->attendance_date)->toDateString(),
            'The punch belongs to the day it was made, not the day it synced.'
        );
    }

    public function test_a_record_never_predates_its_own_check_in(): void
    {
        /*
         * The invariant, stated without reference to any shift policy: a day's
         * record cannot be dated after the punch that opened it. Every
         * date-ranged report, and DayOutcomeService itself, joins on
         * attendance_date — so a row that disagrees with its own timestamp is
         * counted on a day nobody was there and missing from the day they were.
         */
        $this->travelTo(Carbon::parse('2026-08-25 00:10:00'));

        $this->actingAs($this->employee)->postJson('/api/attendance/check-in', [
            'punch_at' => Carbon::parse('2026-08-24 23:50:00')->toIso8601String(),
            'local_id' => 'queued-midnight-2',
            'device_id' => 'phone-1',
        ])->assertOk();

        $record = AttendanceRecord::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertSame(
            Carbon::parse($record->check_in_at)->toDateString(),
            Carbon::parse($record->attendance_date)->toDateString()
        );
    }

    public function test_the_punch_row_agrees_with_its_record(): void
    {
        $this->travelTo(Carbon::parse('2026-08-25 00:10:00'));

        $this->actingAs($this->employee)->postJson('/api/attendance/check-in', [
            'punch_at' => Carbon::parse('2026-08-24 23:50:00')->toIso8601String(),
            'local_id' => 'queued-midnight-3',
            'device_id' => 'phone-1',
        ])->assertOk();

        $punch = AttendancePunch::where('user_id', $this->employee->id)->firstOrFail();
        $record = AttendanceRecord::findOrFail($punch->attendance_record_id);

        $this->assertSame('2026-08-24', Carbon::parse($punch->punch_in_at)->toDateString());
        $this->assertSame('2026-08-24', Carbon::parse($record->attendance_date)->toDateString());
    }

    public function test_a_live_punch_is_unchanged(): void
    {
        // The regression guard. Almost every punch has no punch_at at all, and
        // must keep filing on today exactly as before.
        $this->travelTo(Carbon::parse('2026-08-24 09:15:00'));

        $this->actingAs($this->employee)
            ->postJson('/api/attendance/check-in')
            ->assertOk();

        $record = AttendanceRecord::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertSame('2026-08-24', Carbon::parse($record->attendance_date)->toDateString());
    }

    public function test_a_same_day_backdated_punch_still_files_on_that_day(): void
    {
        // The common offline case: punched 45 minutes ago, synced now, same day.
        $this->travelTo(Carbon::parse('2026-08-24 10:00:00'));

        $this->actingAs($this->employee)->postJson('/api/attendance/check-in', [
            'punch_at' => Carbon::parse('2026-08-24 09:15:00')->toIso8601String(),
            'local_id' => 'queued-same-day',
            'device_id' => 'phone-1',
        ])->assertOk();

        $record = AttendanceRecord::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertSame('2026-08-24', Carbon::parse($record->attendance_date)->toDateString());
        $this->assertSame('09:15', Carbon::parse($record->check_in_at)->format('H:i'));
    }

    public function test_a_future_punch_time_is_not_trusted(): void
    {
        /*
         * A device with a skewed clock must not be able to file attendance on a
         * day that has not happened. resolveSyncTimestamp already clamps the
         * timestamp to now(); the record date has to follow the clamped value,
         * not the raw claim.
         */
        $this->travelTo(Carbon::parse('2026-08-24 10:00:00'));

        $this->actingAs($this->employee)->postJson('/api/attendance/check-in', [
            'punch_at' => Carbon::parse('2026-08-26 09:00:00')->toIso8601String(),
            'local_id' => 'queued-skewed',
            'device_id' => 'phone-1',
        ])->assertOk();

        $record = AttendanceRecord::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertSame('2026-08-24', Carbon::parse($record->attendance_date)->toDateString());
    }
}
