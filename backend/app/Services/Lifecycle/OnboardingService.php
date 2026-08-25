<?php

namespace App\Services\Lifecycle;

use App\Models\ChecklistTemplate;
use App\Models\OnboardingJourney;
use App\Models\User;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * Opens and advances an onboarding journey.
 *
 * A journey is created when someone is hired, not when they arrive — the
 * document collection and equipment provisioning that decide whether Day 1
 * works have to happen before there is an account to log into.
 */
class OnboardingService
{
    public function __construct(
        private readonly ChecklistService $checklists,
        private readonly DefaultChecklistProvisioner $templates,
        private readonly ChecklistEvidenceSync $evidence,
    ) {
    }

    public function open(
        int $organizationId,
        string $candidateName,
        string $candidateEmail,
        CarbonInterface $joiningDate,
        array $attributes = [],
        ?User $creator = null,
    ): OnboardingJourney {
        // Resolve the anchor once, as a plain local date. Re-reading
        // `joining_date` off the model after save sends it through the `date`
        // cast, which resolves against UTC and lands every due date a day early
        // for any timezone ahead of it — a "day one" task falling the day
        // before the person starts.
        $anchor = Carbon::parse($joiningDate)->startOfDay();

        return DB::transaction(function () use (
            $organizationId, $candidateName, $candidateEmail, $anchor, $attributes, $creator
        ) {
            $journey = OnboardingJourney::create([
                'organization_id' => $organizationId,
                'user_id' => $attributes['user_id'] ?? null,
                'invitation_id' => $attributes['invitation_id'] ?? null,
                'candidate_name' => $candidateName,
                'candidate_email' => $candidateEmail,
                'job_title' => $attributes['job_title'] ?? null,
                'joining_date' => $anchor->toDateString(),
                'group_id' => $attributes['group_id'] ?? null,
                'manager_id' => $attributes['manager_id'] ?? null,
                'buddy_id' => $attributes['buddy_id'] ?? null,
                'stage' => $this->stageForDate($anchor),
                'notes' => $attributes['notes'] ?? null,
                'created_by' => $creator?->id,
            ]);

            $template = $this->templates->ensure(
                $organizationId,
                ChecklistTemplate::KIND_ONBOARDING
            );

            $this->checklists->materialise(
                $journey,
                $template,
                $anchor,
                $this->checklists->ownersForJourney($journey),
                // Nothing can be due before the journey existed.
                Carbon::now()->startOfDay()
            );

            // The documents may pre-date the journey. Both the add-user wizard
            // and CSV import upload before this runs, so without a reconcile
            // here a joiner's PAN card sits on file next to a pending "Upload
            // PAN card" from the moment the checklist is created.
            $this->evidence->sync($journey);

            return $journey->fresh(['checklistItems']);
        });
    }

    /**
     * The single entry point every "a person has joined" path goes through.
     *
     * Onboarding used to be opened from exactly one place — UserController::store
     * — so of the four ways an admin can add someone (create directly, invite by
     * email, invite by link, import a CSV) only the first produced a journey. The
     * other three created an account and nothing else: no checklist, no blocking
     * gates, nothing in HR's, IT's or the manager's queue.
     *
     * Idempotent by design, because the invite flow can reach this twice: once
     * when the invitation is raised (preboarding, before an account exists) and
     * again when the invitee accepts. The second call links the new account to
     * the journey already in flight rather than opening a duplicate.
     */
    public function ensureForUser(
        User $user,
        ?User $creator = null,
        array $attributes = [],
        ?CarbonInterface $joiningDate = null,
    ): OnboardingJourney {
        $existing = OnboardingJourney::query()
            ->where('organization_id', $user->organization_id)
            ->where(function ($query) use ($user, $attributes) {
                $query->where('user_id', $user->id);

                if (! empty($attributes['invitation_id'])) {
                    $query->orWhere('invitation_id', $attributes['invitation_id']);
                }
            })
            ->latest('id')
            ->first();

        if ($existing !== null) {
            // Raised at invite time and waiting for the account. Bind it, which
            // also reassigns every item whose owner_kind is 'employee'.
            if ($existing->user_id !== $user->id) {
                return $this->linkUser($existing, $user);
            }

            $this->evidence->sync($existing);

            return $existing->fresh(['checklistItems']);
        }

        return $this->open(
            organizationId: (int) $user->organization_id,
            candidateName: $user->name,
            candidateEmail: $user->email,
            joiningDate: $joiningDate ?? Carbon::now(),
            attributes: [...$attributes, 'user_id' => $user->id],
            creator: $creator,
        );
    }

    /**
     * Attach the account once it exists, and backfill any checklist item that
     * was waiting on "the employee" before there was one.
     */
    public function linkUser(OnboardingJourney $journey, User $user): OnboardingJourney
    {
        $journey->update(['user_id' => $user->id]);
        $this->checklists->reassignOwners($journey, ['employee' => $user->id]);

        // Now that there is an account, the documents filed against it can be
        // read. An invitee who uploaded during acceptance would otherwise have
        // been invisible to the upload-time hook, which had no journey to find.
        $this->evidence->sync($journey);

        return $journey->fresh(['checklistItems']);
    }

    public function assign(OnboardingJourney $journey, array $attributes): OnboardingJourney
    {
        $journey->update(array_intersect_key($attributes, array_flip([
            'manager_id', 'buddy_id', 'group_id', 'job_title', 'joining_date', 'notes',
        ])));

        $this->checklists->reassignOwners($journey, $this->checklists->ownersForJourney($journey->fresh()));

        return $journey->fresh(['checklistItems']);
    }

    public function setStage(OnboardingJourney $journey, string $stage): OnboardingJourney
    {
        $changes = ['stage' => $stage];

        if ($stage === OnboardingJourney::STAGE_COMPLETED) {
            $changes['completed_at'] = now();
        }
        if ($stage === OnboardingJourney::STAGE_CANCELLED) {
            $changes['cancelled_at'] = now();
        }

        $journey->update($changes);

        return $journey->fresh(['checklistItems']);
    }

    /**
     * Where a journey sits purely on dates. Used at creation and by the daily
     * sweep so a journey does not sit in "preboarding" a month after the person
     * started just because nobody pressed a button.
     */
    public function stageForDate(CarbonInterface $joiningDate, ?CarbonInterface $today = null): string
    {
        $now = ($today ? Carbon::parse($today) : Carbon::now())->startOfDay();
        $joining = Carbon::parse($joiningDate)->startOfDay();

        if ($joining->gt($now)) {
            return OnboardingJourney::STAGE_PREBOARDING;
        }

        return $joining->eq($now)
            ? OnboardingJourney::STAGE_DAY_ONE
            : OnboardingJourney::STAGE_ONBOARDING;
    }

    /**
     * Advance stages by date, and close journeys that have run their 90 days.
     * Returns how many rows moved.
     */
    public function sweep(?CarbonInterface $today = null): int
    {
        $now = ($today ? Carbon::parse($today) : Carbon::now())->startOfDay();
        $moved = 0;

        OnboardingJourney::open()->cursor()->each(function (OnboardingJourney $journey) use ($now, &$moved) {
            $joining = Carbon::parse($journey->joining_date)->startOfDay();

            if ($joining->copy()->addDays(90)->lt($now)) {
                $journey->update(['stage' => OnboardingJourney::STAGE_COMPLETED, 'completed_at' => now()]);
                $moved++;

                return;
            }

            $expected = $this->stageForDate($joining, $now);
            if ($journey->stage !== $expected) {
                $journey->update(['stage' => $expected]);
                $moved++;
            }
        });

        return $moved;
    }
}
