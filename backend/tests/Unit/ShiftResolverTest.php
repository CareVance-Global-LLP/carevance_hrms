<?php

namespace Tests\Unit;

use App\Models\EmployeeShift;
use App\Models\EmployeeWorkInfo;
use App\Models\Organization;
use App\Models\Shift;
use App\Models\User;
use App\Services\Attendance\ShiftResolver;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The shift domain answers exactly one question: which shift applies to this
 * person on this calendar date, and how long is it.
 *
 * Everything downstream (the attendance target, the countdown, overtime) reads
 * that answer. The resolver deliberately returns NULL when nothing is
 * configured rather than inventing eight hours — the eight-hour default is a
 * property of the attendance payload, not of the shift domain, and baking it in
 * here would make "no shift configured" indistinguishable from "a shift that
 * happens to be eight hours".
 */
class ShiftResolverTest extends TestCase
{
    use RefreshDatabase;

    private function resolver(): ShiftResolver
    {
        return app(ShiftResolver::class);
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
    private function assign(User $user, Shift $shift, array $attributes = []): EmployeeShift
    {
        return EmployeeShift::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $shift->organization_id,
            'user_id' => $user->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-01-01',
            'effective_to' => null,
            'is_active' => true,
        ], $attributes));
    }

    public function test_resolves_the_assignment_whose_window_contains_the_date(): void
    {
        $org = $this->organization('Org', 'org');
        $user = $this->employee($org, 'a@example.com');
        $shift = $this->shift($org, ['name' => 'Morning', 'code' => 'MOR']);
        $this->assign($user, $shift, ['effective_from' => '2026-08-01', 'effective_to' => '2026-08-31']);

        $resolved = $this->resolver()->resolve($user, '2026-08-19');

        $this->assertNotNull($resolved);
        $this->assertSame($shift->id, $resolved->shift?->id);
        $this->assertSame('assignment', $resolved->source);
    }

    public function test_a_date_outside_every_assignment_window_resolves_to_nothing(): void
    {
        $org = $this->organization('Org', 'org');
        $user = $this->employee($org, 'a@example.com');
        $shift = $this->shift($org);
        $this->assign($user, $shift, ['effective_from' => '2026-08-01', 'effective_to' => '2026-08-31']);

        $this->assertNull($this->resolver()->resolve($user, '2026-07-31'));
        $this->assertNull($this->resolver()->resolve($user, '2026-09-01'));
        $this->assertNull($this->resolver()->expectedSecondsFor($user, '2026-07-31'));
    }

    public function test_the_latest_effective_from_wins_when_assignments_overlap(): void
    {
        $org = $this->organization('Org', 'org');
        $user = $this->employee($org, 'a@example.com');

        $old = $this->shift($org, ['name' => 'Old', 'code' => 'OLD', 'duration_minutes' => 540]);
        $new = $this->shift($org, ['name' => 'New', 'code' => 'NEW', 'duration_minutes' => 420]);

        // The older assignment is open-ended, so BOTH windows contain the date.
        $this->assign($user, $old, ['effective_from' => '2026-01-01', 'effective_to' => null]);
        $this->assign($user, $new, ['effective_from' => '2026-08-15', 'effective_to' => null]);

        $resolved = $this->resolver()->resolve($user, '2026-08-19');

        $this->assertSame($new->id, $resolved?->shift?->id, 'The most recent assignment must win.');
        $this->assertSame((420 - 60) * 60, $resolved?->expectedSeconds);
    }

    public function test_a_null_effective_to_is_open_ended(): void
    {
        $org = $this->organization('Org', 'org');
        $user = $this->employee($org, 'a@example.com');
        $shift = $this->shift($org);
        $this->assign($user, $shift, ['effective_from' => '2026-01-01', 'effective_to' => null]);

        $this->assertNotNull($this->resolver()->resolve($user, '2030-12-31'));
    }

    public function test_an_inactive_assignment_is_ignored(): void
    {
        $org = $this->organization('Org', 'org');
        $user = $this->employee($org, 'a@example.com');
        $shift = $this->shift($org);
        $this->assign($user, $shift, ['is_active' => false]);

        $this->assertNull($this->resolver()->resolve($user, '2026-08-19'));
    }

    public function test_applicable_days_excludes_a_day_the_shift_does_not_run(): void
    {
        $org = $this->organization('Org', 'org');
        $user = $this->employee($org, 'a@example.com');
        $shift = $this->shift($org, [
            'applicable_days' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        ]);
        $this->assign($user, $shift);

        // 2026-08-19 is a Wednesday, 2026-08-23 a Sunday.
        $this->assertSame('Wednesday', Carbon::parse('2026-08-19')->format('l'));
        $this->assertSame('Sunday', Carbon::parse('2026-08-23')->format('l'));

        $this->assertNotNull($this->resolver()->resolve($user, '2026-08-19'));
        $this->assertNull($this->resolver()->resolve($user, '2026-08-23'));
        $this->assertNull($this->resolver()->expectedSecondsFor($user, '2026-08-23'));
    }

    public function test_applicable_days_accepts_numeric_day_conventions(): void
    {
        $org = $this->organization('Org', 'org');
        $user = $this->employee($org, 'a@example.com');
        // 0 means Sunday in the zero-based convention; 7 means Sunday in ISO-8601.
        $shift = $this->shift($org, ['applicable_days' => [0, 6]]);
        $this->assign($user, $shift);

        $this->assertNotNull($this->resolver()->resolve($user, '2026-08-23')); // Sunday
        $this->assertNotNull($this->resolver()->resolve($user, '2026-08-22')); // Saturday
        $this->assertNull($this->resolver()->resolve($user, '2026-08-19'));    // Wednesday
    }

    public function test_a_shift_in_another_organization_never_resolves_for_this_user(): void
    {
        $mine = $this->organization('Mine', 'mine');
        $theirs = $this->organization('Theirs', 'theirs');

        $myUser = $this->employee($mine, 'mine@example.com');
        $theirUser = $this->employee($theirs, 'theirs@example.com');

        $foreignShift = $this->shift($theirs, ['name' => 'Foreign', 'code' => 'FGN']);

        // Planted as a seeder or a bug would write it: an assignment row that
        // names MY user but belongs to the other tenant.
        EmployeeShift::withoutOrganizationScope()->create([
            'organization_id' => $theirs->id,
            'user_id' => $myUser->id,
            'shift_id' => $foreignShift->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);

        $this->assertNull(
            $this->resolver()->resolve($myUser, '2026-08-19'),
            'A cross-tenant assignment resolved for a user in another organization.'
        );

        // And the other tenant's own employee still resolves normally.
        $this->assign($theirUser, $foreignShift);
        $this->assertSame($foreignShift->id, $this->resolver()->resolve($theirUser, '2026-08-19')?->shift?->id);
    }

    public function test_expected_seconds_is_the_shift_span_minus_its_unpaid_break(): void
    {
        $org = $this->organization('Org', 'org');
        $user = $this->employee($org, 'a@example.com');
        $shift = $this->shift($org, ['duration_minutes' => 540, 'break_duration_minutes' => 60]);
        $this->assign($user, $shift);

        $this->assertSame(8 * 3600, $this->resolver()->expectedSecondsFor($user, '2026-08-19'));
    }

    public function test_a_night_shift_instance_ends_on_the_next_calendar_date(): void
    {
        $org = $this->organization('Org', 'org');
        $user = $this->employee($org, 'a@example.com');
        $shift = $this->shift($org, [
            'name' => 'Night',
            'code' => 'NGT',
            'type' => 'night',
            'is_night_shift' => true,
            'start_time' => '22:00:00',
            'end_time' => '06:00:00',
            'duration_minutes' => 480,
            'break_duration_minutes' => 30,
        ]);
        $this->assign($user, $shift);

        $resolved = $this->resolver()->resolve($user, '2026-08-19');

        $this->assertNotNull($resolved);
        $this->assertSame('2026-08-19', $resolved->attendanceDate->toDateString());
        $this->assertSame('2026-08-19 22:00:00', $resolved->startsAt?->format('Y-m-d H:i:s'));
        $this->assertSame('2026-08-20 06:00:00', $resolved->endsAt?->format('Y-m-d H:i:s'));
        $this->assertTrue($resolved->crossesMidnight());
        $this->assertSame((480 - 30) * 60, $resolved->expectedSeconds);
    }

    public function test_a_day_shift_instance_stays_on_the_attendance_date(): void
    {
        $org = $this->organization('Org', 'org');
        $user = $this->employee($org, 'a@example.com');
        $this->assign($user, $this->shift($org));

        $resolved = $this->resolver()->resolve($user, '2026-08-19');

        $this->assertSame('2026-08-19 18:00:00', $resolved?->endsAt?->format('Y-m-d H:i:s'));
        $this->assertFalse($resolved?->crossesMidnight());
    }

    public function test_work_info_shift_name_is_the_fallback_when_no_assignment_exists(): void
    {
        $org = $this->organization('Org', 'org');
        $user = $this->employee($org, 'a@example.com');
        $shift = $this->shift($org, [
            'name' => 'Evening',
            'code' => 'EVE',
            'duration_minutes' => 480,
            'break_duration_minutes' => 30,
        ]);

        EmployeeWorkInfo::withoutOrganizationScope()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'shift_name' => 'evening',
        ]);

        $resolved = $this->resolver()->resolve($user, '2026-08-19');

        $this->assertSame($shift->id, $resolved?->shift?->id);
        $this->assertSame('work_info_shift', $resolved?->source);
        $this->assertSame((480 - 30) * 60, $resolved?->expectedSeconds);
    }

    public function test_work_info_start_time_alone_gives_a_start_but_no_length(): void
    {
        $org = $this->organization('Org', 'org');
        $user = $this->employee($org, 'a@example.com');

        EmployeeWorkInfo::withoutOrganizationScope()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'shift_name' => 'Something nobody configured',
            'expected_start_time' => '10:30:00',
        ]);

        $resolved = $this->resolver()->resolve($user, '2026-08-19');

        $this->assertNotNull($resolved);
        $this->assertNull($resolved->shift);
        $this->assertSame('work_info_time', $resolved->source);
        $this->assertSame('2026-08-19 10:30:00', $resolved->startsAt?->format('Y-m-d H:i:s'));
        $this->assertNull(
            $resolved->expectedSeconds,
            'A start time with no length must not be turned into a guessed shift length.'
        );
    }

    public function test_nothing_configured_resolves_to_null_and_never_to_eight_hours(): void
    {
        $org = $this->organization('Org', 'org');
        $user = $this->employee($org, 'a@example.com');

        $this->assertNull($this->resolver()->resolve($user, '2026-08-19'));
        $this->assertNull($this->resolver()->expectedSecondsFor($user, '2026-08-19'));
    }
}
