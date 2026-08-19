<?php

namespace Tests\Unit;

use App\Models\EmployeeShift;
use App\Models\EmployeeWorkInfo;
use App\Models\Organization;
use App\Models\Shift;
use App\Models\User;
use App\Services\Attendance\AttendanceService;
use App\Services\Attendance\ShiftResolver;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * A shift OCCURRENCE is the pattern plus the calendar date it runs on, with
 * both ends as real datetimes in the employee's own wall clock. For a night
 * shift the end lands on the next calendar date, and every punch in that
 * window belongs to the date the shift STARTED.
 *
 * The inverse — "given an instant, which attendance date is this?" — is the
 * one that actually decides where a night worker's hours are booked. Bucketing
 * a 01:30 punch under its own calendar date splits one night's work across two
 * days and is the bug this whole file exists to pin down.
 */
class ShiftOccurrenceTest extends TestCase
{
    use RefreshDatabase;

    private function resolver(): ShiftResolver
    {
        return app(ShiftResolver::class);
    }

    private function organization(string $name = 'Org', string $slug = 'org'): Organization
    {
        return Organization::create(['name' => $name, 'slug' => $slug]);
    }

    private function employee(Organization $organization, string $email = 'a@example.com'): User
    {
        return User::create([
            'name' => 'Employee',
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);
    }

    /** @param array<string, mixed> $attributes */
    private function shift(Organization $organization, array $attributes = []): Shift
    {
        return Shift::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $organization->id,
            'name' => 'General',
            'code' => 'GEN'.$organization->id,
            'type' => 'general',
            'start_time' => '09:00:00',
            'end_time' => '18:00:00',
            'duration_minutes' => 540,
            'break_duration_minutes' => 60,
            'is_active' => true,
        ], $attributes));
    }

    /** @param array<string, mixed> $attributes */
    private function nightShift(Organization $organization, array $attributes = []): Shift
    {
        return $this->shift($organization, array_merge([
            'name' => 'Night',
            'code' => 'NGT'.$organization->id,
            'type' => 'night',
            'is_night_shift' => true,
            'start_time' => '22:00:00',
            'end_time' => '06:00:00',
            'duration_minutes' => 480,
            'break_duration_minutes' => 30,
        ], $attributes));
    }

    private function assign(User $user, Shift $shift): EmployeeShift
    {
        return EmployeeShift::withoutOrganizationScope()->create([
            'organization_id' => $shift->organization_id,
            'user_id' => $user->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-01-01',
            'effective_to' => null,
            'is_active' => true,
        ]);
    }

    private function timezoneFor(User $user, string $timezone): void
    {
        EmployeeWorkInfo::withoutOrganizationScope()->create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'expected_timezone' => $timezone,
        ]);
    }

    // ---------------------------------------------------------------- forward

    public function test_a_day_shift_occurrence_starts_and_ends_on_the_attendance_date(): void
    {
        $org = $this->organization();
        $user = $this->employee($org);
        $this->assign($user, $this->shift($org));

        $occurrence = $this->resolver()->occurrenceFor($user, '2026-08-19');

        $this->assertNotNull($occurrence);
        $this->assertSame('2026-08-19', $occurrence->attendanceDateString());
        $this->assertSame('2026-08-19 09:00:00', $occurrence->shiftStartAt->format('Y-m-d H:i:s'));
        $this->assertSame('2026-08-19 18:00:00', $occurrence->shiftEndAt?->format('Y-m-d H:i:s'));
        $this->assertFalse($occurrence->crossesMidnight());
    }

    public function test_a_night_shift_occurrence_ends_on_the_next_calendar_date(): void
    {
        $org = $this->organization();
        $user = $this->employee($org);
        $this->assign($user, $this->nightShift($org));

        $occurrence = $this->resolver()->occurrenceFor($user, '2026-08-19');

        $this->assertNotNull($occurrence);
        $this->assertSame('2026-08-19', $occurrence->attendanceDateString());
        $this->assertSame('2026-08-19 22:00:00', $occurrence->shiftStartAt->format('Y-m-d H:i:s'));
        $this->assertSame('2026-08-20 06:00:00', $occurrence->shiftEndAt?->format('Y-m-d H:i:s'));
        $this->assertTrue($occurrence->crossesMidnight());
    }

    public function test_the_occurrence_is_built_in_the_employees_own_timezone(): void
    {
        $org = $this->organization();
        $user = $this->employee($org);
        // Deliberately not the app default (Asia/Kolkata): a shift is a wall
        // clock where the person works, not where the server is racked.
        $this->timezoneFor($user, 'America/New_York');
        $this->assign($user, $this->nightShift($org));

        $occurrence = $this->resolver()->occurrenceFor($user, '2026-08-19');

        $this->assertNotNull($occurrence);
        $this->assertSame('America/New_York', $occurrence->timezone);
        $this->assertSame('2026-08-19 22:00:00-04:00', $occurrence->shiftStartAt->format('Y-m-d H:i:sP'));
        $this->assertSame('2026-08-20 06:00:00-04:00', $occurrence->shiftEndAt?->format('Y-m-d H:i:sP'));
    }

    public function test_the_arithmetic_does_not_assume_a_fixed_utc_offset(): void
    {
        $org = $this->organization();
        $user = $this->employee($org);
        $this->timezoneFor($user, 'America/New_York');
        $this->assign($user, $this->nightShift($org));

        // 2026-03-08 is the US spring-forward: 02:00 EST becomes 03:00 EDT, so
        // the night of the 7th is 23 hours long on the clock. Eight worked
        // hours from 22:00 EST end at 07:00 EDT, not 06:00, and the two ends
        // carry different offsets. Anything doing (start + 8*3600) against a
        // frozen offset gets this wrong.
        $occurrence = $this->resolver()->occurrenceFor($user, '2026-03-07');

        $this->assertNotNull($occurrence);
        $this->assertSame('2026-03-07 22:00:00-05:00', $occurrence->shiftStartAt->format('Y-m-d H:i:sP'));
        $this->assertSame('2026-03-08 07:00:00-04:00', $occurrence->shiftEndAt?->format('Y-m-d H:i:sP'));

        // And a punch inside that window is still the 7th's work.
        $this->assertSame(
            '2026-03-07',
            $this->resolver()->attendanceDateFor($user, Carbon::parse('2026-03-08 03:30:00', 'America/New_York'))
        );
    }

    public function test_a_day_that_the_shift_does_not_run_has_no_occurrence(): void
    {
        $org = $this->organization();
        $user = $this->employee($org);
        $this->assign($user, $this->shift($org, ['applicable_days' => ['monday', 'tuesday']]));

        // 2026-08-19 is a Wednesday.
        $this->assertNull($this->resolver()->occurrenceFor($user, '2026-08-19'));
    }

    // ---------------------------------------------------------------- inverse

    public function test_a_night_shift_punch_after_midnight_belongs_to_the_previous_attendance_date(): void
    {
        $org = $this->organization();
        $user = $this->employee($org);
        $this->assign($user, $this->nightShift($org));

        // Given as UTC on purpose: 20:00Z is 01:30 the next morning in IST.
        // The rule must run on the employee's wall clock, not the instant's.
        $this->assertSame(
            '2026-08-19',
            $this->resolver()->attendanceDateFor($user, Carbon::parse('2026-08-19T20:00:00Z'))
        );
    }

    public function test_punches_either_side_of_midnight_share_one_attendance_date(): void
    {
        $org = $this->organization();
        $user = $this->employee($org);
        $this->assign($user, $this->nightShift($org));

        $before = $this->resolver()->attendanceDateFor($user, Carbon::parse('2026-08-19 23:59:00'));
        $after = $this->resolver()->attendanceDateFor($user, Carbon::parse('2026-08-20 00:01:00'));

        $this->assertSame('2026-08-19', $before);
        $this->assertSame($before, $after, 'One minute apart cannot be two attendance dates.');
    }

    public function test_a_day_shift_is_unaffected_by_the_night_shift_rule(): void
    {
        $org = $this->organization();
        $user = $this->employee($org);
        $this->assign($user, $this->shift($org));

        // Inside the shift.
        $this->assertSame(
            '2026-08-19',
            $this->resolver()->attendanceDateFor($user, Carbon::parse('2026-08-19 09:30:00'))
        );
        // Small hours: a day worker punching at 01:30 is working on that
        // morning's date, never the previous one.
        $this->assertSame(
            '2026-08-20',
            $this->resolver()->attendanceDateFor($user, Carbon::parse('2026-08-20 01:30:00'))
        );
    }

    public function test_the_end_boundary_of_a_night_shift_is_explicit(): void
    {
        $org = $this->organization();
        $user = $this->employee($org);
        $this->assign($user, $this->nightShift($org));

        $tolerance = ShiftResolver::OVERRUN_TOLERANCE_MINUTES;

        // Exactly on the scheduled end: still the previous date.
        $this->assertSame(
            '2026-08-19',
            $this->resolver()->attendanceDateFor($user, Carbon::parse('2026-08-20 06:00:00'))
        );

        // Overrun inside the tolerance: still the previous date, so a late
        // punch-out does not split the night across two attendance dates.
        $this->assertSame(
            '2026-08-19',
            $this->resolver()->attendanceDateFor(
                $user,
                Carbon::parse('2026-08-20 06:00:00')->addMinutes($tolerance)
            )
        );

        // One minute past the tolerance: the instant owns its own date again.
        $this->assertSame(
            '2026-08-20',
            $this->resolver()->attendanceDateFor(
                $user,
                Carbon::parse('2026-08-20 06:00:00')->addMinutes($tolerance + 1)
            )
        );
    }

    public function test_an_instant_with_no_shift_configured_keeps_its_own_local_date(): void
    {
        $org = $this->organization();
        $user = $this->employee($org);
        $this->timezoneFor($user, 'America/New_York');

        $this->assertNull($this->resolver()->occurrenceFor($user, '2026-08-19'));

        // 2026-08-20 01:30 UTC is still 2026-08-19 21:30 in New York.
        $this->assertSame(
            '2026-08-19',
            $this->resolver()->attendanceDateFor($user, Carbon::parse('2026-08-20T01:30:00Z'))
        );
    }

    public function test_the_occurrence_for_an_instant_is_the_shift_that_was_running(): void
    {
        $org = $this->organization();
        $user = $this->employee($org);
        $night = $this->nightShift($org);
        $this->assign($user, $night);

        $occurrence = $this->resolver()->occurrenceForInstant($user, Carbon::parse('2026-08-20 01:30:00'));

        $this->assertNotNull($occurrence);
        $this->assertSame('2026-08-19', $occurrence->attendanceDateString());
        $this->assertSame($night->id, $occurrence->shift?->id);
        $this->assertTrue($occurrence->covers(Carbon::parse('2026-08-20 01:30:00')));
    }

    // ----------------------------------------------------------------- wiring

    public function test_the_today_payload_reports_the_occurrence_for_the_day_it_already_shows(): void
    {
        $org = $this->organization();
        $user = $this->employee($org);
        $this->assign($user, $this->nightShift($org));

        Carbon::setTestNow(Carbon::parse('2026-08-19 23:00:00'));

        try {
            $payload = app(AttendanceService::class)->todayPayload($user);
        } finally {
            Carbon::setTestNow();
        }

        $occurrence = $payload['shift_occurrence'] ?? null;

        $this->assertIsArray($occurrence);
        // The occurrence is for the same date the payload's record is for, so
        // the two can never disagree about which day is on screen.
        $this->assertSame('2026-08-19', $occurrence['attendance_date']);
        $this->assertTrue($occurrence['crosses_midnight']);
        $this->assertStringStartsWith('2026-08-19T22:00:00', $occurrence['shift_start_at']);
        $this->assertStringStartsWith('2026-08-20T06:00:00', $occurrence['shift_end_at']);
        $this->assertSame((480 - 30) * 60, $occurrence['expected_seconds']);
    }

    public function test_the_today_payload_reports_no_occurrence_when_nothing_is_rostered(): void
    {
        $org = $this->organization();
        $user = $this->employee($org);

        $payload = app(AttendanceService::class)->todayPayload($user);

        $this->assertArrayHasKey('shift_occurrence', $payload);
        $this->assertNull($payload['shift_occurrence']);
        // The eight-hour fallback target is untouched by any of this.
        $this->assertSame(8 * 3600, $payload['shift_target_seconds']);
    }

    public function test_another_tenants_night_shift_never_reattributes_this_users_punch(): void
    {
        $mine = $this->organization('Mine', 'mine');
        $theirs = $this->organization('Theirs', 'theirs');

        $user = $this->employee($mine, 'mine@example.com');
        $foreignNight = $this->nightShift($theirs);

        EmployeeShift::withoutOrganizationScope()->create([
            'organization_id' => $theirs->id,
            'user_id' => $user->id,
            'shift_id' => $foreignNight->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);

        $this->assertNull($this->resolver()->occurrenceFor($user, '2026-08-19'));
        $this->assertSame(
            '2026-08-20',
            $this->resolver()->attendanceDateFor($user, Carbon::parse('2026-08-20 01:30:00'))
        );
    }
}
