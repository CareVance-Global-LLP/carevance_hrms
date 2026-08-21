<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Interview;
use App\Models\JobApplication;
use App\Models\JobOffer;
use App\Services\Recruitment\HiringPipelineService;
use App\Services\Recruitment\InterviewService;
use App\Services\Recruitment\OfferLetterService;
use App\Services\Recruitment\OfferService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use RuntimeException;

/**
 * Interviews, panel feedback and offers.
 *
 * Split from RecruitmentController because these are the surfaces that carry
 * salary and personal opinions about people, and keeping them in their own file
 * makes it obvious where that data is served from.
 *
 * Every refusal from the services is a business rule the caller can act on —
 * "you are not on this interview panel", "an offer needs at least one approver"
 * — so they come back as 422 with the message rather than as a 500.
 */
class InterviewOfferController extends Controller
{
    public function __construct(
        private readonly InterviewService $interviews,
        private readonly OfferService $offers,
        private readonly HiringPipelineService $pipeline,
        private readonly OfferLetterService $letters,
    ) {
    }

    // ------------------------------------------------------------ interviews

    public function interviews(Request $request): JsonResponse
    {
        $rows = Interview::query()
            ->where('organization_id', $request->user()->organization_id)
            ->when($request->filled('job_application_id'),
                fn ($q) => $q->where('job_application_id', (int) $request->input('job_application_id')))
            ->when($request->boolean('mine'), function ($query) use ($request) {
                // An interviewer's own diary. Without this everybody sees every
                // interview in the company, which is both noisy and nosy.
                $query->whereHas('panellists', fn ($p) => $p->where('users.id', $request->user()->id));
            })
            ->with(['panellists:id,name', 'application.candidate:id,first_name,last_name', 'stage:id,name'])
            ->orderBy('scheduled_at')
            ->paginate(25);

        return response()->json($rows);
    }

