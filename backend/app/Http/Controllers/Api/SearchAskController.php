<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AiChatLog;
use App\Models\User;
use App\Services\Ai\Actions\ActionExecutor;
use App\Services\Ai\Actions\ActionPlanner;
use App\Services\Ai\Actions\ActionPreviewBuilder;
use App\Services\Ai\Actions\ActionRefusedException;
use App\Services\Ai\AnswerSummariser;
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
        private readonly ActionPlanner $actions,
        private readonly ActionPreviewBuilder $previews,
        private readonly ActionExecutor $applier,
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
            /*
             * THE WRITE PATH SITS BETWEEN THE READ PATH AND PROSE.
             *
             * Between, and nowhere else. Consulted only AFTER the query planner
             * has declined, because a change request never costs a table that
             * would otherwise have been answered — and BEFORE prose, because §6
             * says "a refusal is never a fallback to prose. A person asking for
             * a change and receiving a paragraph would reasonably believe
             * something happened."
             *
             * `isChangeRequest()` is local, free and decides ROUTING rather
             * than an answer: a wrong yes costs a refusal on something the read
             * path had already refused, and a wrong no leaves the question
             * exactly where it went before write actions existed.
             */
            if ($this->readsAsAChange($e, $data['question'])) {
                return $this->previewAction($request, $data['question']);
            }

            if ($e->mayAnswerInProse()) {
                return $this->answerInProse($request, $data['question'], $e);
            }

            return response()->json([
                'kind' => 'refusal',
                'error' => 'unsupported_question',
                'message' => "I can't answer that from your HR data.",
                'detail' => $e->getDetail(),
            ], 422);
        }

        AiChatLog::create([
            'user_id' => $request->user()->id,
            'organization_id' => $request->user()->organization_id,
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

        AiChatLog::create([
            'user_id' => $request->user()->id,
            'organization_id' => $request->user()->organization_id,
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

    /**
     * Whether this refusal should be offered to the write path at all.
     *
     * A WITHHELD refusal never is. "set everyone's PAN to …" is declined by
     * `QueryPlanner::refuseWithheldSubject()` before any model sees it, and
     * handing that sentence to a second planner is how an exclusion gets talked
     * around by a different route — the same reasoning that keeps WITHHELD out
     * of the prose fallback below it.
     */
    private function readsAsAChange(UnsupportedQuestionException $refusal, string $question): bool
    {
        if ($refusal->getReason() === UnsupportedQuestionException::WITHHELD) {
            return false;
        }

        return ActionPlanner::isChangeRequest($question);
    }

    /**
     * The change the person asked for, interpreted and shown back to them.
     *
     * A PREVIEW WRITES NOTHING. Everything below reads: the planner produces an
     * interpretation, the builder resolves the target inside the tenant scope,
     * reads the live values and computes the diff. The only thing it issues is
     * a signed token, and a token is a claim about what was shown — not a
     * change to anything.
     *
     * ITS OWN try/catch, and that is load-bearing rather than tidy.
     * `ActionRefusedException` EXTENDS `UnsupportedQuestionException`, and PHP
     * does not re-enter a catch block with a throw raised inside it — written
     * in the caller's catch, every refusal here would escape as an unhandled
     * 500, which is the one outcome §6 rules out most firmly.
     *
     * A no-op preview comes back with `token: null` and a `message`. It is not
     * a refusal — nothing is wrong, the row already holds what was asked for —
     * and the absence of a token is what stops the client offering an Apply
     * button for a write that would change nothing.
     */
    private function previewAction(Request $request, string $question)
    {
        try {
            $preview = $this->previews->build(
                $this->actions->plan($question),
                $request->user(),
                $question,
            );
        } catch (ActionRefusedException $e) {
            return $this->refuseAction($e);
        } catch (UnsupportedQuestionException $e) {
            // The planner declining before it ever produced a plan — an
            // unconfigured provider, or output nothing could parse. Still a
            // change request, so still an action refusal and never prose.
            return $this->refuseAction(ActionRefusedException::malformed($e->getDetail()));
        }

        AiChatLog::create([
            'user_id' => $request->user()->id,
            'organization_id' => $request->user()->organization_id,
            'message' => $question,
            'reply' => json_encode($this->loggableAction($preview)),
            'tool_calls_used' => ['action_preview.'.$preview['key']],
        ]);

        return response()->json([
            // The client switches on this, exactly as it does for a table or a
            // prose answer. An action is a third answer shape, not a table with
            // unusual columns.
            'kind' => 'action',
            'action' => $preview,
            /*
             * The read path's empty fields, carried exactly as a prose answer
             * carries them. An action is a third answer shape on ONE response
             * type, and a client holding `rows` or `notes` must not have to
             * know which shape it got before it may read them.
             */
            'plan' => null,
            'columns' => [],
            'rows' => [],
            'notes' => [],
            'summary' => null,
            'truncated' => false,
        ]);
    }

    /**
     * Apply a previewed change.
     *
     * The controller does almost nothing here on purpose. `ActionExecutor`
     * re-opens the token, re-reads the catalogue, re-checks the permission and
     * the role gate, re-resolves the target inside the tenant scope, re-reads
     * the live row and refuses if anything moved, dispatches through the REAL
     * HTTP endpoint and writes the audit naming this human. Any of that lifted
     * up here would be a second implementation of a check that already exists,
     * and two copies of a security check is one that eventually disagrees with
     * itself.
     *
     * The inbound request is handed over untouched: the executor forwards its
     * credential to the internal request, so the endpoint authenticates the
     * same person through the same middleware, and it is the provenance the
     * audit row records.
     */
    public function act(Request $request)
    {
        $data = $request->validate(['token' => 'required|string|max:8192']);

        if (! $this->mayAsk($request->user())) {
            return response()->json(['message' => 'AI mode is available to administrators only.'], 403);
        }

        try {
            $result = $this->applier->execute($data['token'], $request->user(), $request);
        } catch (ActionRefusedException $e) {
            return $this->refuseAction($e);
        }

        return response()->json($result);
    }

    /**
     * One refusal envelope for the whole write path.
     *
     * The READ PATH'S SHAPE, deliberately: `kind`/`error`/`message`/`detail` on
     * a 422, because a client that already parses a refusal must not need a
     * second parser to learn that a change was declined. What differs is what
     * fills them — `error` is the machine code, so an action refusal says
     * `action_refused` rather than `unsupported_question`, and the client can
     * tell "I can't answer that from your HR data" apart from "you do not have
     * permission to change leave types". Rendering the second under the first
     * is a false statement, not a cosmetic mismatch.
     *
     * `refusal` carries WHICH refusal it is — stale, not permitted, no
     * preview — so the client can offer the right next step. Every sentence
     * names the thing that was wrong; none of them is "forbidden".
     */
    private function refuseAction(ActionRefusedException $e)
    {
        return response()->json([
            'kind' => 'refusal',
            'error' => 'action_refused',
            'refusal' => $e->refusal(),
            'message' => $e->getDetail(),
            // The same sentence, in the key the existing client reads off a
            // 422. A refusal the reader cannot see is one they will retry.
            'detail' => $e->getDetail(),
        ], 422);
    }

    /**
     * The preview, minus the token, for the ask log.
     *
     * The token is a bearer capability for five minutes. It belongs in the
     * response the person is looking at and nowhere else — certainly not in a
     * table anybody with log access can read.
     *
     * @param  array<string, mixed>  $preview
     * @return array<string, mixed>
     */
    private function loggableAction(array $preview): array
    {
        return array_diff_key($preview, ['token' => null]);
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
