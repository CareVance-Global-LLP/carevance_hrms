<?php

namespace Tests\Feature;

use App\Models\EmployeeShift;
use App\Models\EmployeeWeeklyOffPolicy;
use App\Models\Organization;
use App\Models\Shift;
use App\Models\User;
use App\Models\WeeklyOffPolicy;
use App\Services\Attendance\AttendanceService;
use App\Services\Attendance\ShiftResolver;
use App\Services\Attendance\WeeklyOffResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * "Is this person off on this date" — the second of the five working-time
 * objects, and the one every attendance target has to consult before it can
 * claim an employee owed eight hours.
 *
 * The calendar is the whole test. August 2026 has FIVE Saturdays (1, 8, 15, 22,
 * 29) and September 2026 has four (5, 12, 19, 26), so a policy written as "2nd
 * and 4th Saturday" lands on 8 and 22 in August and on 12 and 26 in September.
 * A month that had four Saturdays in both would let an off-by-one implementation
 * pass, which is why the boundary is crossed explicitly.
 *
 * The other half is what must NOT happen. An organization with no policy has to
 * behave exactly as it did before this existed — nothing off, targets unchanged
 * — because inventing Saturday-Sunday would silently mark absent every employee
 * of the many Indian companies that work a six-day week.
 */
class WeeklyOffResolverTest extends TestCase
{
    use RefreshDatabase;

    private function resolver(): WeeklyOffResolver
    {
        return app(WeeklyOffResolver::class);
    }

    private function organization(string $name, string $slug): Organization
    {
        return Organization::create(['name' => $name, 'slug' => $slug]);
    }

