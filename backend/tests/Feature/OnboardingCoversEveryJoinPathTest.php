<?php

namespace Tests\Feature;

use App\Models\Invitation;
use App\Models\OnboardingJourney;
use App\Models\Organization;
use App\Models\User;
use App\Services\Invitations\InvitationService;
use App\Services\Lifecycle\OnboardingService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Onboarding has to open no matter how the person got into the system.
 *
 * The Add User screen offers four routes — create directly, invite by email,
 * invite by link, import a CSV — and for a long time only the first opened a
 * journey, because OnboardingService::open() had exactly one caller. The other
 * three produced an account with no checklist, no blocking gates and nothing in
 * anyone's queue. These tests exist so that cannot silently return.
 */
class OnboardingCoversEveryJoinPathTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);
    }

    private function invitationFor(string $email, array $metadata = []): Invitation
    {
        return Invitation::create([
            'organization_id' => $this->organization->id,
            'email' => $email,
            'role' => 'employee',
            'token_hash' => Invitation::hashPublicToken(Invitation::generatePublicToken()),
            'invited_by' => $this->admin->id,
            'status' => 'pending',
            'metadata' => $metadata,
            'delivery_method' => 'email',
            'expires_at' => now()->addDays(3),
        ]);
    }

    public function test_accepting_an_invitation_opens_an_onboarding_journey(): void
    {
        $invitation = $this->invitationFor('invited.joiner@example.test');

        $user = app(InvitationService::class)->accept($invitation, [
            'name' => 'Invited Joiner',
            'password' => 'Str0ng!Passw0rd',
        ]);

        $journey = OnboardingJourney::where('user_id', $user->id)->first();

        $this->assertNotNull(
            $journey,
            'Accepting an invitation must open an onboarding journey — this is the '
            .'regression that left invited employees with no checklist at all.'
        );
        $this->assertSame($invitation->id, $journey->invitation_id);
        $this->assertGreaterThan(0, $journey->checklistItems()->count());
    }

    public function test_invited_joiner_receives_their_own_checklist_items(): void
    {
        $invitation = $this->invitationFor('owns.items@example.test');

        $user = app(InvitationService::class)->accept($invitation, [
            'name' => 'Owns Items',
            'password' => 'Str0ng!Passw0rd',
        ]);

        $journey = OnboardingJourney::where('user_id', $user->id)->firstOrFail();

        $employeeItems = $journey->checklistItems()
            ->where('owner_kind', 'employee')
            ->get();

        $this->assertGreaterThan(0, $employeeItems->count());

        // Every item the employee owns has to point at their account, or the
        // joiner opens /onboarding/my-journey to an empty list.
        foreach ($employeeItems as $item) {
            $this->assertSame(
                $user->id,
                $item->owner_user_id,
                "Employee-owned item '{$item->title}' was not assigned to the joiner."
            );
        }
    }

    public function test_a_journey_raised_before_the_account_is_linked_not_duplicated(): void
    {
        $invitation = $this->invitationFor('preboarded@example.test');
        $onboarding = app(OnboardingService::class);

        // Preboarding: the journey is raised while the person is still a
        // candidate, so IT and HR can start before there is an account.
        $preboarded = $onboarding->open(
            organizationId: $this->organization->id,
            candidateName: 'Preboarded Person',
            candidateEmail: 'preboarded@example.test',
            joiningDate: Carbon::now()->addDays(10),
            attributes: ['invitation_id' => $invitation->id],
            creator: $this->admin,
        );

        $this->assertNull($preboarded->user_id);

        $user = app(InvitationService::class)->accept($invitation, [
            'name' => 'Preboarded Person',
            'password' => 'Str0ng!Passw0rd',
        ]);

        $this->assertSame(
            1,
            OnboardingJourney::where('invitation_id', $invitation->id)->count(),
            'Accepting an invitation that already has a journey must bind to it, not open a second.'
        );

        $this->assertSame($user->id, $preboarded->fresh()->user_id);
    }

    public function test_checklist_items_are_never_born_overdue(): void
    {
        // Joining in three days, but the template reaches back to day -14. Six
        // items would otherwise be due before the journey existed.
        $joining = Carbon::now()->addDays(3);

        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        $journey = app(OnboardingService::class)->ensureForUser(
            user: $user,
            creator: $this->admin,
            joiningDate: $joining,
        );

        $today = Carbon::now()->startOfDay();

        foreach ($journey->checklistItems as $item) {
            $this->assertTrue(
                Carbon::parse($item->due_date)->startOfDay()->greaterThanOrEqualTo($today),
                "Item '{$item->title}' was created already overdue (due {$item->due_date})."
            );
        }
    }

    public function test_future_dated_items_keep_their_real_offset(): void
    {
        // Clamping must only lift items out of the past. A joiner starting in
        // 60 days should still see day-30 and day-90 reviews land where the
        // template puts them, not bunched onto today.
        $joining = Carbon::now()->addDays(60);

        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        $journey = app(OnboardingService::class)->ensureForUser(
            user: $user,
            creator: $this->admin,
            joiningDate: $joining,
        );

        $probation = $journey->checklistItems
            ->firstWhere('title', 'Probation review and confirmation');

        $this->assertNotNull($probation);
        $this->assertSame(
            $joining->copy()->addDays(90)->toDateString(),
            Carbon::parse($probation->due_date)->toDateString(),
            'A +90 item must stay 90 days after joining, not be pulled forward by the floor.'
        );
    }

    public function test_ensure_for_user_is_idempotent(): void
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        $onboarding = app(OnboardingService::class);
        $first = $onboarding->ensureForUser(user: $user, creator: $this->admin);
        $second = $onboarding->ensureForUser(user: $user, creator: $this->admin);

        $this->assertSame($first->id, $second->id);
        $this->assertSame(1, OnboardingJourney::where('user_id', $user->id)->count());
    }
}
