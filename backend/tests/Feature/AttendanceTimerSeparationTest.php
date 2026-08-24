<?php

namespace Tests\Feature;

use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Attendance and the timer answer different questions.
 *
 * Attendance answers "was this person here, from when to when" — it is what
 * payroll, late marking and loss-of-pay are computed from
 * (DayOutcomeService reads AttendanceRecord and never touches time_entries).
 * The timer answers "what were they doing at a computer", and is only
 * meaningful when something is watching keyboard and mouse.
 *
 * They used to be one action, and that caused a real defect: a punch from a
 * phone created a timer, `timers:close-idle` found no keyboard activity because
 * a phone cannot produce any, and closed it after five minutes with
 * `duration = 0` — taking the attendance punch down with it. A field employee
 * who never opens a laptop recorded a full day's absence, every day.
 *
 * Punching in now marks presence and nothing else. The timer starts when a
 * client that can actually observe work says so.
 */
class AttendanceTimerSeparationTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-separation',
        ]);

        $this->employee = User::create([
            'name' => 'Ava Employee',
            'email' => 'ava@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);
    }

    // ------------------------------------------------ a punch is not a timer

    public function test_checking_in_marks_presence_without_starting_a_timer(): void
    {
        $this->actingAs($this->employee)
            ->postJson('/api/attendance/check-in')
            ->assertOk();

        $record = AttendanceRecord::where('user_id', $this->employee->id)->firstOrFail();
        $this->assertNotNull($record->check_in_at, 'The person is present.');
        $this->assertSame(1, AttendancePunch::where('user_id', $this->employee->id)->count());

        // The point of the whole change. A timer here is what the idle sweep
        // would later kill with duration 0.
        $this->assertSame(
            0,
            TimeEntry::where('user_id', $this->employee->id)->count(),
            'Checking in must not create a timer — a phone cannot report whether anyone is working.'
        );
    }

    public function test_the_punch_survives_what_used_to_kill_it(): void
    {
        /*
         * The exact failure, reproduced end to end. `timers:close-idle` closes
         * running timers with no keyboard activity AND closes the attendance
         * punch alongside them. With no timer to find, it has nothing to close,
         * so a phone punch is still open five minutes later.
         */
        $this->actingAs($this->employee)
            ->postJson('/api/attendance/check-in')
            ->assertOk();

        $this->travel(6)->minutes();
        $this->artisan('timers:close-idle')->assertExitCode(0);

        $punch = AttendancePunch::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertNull(
            $punch->punch_out_at,
            'The idle sweep must not close an attendance punch that no timer belongs to.'
        );
    }

    public function test_a_full_day_on_the_phone_records_a_full_day(): void
    {
        /*
         * The severe case: on site all day, never opens a laptop. This used to
         * record zero worked seconds, which reads to payroll as an absence.
         *
         * The clock is pinned to a morning start on purpose. Without it this
         * test passed before about 16:00 and failed after, because
         * AttendanceService::checkOut finds the record by TODAY's date and an
         * eight-hour day started in the evening crosses midnight. That is a real
         * limitation for night shifts, but it is not what this test is about,
         * and a test whose result depends on the hour it runs is worse than no
         * test at all.
         */
        $this->travelTo(Carbon::parse('09:00:00'));

        $this->actingAs($this->employee)
            ->postJson('/api/attendance/check-in')
            ->assertOk();

        $this->travel(8)->hours();

        $this->actingAs($this->employee)
            ->postJson('/api/attendance/check-out')
            ->assertOk();

        $punch = AttendancePunch::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertNotNull($punch->punch_out_at);
        // Allow a second of slack for clock movement across the request.
        $this->assertGreaterThan(
            8 * 3600 - 5,
            (int) $punch->worked_seconds,
            'A day spent away from a desk is still a full day present.'
        );
    }

    // ------------------------------------- the desktop still marks attendance

    public function test_starting_the_desktop_timer_still_marks_the_person_present(): void
    {
        /*
         * The other direction must keep working. Somebody who only ever uses
         * the desktop tracker and never punches from a phone still has to be
         * marked present, or decoupling would lose attendance for desk staff.
         */
        $this->actingAs($this->employee)
            ->postJson('/api/time-entries/start', ['timer_slot' => 'primary'])
            ->assertCreated();

        $record = AttendanceRecord::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertNotNull($record->check_in_at);
        $this->assertSame(1, TimeEntry::where('user_id', $this->employee->id)->count());
    }

    public function test_checking_out_still_stops_a_running_desktop_timer(): void
    {
        // Leaving for the day ends desk work too. Decoupling the START must not
        // decouple the stop, or a desktop timer would run all night.
        $this->actingAs($this->employee)
            ->postJson('/api/time-entries/start', ['timer_slot' => 'primary'])
            ->assertCreated();

        $this->travel(2)->hours();

        $this->actingAs($this->employee)
            ->postJson('/api/attendance/check-out')
            ->assertOk();

        $entry = TimeEntry::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertNotNull($entry->end_time, 'Checking out must stop the timer.');
        $this->assertGreaterThan(0, (int) $entry->duration);
    }

    // ------------------------------------------------------ the backdated punch

    public function test_a_backdated_punch_records_the_time_it_was_made(): void
    {
        /*
         * `punch_at` is what makes an offline punch honest. Without it the punch
         * lands at whatever time the queue happened to drain, and late-marking
         * is computed against the wrong instant.
         *
         * This is also why attendance check-in is the right endpoint for a
         * phone: the timer path stamps `check_in_at` with now() regardless.
         */
        $punchedAt = now()->subMinutes(45);

        $this->actingAs($this->employee)->postJson('/api/attendance/check-in', [
            'punch_at' => $punchedAt->toIso8601String(),
            'local_id' => 'queued-punch-1',
            'device_id' => 'phone-1',
        ])->assertOk();

        $record = AttendanceRecord::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertEqualsWithDelta(
            $punchedAt->timestamp,
            $record->check_in_at->timestamp,
            5,
            'A punch made 45 minutes ago must not be recorded as happening now.'
        );
    }
}