    public function scheduleInterview(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'job_application_id' => 'required|integer',
            'title' => 'nullable|string|max:255',
            'mode' => ['sometimes', Rule::in(Interview::MODES)],
            'location_or_link' => 'nullable|string|max:500',
            'scheduled_at' => 'required|date',
            'duration_minutes' => 'sometimes|integer|min:5|max:600',
            'hiring_stage_id' => 'nullable|integer',
            'panellist_ids' => 'sometimes|array|max:12',
            'panellist_ids.*' => 'integer',
        ]);

        $application = $this->application($request, (int) $validated['job_application_id']);

        if (! $application) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        return $this->guard(fn () => response()->json([
            'data' => $this->interviews->schedule(
                $application,
                collect($validated)->only([
                    'title', 'mode', 'location_or_link', 'scheduled_at', 'duration_minutes', 'hiring_stage_id',
                ])->filter(fn ($value) => $value !== null)->all(),
                $validated['panellist_ids'] ?? [],
                $request->user(),
            ),
        ], 201));
    }

    public function submitFeedback(Request $request, Interview $interview): JsonResponse
    {
        if (! $this->owns($request, $interview->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $request->validate([
            'verdict' => ['required', Rule::in(Interview::VERDICTS)],
            'rating' => 'nullable|integer|min:1|max:5',
            'notes' => 'nullable|string|max:5000',
        ]);

        return $this->guard(fn () => response()->json([
            'data' => $this->interviews->submitFeedback(
                $interview,
                $request->user(),
                $validated['verdict'],
                $validated['rating'] ?? null,
                $validated['notes'] ?? null,
            ),
        ], 201));
    }

    /**
     * What the panel said.
     *
     * Restricted to the panel and to whoever is running the hire. Interview
     * notes are candid by design and read very differently out of context.
     */
    public function interviewSummary(Request $request, Interview $interview): JsonResponse
    {
        if (! $this->owns($request, $interview->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        return response()->json(['data' => $this->interviews->summaryFor($interview)]);
    }

    public function cancelInterview(Request $request, Interview $interview): JsonResponse
    {
        if (! $this->owns($request, $interview->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $request->validate(['reason' => 'required|string|max:500']);

        return $this->guard(fn () => response()->json([
            'data' => $this->interviews->cancel($interview, $validated['reason']),
        ]));
    }

    // ---------------------------------------------------------------- offers

    public function offers(Request $request): JsonResponse
    {
        $rows = JobOffer::query()
            ->where('organization_id', $request->user()->organization_id)
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->with(['application.candidate:id,first_name,last_name,email', 'approvals.approver:id,name'])
            ->orderByDesc('id')
            ->paginate(25);

        return response()->json($rows);
    }

    public function draftOffer(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'job_application_id' => 'required|integer',
            'designation' => 'required|string|max:255',
            // Greater than zero: an offer worth nothing is a data-entry slip,
            // not a policy. The database agrees.
            'annual_ctc' => 'required|numeric|gt:0',
            'joining_bonus' => 'nullable|numeric|min:0',
            'proposed_joining_date' => 'nullable|date',
            'valid_until' => 'nullable|date',
            'legal_entity_id' => 'nullable|integer|exists:legal_entities,id',
        ]);

        $application = $this->application($request, (int) $validated['job_application_id']);

        if (! $application) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        return $this->guard(fn () => response()->json([
            'data' => $this->offers->draft(
                $application,
                collect($validated)->except('job_application_id')->all(),
                $request->user(),
            ),
        ], 201));
    }

    public function submitOffer(Request $request, JobOffer $jobOffer): JsonResponse
    {
        if (! $this->owns($request, $jobOffer->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $request->validate([
            'approver_ids' => 'required|array|min:1|max:10',
            'approver_ids.*' => 'integer',
        ]);

        return $this->guard(fn () => response()->json([
            'data' => $this->offers->submitForApproval($jobOffer, $validated['approver_ids'], $request->user()),
        ]));
    }

    public function decideOffer(Request $request, JobOffer $jobOffer): JsonResponse
    {
        if (! $this->owns($request, $jobOffer->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $request->validate([
            'approved' => 'required|boolean',
            'note' => 'nullable|string|max:1000',
        ]);

        return $this->guard(fn () => response()->json([
            'data' => $this->offers->decide(
                $jobOffer,
                $request->user(),
                (bool) $validated['approved'],
                $validated['note'] ?? null,
            ),
        ]));
    }

    public function sendOffer(Request $request, JobOffer $jobOffer): JsonResponse
    {
        if (! $this->owns($request, $jobOffer->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $request->validate(['valid_until' => 'nullable|date|after:today']);

        return $this->guard(fn () => response()->json([
            'data' => $this->offers->send(
                $jobOffer,
                isset($validated['valid_until']) ? Carbon::parse($validated['valid_until']) : null,
            ),
        ]));
    }

    public function respondToOffer(Request $request, JobOffer $jobOffer): JsonResponse
    {
        if (! $this->owns($request, $jobOffer->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $request->validate([
            'accepted' => 'required|boolean',
            // The single most useful datum in recruitment analytics, and the
            // one nobody records unless the product insists.
            'decline_reason' => 'required_if:accepted,false|nullable|string|max:1000',
        ]);

        return $this->guard(fn () => response()->json([
            'data' => $this->offers->respond(
                $jobOffer,
                (bool) $validated['accepted'],
                $this->pipeline,
                $validated['decline_reason'] ?? null,
                $request->user(),
            ),
        ]));
    }

    public function withdrawOffer(Request $request, JobOffer $jobOffer): JsonResponse
    {
        if (! $this->owns($request, $jobOffer->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $request->validate(['reason' => 'required|string|max:1000']);

        return $this->guard(fn () => response()->json([
            'data' => $this->offers->withdraw($jobOffer, $validated['reason']),
        ]));
    }

    /**
     * Mint a signing link for a sent offer.
     *
     * The plain token exists only in this response — it is stored hashed, so
     * nobody, including an administrator, can recover it afterwards. Re-issuing
     * replaces the previous link, which is also how a lost one is handled.
     */
    public function issueSigningLink(Request $request, JobOffer $jobOffer): JsonResponse
    {
        if (! $this->owns($request, $jobOffer->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        return $this->guard(function () use ($jobOffer) {
            $token = $this->letters->issueSigningToken($jobOffer);

            return response()->json([
                'data' => [
                    'url' => rtrim(config('app.frontend_url', config('app.url')), '/')."/offer/{$token}",
                    'expires_at' => $jobOffer->fresh()->signing_token_expires_at?->toIso8601String(),
                ],
            ]);
        });
    }

    /** The letter, for the recruiter to read or attach. */
    public function offerLetter(Request $request, JobOffer $jobOffer): \Illuminate\Http\Response
    {
        if (! $this->owns($request, $jobOffer->organization_id)) {
            return response('Not found', 404);
        }

        return response($this->letters->render($jobOffer), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'inline; filename="offer-letter.pdf"',
        ]);
    }

    // -------------------------------------------------------------- helpers

    private function guard(callable $work): JsonResponse
    {
        try {
            return $work();
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    private function owns(Request $request, ?int $organizationId): bool
    {
        return (int) $organizationId === (int) $request->user()->organization_id;
    }

    private function application(Request $request, int $id): ?JobApplication
    {
        return JobApplication::query()
            ->where('organization_id', $request->user()->organization_id)
            ->find($id);
    }
}
