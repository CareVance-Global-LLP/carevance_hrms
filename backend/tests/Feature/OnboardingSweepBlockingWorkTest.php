<?php

namespace Tests\Feature;

use App\Models\ChecklistItem;
use App\Models\OnboardingJourney;
use App\Models\Organization;
use App\Models\User;
use App\Services\Lifecycle\OnboardingService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Time passing is not the same as work being done.
 *
 * The daily sweep completed any journey 90 days past its joining date,
 * regardless of its checklist. Found on production 25 Aug 2026: a joiner from
 * 25 May was `stage=completed` with THREE BLOCKING items outstanding — no
 * signed contract, no email account, no laptop — and had silently disappeared
 * from New Hires. The person who noticed assumed uploading a document had
 * deleted her.
 *
 * "Completed" over outstanding blocking work is a false statement, in exactly
 * the sense that ticking "Add PAN details" for somebody with no PAN is. The
 * status claims something nobody did, and the cost lands on whoever needed the
 * contract signed.
 *
 * A journey with blocking work left now stays OPEN and stays visible. Its stage
 * still advances, so it reads as in-progress and overdue — which is true, and
 * which is the only state that gets it finished. An unfinished journey nobody
 * can see is the one outcome worse than a late one.
 */
class OnboardingSweepBlockingWorkTest extends TestCase
{
    use RefreshDatabase;

    private OnboardingService $service;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();

        $this->service = app(OnboardingService::class);
        $this->organization = Organization::factory()->create();
    }

    public function test_a_journey_past_ninety_days_completes_when_nothing_blocking_remains(): void
    {
        $journey = $this->journeyJoining('2026-01-01');
        $this->settleAllBlockingItems($journey);

        $this->service->sweep(Carbon::parse('2026-06-01'));

        $this->assertSame(
            OnboardingJourney::STAGE_COMPLETED,
            $journey->fresh()->stage,
            'a finished journey well past 90 days should close'
        );
    }

    public function test_a_journey_past_ninety_days_stays_open_while_blocking_work_is_outstanding(): void
    {
        // Nisha's case, reduced: joined 25 May, swept on 25 Aug, contract still
        // unsigned. Ninety-two days had passed and nothing had been done.
        $journey = $this->journeyJoining('2026-05-25');

        $this->service->sweep(Carbon::parse('2026-08-25'));

        $fresh = $journey->fresh();

        $this->assertNotSame(
            OnboardingJourney::STAGE_COMPLETED,
            $fresh->stage,
            'blocking work outstanding must not be reported as completed'
        );
        $this->assertNull($fresh->completed_at, 'nothing completed it, so it has no completion time');
    }

    public function test_the_stage_still_advances_so_it_reads_as_overdue_not_frozen(): void
    {
        // Staying open must not mean staying in "preboarding" forever — that
        // reads as "not started" when the truth is "started and overdue".
        $journey = $this->journeyJoining('2026-05-25');

        $this->service->sweep(Carbon::parse('2026-08-25'));

        $this->assertSame(
            OnboardingJourney::STAGE_ONBOARDING,
            $journey->fresh()->stage,
            'the stage should reflect where the journey actually is'
        );
    }

    public function test_a_skipped_blocking_item_does_not_hold_the_journey_open(): void
    {
        // Skipping is a decision somebody made. Pending is one nobody has.
        $journey = $this->journeyJoining('2026-01-01');

        ChecklistItem::forSubject($journey)
            ->where('is_blocking', true)
            ->update(['status' => ChecklistItem::STATUS_SKIPPED]);

        $this->service->sweep(Carbon::parse('2026-06-01'));

        $this->assertSame(OnboardingJourney::STAGE_COMPLETED, $journey->fresh()->stage);
    }

    public function test_a_pending_non_blocking_item_does_not_hold_it_open_either(): void
    {
        // A "60-day review" left pending is a reminder, not a gate. Holding the
        // journey open for one would keep every joiner in New Hires forever,
        // which is how a list stops being read at all.
        $journey = $this->journeyJoining('2026-01-01');
        $this->settleAllBlockingItems($journey);

        $this->assertTrue(
            ChecklistItem::forSubject($journey)->where('is_blocking', false)->outstanding()->exists(),
            'the fixture needs an outstanding non-blocking item for this to mean anything'
        );

        $this->service->sweep(Carbon::parse('2026-06-01'));

        $this->assertSame(OnboardingJourney::STAGE_COMPLETED, $journey->fresh()->stage);
    }

    private function journeyJoining(string $date): OnboardingJourney
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        return $this->service->open(
            organizationId: (int) $this->organization->id,
            candidateName: $user->name,
            candidateEmail: $user->email,
            joiningDate: Carbon::parse($date),
            attributes: ['user_id' => $user->id],
        );
    }

    private function settleAllBlockingItems(OnboardingJourney $journey): void
    {
        ChecklistItem::forSubject($journey)
            ->where('is_blocking', true)
            ->update([
                'status' => ChecklistItem::STATUS_DONE,
                'completed_at' => now(),
            ]);
    }
}
