<?php

namespace App\Services\Ai\Actions;

use App\Services\Ai\PlanningClient;
use App\Services\Ai\UnsupportedQuestionException;

/**
 * Turns "change the casual leave carry-forward to 10 days" into the §2 plan.
 *
 * `QueryPlanner` is this class's sibling and the shape is deliberately the
 * same: the model picks a KEY out of a hand-written catalogue and supplies
 * values, and everything it produces is untrusted input until
 * `ActionPreviewBuilder` has checked every part of it against that catalogue.
 * The transport, the provider order and the three ox-alpha settings are shared
 * through `PlanningClient` rather than copied, so the two planners cannot drift.
 *
 * WHAT THE MODEL IS SHOWN, AND WHAT IT IS NOT
 *
 * The prompt carries action keys, labels, lookup names, field names and bounds.
 * It does NOT carry the endpoint, the Eloquent class or the table — §3 says the
 * model "cannot name an endpoint, a table, a column or a model", and the way to
 * make that true is not to validate it away afterwards but to never show it. A
 * plan naming a route is then not a refusal, it is an unthinkable sentence.
 *
 * The bounds are in the prompt for a different reason: they are the difference
 * between "set the cap to 4000" coming back as a plan that preview refuses, and
 * the model producing 365 with a note that it clamped. The first is honest, so
 * the bounds are stated and the model is told to refuse rather than clamp.
 *
 * WHEN THIS RUNS AT ALL
 *
 * Only after the read path has declined AND `isChangeRequest()` says the person
 * was giving an instruction rather than asking a question. That ordering is not
 * an optimisation — §6 says an action refusal never falls back to prose, so a
 * question routed here comes back as "I can't change that" instead of an
 * answer. Asking the read path first means a false positive costs nothing,
 * because the read path has already refused by then.
 *
 * @see docs/superpowers/specs/2026-08-26-ai-write-actions.md §2, §3, §6
 */
class ActionPlanner
{
    /**
     * A plan is one key, a small target map and a handful of fields — far
     * smaller than a v2 query plan. The budget is generous anyway because a
     * response truncated mid-object is unparseable, and unparseable is a
     * refusal for want of output budget rather than for anything about the
     * request.
     */
    private const MAX_TOKENS = 600;

    /**
     * Verbs that mean somebody wants something changed.
     *
     * Matched as whole words, never substrings — "unchanged" contains "change"
     * and "offset" contains "set", and routing either into the write path is
     * how a report question comes back as a refusal to write.
     */
    private const CHANGE_VERBS = [
        'change', 'set', 'update', 'rename', 'edit', 'adjust', 'correct',
        'increase', 'decrease', 'raise', 'lower', 'reduce', 'bump', 'make',
        'switch', 'move', 'configure', 'rename', 'reset',
    ];

    /**
     * Instructions that mean somebody wants something DONE that this system
     * deliberately will not do from here.
     *
     * None of these is in the catalogue and none ever will be — §4 rules out
     * deletes, money and payroll state transitions — so every one of them ends
     * in a refusal. They are listed anyway, and that is the whole point: routed
     * here, "delete all employees" comes back as *"There is no action for
     * deleting an employee"*, named and final. Left out, the read path declines
     * it and the PROSE assistant answers, and a person who asked for a deletion
     * and received a helpful paragraph has every reason to believe one
     * happened. §6: "a refusal is never a fallback to prose."
     *
     * So the gate asks "was this an instruction?", not "is this an instruction
     * we can carry out?". The catalogue answers the second question, and it
     * answers it by name.
     */
    private const REFUSABLE_VERBS = [
        'delete', 'remove', 'archive', 'deactivate', 'disable', 'enable',
        'activate', 'suspend', 'revoke', 'terminate', 'cancel', 'close',
        'approve', 'reject', 'lock', 'unlock', 'release', 'disburse',
        'add', 'create', 'assign', 'grant', 'promote', 'transfer',
    ];

    /**
     * Interrogatives — words that make what follows a QUESTION.
     *
     * "how do I change the cap?" contains a change verb and is not a request to
     * change anything — it is the exact question the prose assistant exists to
     * answer, and turning it into "I can't change that" is a worse product than
     * the one that existed before write actions.
     *
     * An interrogative FRAMES everything after it, so one opening the sentence
     * settles the whole sentence however many clauses follow.
     *
     * `can` and `could` are deliberately absent: "can you change the start time
     * to 09:30?" is a polite imperative, not an enquiry. They are stripped as
     * prefixes below instead.
     */
    private const ENQUIRY_OPENERS = [
        'how', 'what', 'why', 'when', 'where', 'which', 'who', 'whose', 'whom',
        'is', 'are', 'was', 'were', 'do', 'does', 'did', 'should',
    ];

