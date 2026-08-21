<?php

namespace App\Services\Recruitment;

use App\Models\ApplicationStageEvent;
use App\Models\Candidate;
use App\Models\HiringStage;
use App\Models\JobApplication;
use App\Models\JobOpening;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Moving candidacies through the pipeline.
 *
 * Every transition writes BOTH the new position and the event that produced it,
 * inside one transaction. A stage column updated without its event is a
 * candidacy nobody can explain, and an event without the column move is a
 * pipeline that displays the wrong thing — so neither is allowed to happen
 * alone.
 *
 * WHAT THIS REFUSES, AND WHY:
 *
 *   - Moving a decided application. Rejected, withdrawn and hired are
 *     end states; re-advancing one silently resurrects a candidacy somebody
 *     deliberately closed.
 *   - Applying to an opening that is not open. A draft requisition has no
 *     agreed headcount and a closed one has no vacancy.
 *   - Rejecting without a reason. A candidacy that simply stops moving tells
 *     the candidate nothing and an auditor less.
 *   - A stage from another organization. The foreign key alone would allow it.
 */
class HiringPipelineService
{
    /**
     * Ensure an organization has a pipeline.
     *
     * Called lazily rather than seeded on signup, because an organization that
     * never recruits should not carry stages it has to delete, and one that
     * starts recruiting must not be met with an empty screen.
     *
     * @return \Illuminate\Support\Collection<int, HiringStage>
     */
    public function ensureStagesFor(Organization $organization)
    {
        $existing = HiringStage::query()
            ->where('organization_id', $organization->id)
            ->orderBy('position')
            ->get();

        if ($existing->isNotEmpty()) {
            return $existing;
        }

        foreach (HiringStage::defaults() as $stage) {
            HiringStage::query()->create($stage + ['organization_id' => $organization->id]);
        }

        return HiringStage::query()
            ->where('organization_id', $organization->id)
            ->orderBy('position')
            ->get();
    }

    /**
     * Record a candidate applying for an opening.
     *
     * Re-applying to the SAME opening reopens the existing application rather
     * than creating a second — the database enforces one candidacy per person
     * per role, and silently failing the insert would lose the fact that they
     * came back.
     */
    public function apply(JobOpening $opening, Candidate $candidate, ?User $actor = null): JobApplication
    {
        if (! $opening->isAcceptingApplications()) {
            throw new RuntimeException('That opening is not accepting applications.');
        }

        if ((int) $candidate->organization_id !== (int) $opening->organization_id) {
            throw new RuntimeException('That candidate belongs to another workspace.');
        }

        $first = $this->firstStageFor((int) $opening->organization_id);

        return DB::transaction(function () use ($opening, $candidate, $actor, $first) {
            $application = JobApplication::query()->firstOrNew([
                'job_opening_id' => $opening->id,
                'candidate_id' => $candidate->id,
            ]);

            $reapplying = $application->exists;

            $application->fill([
                'organization_id' => $opening->organization_id,
                'hiring_stage_id' => $first?->id,
                'status' => 'active',
                'applied_at' => now(),
                // A previous rejection must not follow somebody into a fresh
                // candidacy for the same role.
                'rejection_reason' => null,
                'decided_at' => null,
                'decided_by' => null,
            ])->save();

            $this->event($application, null, $first, 'applied', $actor,
                $reapplying ? 'Re-applied' : null);

            return $application->fresh(['stage', 'candidate']);
        });
    }

    /**
     * Move a candidacy to a stage.
     *
     * Moving BACKWARDS is allowed and recorded as such. It happens — a panel
     * wants another screening round — and a pipeline that only goes forwards
     * gets worked around by deleting and recreating the application, which
     * destroys the history this exists to keep.
     */
    public function moveTo(JobApplication $application, HiringStage $stage, ?User $actor = null, ?string $note = null): JobApplication
    {
        $this->assertOpen($application);

        if ((int) $stage->organization_id !== (int) $application->organization_id) {
            throw new RuntimeException('That stage belongs to another workspace.');
        }

        if (! $stage->is_active) {
            throw new RuntimeException('That stage is no longer in use.');
        }

        $from = $application->stage;

        if ($from && (int) $from->id === (int) $stage->id) {
            // Not an error, but not an event either. Recording a move to the
            // stage somebody is already in fills the history with noise.
            return $application;
        }

        return DB::transaction(function () use ($application, $stage, $actor, $note, $from) {
            $action = $from && $stage->position < $from->position ? 'moved_back' : 'advanced';

            $application->forceFill(['hiring_stage_id' => $stage->id]);

            /*
             * A terminal stage of kind `hired` ends the candidacy. Leaving it
             * `active` would keep somebody who has accepted an offer sitting in
             * the live pipeline, and would let the opening over-hire.
             */
            if ($stage->is_terminal && $stage->kind === 'hired') {
                $application->forceFill([
                    'status' => 'hired',
                    'decided_at' => now(),
                    'decided_by' => $actor?->id,
                ]);
                $action = 'hired';
            }

            $application->save();

            $this->event($application, $from, $stage, $action, $actor, $note);

            return $application->fresh(['stage']);
        });
    }

