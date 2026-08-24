<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AiChatLog;
use App\Models\User;
use App\Services\Ai\AnswerSummariser;
use App\Services\Ai\PlanValidator;
use App\Services\Ai\QueryPlanExecutor;
use App\Services\Ai\QueryPlanner;
use App\Services\Ai\UnsupportedQuestionException;
use Illuminate\Http\Request;

class SearchAskController extends Controller
{
    /**
     * Mirrors AiChatController::ASSISTANT_MAX_HIERARCHY_LEVEL and
     * hasStrictAdminAccess() on the frontend: super_admin (0) and admin (10).
     */
    private const MAX_HIERARCHY_LEVEL = 10;

    public function __construct(
        private readonly QueryPlanner $planner,
        private readonly PlanValidator $validator,
        private readonly QueryPlanExecutor $executor,
        private readonly AnswerSummariser $summariser,
    ) {
    }

    public function ask(Request $request)
    {
        $data = $request->validate(['question' => 'required|string|max:2000']);

        if (! $this->mayAsk($request->user())) {
            return response()->json(['message' => 'AI mode is available to administrators only.'], 403);
        }

        try {
            $plan = $this->validator->validate($this->planner->plan($data['question']));
        } catch (UnsupportedQuestionException $e) {
            return response()->json([
                'error' => 'unsupported_question',
                'message' => "I can't answer that from your HR data.",
                'detail' => $e->getDetail(),
            ], 422);
        }

        $result = $this->executor->execute($plan);

        AiChatLog::create([
            'user_id' => $request->user()->id,
            'organization_id' => $request->user()->organization_id,
            'message' => $data['question'],
            'reply' => json_encode($plan),
            'tool_calls_used' => [$plan['entity'] . '.' . $plan['metric']],
        ]);

        return response()->json([
            'plan' => $plan,
            'columns' => $result['columns'],
            'rows' => $result['rows'],
            'notes' => $result['notes'],
            // Filled by the separate summary call — the table must not wait.
            'summary' => null,
            'truncated' => $result['truncated'],
        ]);
    }

    public function summary(Request $request)
    {
        $data = $request->validate([
            'question' => 'required|string|max:2000',
            'columns' => 'required|array',
            'rows' => 'required|array',
        ]);

        if (! $this->mayAsk($request->user())) {
            return response()->json(['message' => 'AI mode is available to administrators only.'], 403);
        }

        return response()->json([
            'summary' => $this->summariser->summarise($data['question'], $data['columns'], $data['rows']),
        ]);
    }

    private function mayAsk(?User $user): bool
    {
        return $user !== null && $user->getHierarchyLevel() <= self::MAX_HIERARCHY_LEVEL;
    }
}
