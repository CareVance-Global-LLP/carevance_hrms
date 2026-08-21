<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\RosterDay;
use App\Models\Shift;
use App\Models\ShiftSwapRequest;
use App\Models\User;
use App\Services\Attendance\ShiftSwapService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Tests\TestCase;

/**
 * Trading rostered days.
 *
 * THREE PARTIES, NOT TWO. One person cannot give away their shift, and two
 * people cannot rewrite the site's cover between them — which is exactly what a
 * two-party swap allows on a rota that exists to guarantee cover.
 *
 * And nothing moves until approval. A product that swapped optimistically and
 * rolled back on refusal would be telling people to come in and then telling
 * them not to.
 */
class ShiftSwapTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $kajal;
    private User $ravi;
    private User $manager;
    private Shift $early;
    private Shift $night;
    private RosterDay $kajalDay;
    private RosterDay $raviDay;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-swap']);

        $this->kajal = $this->makeUser('kajal@carevance.test');
        $this->ravi = $this->makeUser('ravi@carevance.test');
        $this->manager = $this->makeUser('manager@carevance.test', 'manager');

        $this->early = $this->makeShift('Early', 'EARLY');
        $this->night = $this->makeShift('Night', 'NIGHT');

        $date = now()->copy()->addDays(3)->toDateString();

        $this->kajalDay = $this->makeDay($this->kajal, $date, $this->early);
        $this->raviDay = $this->makeDay($this->ravi, $date, $this->night);
    }

    private function makeUser(string $email, string $role = 'employee'): User
    {
        return User::create([
            'name' => explode('@', $email)[0],
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $this->organization->id,
        ]);
    }

    private function makeShift(string $name, string $code): Shift
    {
        return Shift::query()->create([
            'organization_id' => $this->organization->id,
            'name' => $name,
            'code' => $code,
            'start_time' => '09:00',
            'end_time' => '17:00',
            'duration_minutes' => 480,
            'is_active' => true,
        ]);
    }

    private function makeDay(User $user, string $date, ?Shift $shift, string $status = 'published'): RosterDay
    {
        return RosterDay::query()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'roster_date' => $date,
            'shift_id' => $shift?->id,
            'status' => $status,
            'source' => 'generated',
            'published_at' => $status === 'published' ? now() : null,
        ]);
    }

    private function swaps(): ShiftSwapService
    {
        return app(ShiftSwapService::class);
    }

    private function ask(): ShiftSwapRequest
    {
        return $this->swaps()->request($this->kajal, $this->kajalDay, $this->raviDay, 'Family commitment');
    }

    public function test_a_request_waits_on_the_other_person_first(): void
    {
        $request = $this->ask();

        $this->assertSame('pending_counterparty', $request->status);
        $this->assertSame($this->ravi->id, $request->requested_with);
    }

    public function test_nothing_moves_on_the_roster_until_it_is_approved(): void
    {
        $this->ask();

        /*
         * Swapping optimistically and rolling back on refusal means telling
         * people to come in and then telling them not to.
         */
        $this->assertSame($this->early->id, $this->kajalDay->fresh()->shift_id);
        $this->assertSame($this->night->id, $this->raviDay->fresh()->shift_id);
    }

    public function test_accepting_is_not_enough_on_its_own(): void
    {
        $request = $this->swaps()->accept($this->ask(), $this->ravi);

        // Two people agreeing cannot rewrite the site's cover between them.
        $this->assertSame('pending_approval', $request->status);
        $this->assertSame($this->early->id, $this->kajalDay->fresh()->shift_id);
    }

    public function test_approval_actually_trades_the_days(): void
    {
        $request = $this->swaps()->accept($this->ask(), $this->ravi);
        $this->swaps()->approve($request, $this->manager);

        $this->assertSame($this->night->id, $this->kajalDay->fresh()->shift_id);
        $this->assertSame($this->early->id, $this->raviDay->fresh()->shift_id);
    }

    public function test_a_swapped_day_is_marked_so_regeneration_leaves_it_alone(): void
    {
        $request = $this->swaps()->accept($this->ask(), $this->ravi);
        $this->swaps()->approve($request, $this->manager);

        // Both `swap` and `manual` survive a rebuild, but a roster somebody
        // reads later should say which of the two happened.
        $this->assertSame('swap', $this->kajalDay->fresh()->source);
        $this->assertTrue($this->kajalDay->fresh()->isHumanSet());
    }

    public function test_only_the_person_asked_can_accept(): void
    {
        $stranger = $this->makeUser('stranger@carevance.test');

        $this->expectException(RuntimeException::class);
        $this->swaps()->accept($this->ask(), $stranger);
    }

    public function test_you_cannot_offer_somebody_elses_day(): void
    {
        // Giving away a shift that is not yours is not a swap, it is a
        // reassignment — and that is a manager's decision.
        $this->expectException(RuntimeException::class);
        $this->swaps()->request($this->kajal, $this->raviDay, $this->kajalDay);
    }

    public function test_a_draft_day_cannot_be_swapped(): void
    {
        $draft = $this->makeDay($this->ravi, now()->copy()->addDays(4)->toDateString(), $this->night, 'draft');

        // Trading something neither person has been told about yet.
        $this->expectException(RuntimeException::class);
        $this->swaps()->request($this->kajal, $this->kajalDay, $draft);
    }

    public function test_a_day_already_past_cannot_be_swapped(): void
    {
        $past = $this->makeDay($this->kajal, now()->copy()->subDay()->toDateString(), $this->early);
        $theirPast = $this->makeDay($this->ravi, now()->copy()->subDay()->toDateString(), $this->night);

        // Changing the record of what somebody was told to do, after they did
        // it.
        $this->expectException(RuntimeException::class);
        $this->swaps()->request($this->kajal, $past, $theirPast);
    }

    public function test_a_day_cannot_have_two_swaps_in_flight(): void
    {
        $this->ask();

        $third = $this->makeUser('meera@carevance.test');
        $theirDay = $this->makeDay($third, $this->kajalDay->roster_date->toDateString(), $this->night);

        /*
         * Two live requests race to swap the same day, and whichever is
         * approved second is approving against a roster that has already moved.
         */
        $this->expectException(RuntimeException::class);
        $this->swaps()->request($this->kajal, $this->kajalDay, $theirDay);
    }

    public function test_a_refusal_needs_a_reason(): void
    {
        $this->expectException(RuntimeException::class);
        $this->swaps()->decline($this->ask(), $this->ravi, '   ');
    }

    public function test_a_declined_swap_leaves_the_roster_untouched(): void
    {
        $declined = $this->swaps()->decline($this->ask(), $this->ravi, 'I am away that week');

        $this->assertSame('declined', $declined->status);
        $this->assertSame('I am away that week', $declined->decline_reason);
        $this->assertSame($this->early->id, $this->kajalDay->fresh()->shift_id);
    }

    public function test_only_the_requester_can_withdraw(): void
    {
        $this->expectException(RuntimeException::class);
        $this->swaps()->cancel($this->ask(), $this->ravi);
    }

    public function test_a_decided_request_cannot_be_decided_again(): void
    {
        $request = $this->swaps()->accept($this->ask(), $this->ravi);
        $this->swaps()->approve($request, $this->manager);

        $this->expectException(RuntimeException::class);
        $this->swaps()->decline($request->fresh(), $this->manager, 'Changed my mind');
    }

    public function test_swapping_with_yourself_is_refused(): void
    {
        $mine = $this->makeDay($this->kajal, now()->copy()->addDays(5)->toDateString(), $this->night);

        $this->expectException(RuntimeException::class);
        $this->swaps()->request($this->kajal, $this->kajalDay, $mine);
    }
}
