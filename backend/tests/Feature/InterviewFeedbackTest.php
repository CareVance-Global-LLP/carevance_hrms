<?php

namespace Tests\Feature;

use App\Models\Candidate;
use App\Models\Interview;
use App\Models\JobApplication;
use App\Models\JobOpening;
use App\Models\Organization;
use App\Models\User;
use App\Services\Recruitment\HiringPipelineService;
use App\Services\Recruitment\InterviewService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Tests\TestCase;

/**
 * Interviews and panel feedback.
 *
 * The rule everything here protects: a panel's verdicts are kept individually
 * and reported as a split, never averaged. Three people going two-to-one and
 * three people all lukewarm produce the same mean, and they call for completely
 * different conversations.
 */
class InterviewFeedbackTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $recruiter;
    private User $alice;
    private User $bob;
    private User $carol;
    private JobApplication $application;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-interviews']);
        $this->recruiter = $this->makeUser('recruiter@carevance.test', 'hr');
        $this->alice = $this->makeUser('alice@carevance.test', 'manager');
        $this->bob = $this->makeUser('bob@carevance.test', 'manager');
        $this->carol = $this->makeUser('carol@carevance.test', 'manager');

        $pipeline = app(HiringPipelineService::class);
        $pipeline->ensureStagesFor($this->organization);

        $opening = JobOpening::query()->create([
            'organization_id' => $this->organization->id,
            'code' => 'REQ-1',
            'title' => 'Backend Engineer',
            'status' => 'open',
        ]);

        $candidate = Candidate::query()->create([
            'organization_id' => $this->organization->id,
            'first_name' => 'Priya',
            'email' => 'priya@example.test',
        ]);

        $this->application = $pipeline->apply($opening, $candidate, $this->recruiter);
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

    private function service(): InterviewService
    {
        return app(InterviewService::class);
    }

    /** @param array<int, int> $panel */
    private function schedule(array $panel = []): Interview
    {
        return $this->service()->schedule(
            $this->application,
            ['title' => 'Systems round', 'mode' => 'video', 'scheduled_at' => now()->addDay()->toDateTimeString()],
            $panel ?: [$this->alice->id, $this->bob->id],
            $this->recruiter,
        );
    }

    public function test_an_interview_inherits_the_stage_the_candidacy_is_in(): void
    {
        $interview = $this->schedule();

        // A two-round process must not merge into one undifferentiated pile of
        // feedback.
        $this->assertSame($this->application->hiring_stage_id, $interview->hiring_stage_id);
    }

    public function test_the_panel_reports_who_has_not_answered(): void
    {
        $interview = $this->schedule();
        $this->service()->submitFeedback($interview, $this->alice, 'yes');

        $progress = $interview->fresh()->panelProgress();

        // "Two of three have responded" is the question a recruiter asks
        // constantly, and a table of only-submitted rows cannot answer it.
        $this->assertSame(2, $progress['invited']);
        $this->assertSame(1, $progress['submitted']);
        $this->assertSame(1, $progress['outstanding']);
    }

    public function test_a_split_panel_is_surfaced_rather_than_averaged(): void
    {
        $interview = $this->schedule([$this->alice->id, $this->bob->id, $this->carol->id]);

        $this->service()->submitFeedback($interview, $this->alice, 'strong_yes', 5);
        $this->service()->submitFeedback($interview, $this->bob, 'yes', 4);
        $this->service()->submitFeedback($interview, $this->carol, 'strong_no', 1);

        $summary = $this->service()->summaryFor($interview->fresh());

        /*
         * Two-to-one. A mean of these three is 3.3, which is also what a
         * unanimously lukewarm panel scores - and those two situations call for
         * completely different conversations.
         */
        $this->assertTrue($summary['is_split']);
        $this->assertSame(1, $summary['verdicts']['strong_yes']);
        $this->assertSame(1, $summary['verdicts']['yes']);
        $this->assertSame(1, $summary['verdicts']['strong_no']);
        $this->assertCount(3, $summary['feedback']);
    }

    public function test_a_unanimous_panel_is_not_reported_as_split(): void
    {
        $interview = $this->schedule();

        $this->service()->submitFeedback($interview, $this->alice, 'yes');
        $this->service()->submitFeedback($interview, $this->bob, 'strong_yes');

        $this->assertFalse($this->service()->summaryFor($interview->fresh())['is_split']);
    }

    public function test_only_a_panellist_may_give_feedback(): void
    {
        $interview = $this->schedule([$this->alice->id]);

        // Either a mistake or a thumb on the scale. Both worth refusing.
        $this->expectException(RuntimeException::class);
        $this->service()->submitFeedback($interview, $this->carol, 'no');
    }

    public function test_resubmitting_replaces_your_own_verdict_rather_than_adding_one(): void
    {
        $interview = $this->schedule();

        $this->service()->submitFeedback($interview, $this->alice, 'no', 2);
        $this->service()->submitFeedback($interview, $this->alice, 'yes', 4, 'Changed my mind after the debrief');

        $summary = $this->service()->summaryFor($interview->fresh());

        // People do change their mind after a debrief. Nobody gets two votes.
        $this->assertSame(1, $summary['panel']['submitted']);
        $this->assertSame(0, $summary['verdicts']['no']);
        $this->assertSame(1, $summary['verdicts']['yes']);
    }

    public function test_the_first_verdict_marks_the_interview_as_held(): void
    {
        $interview = $this->schedule();

        $this->service()->submitFeedback($interview, $this->alice, 'yes');

        // A `scheduled` interview carrying feedback is a contradiction that
        // makes every "awaiting feedback" list wrong.
        $this->assertSame('completed', $interview->fresh()->status);
    }

    public function test_somebody_who_has_given_feedback_cannot_be_dropped_from_the_panel(): void
    {
        $interview = $this->schedule();
        $this->service()->submitFeedback($interview, $this->bob, 'strong_no', 1);

        /*
         * Their verdict informed a decision that may already have been taken.
         * Cascading the delete rewrites the record of how it was reached.
         */
        $this->expectException(RuntimeException::class);
        $this->service()->setPanel($interview->fresh(), [$this->alice->id]);
    }

    public function test_a_panellist_who_has_not_answered_can_be_swapped_out(): void
    {
        $interview = $this->schedule();

        $updated = $this->service()->setPanel($interview, [$this->alice->id, $this->carol->id]);

        // Normal rescheduling. Nothing has been decided on Bob's word yet.
        $this->assertSame(
            [$this->alice->id, $this->carol->id],
            $updated->panellists()->pluck('users.id')->sort()->values()->all(),
        );
    }

    public function test_a_cancellation_needs_a_reason(): void
    {
        $interview = $this->schedule();

        // An interview that just vanishes from a candidate's timeline explains
        // nothing to the next person who reads it.
        $this->expectException(RuntimeException::class);
        $this->service()->cancel($interview, '  ');
    }

    public function test_a_cancelled_interview_takes_no_feedback(): void
    {
        $interview = $this->schedule();
        $this->service()->cancel($interview, 'Candidate rescheduled');

        $this->expectException(RuntimeException::class);
        $this->service()->submitFeedback($interview->fresh(), $this->alice, 'yes');
    }

    public function test_an_interviewer_from_another_workspace_is_refused(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'other-interviews']);
        $stranger = User::create([
            'name' => 'Stranger',
            'email' => 'stranger@other.test',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'organization_id' => $other->id,
        ]);

        $this->expectException(RuntimeException::class);
        $this->schedule([$stranger->id]);
    }

    public function test_a_decided_candidacy_cannot_be_interviewed(): void
    {
        app(HiringPipelineService::class)->reject($this->application, 'Not a fit', $this->recruiter);

        // Nearly always a stale browser tab rather than an intention, and it
        // costs a panel their afternoon.
        $this->expectException(RuntimeException::class);
        $this->schedule();
    }
}
