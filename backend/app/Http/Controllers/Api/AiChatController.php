<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AiChatService;
use Illuminate\Http\Request;

class AiChatController extends Controller
{
    /**
     * Hierarchy level at or below which a user may reach the in-app assistant:
     * super_admin (0) and admin (10). Custom roles carry their own
     * hierarchy_level, so a bespoke admin-tier role passes without being named
     * here. Mirrors hasStrictAdminAccess() in frontend/src/lib/permissions.ts.
     */
    private const ASSISTANT_MAX_HIERARCHY_LEVEL = 10;

    public function __construct(private readonly AiChatService $chatService)
    {
    }

    public function chat(Request $request)
    {
        $data = $request->validate([
            'message' => 'required|string|max:2000',
            'history' => 'nullable|array',
            'history.*.role' => 'required|in:user,assistant',
            'history.*.content' => 'required|string|max:2000',
            'context' => 'nullable|in:admin,landing',
        ]);

        $user = $request->user();
        $context = $data['context'] ?? null;

        /*
         * This route sits in routes/api/public.php behind `api.token.optional`,
         * which resolves a user when a token is present and lets the request
         * through when it is not. That is deliberate — the landing-page sales
         * bot serves unauthenticated visitors — but it means the ONLY thing
         * standing between a stranger and the org-wide data tools is this
         * check. Keep it here, before the service is touched.
         *
         * The landing branch stays open to everyone, including logged-in
         * employees who pass `context=landing`. It runs the marketing prompt
         * with no tools and reads no organisation data, so there is nothing
         * behind it to reach. Do not wire tools into that branch.
         */
        if ($context !== 'landing' && ! $this->mayUseAssistant($user)) {
            return response()->json([
                'message' => 'The AI assistant is available to administrators only.',
            ], 403);
        }

        // ['reply' => string, 'sources' => [['label', 'route'], ...]]. The
        // sources come from the tools that actually ran, so the client can link
        // every number back to the screen it was read from.
        return response()->json($this->chatService->chat(
            $data['message'],
            $data['history'] ?? [],
            $user,
            $context
        ));
    }

    private function mayUseAssistant($user): bool
    {
        return $user !== null
            && $user->getHierarchyLevel() <= self::ASSISTANT_MAX_HIERARCHY_LEVEL;
    }
}