    /**
     * Words that open a request to DISPLAY something.
     *
     * These are imperatives too — "show me the leave types" is an instruction —
     * but the thing they instruct is a read, so they cancel their OWN clause and
     * nothing else. That distinction is the whole of the fix: these used to sit
     * beside the interrogatives and cancel the entire sentence, so *"find the
     * paid leave type and rename it to Annual Leave"* never reached the write
     * path at all and was answered by the prose assistant with instructions for
     * doing it by hand — §6's forbidden outcome, reached by the routing gate
     * rather than by a refusal.
     *
     * Cancelling the clause is still right, and is what keeps "show me how to
     * rename a department" a question: there is no second clause, so there is
     * nothing left to read as an instruction.
     */
    private const RETRIEVAL_OPENERS = [
        'show', 'list', 'give', 'tell', 'count', 'compare', 'find', 'display',
    ];

    /**
     * Words that end one clause and begin the next.
     *
     * Sentence punctuation does the same job and is folded in by `clauses()`.
     */
    private const CLAUSE_BREAKS = ['and', 'then', 'also', 'plus'];

    /**
     * Words that stand in FRONT of an instruction without being part of it.
     *
     * "can you delete all employees" and "delete all employees" are the same
     * request, so the head of a clause is read past them. They are stripped
     * only from the front — a word from this list in the middle of a sentence
     * is ordinary English.
     */
    private const POLITE_PREFIXES = [
        'please', 'kindly', 'just', 'now', 'can', 'could', 'would', 'will',
        'you', 'i', 'we', 'us', 'me', 'want', 'need', 'to', 'let',
    ];

    public function __construct(private readonly PlanningClient $client)
    {
    }