    /**
     * Reject a candidacy, with a reason.
     *
     * The stage is deliberately left where it was. "Rejected after the tech
     * round" and "rejected on the CV" are different facts about the same
     * decision, and blanking the stage loses the more useful one.
     */
    public function reject(JobApplication $application, string $reason, ?User $actor = null): JobApplication
    {
        $this->assertOpen($application);

        $reason = trim($reason);

        if ($reason === '') {
            throw new RuntimeException('A rejection needs a reason.');
        }

        return DB::transaction(function () use ($application, $reason, $actor) {
            $application->forceFill([
                'status' => 'rejected',
                'rejection_reason' => $reason,
                'decided_at' => now(),
                'decided_by' => $actor?->id,
            ])->save();

            $this->event($application, $application->stage, $application->stage, 'rejected', $actor, $reason);

            return $application->fresh(['stage']);
        });
    }

    /** The candidate stepped away. Not a rejection, and not the same statistic. */
    public function withdraw(JobApplication $application, ?string $note = null, ?User $actor = null): JobApplication
    {
        $this->assertOpen($application);

        return DB::transaction(function () use ($application, $note, $actor) {
            $application->forceFill([
                'status' => 'withdrawn',
                'decided_at' => now(),
                'decided_by' => $actor?->id,
            ])->save();

            $this->event($application, $application->stage, $application->stage, 'withdrawn', $actor, $note);

            return $application->fresh(['stage']);
        });
    }

    /**
     * How many live candidacies sit in each stage of an opening.
     *
     * Every stage appears, including the empty ones. A funnel that omits its
     * gaps is the one chart a hiring manager most needs to see.
     *
     * @return array<int, array<string, mixed>>
     */
    public function funnelFor(JobOpening $opening): array
    {
        $counts = JobApplication::query()
            ->where('job_opening_id', $opening->id)
            ->where('status', 'active')
            ->selectRaw('hiring_stage_id, COUNT(*) as total')
            ->groupBy('hiring_stage_id')
            ->pluck('total', 'hiring_stage_id');

        return HiringStage::query()
            ->where('organization_id', $opening->organization_id)
            ->where('is_active', true)
            ->orderBy('position')
            ->get()
            ->map(fn (HiringStage $stage) => [
                'stage_id' => (int) $stage->id,
                'name' => $stage->name,
                'kind' => $stage->kind,
                'active' => (int) ($counts[$stage->id] ?? 0),
            ])
            ->all();
    }

    /**
     * The stage that means somebody has been hired.
     *
     * Resolved by `kind`, never by name — a customer renaming "Hired" to
     * "Joined" must not stop an accepted offer closing the candidacy.
     */
    public function hiredStageFor(int $organizationId): ?HiringStage
    {
        return HiringStage::query()
            ->where('organization_id', $organizationId)
            ->where('kind', 'hired')
            ->orderByDesc('position')
            ->first();
    }

    private function firstStageFor(int $organizationId): ?HiringStage
    {
        return HiringStage::query()
            ->where('organization_id', $organizationId)
            ->where('is_active', true)
            ->orderBy('position')
            ->first();
    }

    private function assertOpen(JobApplication $application): void
    {
        if (! $application->isOpen()) {
            throw new RuntimeException(
                'That application is already '.$application->status.'. Reopen it before moving it.'
            );
        }
    }

    private function event(
        JobApplication $application,
        ?HiringStage $from,
        ?HiringStage $to,
        string $action,
        ?User $actor,
        ?string $note,
    ): void {
        ApplicationStageEvent::query()->create([
            'organization_id' => $application->organization_id,
            'job_application_id' => $application->id,
            'from_stage_id' => $from?->id,
            'to_stage_id' => $to?->id,
            'action' => $action,
            'note' => $note,
            'actor_id' => $actor?->id,
        ]);
    }
}
