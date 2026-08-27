<?php

namespace Tests\Feature;

use App\Models\ChecklistItem;
use App\Models\ChecklistTemplate;
use App\Models\OnboardingJourney;
use App\Models\Organization;
use App\Models\User;
use App\Services\Lifecycle\OnboardingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * New Hires had no backend at all — it filtered the user list by joining date
 * in the browser. These cover the journey that replaces it, and the property
 * that makes the whole thing work: a journey exists before the employee does.
 */
class OnboardingJourneyTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'Org', 'slug' => 'org-onboarding']);
        $this->admin = $this->member('admin', 'ob-admin@example.com');
        $this->manager = $this->member('manager', 'ob-manager@example.com');
    }

    private function member(string $role, string $email): User
    {
        return User::create([
            'name' => ucfirst($role),
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $this->organization->id,
        ]);
    }

    private function onboarding(): OnboardingService
    {
        return app(OnboardingService::class);
    }

    public function test_a_journey_can_exist_before_the_employee_has_an_account(): void
    {
        $journey = $this->onboarding()->open(
            organizationId: $this->organization->id,
            candidateName: 'Priya Shah',
            candidateEmail: 'priya@example.com',
            joiningDate: now()->addDays(14),
            creator: $this->admin,
        );

        $this->assertNull($journey->user_id, 'Preboarding happens before the account exists');
        $this->assertSame(OnboardingJourney::STAGE_PREBOARDING, $journey->stage);
        $this->assertGreaterThan(0, $journey->checklistItems()->count());
    }

    public function test_due_dates_are_computed_as_offsets_from_the_joining_date(): void
    {
        $joining = now()->addDays(20)->startOfDay();

        $journey = $this->onboarding()->open(
            organizationId: $this->organization->id,
            candidateName: 'Arjun Bose',
            candidateEmail: 'arjun@example.com',
            joiningDate: $joining,
            creator: $this->admin,
        );

        $template = ChecklistTemplate::defaultFor($this->organization->id, 'onboarding');
        $offerItem = $template->items->firstWhere('offset_days', -14);

        $item = ChecklistItem::forSubject($journey)
            ->where('checklist_template_item_id', $offerItem->id)
            ->firstOrFail();

        $this->assertSame(
            $joining->copy()->subDays(14)->toDateString(),
            $item->due_date->toDateString(),
            'A -14 offset must land two weeks before the joining date'
        );
    }

    public function test_linking_the_account_backfills_the_candidate_own_items(): void
    {
        $journey = $this->onboarding()->open(
            organizationId: $this->organization->id,
            candidateName: 'Nikhil Verma',
            candidateEmail: 'nikhil@example.com',
            joiningDate: now()->addDays(7),
            creator: $this->admin,
        );

        $this->assertSame(
            0,
            ChecklistItem::forSubject($journey)->where('owner_kind', 'employee')->whereNotNull('owner_user_id')->count()
        );

        $newHire = $this->member('employee', 'nikhil@example.com');
        $this->onboarding()->linkUser($journey, $newHire);

        $this->assertGreaterThan(
            0,
            ChecklistItem::forSubject($journey)
                ->where('owner_kind', 'employee')
                ->where('owner_user_id', $newHire->id)
                ->count(),
            'Items waiting on "the employee" must find their owner once the account exists'
        );
    }

    public function test_materialising_twice_does_not_duplicate_the_checklist(): void
    {
        $journey = $this->onboarding()->open(
            organizationId: $this->organization->id,
            candidateName: 'Repeat Candidate',
            candidateEmail: 'repeat@example.com',
            joiningDate: now()->addDays(10),
            creator: $this->admin,
        );

        $before = ChecklistItem::forSubject($journey)->count();

        app(\App\Services\Lifecycle\ChecklistService::class)->materialise(
            $journey,
            ChecklistTemplate::defaultFor($this->organization->id, 'onboarding'),
            now()->addDays(10),
        );

        $this->assertSame($before, ChecklistItem::forSubject($journey)->count());
    }

    public function test_readiness_counts_only_blocking_overdue_as_an_alarm(): void
    {
        $journey = $this->onboarding()->open(
            organizationId: $this->organization->id,
            candidateName: 'Late Candidate',
            candidateEmail: 'late@example.com',
            joiningDate: now()->addDays(1),
            creator: $this->admin,
        );

        $readiness = $journey->fresh()->readiness;

        $this->assertGreaterThan(0, $readiness['total']);
        $this->assertSame(0, $readiness['done']);
        // Items dated before today are overdue; only the blocking ones count
        // as something that will actually stop Day 1.
        $this->assertGreaterThanOrEqual($readiness['blocking_overdue'], $readiness['overdue']);
    }

    public function test_the_sweep_moves_a_journey_out_of_preboarding_once_the_person_has_started(): void
    {
        $journey = $this->onboarding()->open(
            organizationId: $this->organization->id,
            candidateName: 'Started Already',
            candidateEmail: 'started@example.com',
            joiningDate: now()->subDays(3),
            creator: $this->admin,
        );

        // Force it back so the sweep has something to correct.
        $journey->update(['stage' => OnboardingJourney::STAGE_PREBOARDING]);

        $this->onboarding()->sweep();

        $this->assertSame(OnboardingJourney::STAGE_ONBOARDING, $journey->fresh()->stage);
    }

    /**
     * This used to assert that ninety days ALONE closed a journey, with every
     * blocking item still pending. That is the bug, not the contract: on
     * production a joiner from 25 May was marked `completed` with no signed
     * contract, no email account and no laptop, and vanished from New Hires
     * with nobody told.
     *
     * Time passing is not the same as work being done, so the fixture now
     * settles the blocking items — which is what "done" is supposed to mean.
     * `OnboardingSweepBlockingWorkTest` covers the other half: outstanding
     * blocking work keeps the journey open and visible.
     */
    public function test_the_sweep_closes_a_finished_journey_after_ninety_days(): void
    {
        $journey = $this->onboarding()->open(
            organizationId: $this->organization->id,
            candidateName: 'Long Done',
            candidateEmail: 'longdone@example.com',
            joiningDate: now()->subDays(120),
            creator: $this->admin,
        );

        ChecklistItem::forSubject($journey)
            ->where('is_blocking', true)
            ->update(['status' => ChecklistItem::STATUS_DONE, 'completed_at' => now()]);

        $this->onboarding()->sweep();

        $this->assertSame(OnboardingJourney::STAGE_COMPLETED, $journey->fresh()->stage);
        $this->assertNotNull($journey->fresh()->completed_at);
    }

    public function test_a_joiner_can_complete_their_own_item_but_not_somebody_elses(): void
    {
        $newHire = $this->member('employee', 'joiner@example.com');

        $journey = $this->onboarding()->open(
            organizationId: $this->organization->id,
            candidateName: 'Joiner',
            candidateEmail: 'joiner@example.com',
            joiningDate: now()->addDays(5),
            attributes: ['user_id' => $newHire->id],
            creator: $this->admin,
        );
        $this->onboarding()->linkUser($journey, $newHire);

        /*
         * Deliberately the acknowledgement item, not the first employee-owned
         * row. The document items now refuse a manual tick outright — they
         * complete themselves from the upload — so completing one is a 422 for
         * everybody and would test the wrong rule here.
         */
        $ownItem = ChecklistItem::forSubject($journey)
            ->where('owner_kind', 'employee')
            ->where('requires', 'acknowledgement')
            ->firstOrFail();
        $itItem = ChecklistItem::forSubject($journey)->where('owner_kind', 'it')->firstOrFail();

        $this->postJson(
            "/api/onboarding/journeys/{$journey->id}/items/{$ownItem->id}/complete",
            [],
            $this->apiHeadersFor($newHire)
        )->assertOk();

        $this->postJson(
            "/api/onboarding/journeys/{$journey->id}/items/{$itItem->id}/complete",
            [],
            $this->apiHeadersFor($newHire)
        )->assertStatus(403);
    }

    public function test_admins_can_create_a_journey_over_the_api(): void
    {
        $this->postJson('/api/onboarding/journeys', [
            'candidate_name' => 'Api Candidate',
            'candidate_email' => 'api@example.com',
            'joining_date' => now()->addDays(21)->toDateString(),
            'job_title' => 'Backend Engineer',
            'manager_id' => $this->manager->id,
        ], $this->apiHeadersFor($this->admin))
            ->assertCreated()
            ->assertJsonPath('data.candidate_name', 'Api Candidate');

        $journey = OnboardingJourney::where('candidate_email', 'api@example.com')->firstOrFail();
        $this->assertSame($this->manager->id, $journey->manager_id);

        // Manager-owned items should already point at the named manager.
        $this->assertGreaterThan(
            0,
            ChecklistItem::forSubject($journey)
                ->where('owner_kind', 'manager')
                ->where('owner_user_id', $this->manager->id)
                ->count()
        );
    }

    public function test_the_default_template_is_created_once_and_reused(): void
    {
        $this->onboarding()->open(
            organizationId: $this->organization->id,
            candidateName: 'First',
            candidateEmail: 'first@example.com',
            joiningDate: now()->addDays(3),
            creator: $this->admin,
        );

        $this->onboarding()->open(
            organizationId: $this->organization->id,
            candidateName: 'Second',
            candidateEmail: 'second@example.com',
            joiningDate: now()->addDays(4),
            creator: $this->admin,
        );

        $this->assertSame(
            1,
            ChecklistTemplate::where('organization_id', $this->organization->id)
                ->where('kind', 'onboarding')
                ->count()
        );
    }
}