    private function employee(Organization $organization, string $email): User
    {
        return User::create([
            'name' => 'Employee',
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);
    }

    /** @param array<string, mixed> $rules */
    private function policy(Organization $organization, string $name, array $rules, bool $isDefault = false): WeeklyOffPolicy
    {
        return WeeklyOffPolicy::withoutOrganizationScope()->create([
            'organization_id' => $organization->id,
            'name' => $name,
            'day_rules' => $rules,
            'is_default' => $isDefault,
            'is_active' => true,
        ]);
    }

    /** @param array<string, mixed> $attributes */
    private function assign(User $user, WeeklyOffPolicy $policy, array $attributes = []): EmployeeWeeklyOffPolicy
    {
        return EmployeeWeeklyOffPolicy::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $policy->organization_id,
            'user_id' => $user->id,
            'weekly_off_policy_id' => $policy->id,
            'effective_from' => '2026-01-01',
            'effective_to' => null,
            'is_active' => true,
        ], $attributes));
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

    private function assignShift(User $user, Shift $shift): EmployeeShift
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

    /**
     * The off dates of a month, as day-of-month integers.
     *
     * @return list<int>
     */
    private function offDaysIn(User $user, int $year, int $month): array
    {
        $days = [];
        $last = (int) \Carbon\Carbon::create($year, $month, 1)->daysInMonth;

        for ($day = 1; $day <= $last; $day++) {
            $date = sprintf('%04d-%02d-%02d', $year, $month, $day);

            if ($this->resolver()->isWeeklyOff($user, $date)) {
                $days[] = $day;
            }
        }

        return $days;
    }

    public function test_a_sunday_only_policy_marks_sundays_off_and_leaves_saturdays_working(): void
    {
        // A six-day week is the common Indian arrangement and the one an
        // invented weekend would break. Sundays in August 2026: 2, 9, 16, 23, 30.
        $org = $this->organization('Six Day Co', 'six-day-co');
        $user = $this->employee($org, 'sunday@example.com');
        $this->assign($user, $this->policy($org, 'Sundays only', ['sunday' => 'every']));

        $this->assertSame([2, 9, 16, 23, 30], $this->offDaysIn($user, 2026, 8));

        foreach ([1, 8, 15, 22, 29] as $saturday) {
            $this->assertFalse(
                $this->resolver()->isWeeklyOff($user, sprintf('2026-08-%02d', $saturday)),
                "August {$saturday} 2026 is a Saturday and this policy works Saturdays."
            );
        }
    }

    public function test_second_and_fourth_saturday_lands_correctly_in_a_five_saturday_month(): void
    {
        // Hand-checked: August 2026 Saturdays are 1, 8, 15, 22 and 29. The 2nd
        // is the 8th and the 4th is the 22nd — NOT the 29th, which is the fifth
        // and the one a "last Saturday" reading would wrongly pick.
        $org = $this->organization('Alt Sat Co', 'alt-sat-co');
        $user = $this->employee($org, 'altsat@example.com');
        $this->assign($user, $this->policy($org, '2nd & 4th Sat', [
            'sunday' => 'every',
            'saturday' => [2, 4],
        ]));

        $this->assertSame([2, 8, 9, 16, 22, 23, 30], $this->offDaysIn($user, 2026, 8));
    }

    public function test_second_and_fourth_saturday_recomputes_across_the_month_boundary(): void
    {
        // The same assignment, read a month later. September 2026 Saturdays are
        // 5, 12, 19 and 26, so the 2nd and 4th are the 12th and the 26th. An
        // implementation that counted weeks from the assignment date instead of
        // ordinals within the month would answer 5 and 19 here.
        $org = $this->organization('Boundary Co', 'boundary-co');
        $user = $this->employee($org, 'boundary@example.com');
        $this->assign($user, $this->policy($org, '2nd & 4th Sat', ['saturday' => [2, 4]]));

        $this->assertSame([8, 22], $this->offDaysIn($user, 2026, 8));
        $this->assertSame([12, 26], $this->offDaysIn($user, 2026, 9));
    }

    public function test_an_alternate_week_pattern_counts_continuously_and_not_per_month(): void
    {
        // The other real arrangement: every other Saturday counted from a fixed
        // date, which does not reset in September. From Aug 1 2026 that is
        // Aug 1, 15, 29 then Sep 12 and 26.
        $org = $this->organization('Alternate Co', 'alternate-co');
        $user = $this->employee($org, 'alternate@example.com');
        $this->assign($user, $this->policy($org, 'Alternate Sat', [
            'saturday' => ['mode' => 'alternate', 'interval_weeks' => 2, 'anchor_date' => '2026-08-01'],
        ]));

        $this->assertSame([1, 15, 29], $this->offDaysIn($user, 2026, 8));
        $this->assertSame([12, 26], $this->offDaysIn($user, 2026, 9));
    }

    public function test_an_effective_dated_change_switches_policies_mid_month(): void
    {
        // The company moves from "every Saturday off" to "2nd and 4th only",
        // effective the 15th. The 8th resolves against the old policy and the
        // 22nd against the new one, and re-reading an earlier date after the
        // change must still give the old answer — that is the whole point of
        // appending a row rather than editing one.
        $org = $this->organization('Changing Co', 'changing-co');
        $user = $this->employee($org, 'change@example.com');

        $old = $this->policy($org, 'All Saturdays', ['saturday' => 'every']);
        $new = $this->policy($org, '2nd & 4th Sat', ['saturday' => [2, 4]]);

        $this->assign($user, $old, ['effective_from' => '2026-01-01', 'effective_to' => '2026-08-14']);
        $this->assign($user, $new, ['effective_from' => '2026-08-15']);

        // Under the old policy every Saturday is off.
        $this->assertTrue($this->resolver()->isWeeklyOff($user, '2026-08-01'));
        $this->assertTrue($this->resolver()->isWeeklyOff($user, '2026-08-08'));

        // Under the new one, the 15th (a 3rd Saturday) is a working day.
        $this->assertFalse($this->resolver()->isWeeklyOff($user, '2026-08-15'));
        $this->assertTrue($this->resolver()->isWeeklyOff($user, '2026-08-22'));
        $this->assertFalse($this->resolver()->isWeeklyOff($user, '2026-08-29'));

        $this->assertSame($old->id, $this->resolver()->policyFor($user, '2026-08-08')?->id);
        $this->assertSame($new->id, $this->resolver()->policyFor($user, '2026-08-22')?->id);
    }

    public function test_the_latest_window_wins_when_two_open_ended_assignments_overlap(): void
    {
        // Re-assignment normally leaves the previous row open-ended, exactly as
        // employee_shifts does, so overlapping windows are the normal state and
        // the later effective_from has to win.
        $org = $this->organization('Overlap Co', 'overlap-co');
        $user = $this->employee($org, 'overlap@example.com');

        $old = $this->policy($org, 'All Saturdays', ['saturday' => 'every']);
        $new = $this->policy($org, 'Sundays only', ['sunday' => 'every']);

        $this->assign($user, $old, ['effective_from' => '2026-01-01']);
        $this->assign($user, $new, ['effective_from' => '2026-08-10']);

        $this->assertSame($new->id, $this->resolver()->policyFor($user, '2026-08-15')?->id);
        $this->assertFalse($this->resolver()->isWeeklyOff($user, '2026-08-15'));
        $this->assertTrue($this->resolver()->isWeeklyOff($user, '2026-08-16'));
    }

    public function test_no_policy_assigned_means_nothing_is_off(): void
    {
        // The load-bearing negative. Before weekly-off policies existed nothing
        // was ever a weekly off, and an organization that has configured none
        // must keep that behaviour exactly — including on a Sunday.
        $org = $this->organization('Unconfigured Co', 'unconfigured-co');
        $user = $this->employee($org, 'nothing@example.com');

        foreach (['2026-08-15', '2026-08-16', '2026-08-19'] as $date) {
            $this->assertFalse(
                $this->resolver()->isWeeklyOff($user, $date),
                "{$date} was marked off for an organization with no weekly-off policy."
            );
        }

        $this->assertNull($this->resolver()->policyFor($user, '2026-08-16'));
    }

    public function test_the_organization_default_applies_to_anyone_with_no_assignment(): void
    {
        $org = $this->organization('Default Co', 'default-co');
        $user = $this->employee($org, 'default@example.com');
        $default = $this->policy($org, 'Company standard', ['sunday' => 'every'], true);

        $this->assertSame($default->id, $this->resolver()->policyFor($user, '2026-08-16')?->id);
        $this->assertTrue($this->resolver()->isWeeklyOff($user, '2026-08-16'));

        // An explicit assignment still outranks the default.
        $this->assign($user, $this->policy($org, 'Saturdays instead', ['saturday' => 'every']));

        $this->assertFalse($this->resolver()->isWeeklyOff($user, '2026-08-16'));
        $this->assertTrue($this->resolver()->isWeeklyOff($user, '2026-08-15'));
    }

    public function test_another_organizations_policies_are_never_read(): void
    {
        // Both halves of the tenancy boundary, because the resolver runs with
        // nobody authenticated (scheduler, queued job) where the global scope is
        // deliberately a no-op and only an explicit forOrganization() pin holds.
        $mine = $this->organization('Mine', 'mine');
        $theirs = $this->organization('Theirs', 'theirs');

        $me = $this->employee($mine, 'me@example.com');
        $them = $this->employee($theirs, 'them@example.com');

        // Their default policy must not become my default.
        $theirDefault = $this->policy($theirs, 'Their standard', ['sunday' => 'every', 'saturday' => 'every'], true);
        $this->assign($them, $theirDefault);

        $this->assertNull($this->resolver()->policyFor($me, '2026-08-16'));
        $this->assertFalse($this->resolver()->isWeeklyOff($me, '2026-08-16'));

        // And an assignment row naming me but stamped with their organization —
        // the shape a mis-scoped write or a drifted migration leaves behind —
        // must be invisible rather than authoritative.
        $this->assign($me, $theirDefault, ['organization_id' => $theirs->id]);

        $this->assertNull($this->resolver()->policyFor($me, '2026-08-16'));
        $this->assertFalse($this->resolver()->isWeeklyOff($me, '2026-08-16'));

        // Their own employee is unaffected by all of this.
        $this->assertTrue($this->resolver()->isWeeklyOff($them, '2026-08-16'));
    }

    public function test_a_weekly_off_zeroes_the_expected_hours_but_keeps_the_shift(): void
    {
        // The integration with ShiftResolver. A weekly off is "no hours are
        // expected", not "no shift exists": the occurrence has to survive so
        // work actually done on a weekly off still attaches to the right
        // attendance date and can be recognised as weekly-off overtime.
        $org = $this->organization('Integrated Co', 'integrated-co');
        $user = $this->employee($org, 'integrated@example.com');
        $this->assignShift($user, $this->shift($org));
        $this->assign($user, $this->policy($org, 'Sundays', ['sunday' => 'every']));

        $resolver = app(ShiftResolver::class);

        // Wednesday the 19th: an ordinary working day, untouched.
        $working = $resolver->resolve($user, '2026-08-19');
        $this->assertNotNull($working);
        $this->assertFalse($working->isWeeklyOff);
        $this->assertSame(8 * 3600, $working->expectedSeconds);
        $this->assertSame(8 * 3600, $resolver->expectedSecondsFor($user, '2026-08-19'));

        // Sunday the 16th: same shift, zero expected hours.
        $off = $resolver->resolve($user, '2026-08-16');
        $this->assertNotNull($off, 'The shift disappeared on a weekly off; punches on it would lose their occurrence.');
        $this->assertTrue($off->isWeeklyOff);
        $this->assertSame(0, $off->expectedSeconds);
        $this->assertSame(0, $resolver->expectedSecondsFor($user, '2026-08-16'));
        $this->assertNotNull($off->startsAt);
        $this->assertNotNull($off->endsAt);

        $occurrence = $resolver->occurrenceFor($user, '2026-08-16');
        $this->assertNotNull($occurrence);
        $this->assertTrue($occurrence->isWeeklyOff);
        $this->assertSame(0, $occurrence->expectedSeconds);
        $this->assertTrue($occurrence->toArray()['is_weekly_off']);
    }

    public function test_a_night_shift_starting_on_a_weekly_off_still_owns_its_after_midnight_punches(): void
    {
        // Somebody called in on their day off at 22:00 punches out at 01:30.
        // Those ninety minutes belong to the weekly off — that is what makes
        // them weekly-off overtime — so the attribution rule must not have been
        // switched off along with the expected hours.
        $org = $this->organization('Night Co', 'night-co');
        $user = $this->employee($org, 'night@example.com');
        $this->assignShift($user, $this->shift($org, [
            'name' => 'Night',
            'code' => 'NIGHT',
            'start_time' => '22:00:00',
            'end_time' => '06:00:00',
            'duration_minutes' => 480,
            'break_duration_minutes' => 0,
            'is_night_shift' => true,
        ]));
        $this->assign($user, $this->policy($org, 'Sundays', ['sunday' => 'every']));

        $resolver = app(ShiftResolver::class);

        $this->assertSame(
            '2026-08-16',
            $resolver->attendanceDateFor($user, '2026-08-17 01:30:00'),
            'A punch inside a shift that began on the weekly off was booked to the next day.'
        );
        $this->assertSame(0, $resolver->expectedSecondsFor($user, '2026-08-16'));
    }

    public function test_the_attendance_target_is_zero_on_a_weekly_off(): void
    {
        // shift_target_seconds is what the countdown and the overtime threshold
        // read. Falling through to the eight-hour config default on a weekly off
        // would tell an employee they owe a full day on their day off.
        $org = $this->organization('Target Co', 'target-co');
        $user = $this->employee($org, 'target@example.com');
        $this->assignShift($user, $this->shift($org));
        $this->assign($user, $this->policy($org, 'Sundays', ['sunday' => 'every']));

        $attendance = app(AttendanceService::class);

        $this->assertSame(8 * 3600, $attendance->shiftTargetSecondsFor($user, '2026-08-19'));
        $this->assertSame(0, $attendance->shiftTargetSecondsFor($user, '2026-08-16'));
    }

    public function test_an_organization_with_no_policy_keeps_its_eight_hour_default(): void
    {
        // The regression guard for every existing tenant: no policy anywhere,
        // no shift either, and the target is still what it was.
        $org = $this->organization('Legacy Co', 'legacy-co');
        $user = $this->employee($org, 'legacy@example.com');

        $attendance = app(AttendanceService::class);

        $this->assertSame(8 * 3600, $attendance->shiftTargetSecondsFor($user, '2026-08-16'));
        $this->assertNull(app(ShiftResolver::class)->expectedSecondsFor($user, '2026-08-16'));
    }
}
