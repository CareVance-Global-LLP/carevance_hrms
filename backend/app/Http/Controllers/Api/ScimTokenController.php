<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ScimToken;
use App\Services\Auth\ScimProvisioningService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Issuing and revoking the token an identity provider provisions with.
 *
 * Admin-only, and for the sharpest reason in the product: whoever holds one of
 * these can create and deactivate users across the whole tenant. It is a higher
 * privilege than most administrators exercise by hand.
 */
class ScimTokenController extends Controller
{
    public function __construct(
        private readonly ScimProvisioningService $scim,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        return response()->json([
            'data' => ScimToken::query()
                ->where('organization_id', $request->user()->organization_id)
                ->with('creator:id,name')
                ->orderByDesc('id')
                ->get()
                ->map(fn (ScimToken $token) => array_merge($token->toArray(), [
                    // Whether the integration is actually live. A token that
                    // has never been used is usually one somebody pasted wrongly.
                    'is_live' => $token->isLive(),
                ])),
            'endpoint' => rtrim(config('app.url'), '/').'/api/scim/v2',
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate(['name' => 'required|string|max:120']);

        $issued = $this->scim->issueToken(
            $request->user()->organization,
            $validated['name'],
            $request->user(),
        );

        return response()->json([
            'data' => $issued['token'],
            /*
             * The only time this exists in readable form. Said plainly to the
             * caller, because somebody who closes the dialog without copying it
             * has to issue another - and that is better than a token we could
             * hand back on request.
             */
            'token' => $issued['plain'],
            'message' => 'Copy this now. It cannot be shown again.',
        ], 201);
    }

    public function revoke(Request $request, ScimToken $scimToken): JsonResponse
    {
        if ((int) $scimToken->organization_id !== (int) $request->user()->organization_id) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        // Revoked rather than deleted: an audit asking "what could reach this
        // tenant last March" needs the row to still be there.
        $scimToken->forceFill(['revoked_at' => $scimToken->revoked_at ?: now()])->save();

        return response()->json(['data' => $scimToken->fresh()]);
    }
}
