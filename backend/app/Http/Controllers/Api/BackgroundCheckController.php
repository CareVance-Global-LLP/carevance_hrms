<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\BackgroundCheck;
use App\Models\BackgroundCheckConsent;
use App\Models\BackgroundCheckItem;
use App\Models\Candidate;
use App\Models\User;
use App\Services\Recruitment\BackgroundCheckService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use RuntimeException;

/**
 * Background verification.
 *
 * The most sensitive surface in the product. A completed check can contain a
 * criminal record, an address history and somebody's real salary at a previous
 * employer — so this sits behind the HR gate rather than the manager one that
 * the rest of recruitment uses. A hiring manager decides whether to hire; they
 * do not need to read a police verification to do it.
 *
 * NOTHING HERE REJECTS ANYBODY. Every endpoint records a finding; none of them
 * touches a candidacy, moves a pipeline stage, or writes a status that reads as
 * a verdict. What to do about a discrepancy is a decision a person takes with
 * the finding in front of them.
 */
class BackgroundCheckController extends Controller
{
    public function __construct(
        private readonly BackgroundCheckService $checks,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $rows = BackgroundCheck::query()
            ->where('organization_id', $request->user()->organization_id)
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
            ->when($request->filled('outcome'), fn ($q) => $q->where('outcome', $request->string('outcome')))
            ->with([
                'candidate:id,first_name,last_name,email',
                'subject:id,name,email',
                // Types and statuses only. The listing is a worklist, and the
                // findings themselves are read one check at a time.
                'items:id,background_check_id,type,status',
            ])
            ->orderByDesc('id')
            ->paginate(20);

        return response()->json($rows);
    }

    /** One check, with its findings. */
    public function show(Request $request, BackgroundCheck $backgroundCheck): JsonResponse
    {
        if (! $this->owns($request, $backgroundCheck->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $backgroundCheck->load(['items', 'consent', 'candidate:id,first_name,last_name,email', 'subject:id,name,email']);

        return response()->json([
            'data' => $backgroundCheck,
            // Surfaced rather than left for the UI to work out, because
            // forgetting to tell somebody is the failure that matters.
            'needs_adverse_action_notice' => $backgroundCheck->needsAdverseActionNotice(),
        ]);
    }

    /**
     * Record consent.
     *
     * The IP and user agent come from the request rather than the payload — a
     * client-supplied address is not evidence of anything.
     */
    public function storeConsent(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'candidate_id' => 'required_without:user_id|nullable|integer',
            'user_id' => 'required_without:candidate_id|nullable|integer',
            'consented_name' => 'required|string|max:150',
            'scope' => 'required|array|min:1',
            'scope.*' => ['string', Rule::in(BackgroundCheckItem::TYPES)],
            'notice_text' => 'nullable|string|max:20000',
        ]);

        $subject = $this->subject($request, $validated);

        if (! $subject) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        return $this->guard(fn () => response()->json([
            'data' => $this->checks->recordConsent(
                $subject,
                $validated['consented_name'],
                $validated['scope'],
                $validated['notice_text'] ?? null,
                $request->ip(),
                $request->userAgent(),
            ),
        ], 201));
    }

    public function withdrawConsent(Request $request, BackgroundCheckConsent $backgroundCheckConsent): JsonResponse
    {
        if (! $this->owns($request, $backgroundCheckConsent->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $request->validate(['reason' => 'required|string|max:500']);

        return $this->guard(fn () => response()->json([
            'data' => $this->checks->withdrawConsent($backgroundCheckConsent, $validated['reason']),
        ]));
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'candidate_id' => 'required_without:user_id|nullable|integer',
            'user_id' => 'required_without:candidate_id|nullable|integer',
            'consent_id' => 'required|integer',
            'types' => 'required|array|min:1',
            'types.*' => ['string', Rule::in(BackgroundCheckItem::TYPES)],
            'package' => 'nullable|string|max:120',
        ]);

        $subject = $this->subject($request, $validated);

        $consent = BackgroundCheckConsent::query()
            ->where('organization_id', $request->user()->organization_id)
            ->find($validated['consent_id']);

        if (! $subject || ! $consent) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        return $this->guard(fn () => response()->json([
            'data' => $this->checks->open(
                $subject,
                $consent,
                $validated['types'],
                $validated['package'] ?? null,
                $request->user(),
            ),
        ], 201));
    }

    public function recordItem(Request $request, BackgroundCheckItem $backgroundCheckItem): JsonResponse
    {
        if (! $this->owns($request, $backgroundCheckItem->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $request->validate([
            'status' => ['required', Rule::in(BackgroundCheckItem::STATUSES)],
            // Both required for a discrepancy — the service refuses one without
            // the other, because an accusation with no comparison behind it is
            // one nobody can answer.
            'claimed' => 'required_if:status,discrepancy|nullable|string|max:2000',
            'verified' => 'required_if:status,discrepancy|nullable|string|max:2000',
            'notes' => 'nullable|string|max:5000',
        ]);

        return $this->guard(fn () => response()->json([
            'data' => $this->checks->recordItem(
                $backgroundCheckItem,
                $validated['status'],
                $validated['claimed'] ?? null,
                $validated['verified'] ?? null,
                $validated['notes'] ?? null,
                $request->user(),
            ),
        ]));
    }

    /** Record that the candidate has been told about an adverse finding. */
    public function notify(Request $request, BackgroundCheck $backgroundCheck): JsonResponse
    {
        if (! $this->owns($request, $backgroundCheck->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        return $this->guard(fn () => response()->json([
            'data' => $this->checks->recordAdverseActionNotice($backgroundCheck),
        ]));
    }

    /** Their answer to it. */
    public function respond(Request $request, BackgroundCheck $backgroundCheck): JsonResponse
    {
        if (! $this->owns($request, $backgroundCheck->organization_id)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $request->validate(['response' => 'required|string|max:5000']);

        return $this->guard(fn () => response()->json([
            'data' => $this->checks->recordCandidateResponse($backgroundCheck, $validated['response']),
        ]));
    }

    // -------------------------------------------------------------- helpers

    private function guard(callable $work): JsonResponse
    {
        try {
            return $work();
        } catch (RuntimeException $exception) {
            // Every refusal here is a rule the caller can act on — "consent
            // does not cover: criminal", "a discrepancy needs both sides".
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    private function owns(Request $request, ?int $organizationId): bool
    {
        return (int) $organizationId === (int) $request->user()->organization_id;
    }

    /** @param array<string, mixed> $validated */
    private function subject(Request $request, array $validated): Candidate|User|null
    {
        $organizationId = $request->user()->organization_id;

        if (! empty($validated['candidate_id'])) {
            return Candidate::query()->where('organization_id', $organizationId)->find($validated['candidate_id']);
        }

        if (! empty($validated['user_id'])) {
            return User::query()->where('organization_id', $organizationId)->find($validated['user_id']);
        }

        return null;
    }
}
