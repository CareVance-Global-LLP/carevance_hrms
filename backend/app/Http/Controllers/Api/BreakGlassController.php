<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\BreakGlassSession;
use App\Models\User;
use App\Services\Security\BreakGlassService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Break-glass access: the vendor half and the customer half.
 *
 * Kept in one controller because the two halves are one protocol, and reading
 * them apart is how the states drift. Route registration separates them —
 * the vendor endpoints sit behind `role:super_admin`, the customer endpoints
 * behind `role:admin` and the ordinary tenant scope.
 */
class BreakGlassController extends Controller
{
    public function __construct(private readonly BreakGlassService $service)
    {
    }

    // ---------------------------------------------------------------- vendor

    /**
     * Ask a customer for access to one of their user accounts.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'user_id' => ['required', 'integer'],
            // A stated purpose is the entire basis on which a customer decides.
            // Ten characters is not a real bar, but it stops "test" and "asdf".
            'reason' => ['required', 'string', 'min:10', 'max:1000'],
        ]);

        $target = User::withoutGlobalScopes()->find($validated['user_id']);

        if (! $target || $target->organization_id === null) {
            return response()->json([
                'success' => false,
                'message' => 'That user does not exist or does not belong to an organisation.',
                'error_code' => 'NOT_FOUND',
            ], 404);
        }

        $session = $this->service->request(
            vendor: $request->user(),
            target: $target,
            reason: $validated['reason'],
            httpRequest: $request,
        );

        return response()->json([
            'success' => true,
            'message' => $session->status === 'approved'
                ? 'Access granted. This organisation has chosen notify-only support access.'
                : 'Access requested. An administrator at the customer must approve it.',
            'data' => $this->present($session),
        ], 201);
    }

    /**
     * Exchange an approved session for a token that acts as the target user.
     */
    public function issueToken(Request $request, int $id): JsonResponse
    {
        $session = BreakGlassSession::withoutOrganizationScope()->find($id);

        if (! $session) {
            return response()->json([
                'success' => false,
                'message' => 'Access session not found.',
                'error_code' => 'NOT_FOUND',
            ], 404);
        }

        try {
            $token = $this->service->issueToken($session, $request->user());
        } catch (\InvalidArgumentException $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
                'error_code' => 'BREAK_GLASS_UNAVAILABLE',
            ], 403);
        }

        return response()->json([
            'success' => true,
            'data' => [
                'token' => $token,
                'expires_at' => $session->expires_at?->toIso8601String(),
                'session' => $this->present($session->refresh()),
            ],
        ]);
    }

    /**
     * Every session, across tenants. Vendor-side audit view.
     */
    public function indexAll(Request $request): JsonResponse
    {
        $sessions = BreakGlassSession::withoutOrganizationScope()
            ->with(['organization:id,name', 'targetUser:id,name,email', 'requestedBy:id,name,email'])
            ->orderByDesc('created_at')
            ->limit(200)
            ->get();

        return response()->json([
            'success' => true,
            'data' => $sessions->map(fn (BreakGlassSession $s) => $this->present($s))->all(),
        ]);
    }

    // -------------------------------------------------------------- customer

    /**
     * Sessions touching this organisation. Scoped automatically.
     */
    public function index(Request $request): JsonResponse
    {
        $sessions = BreakGlassSession::query()
            ->with(['targetUser:id,name,email', 'requestedBy:id,name,email'])
            ->orderByDesc('created_at')
            ->limit(200)
            ->get();

        return response()->json([
            'success' => true,
            'data' => $sessions->map(fn (BreakGlassSession $s) => $this->present($s))->all(),
        ]);
    }

    public function approve(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'minutes' => ['nullable', 'integer', 'min:1', 'max:'.BreakGlassSession::MAX_DURATION_MINUTES],
        ]);

        $session = $this->findForTenant($id);

        if (! $session) {
            return $this->notFound();
        }

        try {
            $session = $this->service->approve(
                $session,
                $request->user(),
                $validated['minutes'] ?? BreakGlassSession::MAX_DURATION_MINUTES,
            );
        } catch (\InvalidArgumentException $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
                'error_code' => 'INVALID_STATE',
            ], 422);
        }

        return response()->json([
            'success' => true,
            'message' => 'Support access approved. It ends automatically at the time shown.',
            'data' => $this->present($session),
        ]);
    }

    public function reject(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'reason' => ['nullable', 'string', 'max:1000'],
        ]);

        $session = $this->findForTenant($id);

        if (! $session) {
            return $this->notFound();
        }

        try {
            $session = $this->service->reject($session, $request->user(), $validated['reason'] ?? null);
        } catch (\InvalidArgumentException $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
                'error_code' => 'INVALID_STATE',
            ], 422);
        }

        return response()->json([
            'success' => true,
            'message' => 'Access request declined.',
            'data' => $this->present($session),
        ]);
    }

    /**
     * End a session now. Deliberately allowed from any state — a customer
     * revoking something already expired should get "done", not an error.
     */
    public function revoke(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'reason' => ['nullable', 'string', 'max:1000'],
        ]);

        $session = $this->findForTenant($id);

        if (! $session) {
            return $this->notFound();
        }

        $session = $this->service->revoke($session, $request->user(), $validated['reason'] ?? null);

        return response()->json([
            'success' => true,
            'message' => 'Support access ended. Any active session token has been destroyed.',
            'data' => $this->present($session),
        ]);
    }

    // ----------------------------------------------------------------- utils

    private function findForTenant(int $id): ?BreakGlassSession
    {
        // The ordinary tenant scope applies, so an admin cannot reach another
        // organisation's session by guessing an id.
        return BreakGlassSession::query()->find($id);
    }

    private function notFound(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => 'Access session not found.',
            'error_code' => 'NOT_FOUND',
        ], 404);
    }

    /**
     * @return array<string, mixed>
     */
    private function present(BreakGlassSession $session): array
    {
        return [
            'id' => $session->id,
            'organization_id' => $session->organization_id,
            'organization' => $session->relationLoaded('organization') ? $session->organization?->name : null,
            'target_user' => $session->relationLoaded('targetUser')
                ? ['id' => $session->targetUser?->id, 'name' => $session->targetUser?->name]
                : ['id' => $session->target_user_id, 'name' => null],
            'requested_by' => $session->relationLoaded('requestedBy')
                ? ['id' => $session->requestedBy?->id, 'name' => $session->requestedBy?->name]
                : ['id' => $session->requested_by_user_id, 'name' => null],
            'reason' => $session->reason,
            'status' => $session->status,
            'is_usable' => $session->isUsable(),
            'unusable_reason' => $session->unusableReason(),
            'remaining_minutes' => $session->remainingMinutes(),
            'requested_at' => $session->requested_at?->toIso8601String(),
            'approved_at' => $session->approved_at?->toIso8601String(),
            'expires_at' => $session->expires_at?->toIso8601String(),
            'revoked_at' => $session->revoked_at?->toIso8601String(),
        ];
    }
}
