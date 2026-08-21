<?php

namespace Tests\Feature;

use App\Models\EmployeeShift;
use App\Models\EmployeeShiftRotation;
use App\Models\Organization;
use App\Models\RosterDay;
use App\Models\Shift;
use App\Models\ShiftRotation;
use App\Models\ShiftRotationStep;
use App\Models\User;
use App\Services\Attendance\RosterService;
use App\Services\Attendance\ShiftResolver;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Tests\TestCase;

/**
 * Date-based rostering.
 *
 * Shift definitions already existed; this is the calendar on top of them. Four
 * properties matter more than the generation arithmetic:
 *
 *   a draft roster changes nothing anybody is measured against
 *   regenerating never destroys a decision somebody made by hand
 *   a rostered rest day is a rest day, not a fall-through to the usual shift
 *   a roster already worked is not rewritten
 */
class RosteringTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;
    private User $manager;
    private Shift $early;
    private Shift $night;
    private ShiftRotation $rotation;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-roster']);

        $this->employee = $this->makeUser('kajal@carevance.test', 'employee');
        $this->manager = $this->makeUser('manager@carevance.test', 'manager');

        $this->early = $this->makeShift('Early', 'EARLY', '06:00', '14:00');
        $this->night = $this->makeShift('Night', 'NIGHT', '22:00', '06:00');

        // Two early days, then a rest day. Three-day cycle.
        $this->rotation = ShiftRotation::query()->create([
            'organization_id' => $this->organization->id,
            'name' => 'Two on, one off',
            'cycle_length_days' => 3,
            'is_active' => true,
        ]);

        foreach ([[0, $this->early->id], [1, $this->early->id], [2, null]] as [$position, $shiftId]) {
            ShiftRotationStep::query()->create([
                'organization_id' => $this->organization->id,
                'shift_rotation_id' => $this->rotation->id,
                'position' => $position,
                'shift_id' => $shiftId,
            ]);
        }
    }

    private function makeUser(string $email, string $role): User
    {
        return User::create([
            'name' => explode('@', $email)[0],
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $this->organization->id,
        ]);
    }

    private function makeShift(string $name, string $code, string $start, string $end): Shift
    {
        return Shift::query()->create([
            'organization_id' => $this->organization->id,
            'name' => $name,
            'code' => $code,
            'start_time' => $start,
            'end_time' => $end,
            'duration_minutes' => 480,
            'break_duration_minutes' => 0,
            'is_active' => true,
        ]);
    }

    private function assign(User $user, int $offset = 0, ?string $from = null): EmployeeShiftRotation
    {
        return EmployeeShiftRotation::query()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'shift_rotation_id' => $this->rotation->id,
            'effective_from' => $from ?: now()->toDateString(),
            'start_offset' => $offset,
            'is_active' => true,
        ]);
    }


    /** The usual arrangement, so the roster has something to outrank. */
    private function standingAssignmentToNights(): void
    {
        EmployeeShift::query()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'shift_id' => $this->night->id,
            'effective_from' => now()->subYear()->toDateString(),
            'is_active' => true,
        ]);
    }

    private function roster(): RosterService
    {
        return app(RosterService::class);
    }

    private function dayFor(User $user, string $date): ?RosterDay
    {
        return RosterDay::query()
            ->where('user_id', $user->id)
            ->whereDate('roster_date', $date)
            ->first();
    }

    public function test_generation_follows_the_cycle_and_writes_rest_days_as_rows(): void
    {
        $this->assign($this->employee);
        $start = now()->startOfDay();

        $this->roster()->generateForUser($this->employee, $start, $start->copy()->addDays(2));

        $days = RosterDay::query()->where('user_id', $this->employee->id)->orderBy('roster_date')->get();

        $this->assertCount(3, $days);
        $this->assertSame($this->early->id, $days[0]->shift_id);
        $this->assertSame($this->early->id, $days[1]->shift_id);

        /*
         * A rest day is a ROW with no shift, not an absent row. "You are off on
         * Tuesday" and "nobody has scheduled you" are different things to be
         * told, and only one of them is a roster.
         */
        $this->assertNull($days[2]->shift_id);
        $this->assertTrue($days[2]->isRestDay());
    }

    public function test_generated_days_start_as_draft(): void
    {
        $this->assign($this->employee);
        $this->roster()->generateForUser($this->employee, now(), now()->addDay());

        // A manager can build next month without changing what attendance
        // expects of anybody today.
        $this->assertSame(['draft', 'draft'], RosterDay::query()
            ->where('user_id', $this->employee->id)->orderBy('roster_date')->pluck('status')->all());
    }

    public function test_a_draft_day_does_not_change_what_the_resolver_expects(): void
    {
        $this->assign($this->employee);
        $this->roster()->generateForUser($this->employee, now(), now()->addDay());

        // Nothing published, so nothing to say. The resolver falls through to
        // whatever it would have answered before the roster existed.
        $resolved = app(ShiftResolver::class)->resolve($this->employee->fresh(), now());

        $this->assertNull($resolved);
    }

    public function test_a_published_day_outranks_a_standing_assignment(): void
    {
        $this->assign($this->employee);

        // The usual arrangement says nights.
        $this->standingAssignmentToNights();

        $this->roster()->generateForUser($this->employee, now(), now());
        $this->roster()->publish($this->manager, now(), now());

        $resolved = app(ShiftResolver::class)->resolve($this->employee->fresh(), now());

        /*
         * An assignment says what somebody USUALLY works; a roster says what
         * they are working on Tuesday. Where they disagree the roster is the
         * one the employee was actually told.
         */
        $this->assertSame($this->early->id, $resolved?->shift?->id);
        $this->assertSame(ShiftResolver::SOURCE_ROSTER, $resolved?->source);
    }

    public function test_a_rostered_rest_day_does_not_fall_through_to_the_usual_shift(): void
    {
        $this->assign($this->employee);

        $this->standingAssignmentToNights();

        // Day 2 of the cycle is the rest day.
        $restDate = now()->copy()->addDays(2);
        $this->roster()->generateForUser($this->employee, now(), $restDate);
        $this->roster()->publish($this->manager, now(), $restDate);

        $resolved = app(ShiftResolver::class)->resolve($this->employee->fresh(), $restDate);

        /*
         * Falling through would hand back the standing assignment and quietly
         * expect a full night shift from somebody who was told they had the day
         * off.
         */
        $this->assertNull($resolved);
    }

    public function test_regenerating_does_not_destroy_a_manual_decision(): void
    {
        $this->assign($this->employee);
        $start = now()->startOfDay();
        $this->roster()->generateForUser($this->employee, $start, $start->copy()->addDays(2));

        // A manager moves them to nights on the second day.
        $manualDate = $start->copy()->addDay();
        $this->roster()->setDay($this->employee, $manualDate, $this->night, $this->manager, 'Covering for Ravi');

        $result = $this->roster()->generateForUser($this->employee, $start, $start->copy()->addDays(2));

        /*
         * The whole reason `source` exists. Somebody who moved one person to
         * nights on the 14th must not lose that because the rota was rebuilt.
         */
        $this->assertSame(1, $result['skipped_manual']);
        $this->assertSame($this->night->id, $this->dayFor($this->employee, $manualDate->toDateString())?->shift_id);
        $this->assertSame('Covering for Ravi', $this->dayFor($this->employee, $manualDate->toDateString())?->note);
    }

    public function test_a_roster_already_worked_is_not_rewritten(): void
    {
        $this->assign($this->employee, 0, now()->subMonth()->toDateString());

        $result = $this->roster()->generateForUser(
            $this->employee,
            now()->copy()->subDays(3),
            now()->copy()->addDay(),
        );

        /*
         * Last Tuesday's roster is a record of what people were told to work.
         * Rebuilding it would rewrite the expectation every attendance record
         * on that date was measured against.
         */
        $this->assertSame(3, $result['skipped_past']);
        $this->assertNull($this->dayFor($this->employee, now()->copy()->subDay()->toDateString()));
    }

    public function test_an_offset_puts_two_people_on_different_days(): void
    {
        $other = $this->makeUser('ravi@carevance.test', 'employee');

        $this->assign($this->employee, 0);
        // Started two days into the cycle, so today is their rest day.
        $this->assign($other, 2);

        $this->roster()->generateForUser($this->employee, now(), now());
        $this->roster()->generateForUser($other, now(), now());

        // Without an offset everybody on a rota rests together, which is the
        // opposite of what a rota is for.
        $this->assertSame($this->early->id, $this->dayFor($this->employee, now()->toDateString())?->shift_id);
        $this->assertNull($this->dayFor($other, now()->toDateString())?->shift_id);
    }

    public function test_publishing_reports_how_many_days_actually_moved(): void
    {
        $this->assign($this->employee);
        $this->roster()->generateForUser($this->employee, now(), now()->addDay());

        $first = $this->roster()->publish($this->manager, now(), now()->addDay());
        $second = $this->roster()->publish($this->manager, now(), now()->addDay());

        // A publish that silently affected nothing looks identical to one that
        // worked, and the manager needs to know which.
        $this->assertSame(2, $first);
        $this->assertSame(0, $second);
    }

    public function test_editing_a_published_day_leaves_it_published(): void
    {
        $this->assign($this->employee);
        $this->roster()->generateForUser($this->employee, now(), now());
        $this->roster()->publish($this->manager, now(), now());

        $this->roster()->setDay($this->employee, now(), $this->night, $this->manager);

        // Unpublishing somebody's Tuesday without telling them is worse than
        // changing it.
        $this->assertSame('published', $this->dayFor($this->employee, now()->toDateString())?->status);
    }

    public function test_coverage_lists_who_is_off_as_well_as_who_is_working(): void
    {
        $other = $this->makeUser('ravi@carevance.test', 'employee');
        $this->assign($this->employee, 0);
        $this->assign($other, 2);

        $this->roster()->generateForUser($this->employee, now(), now());
        $this->roster()->generateForUser($other, now(), now());
        $this->roster()->publish($this->manager, now(), now());

        $coverage = collect($this->roster()->coverageFor($this->organization->id, now()));

        // A cover report listing only the people working cannot answer "is
        // anybody on tonight", which is the question a rota exists for.
        $this->assertCount(2, $coverage);
        $this->assertTrue($coverage->firstWhere('user_id', $other->id)['is_rest_day']);
        $this->assertFalse($coverage->firstWhere('user_id', $this->employee->id)['is_rest_day']);
    }

    public function test_a_shift_from_another_workspace_cannot_be_rostered(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'other-roster']);
        $theirShift = Shift::withoutOrganizationScope()->create([
            'organization_id' => $other->id,
            'name' => 'Theirs',
            'code' => 'THEIRS',
            'start_time' => '09:00',
            'end_time' => '17:00',
            'duration_minutes' => 480,
            'is_active' => true,
        ]);

        $this->expectException(RuntimeException::class);
        $this->roster()->setDay($this->employee, now(), $theirShift, $this->manager);
    }

    public function test_a_backwards_range_is_refused(): void
    {
        $this->assign($this->employee);

        $this->expectException(RuntimeException::class);
        $this->roster()->generateForUser($this->employee, now()->addDays(5), now());
    }

    public function test_somebody_with_no_rotation_gets_no_roster(): void
    {
        $result = $this->roster()->generateForUser($this->employee, now(), now()->addDays(3));

        // Not an error. Plenty of people are not on a rota, and inventing days
        // for them would fill the calendar with shifts nobody assigned.
        $this->assertSame(0, $result['created']);
        $this->assertSame(0, RosterDay::query()->where('user_id', $this->employee->id)->count());
    }
}
