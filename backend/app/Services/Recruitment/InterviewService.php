<?php

namespace App\Services\Recruitment;

use App\Models\Interview;
use App\Models\InterviewFeedback;
use App\Models\InterviewPanellist;
use App\Models\JobApplication;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Scheduling interviews and collecting what the panel thought.
 *
 * FEEDBACK IS NEVER AVERAGED. Each interviewer's verdict is kept as their own
 * row, and the summary reports the split rather than a mean. A panel of three
 * going two-to-one is the most important signal in a hiring decision; "3.0 out
 * of 5" is the same number a unanimous lukewarm panel produces, and the two
 * call for completely different conversations.
 *
 * INVITED AND SUBMITTED ARE DIFFERENT STATES. A recruiter chasing feedback
 * needs to know who has not answered, which a table of only-submitted rows
 * cannot tell them.
 */
class InterviewService
{
    /**
     * Put an interview in the diary.
     *
     * Scheduling against a decided candidacy is refused: interviewing somebody
     * already rejected wastes a panel's afternoon, and it is nearly always a
     * stale browser tab rather than an intention.
     *
     * @param  array<int, int>  $panellistIds
     * @param  array<string, mixed>  $attributes
     */
    public function schedule(
        JobApplication $application,
        array $attributes,
        array $panellistIds = [],
        ?User $actor = null,
    ): Interview {
        if (! $application->isOpen()) {
            throw new RuntimeException('That application is '.$application->status.'. Interviews need a live candidacy.');
        }

        $when = Carbon::parse($attributes['scheduled_at'] ?? 'now');

        return DB::transaction(function () use ($application, $attributes, $panellistIds, $actor, $when) {
            $interview = Interview::query()->create($attributes + [
                'organization_id' => $application->organization_id,
                'job_application_id' => $application->id,
                // Defaults to wherever the candidacy currently sits, so a
                // two-round process does not merge into one undifferentiated
                // pile of feedback.
                'hiring_stage_id' => $attributes['hiring_stage_id'] ?? $application->hiring_stage_id,
                'scheduled_at' => $when,
                'status' => 'scheduled',
                'scheduled_by' => $actor?->id,
            ]);

            $this->setPanel($interview, $panellistIds);

            return $interview->fresh('panellists');
        });
    }

    /**
     * Replace the panel.
     *
     * Removing somebody who has ALREADY given feedback is refused rather than
     * cascading. Their verdict informed a decision that may already have been
     * taken, and deleting it rewrites the record of how that decision was
     * reached.
     *
     * @param  array<int, int>  $panellistIds
     */
    public function setPanel(Interview $interview, array $panellistIds): Interview
    {
        $wanted = collect($panellistIds)->filter()->unique()->values();

        $valid = User::query()
            ->where('organization_id', $interview->organization_id)
            ->whereIn('id', $wanted)
            ->pluck('id');

        if ($valid->count() !== $wanted->count()) {
            throw new RuntimeException('One of those interviewers is not in this workspace.');
        }

        $withFeedback = InterviewFeedback::query()
            ->where('interview_id', $interview->id)
            ->whereNotNull('submitted_at')
            ->pluck('user_id');

        $removed = $withFeedback->diff($valid);

        if ($removed->isNotEmpty()) {
            throw new RuntimeException('Somebody on this panel has already given feedback and cannot be removed.');
        }

        DB::transaction(function () use ($interview, $valid) {
            InterviewPanellist::query()
                ->where('interview_id', $interview->id)
                ->whereNotIn('user_id', $valid)
                ->delete();

            foreach ($valid as $index => $userId) {
                InterviewPanellist::query()->updateOrCreate(
                    ['interview_id' => $interview->id, 'user_id' => $userId],
                    [
                        'organization_id' => $interview->organization_id,
                        // First named is the lead unless somebody says otherwise.
                        'is_lead' => $index === 0,
                    ],
                );
            }
        });

        return $interview->fresh('panellists');
    }

    /**
     * Record one interviewer's verdict.
     *
     * Only a panellist may submit. Feedback from somebody who was not on the
     * panel is either a mistake or a thumb on the scale, and both are worth
     * refusing rather than absorbing.
     *
     * Re-submitting REPLACES your own verdict — people change their mind after
     * a debrief — but nobody gets two votes.
     */
    public function submitFeedback(
        Interview $interview,
        User $interviewer,
        string $verdict,
        ?int $rating = null,
        ?string $notes = null,
    ): InterviewFeedback {
        if (! in_array($verdict, Interview::VERDICTS, true)) {
            throw new RuntimeException('That is not a recognised verdict.');
        }

        $onPanel = InterviewPanellist::query()
            ->where('interview_id', $interview->id)
            ->where('user_id', $interviewer->id)
            ->exists();

        if (! $onPanel) {
            throw new RuntimeException('You are not on this interview panel.');
        }

        if ($interview->status === 'cancelled') {
            throw new RuntimeException('That interview was cancelled.');
        }

        return DB::transaction(function () use ($interview, $interviewer, $verdict, $rating, $notes) {
            $feedback = InterviewFeedback::query()->updateOrCreate(
                ['interview_id' => $interview->id, 'user_id' => $interviewer->id],
                [
                    'organization_id' => $interview->organization_id,
                    'verdict' => $verdict,
                    'rating' => $rating,
                    'notes' => $notes,
                    'submitted_at' => now(),
                ],
            );

            /*
             * The first verdict marks the interview as having happened. A
             * `scheduled` interview with feedback against it is a contradiction
             * that makes every "awaiting feedback" list wrong.
             */
            if ($interview->status === 'scheduled') {
                $interview->forceFill(['status' => 'completed'])->save();
            }

            return $feedback;
        });
    }

    /** Cancel, with a reason. An interview that just vanishes explains nothing. */
    public function cancel(Interview $interview, string $reason): Interview
    {
        if ($interview->status === 'completed') {
            throw new RuntimeException('That interview has already happened.');
        }

        if (trim($reason) === '') {
            throw new RuntimeException('A cancellation needs a reason.');
        }

        $interview->forceFill([
            'status' => 'cancelled',
            'cancellation_reason' => trim($reason),
        ])->save();

        return $interview->fresh();
    }

    /**
     * What the panel actually said.
     *
     * Returns the split, never a mean. `is_split` is surfaced explicitly
     * because it is the one fact a hiring manager must not miss, and a
     * dashboard that shows only a total is exactly how it gets missed.
     *
     * @return array<string, mixed>
     */
    public function summaryFor(Interview $interview): array
    {
        $submitted = $interview->feedback()
            ->whereNotNull('submitted_at')
            ->with('interviewer:id,name')
            ->get();

        $counts = collect(Interview::VERDICTS)
            ->mapWithKeys(fn (string $verdict) => [
                $verdict => $submitted->where('verdict', $verdict)->count(),
            ])
            ->all();

        return [
            'panel' => $interview->panelProgress(),
            'verdicts' => $counts,
            'is_split' => $interview->isSplit(),
            'feedback' => $submitted->map(fn (InterviewFeedback $row) => [
                'interviewer' => $row->interviewer?->name,
                'verdict' => $row->verdict,
                'rating' => $row->rating,
                'notes' => $row->notes,
                'submitted_at' => $row->submitted_at?->toIso8601String(),
            ])->values()->all(),
        ];
    }
}
