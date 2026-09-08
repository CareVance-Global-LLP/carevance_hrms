<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AiChatLog;
use App\Models\User;
use App\Services\Ai\AnswerSummariser;
use App\Services\Ai\ConversationMemory;
use App\Services\Ai\PlanValidator;
use App\Services\Ai\QueryPlanExecutor;
use App\Services\Ai\QueryPlanner;
use App\Services\Ai\UnsupportedQuestionException;
use App\Services\AiChatService;
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
        private readonly ConversationMemory $memory,
    ) {
    }

    public function ask(Request $request)
    {
        $data = $request->validate([
            'question' => 'required|string|max:2000',
            'history' => 'nullable|array',
            'history.*.role' => 'required|in:user,assistant',
            'history.*.content' => 'required|string|max:2000',
        ]);

        if (! $this->mayAsk($request->user())) {
            return response()->json(['message' => 'AI mode is available to administrators only.'], 403);
        }

        $user = $request->user();

        // Server-side memory is the primary source. Frontend history is
        // supplementary — used only when server memory is empty (e.g., first
        // question after a cache flush).
        $contextBlock = $this->memory->contextBlock($user->id);
        if ($contextBlock === '' && ! empty($data['history'])) {
            $contextBlock = $this->buildContextFromFrontendHistory($data['history']);
        }

        try {
            $plan = $this->validator->validate($this->planner->plan($data['question'], $contextBlock));
            // Inside the same try as the validator: the executor refuses a plan
            // it cannot run in full rather than running a narrower one, and
            // that refusal is the same recoverable outcome with the same reason
            // attached — a 422 naming what was missing, never a 500.
            $result = $this->executor->execute($plan);
        } catch (UnsupportedQuestionException $e) {
            /*
             * ONE ASSISTANT, NOT A DATA MODE BESIDE A HELP BUBBLE.
             *
             * A person does not know in advance whether what they are about to
             * type is "a data question" or "a help question", and making them
             * pick the right box first is the tool's problem, not theirs.
             * "How do I run payroll?" used to be rejected here with "I can't
             * answer that from your HR data", which is true and useless.
             *
             * So a refusal becomes a FALLBACK rather than a dead end — with one
             * line held: the prose assistant may explain, but it never invents
             * a figure. Its numbers come from AiToolRegistry, which runs the
             * same scoped queries and returns a `sources` route to go and check
             * them. The moment an answer would contain a number that did not
             * come from an executed metric or a tool, it does not get said.
             *
             * `mayAnswerInProse()` is what keeps that honest: a WITHHELD
             * refusal (PAN, bank details) stays refused here, because routing
             * it to a general assistant is how an exclusion gets talked around.
             */
            if ($e->mayAnswerInProse()) {
                return $this->answerInProse($request, $data['question'], $e);
            }

            return response()->json([
                'kind' => 'refusal',
                'error' => 'unsupported_question',
                'message' => "I can't answer that from your HR data.",
                'detail' => $e->getDetail(),
                'suggestions' => $e->getSuggestions(),
            ], 422);
        }

        // Store the Q&A pair for conversation memory.
        $answerSummary = ConversationMemory::summarizeAnswer($plan, $result['rows']);
        $this->memory->remember($user->id, $data['question'], $answerSummary);

        AiChatLog::create([
            'user_id' => $user->id,
            'organization_id' => $user->organization_id,
            'message' => $data['question'],
            'reply' => json_encode($plan),
            'tool_calls_used' => [$plan['entity'] . '.' . $plan['metric']],
        ]);

        return response()->json([
            // The client switches on this rather than sniffing for `rows`,
            // because a prose answer legitimately has none.
            'kind' => 'table',
            'plan' => $plan,
            'columns' => $result['columns'],
            'rows' => $result['rows'],
            'notes' => $result['notes'],
            // Filled by the separate summary call — the table must not wait.
            'summary' => null,
            'truncated' => $result['truncated'],
        ]);
    }

    /**
     * The prose half of the one assistant.
     *
     * Reached only when the data path refused for NOT_A_DATA_QUESTION. Runs the
     * existing `AiChatService` — the same service behind the help bubble, with
     * the same tool registry — so this is one assistant with two answer shapes,
     * not a second implementation that will drift from the first.
     *
     * A failure here degrades to the original refusal rather than a 500: the
     * user asked a question, and "I can't answer that from your HR data" is a
     * worse answer than prose but a much better one than an error page.
     */
    private function answerInProse(Request $request, string $question, UnsupportedQuestionException $refusal)
    {
        try {
            $answer = app(AiChatService::class)->chat($question, [], $request->user());
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'kind' => 'refusal',
                'error' => 'unsupported_question',
                'message' => "I can't answer that from your HR data.",
                'detail' => $refusal->getDetail(),
            ], 422);
        }

        $user = $request->user();

        // Store the Q&A pair for conversation memory.
        $replyPreview = substr($answer['reply'], 0, 200);
        $this->memory->remember($user->id, $question, "Prose answer: {$replyPreview}");

        AiChatLog::create([
            'user_id' => $user->id,
            'organization_id' => $user->organization_id,
            'message' => $question,
            'reply' => $answer['reply'],
            'tool_calls_used' => ['prose_fallback'],
        ]);

        return response()->json([
            'kind' => 'prose',
            'reply' => $answer['reply'],
            'sources' => $answer['sources'] ?? [],
            // Kept so the reason the data path declined is still inspectable —
            // a prose answer to something that SHOULD have been a table is a
            // coverage gap, and hiding the reason hides the gap.
            'detail' => $refusal->getDetail(),
            'plan' => null,
            'columns' => [],
            'rows' => [],
            'notes' => [],
            'summary' => null,
            'truncated' => false,
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

    /**
     * Build a context block from frontend-supplied history.
     *
     * Used only when server-side memory is empty (first question after cache
     * flush). The frontend sends the raw conversation; we summarize it into
     * the format the planner expects.
     *
     * @param  list<array{role: string, content: string}>  $history
     */
    private function buildContextFromFrontendHistory(array $history): string
    {
        $turns = [];
        $currentQuestion = '';

        foreach ($history as $entry) {
            if ($entry['role'] === 'user') {
                $currentQuestion = $entry['content'];
            } elseif ($entry['role'] === 'assistant' && $currentQuestion !== '') {
                $turns[] = "Q: {$currentQuestion}\nA: " . substr($entry['content'], 0, 200);
                $currentQuestion = '';
            }
        }

        if ($turns === []) {
            return '';
        }

        return "Recent conversation (for resolving follow-ups only — always query fresh data):\n" . implode("\n", $turns);
    }
}
