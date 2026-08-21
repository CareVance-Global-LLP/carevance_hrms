<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Candidate;
use App\Models\HiringStage;
use App\Models\JobApplication;
use App\Models\JobOpening;
use App\Services\Recruitment\HiringPipelineService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use RuntimeException;

/**
 * Openings, candidates and the pipeline between them.
 *
 * Every write goes through HiringPipelineService rather than touching the
 * models: the rules about what may move where, and the requirement that a move
 * always writes the event explaining it, belong in one place. A controller that
 * updated `hiring_stage_id` directly would be a second, silent pipeline.
 */
class RecruitmentController extends Controller
{
    public function __construct(
        private readonly HiringPipelineService $pipeline,
    ) {
    }

    // ------------------------------------------------------------- openings

    public function openings(Request $request): JsonResponse
    {
        $openings = JobOpening::query()
            ->where('organization_id', $request->user()->organization_id)
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->with(['hiringManager:id,name', 'recruiter:id,name', 'department:id,name'])
            ->withCount([
                // Live candidacies only. Counting decided ones makes every
                // opening look permanently busy.
                'applications as active_applications_count' => fn ($q) => $q->where('status', 'active'),
                'applications as hired_count' => fn ($q) => $q->where('status', 'hired'),
            ])
            ->orderByDesc('id')
            ->paginate(15);

        return response()->json($openings);
    }

    public function storeOpening(Request $request): JsonResponse
    {
        $validated = $this->validatedOpening($request);

        $organizationId = $request->user()->organization_id;

        // The pipeline has to exist before anybody can apply, and an admin
        // creating their first requisition is the first moment it is needed.
        $this->pipeline->ensureStagesFor($request->user()->organization);

        $opening = JobOpening::query()->create($validated + [
            'organization_id' => $organizationId,
            'created_by' => $request->user()->id,
            'code' => $validated['code'] ?? $this->nextCode($organizationId),
        ]);

        return response()->json(['data' => $opening], 201);
    }

    public function updateOpening(Request $request, JobOpening $jobOpening): JsonResponse
    {
        if (! $this->belongsToCaller($request, $jobOpening->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $this->validatedOpening($request, $jobOpening);

        /*
         * Opening a requisition stamps the date it opened, once. Re-stamping on
         * every later edit would make time-to-hire measure from the last time
         * somebody fixed a typo.
         */
        if (($validated['status'] ?? null) === 'open' && ! $jobOpening->opened_at) {
            $validated['opened_at'] = now()->toDateString();
        }

        if (in_array($validated['status'] ?? null, ['closed', 'filled'], true) && ! $jobOpening->closed_at) {
            $validated['closed_at'] = now()->toDateString();
        }

        $jobOpening->update($validated);

        return response()->json(['data' => $jobOpening->fresh()]);
    }

    /** One opening, with its funnel. */
    public function showOpening(Request $request, JobOpening $jobOpening): JsonResponse
    {
        if (! $this->belongsToCaller($request, $jobOpening->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        return response()->json([
            'data' => $jobOpening->load(['hiringManager:id,name', 'recruiter:id,name', 'department:id,name']),
            'funnel' => $this->pipeline->funnelFor($jobOpening),
            'remaining_openings' => $jobOpening->remainingOpenings(),
        ]);
    }

    // ----------------------------------------------------------- candidates

    public function candidates(Request $request): JsonResponse
    {
        $candidates = Candidate::query()
            ->where('organization_id', $request->user()->organization_id)
            ->when($request->filled('q'), function ($query) use ($request) {
                $term = '%'.strtolower($request->string('q')).'%';
                $query->where(function ($scope) use ($term) {
                    $scope->whereRaw('LOWER(first_name) LIKE ?', [$term])
                        ->orWhereRaw('LOWER(last_name) LIKE ?', [$term])
                        ->orWhereRaw('LOWER(email) LIKE ?', [$term]);
                });
            })
            ->withCount('applications')
            ->orderByDesc('id')
            ->paginate(15);

        return response()->json($candidates);
    }

    public function storeCandidate(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $validated = $request->validate([
            'first_name' => 'required|string|max:120',
            'last_name' => 'nullable|string|max:120',
            /*
             * Unique per organization, not globally. The same person
             * legitimately applies to two different customers on this platform,
             * and a global rule would let one customer's pipeline block
             * another's.
             */
            'email' => [
                'required', 'email', 'max:255',
                Rule::unique('candidates')->where(fn ($q) => $q->where('organization_id', $organizationId)),
            ],
            'phone' => 'nullable|string|max:32',
            'linkedin_url' => 'nullable|url|max:255',
            'source' => ['sometimes', Rule::in(Candidate::SOURCES)],
            'referred_by' => 'nullable|integer',
            'current_company' => 'nullable|string|max:255',
            'current_ctc' => 'nullable|numeric|min:0',
            'expected_ctc' => 'nullable|numeric|min:0',
            'notice_period_days' => 'nullable|integer|min:0|max:365',
            'location' => 'nullable|string|max:255',
        ]);

        $candidate = Candidate::query()->create($validated + ['organization_id' => $organizationId]);

        return response()->json(['data' => $candidate], 201);
    }

    // ------------------------------------------------------------- pipeline

    public function stages(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->pipeline->ensureStagesFor($request->user()->organization),
        ]);
    }

    public function applications(Request $request): JsonResponse
    {
        $applications = JobApplication::query()
            ->where('organization_id', $request->user()->organization_id)
            ->when($request->filled('job_opening_id'), fn ($q) => $q->where('job_opening_id', (int) $request->input('job_opening_id')))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->with(['candidate:id,first_name,last_name,email', 'stage:id,name,kind,position', 'opening:id,title,code'])
            ->orderByDesc('id')
            ->paginate(25);

        return response()->json($applications);
    }

    public function apply(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'job_opening_id' => 'required|integer',
            'candidate_id' => 'required|integer',
        ]);

        $opening = $this->findOpening($request, (int) $validated['job_opening_id']);
        $candidate = Candidate::query()
            ->where('organization_id', $request->user()->organization_id)
            ->find($validated['candidate_id']);

        if (! $opening || ! $candidate) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        return $this->guard(fn () => response()->json([
            'data' => $this->pipeline->apply($opening, $candidate, $request->user()),
        ], 201));
    }

