<?php

namespace Tests\Feature;

use App\Models\ApplicationStageEvent;
use App\Models\Candidate;
use App\Models\HiringStage;
use App\Models\JobApplication;
use App\Models\JobOpening;
use App\Models\Organization;
use App\Models\User;
use App\Services\Recruitment\HiringPipelineService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Tests\TestCase;

/**
 * Moving candidacies through the hiring pipeline.
 *
 * Two things must hold everywhere. A stage move always writes the event that
 * explains it — otherwise a candidacy is a position nobody can account for. And
 * a decided application never moves again, because silently resurrecting one
 * somebody deliberately closed is how a rejected candidate ends up back in an
 * interview loop.
 */
class HiringPipelineTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $recruiter;
    private JobOpening $opening;
    private Candidate $candidate;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-ats']);

        $this->recruiter = User::create([
            'name' => 'Recruiter',
            'email' => 'recruiter@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'hr',
            'organization_id' => $this->organization->id,
        ]);

        app(HiringPipelineService::class)->ensureStagesFor($this->organization);

        $this->opening = JobOpening::query()->create([
            'organization_id' => $this->organization->id,
            'code' => 'REQ-1',
            'title' => 'Backend Engineer',
            'status' => 'open',
            'openings_count' => 1,
        ]);

        $this->candidate = Candidate::query()->create([
            'organization_id' => $this->organization->id,
            'first_name' => 'Priya',
            'last_name' => 'Nair',
            'email' => 'priya@example.test',
        ]);
    }

    private function pipeline(): HiringPipelineService
    {
        return app(HiringPipelineService::class);
    }

    private function stage(string $slug): HiringStage
    {
        return HiringStage::query()
            ->where('organization_id', $this->organization->id)
            ->where('slug', $slug)
            ->firstOrFail();
    }

    private function apply(): JobApplication
    {
        return $this->pipeline()->apply($this->opening, $this->candidate, $this->recruiter);
    }

    public function test_a_new_organization_gets_a_usable_pipeline(): void
    {
        $stages = $this->pipeline()->ensureStagesFor($this->organization);

        $this->assertSame(['applied', 'screening', 'interview', 'offer', 'hired'], $stages->pluck('slug')->all());
        $this->assertTrue($stages->last()->is_terminal);
    }

    public function test_ensuring_stages_twice_does_not_duplicate_them(): void
    {
        $this->pipeline()->ensureStagesFor($this->organization);
        $this->pipeline()->ensureStagesFor($this->organization);

        // Called lazily from several entry points, so it will run more than
        // once for the same organization.
        $this->assertSame(5, HiringStage::query()->where('organization_id', $this->organization->id)->count());
    }

    public function test_applying_lands_in_the_first_stage_and_records_the_event(): void
    {
        $application = $this->apply();

        $this->assertSame($this->stage('applied')->id, $application->hiring_stage_id);
        $this->assertSame('active', $application->status);

        // The event is not optional. A position nobody can account for is not a
        // pipeline, it is a guess.
        $this->assertSame(1, ApplicationStageEvent::query()->where('job_application_id', $application->id)->count());
        $this->assertSame('applied', ApplicationStageEvent::query()->where('job_application_id', $application->id)->value('action'));
    }

    public function test_the_same_person_may_apply_for_a_second_role(): void
    {
        $this->apply();

        $other = JobOpening::query()->create([
            'organization_id' => $this->organization->id,
            'code' => 'REQ-2',
            'title' => 'Frontend Engineer',
            'status' => 'open',
        ]);

        $second = $this->pipeline()->apply($other, $this->candidate, $this->recruiter);

        /*
         * The whole reason candidate and application are separate rows. One
         * human, two candidacies, two histories.
         */
        $this->assertSame(2, JobApplication::query()->where('candidate_id', $this->candidate->id)->count());
        $this->assertSame(1, Candidate::query()->where('organization_id', $this->organization->id)->count());
        $this->assertNotSame($second->id, JobApplication::query()->where('job_opening_id', $this->opening->id)->value('id'));
    }

    public function test_re_applying_to_the_same_role_reopens_rather_than_duplicating(): void
    {
        $application = $this->apply();
        $this->pipeline()->reject($application, 'Not enough Go experience', $this->recruiter);

        $again = $this->apply();

        // One candidacy per person per role, so this is the same row - and the
        // old rejection must not follow them into the fresh attempt.
        $this->assertSame($application->id, $again->id);
        $this->assertSame('active', $again->status);
        $this->assertNull($again->rejection_reason);
        $this->assertSame(1, JobApplication::query()->where('job_opening_id', $this->opening->id)->count());
    }

    public function test_a_draft_opening_does_not_accept_applications(): void
    {
        $this->opening->update(['status' => 'draft']);

        // A draft requisition has no agreed headcount behind it.
        $this->expectException(RuntimeException::class);
        $this->apply();
    }

    public function test_moving_backwards_is_allowed_and_recorded_as_such(): void
    {
        $application = $this->apply();
        $this->pipeline()->moveTo($application, $this->stage('interview'), $this->recruiter);

        $moved = $this->pipeline()->moveTo($application->fresh(), $this->stage('screening'), $this->recruiter);

        /*
         * It happens - a panel wants another screening round. A pipeline that
         * only goes forwards gets worked around by deleting and recreating the
         * application, which destroys the history this exists to keep.
         */
        $this->assertSame($this->stage('screening')->id, $moved->hiring_stage_id);
        $this->assertSame('moved_back', ApplicationStageEvent::query()
            ->where('job_application_id', $application->id)
            ->latest('id')->value('action'));
    }

    public function test_moving_to_the_current_stage_writes_no_event(): void
    {
        $application = $this->apply();
        $before = ApplicationStageEvent::query()->where('job_application_id', $application->id)->count();

        $this->pipeline()->moveTo($application->fresh(), $this->stage('applied'), $this->recruiter);

        // Not an error, but not history either. Recording it fills the trail
        // with noise that hides the real moves.
        $this->assertSame($before, ApplicationStageEvent::query()->where('job_application_id', $application->id)->count());
    }

    public function test_reaching_the_hired_stage_closes_the_candidacy(): void
    {
        $application = $this->apply();

        $hired = $this->pipeline()->moveTo($application, $this->stage('hired'), $this->recruiter);

        // Leaving it active would keep somebody who has accepted an offer in
        // the live pipeline, and would let the opening over-hire.
        $this->assertSame('hired', $hired->status);
        $this->assertNotNull($hired->decided_at);
        $this->assertSame(0, $this->opening->fresh()->remainingOpenings());
    }

    public function test_a_decided_application_cannot_be_moved_again(): void
    {
        $application = $this->apply();
        $this->pipeline()->reject($application, 'Withdrew from process', $this->recruiter);

        $this->expectException(RuntimeException::class);
        $this->pipeline()->moveTo($application->fresh(), $this->stage('interview'), $this->recruiter);
    }

    public function test_a_rejection_needs_a_reason(): void
    {
        $application = $this->apply();

        // A candidacy that simply stops moving tells the candidate nothing and
        // an auditor less.
        $this->expectException(RuntimeException::class);
        $this->pipeline()->reject($application, '   ', $this->recruiter);
    }

    public function test_a_rejection_keeps_the_stage_it_happened_at(): void
    {
        $application = $this->apply();
        $this->pipeline()->moveTo($application, $this->stage('interview'), $this->recruiter);

        $rejected = $this->pipeline()->reject($application->fresh(), 'Failed system design', $this->recruiter);

        // "Rejected after the tech round" and "rejected on the CV" are
        // different facts. Blanking the stage loses the more useful one.
        $this->assertSame($this->stage('interview')->id, $rejected->hiring_stage_id);
        $this->assertSame('Failed system design', $rejected->rejection_reason);
    }

    public function test_withdrawing_is_not_recorded_as_a_rejection(): void
    {
        $application = $this->apply();

        $withdrawn = $this->pipeline()->withdraw($application, 'Accepted another offer', $this->recruiter);

        // Different statistic, different conversation. Filing it as a rejection
        // makes a team look pickier than it is and hides a compensation problem.
        $this->assertSame('withdrawn', $withdrawn->status);
        $this->assertNull($withdrawn->rejection_reason);
    }

    public function test_a_stage_from_another_workspace_is_refused(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'other-ats']);
        $theirStage = HiringStage::query()->create([
            'organization_id' => $other->id,
            'name' => 'Their stage',
            'slug' => 'their-stage',
            'position' => 0,
        ]);

        $application = $this->apply();

        // The foreign key alone would allow this.
        $this->expectException(RuntimeException::class);
        $this->pipeline()->moveTo($application, $theirStage, $this->recruiter);
    }

    public function test_the_funnel_reports_every_stage_including_the_empty_ones(): void
    {
        $this->apply();

        $funnel = $this->pipeline()->funnelFor($this->opening);

        // A funnel that omits its gaps is the one chart a hiring manager most
        // needs to see.
        $this->assertCount(5, $funnel);
        $this->assertSame(1, collect($funnel)->firstWhere('name', 'Applied')['active']);
        $this->assertSame(0, collect($funnel)->firstWhere('name', 'Interview')['active']);
    }

    public function test_a_rejected_candidacy_leaves_the_funnel(): void
    {
        $application = $this->apply();
        $this->pipeline()->reject($application, 'Not a fit', $this->recruiter);

        $funnel = $this->pipeline()->funnelFor($this->opening);

        // The funnel counts LIVE candidacies. Counting decided ones would make
        // every pipeline look permanently full.
        $this->assertSame(0, collect($funnel)->sum('active'));
    }
}