    /**
     * Whether this reads as an instruction to change something.
     *
     * Local, deterministic and free — no model call. It decides ROUTING, never
     * an answer: a wrong "yes" costs a refusal on a question the read path has
     * already declined, and a wrong "no" leaves the question exactly where it
     * would have gone before write actions existed.
     */
    public static function isChangeRequest(string $question): bool
    {
        $clauses = self::clauses($question);

        if ($clauses === []) {
            return false;
        }

        // An interrogative at the very front settles the sentence. "how do I
        // change the cap and set the start time?" is one question with two
        // subjects, not a question followed by an order.
        if (in_array(self::head($clauses[0]), self::ENQUIRY_OPENERS, true)) {
            return false;
        }

        foreach ($clauses as $clause) {
            $head = self::head($clause);

            if (in_array($head, self::ENQUIRY_OPENERS, true)
                || in_array($head, self::RETRIEVAL_OPENERS, true)) {
                continue;
            }

            // A CHANGE verb counts wherever it sits in its clause. "can you
            // change the office start time to 09:30" puts it third, and the
            // catalogue can act on it, so a wrong yes costs only a preview.
            if (array_intersect(self::CHANGE_VERBS, $clause) !== []) {
                return true;
            }

            /*
             * A REFUSABLE verb counts only as the HEAD of its clause, and that
             * asymmetry is deliberate. None of them can ever produce a plan —
             * they exist so an instruction is refused BY NAME instead of being
             * answered in prose — and they are far commoner as ordinary English
             * inside a question than the change verbs are: "employees to
             * promote to manager next quarter", "everyone who did not close
             * their timesheet", "leave still to approve". Matched anywhere,
             * each of those came back as "there is no action for promoting
             * employees", which is a false statement about what was asked.
             * Matched at the head, "delete all employees" and "approve the July
             * payroll run" still land here and are still refused by name.
             */
            if (in_array($head, self::REFUSABLE_VERBS, true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The question, split into clauses of bare words.
     *
     * Tokenised on WHITESPACE and then trimmed at the edges, never split on
     * every non-alphanumeric: "the add-ons team" split that way yields the word
     * "add", and "add" is a gate verb — which is how a question about a team's
     * leave balance was read as an instruction to add something.
     *
     * @return list<list<string>>
     */
    private static function clauses(string $question): array
    {
        $marked = preg_replace('/[;,.!?]+/', ' | ', strtolower($question)) ?? strtolower($question);

        $clauses = [];
        $current = [];

        foreach (preg_split('/\s+/', $marked, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $token) {
            $word = preg_replace('/^[^a-z0-9]+|[^a-z0-9]+$/', '', $token) ?? '';

            // Either the punctuation marker above or a token that was nothing
            // but punctuation. Both end the clause.
            if ($word === '' || in_array($word, self::CLAUSE_BREAKS, true)) {
                if ($current !== []) {
                    $clauses[] = $current;
                    $current = [];
                }

                continue;
            }

            $current[] = $word;
        }

        if ($current !== []) {
            $clauses[] = $current;
        }

        return $clauses;
    }

    /**
     * The first word of a clause that carries any meaning.
     *
     * @param  list<string>  $clause
     */
    private static function head(array $clause): string
    {
        foreach ($clause as $word) {
            if (! in_array($word, self::POLITE_PREFIXES, true)) {
                return $word;
            }
        }

        return '';
    }

    /**
     * @return array<string, mixed>  the raw plan, or the model's `{"error": …}` refusal
     */
    public function plan(string $question): array
    {
        if (! $this->client->configured()) {
            // A configuration fault, checked first: it is true of every
            // request, and telling somebody to rephrase would be a lie.
            throw new UnsupportedQuestionException('The AI service is not configured.');
        }

        $plan = $this->client->json($this->systemPrompt(), $question, self::MAX_TOKENS, 'action planner');

        if ($plan === null) {
            /*
             * No guess, ever. The read path's equivalent failure produces a
             * wrong number somebody can dispute; this one would write to a row
             * nobody named.
             */
            throw new UnsupportedQuestionException("I couldn't turn that into a change I can make.");
        }

        return $plan;
    }

    private function systemPrompt(): string
    {
        $catalogue = $this->catalogue();
        $today = now()->toDateString();

        return <<<PROMPT
        You translate an HR admin's instruction into ONE action plan for CareVance HRMS.

        Today is {$today}. Resolve every relative date against it.

        Respond with RAW JSON only — one object, no markdown fence, no prose.

        PLAN
        {"action":<action>,"target":{<lookup>:<value>},"changes":{<field>:<value>}}

        "action" is one key from ACTIONS below, exactly as written.
        "target" says which row, using ONLY that action's listed lookups, with the value the person used.
        "changes" is one or more of that action's listed fields and the NEW value for each.
        One action per plan. Never two, never a list.

        ACTIONS
        {$catalogue}

        RULES
        Never invent an action, a lookup or a field. Everything you emit is listed above.
        Never clamp a value into range. If what was asked for is outside the stated bounds, refuse and say the bound.
        Only include a field the person actually asked to change.
        Copy names as the person said them; the server finds the row.

        EXAMPLES — the SHAPE only.
        Q: change the casual leave carry-forward to 10 days
        A: {"action":"leave_type.update","target":{"name":"Casual Leave"},"changes":{"carry_forward_cap":10}}
        Q: rename the HR department to Human Resources
        A: {"action":"department.rename","target":{"name":"HR"},"changes":{"name":"Human Resources"}}
        Q: set our timezone to Asia/Kolkata and the office start to 09:30
        A: {"action":"organization.update","target":{},"changes":{"timezone":"Asia/Kolkata","office_start_time":"09:30"}}
        Q: delete the employee Priya Sharma
        A: {"error":"There is no action for deleting an employee."}
        Q: approve the July payroll run
        A: {"error":"Payroll runs cannot be approved from here."}

        If the instruction needs anything not listed above, answer with the error shape and one sentence naming what is missing. Never answer with a plan you are unsure of.
        PROMPT;
    }

    /**
     * The catalogue, rendered as the only vocabulary the model has.
     *
     * Built from `ActionCatalogue::all()` rather than written out here, so a
     * fourth action is offered the moment it is added. A prompt describing
     * three actions while the catalogue holds four produces refusals for
     * something the system supports, which from the outside is indistinguishable
     * from a missing feature.
     *
     * `endpoint`, `model`, `permission` and `roles` are all deliberately left
     * out. The model has no use for them and every one of them is something §3
     * says it must not be able to name.
     */
    private function catalogue(): string
    {
        $lines = [];

        foreach (ActionCatalogue::all() as $key => $entry) {
            $lines[] = $key.' — '.$entry['label'].'. '.$this->targetSentence($entry);

            foreach ($entry['fields'] as $field => $spec) {
                $lines[] = '  '.$field.' — '.$spec['label'].': '.$this->bounds($spec);
            }
        }

        return implode("\n", $lines);
    }

    /** @param  array<string, mixed>  $entry */
    private function targetSentence(array $entry): string
    {
        $lookups = array_values(array_filter(
            $entry['target_by'],
            static fn (string $lookup): bool => $lookup !== ActionCatalogue::TARGET_ACTING_ORGANIZATION,
        ));

        if ($lookups === []) {
            // There is exactly one addressable organisation and the server
            // already knows which. Asking the model to name it invites it to
            // name a different one.
            return 'This always applies to the signed-in organization; send "target": {}.';
        }

        return 'Find it by: '.implode(' or ', $lookups).'.';
    }

    /**
     * The bounds, in the words the refusal will use.
     *
     * Stated so the model can decline "set the cap to 4000" itself rather than
     * clamping it to 365 — a clamp is a different change from the one that was
     * asked for, arriving with no indication that it happened.
     *
     * @param  array<string, mixed>  $spec
     */
    private function bounds(array $spec): string
    {
        $unit = isset($spec['unit']) ? ' '.$spec['unit'] : '';

        return match ($spec['type']) {
            'integer' => sprintf('a whole number between %s and %s%s', $spec['min'], $spec['max'], $unit),
            'number' => sprintf('a number between %s and %s%s', $spec['min'], $spec['max'], $unit),
            'text' => sprintf('text, at most %d characters', $spec['max_length']),
            'time' => 'a 24-hour time such as 09:30',
            'timezone' => 'an IANA timezone name such as Asia/Kolkata',
            default => 'a value',
        };
    }
}