    public function moveApplication(Request $request, JobApplication $jobApplication): JsonResponse
    {
        if (! $this->belongsToCaller($request, $jobApplication->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $request->validate([
            'hiring_stage_id' => 'required|integer',
            'note' => 'nullable|string|max:500',
        ]);

        $stage = HiringStage::query()
            ->where('organization_id', $request->user()->organization_id)
            ->find($validated['hiring_stage_id']);

        if (! $stage) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        return $this->guard(fn () => response()->json([
            'data' => $this->pipeline->moveTo($jobApplication, $stage, $request->user(), $validated['note'] ?? null),
        ]));
    }

    public function decideApplication(Request $request, JobApplication $jobApplication): JsonResponse
    {
        if (! $this->belongsToCaller($request, $jobApplication->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $request->validate([
            'decision' => ['required', Rule::in(['rejected', 'withdrawn'])],
            // Required for a rejection, and the service refuses a blank one
            // regardless - a candidacy that simply stops moving explains
            // nothing to the candidate or to an auditor.
            'reason' => 'required_if:decision,rejected|nullable|string|max:500',
        ]);

        return $this->guard(fn () => response()->json([
            'data' => $validated['decision'] === 'rejected'
                ? $this->pipeline->reject($jobApplication, (string) $validated['reason'], $request->user())
                : $this->pipeline->withdraw($jobApplication, $validated['reason'] ?? null, $request->user()),
        ]));
    }

    /** The history behind one candidacy. */
    public function applicationEvents(Request $request, JobApplication $jobApplication): JsonResponse
    {
        if (! $this->belongsToCaller($request, $jobApplication->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        return response()->json([
            'data' => $jobApplication->events()
                ->with(['fromStage:id,name', 'toStage:id,name', 'actor:id,name'])
                ->orderBy('created_at')
                ->orderBy('id')
                ->get(),
        ]);
    }

    // -------------------------------------------------------------- helpers

    /**
     * Turn a refused transition into a 422 rather than a 500.
     *
     * Every one of these is a business rule the caller can act on - "that
     * opening is not accepting applications", "a rejection needs a reason" -
     * and a 500 tells them only that something broke.
     */
    private function guard(callable $work): JsonResponse
    {
        try {
            return $work();
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    private function belongsToCaller(Request $request, ?int $organizationId): bool
    {
        return (int) $organizationId === (int) $request->user()->organization_id;
    }

    private function findOpening(Request $request, int $id): ?JobOpening
    {
        return JobOpening::query()
            ->where('organization_id', $request->user()->organization_id)
            ->find($id);
    }

    /**
     * The next requisition reference for this organization.
     *
     * Derived from the highest number ever issued - archived requisitions
     * included - rather than from a count. REQ-2 gets quoted in approval emails
     * and offer letters, so handing that reference to a different role later
     * makes those documents point at the wrong job.
     */
    private function nextCode(int $organizationId): string
    {
        $highest = JobOpening::withTrashed()
            ->where('organization_id', $organizationId)
            ->where('code', 'like', 'REQ-%')
            ->get(['code'])
            ->map(fn ($row) => (int) substr((string) $row->code, 4))
            ->max();

        return 'REQ-'.(((int) $highest) + 1);
    }

    /** @return array<string, mixed> */
    private function validatedOpening(Request $request, ?JobOpening $existing = null): array
    {
        $presence = $existing ? 'sometimes' : 'required';

        return $request->validate([
            'title' => $presence.'|string|max:255',
            'code' => 'sometimes|nullable|string|max:40',
            'description' => 'sometimes|nullable|string|max:20000',
            'employment_type' => ['sometimes', Rule::in(JobOpening::EMPLOYMENT_TYPES)],
            'location' => 'sometimes|nullable|string|max:255',
            'is_remote' => 'sometimes|boolean',
            'openings_count' => 'sometimes|integer|min:1|max:999',
            'min_ctc' => 'sometimes|nullable|numeric|min:0',
            // Checked against min_ctc here as well as by a database constraint:
            // a band that runs backwards silently mis-sorts every salary filter
            // built on it later.
            'max_ctc' => 'sometimes|nullable|numeric|min:0|gte:min_ctc',
            'status' => ['sometimes', Rule::in(JobOpening::STATUSES)],
            'hiring_manager_id' => 'sometimes|nullable|integer|exists:users,id',
            'recruiter_id' => 'sometimes|nullable|integer|exists:users,id',
            'legal_entity_id' => 'sometimes|nullable|integer|exists:legal_entities,id',
            'group_id' => 'sometimes|nullable|integer|exists:groups,id',
        ]);
    }
}
