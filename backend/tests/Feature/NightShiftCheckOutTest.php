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
 * Checking out of a shift that started yesterday.
 *
 * `checkOut` resolved the record with `whereDate('attendance_date', today())`,
 * so it could only ever close a punch made on the same calendar day. Anybody on
 * a night shift — in at 22:00, out at 06:00 — asked for today's record, found
 * none, and was told **"Please check in first"** while visibly checked in. There
 * was no way for them to end their own day at all; the punch stayed open until
 * the auto-close sweeper eventually capped it.
 *
 * This is not a hypothetical shift pattern. `Shift` carries night-shift windows
 * and differentials, and `ShiftResolver::attendanceDateFor()` exists precisely
 * to say which day a punch at 01:30 belongs to. Check-out simply never asked.
 */
class NightShiftCheckOutTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-night-shift',
        ]);

        $this->employee = User::create([
            'name' => 'Nadia Night',
            'email' => 'nadia@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);
    }

    public function test_a_night_shift_can_check_out_after_midnight(): void
    {
        $this->travelTo(Carbon::parse('2026-08-24 22:00:00'));

        $this->actingAs($this->employee)
            ->postJson('/api/attendance/check-in')
            ->assertOk();

        // Eight hours later, on the next calendar day.
        $this->travelTo(Carbon::parse('2026-08-25 06:00:00'));

        $this->actingAs($this->employee)
            ->postJson('/api/attendance/check-out')
            ->assertOk();

        $punch = AttendancePunch::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertNotNull($punch->punch_out_at, 'A night shift must be able to end its own day.');
        $this->assertEqualsWithDelta(8 * 3600, (int) $punch->worked_seconds, 60);
    }

    public function test_the_night_shift_day_totals_on_the_date_it_started(): void
    {
        /*
         * The worked time belongs to the day the shift opened, not the day it
         * happened to finish. Splitting it across two records would show two
         * half days to payroll and break the shift-length comparison on both.
         */
        $this->travelTo(Carbon::parse('2026-08-24 22:00:00'));
        $this->actingAs($this->employee)->postJson('/api/attendance/check-in')->assertOk();

        $this->travelTo(Carbon::parse('2026-08-25 06:00:00'));
        $this->actingAs($this->employee)->postJson('/api/attendance/check-out')->assertOk();

        $this->assertSame(
            1,
            AttendanceRecord::where('user_id', $this->employee->id)->count(),
            'One shift is one attendance day, even when it crosses midnight.'
        );

        $record = AttendanceRecord::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertSame('2026-08-24', Carbon::parse($record->attendance_date)->toDateString());
        $this->assertNotNull($record->check_out_at);
        $this->assertEqualsWithDelta(8 * 3600, (int) $record->worked_seconds, 60);
    }

    public function test_a_normal_day_is_unaffected(): void
    {
        // The regression guard. Widening the lookup must not change the ordinary
        // same-day path, which is what almost every punch actually is.
        $this->travelTo(Carbon::parse('2026-08-24 09:00:00'));
        $this->actingAs($this->employee)->postJson('/api/attendance/check-in')->assertOk();

        $this->travelTo(Carbon::parse('2026-08-24 17:30:00'));
        $this->actingAs($this->employee)->postJson('/api/attendance/check-out')->assertOk();

        $punch = AttendancePunch::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertNotNull($punch->punch_out_at);
        $this->assertEqualsWithDelta(8.5 * 3600, (int) $punch->worked_seconds, 60);
    }

    public function test_checking_out_with_nothing_open_still_refuses(): void
    {
        $this->travelTo(Carbon::parse('2026-08-24 17:00:00'));

        $this->actingAs($this->employee)
            ->postJson('/api/attendance/check-out')
            ->assertStatus(422);
    }

    public function test_a_long_abandoned_punch_is_not_closed_by_a_fresh_tap(): void
    {
        /*
         * The bound on the widened lookup. A punch left open for days is the
         * auto-close sweeper's job — it rewinds to shift end or the configured
         * cap. If a check-out tap today could close it, the person would be
         * credited every hour since, which is the exact over-crediting
         * CloseOpenAttendancePunches exists to avoid.
         */
        $this->travelTo(Carbon::parse('2026-08-20 09:00:00'));
        $this->actingAs($this->employee)->postJson('/api/attendance/check-in')->assertOk();

        $this->travelTo(Carbon::parse('2026-08-25 10:00:00'));
        $this->actingAs($this->employee)
            ->postJson('/api/attendance/check-out')
            ->assertStatus(422);

        $punch = AttendancePunch::where('user_id', $this->employee->id)->firstOrFail();
        $this->assertNull($punch->punch_out_at, 'The sweeper closes stale punches, not a tap five days later.');
    }
}
