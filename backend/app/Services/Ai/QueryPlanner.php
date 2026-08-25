<?php

namespace App\Services\Ai;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Turns a question into a query plan.
 *
 * This step deliberately sees NO employee data — only the question and the
 * catalogue of entity/metric/dimension names. That is what makes it safe to run
 * on `stealth/ox-alpha`, a cloaked pre-release model whose traffic reaches the
 * originating lab. Rows never come here; they go to the summariser, which runs
 * on the primary provider.
 *
 * Since §13's retrieval was wired in it no longer sees the whole schema
 * either, only the handful of entities a question is about — `catalogueFor()`
 * explains what that fixed and what it cost to learn.
 *
 * What it ASKS for is the v2 grammar of §1-§3: a mode, several metrics or list
 * columns, two group-by dimensions, filters carrying every operator, a
 * threshold on the aggregate and a sort. `systemPrompt()` explains why each
 * part of that had to be written down rather than assumed, and which wrong
 * answer each omission produced.
 */
class QueryPlanner
{
    public function plan(string $question): array
    {
        $providers = $this->providers();

        if (empty($providers)) {
            // A configuration fault, checked first: it is true of every
            // question, and telling somebody to rephrase would be a lie.
            throw new UnsupportedQuestionException('The AI service is not configured.');
        }

        $this->refuseWithheldSubject($question);

        $catalogue = $this->catalogueFor($question);

        foreach ($providers as $provider) {
            foreach ($provider['models'] as $model) {
                $content = $this->attempt($provider, $model, $question, $catalogue);

                if ($content === null) {
                    continue;
                }

                $parsed = $this->extractJson($content);

                if ($parsed !== null) {
                    return $parsed;
                }
            }
        }

        throw new UnsupportedQuestionException("I couldn't turn that into a data question.");
    }

    /**
     * The two-stage plan of §13, and the reason it is not an optimisation.
     *
     * Retrieval runs FIRST and LOCALLY — no model call, no network — and only
     * the entities it picked are described to the planner. Sending all 149 was
     * not merely expensive at ~48,000 characters; it is what broke the thing.
     * `payroll` arrived as one ~2,500 character run-on, the model could not
     * find `department` in it, and it refused "compare average net pay by
     * department" on the grounds that payroll had no such dimension. It has
     * one, it joins `groups`, and it had answered that exact question hours
     * earlier. A prompt too long to read is a prompt that produces confident
     * refusals about things the layer does.
     *
     * `cached()` rather than `entities()`: they return the same catalogue, but
     * `entities()` re-derives it from the live schema on every call — measured
     * at 0.95s against Postgres — and this sits on the request path. The spec's
     * words are `never computed per request`.
     *
     * Nothing above the floor is a REFUSAL, not a fallback to the whole
     * catalogue. It names the entities it considered so the reader has
     * something to rephrase against, which is the only difference between a
     * recoverable refusal and a dead end.
     */
    private function catalogueFor(string $question): string
    {
        $entities = SemanticLayer::cached();
        $retrieved = EntityRetriever::forQuestion($question, $entities);

        if ($retrieved === []) {
            $considered = array_slice(array_keys(EntityRetriever::scoreAll($question, $entities)), 0, 5);

            throw new UnsupportedQuestionException(
                "I couldn't match that to anything I can query. I looked at: ".implode(', ', $considered).'.'
            );
        }

        return SemanticLayer::catalogueFor(array_keys($retrieved));
    }

    private function attempt(array $provider, string $model, string $question, string $catalogue): ?string
    {
        try {
            $response = Http::withToken($provider['api_key'])
                ->withHeaders([
                    'HTTP-Referer' => config('services.ai.site_url'),
                    'X-Title' => config('services.ai.app_name'),
                ])
                ->timeout(20)
                ->post(rtrim($provider['base_url'], '/') . '/chat/completions', [
                    'model' => $model,
                    'temperature' => 0,
                    /*
                     * A v1 plan was one entity, one metric and one group_by,
                     * and 700 tokens covered it several times over. A v2 plan
                     * carries up to four metrics or eight columns, two
                     * group_by fields, a filter list, a having and a sort.
                     * Truncated mid-object it is unparseable, and unparseable
                     * is a refusal — the question would fail for want of
                     * output budget rather than for anything about the
                     * question. Reasoning is pinned low, so this is the answer
                     * budget almost entirely.
                     */
                    'max_tokens' => 1200,
                    // ox-alpha's reasoning is mandatory and defaults to "max",
                    // which costs 6.6s. Pinned to low it answers in ~3s.
                    'reasoning' => ['effort' => 'low'],
                    'messages' => [
                        ['role' => 'system', 'content' => $this->systemPrompt($catalogue)],
                        ['role' => 'user', 'content' => $question],
                    ],
                ]);

            if (! $response->successful()) {
                return null;
            }

            return data_get($response->json(), 'choices.0.message.content');
        } catch (\Throwable $e) {
            Log::warning('AI mode planner attempt failed', ['model' => $model, 'error' => $e->getMessage()]);

            return null;
        }
    }

    /**
     * The v2 grammar, taught rather than assumed.
     *
     * `PlanValidator` could read a v2 plan for a while before this could ask
     * for one, and that gap is not academic — it is DEFECT 2. "list employees
     * who joined this year" answered `count: 0` against a true answer of 14,
     * and the prompt is where that started: the v1 shape below had no `mode`
     * and no `columns`, so the only plan a model could write for a question
     * that asks WHO was an aggregate. It wrote one, and a count of nothing
     * came back looking like an answer. A grammar nothing emits is not a
     * grammar.
     *
     * Four things are in here because leaving any of them out is a whole class
     * of question the planner cannot reach:
     *
     *  - THE SHAPE, with every key named. `mode`, `columns` and `having` in
     *    particular: `having` is the only way to say "more than 3 days", which
     *    was the user's own first example and the reason v2 exists.
     *  - THE OPERATOR TABLE (§2) in full. An operator the model has not been
     *    told about is one it does not use, however well the validator honours
     *    it.
     *  - THE PERIOD TOKENS (§3), with the instruction that the SERVER resolves
     *    them. A model left to write its own bounds writes them against its
     *    training cutoff — that is how "this year" came back as 2025 — and a
     *    wrong range does not degrade an answer, it answers a different
     *    question with the same confidence.
     *  - WORKED EXAMPLES, because the examples are the part of a prompt a
     *    model actually copies. They also carry the {field, op, value}
     *    descriptor, which is the shape the model was inventing around when it
     *    emitted `{"joining_date":{"gte":…,"lte":…}}`.
     *
     * And one sentence that is not decoration: the examples name entities the
     * catalogue for any given question almost never contains. Without saying
     * they are a SHAPE and not a vocabulary, the prompt contradicts itself —
     * "never invent a name", over four examples full of names that are not on
     * the list — and a model that resolves that the other way starts quoting
     * the examples as though they were the catalogue.
     *
     * @see docs/superpowers/specs/2026-08-24-ai-mode-grammar-v2.md §1-§3, §8
     */
    private function systemPrompt(string $catalogue): string
    {
        return <<<PROMPT
        You translate an HR admin's question into ONE query plan for CareVance HRMS.

        Today is {$this->today()}. Resolve every relative date against it.

        Respond with RAW JSON only — one object, no markdown fence, no prose.

        PLAN
        {"entity":<entity>,"mode":"aggregate"|"list","metrics":[<metric>],"columns":[<column>],"group_by":[<field>],"filters":[{"field":<field>,"op":<op>,"value":<value>}],"having":[{"metric":<metric>,"op":<op>,"value":<number>}],"sort":{"by":<name>,"dir":"asc"|"desc"},"limit":<number>}

        "aggregate" (the default) computes 1-4 "metrics" over 0-2 "group_by" fields and never uses "columns".
        "list" shows rows: 1-8 "columns", no "metrics", no "group_by". Use it whenever the question asks WHO or WHICH, or says list or show — counting is not listing.
        "group_by" an "employee" field to turn "how many" into "who".
        "having" thresholds a metric this plan already computes — it is how "more than 3 days" is said.
        "sort" names a metric, "group_by" field or column this plan has. Omit "limit" unless a top or bottom few is asked for.

        OPERATORS for each "filters" entry — "having" takes only eq, neq, gt, gte, lt, lte, between:
        eq, neq — one value.  gt, gte, lt, lte — one number or date.  between — [low, high].
        contains — text fields only, never a number, money or date field.
        in, not_in — a list of at most 50 values.  is_null, is_not_null — no "value" at all.
        period — a date field only, "value" is a token below.

        PERIODS — emit the token, the server resolves it. Never write your own dates.
        today, yesterday, this_week, last_week, this_month, last_month, this_quarter,
        last_quarter, this_year, last_year, last_7_days, last_30_days, last_90_days,
        last_12_months, or "2026-07" a month, "2026" a year, "2026-07-01..2026-07-31" a range.

        CATALOGUE
        {$catalogue}

        EXAMPLES — the SHAPE only; take every name from the CATALOGUE above, never from an example.
        Q: who was absent more than 3 days last month
        A: {"entity":"attendance","metrics":["absent_days"],"group_by":["employee"],"filters":[{"field":"date","op":"period","value":"last_month"}],"having":[{"metric":"absent_days","op":"gt","value":3}],"sort":{"by":"absent_days","dir":"desc"}}
        Q: compare average net pay by department and month
        A: {"entity":"payroll","metrics":["avg_net_pay"],"group_by":["department","month"]}
        Q: list employees who joined this year
        A: {"entity":"employees","mode":"list","columns":["name","department","joining_date"],"filters":[{"field":"joining_date","op":"period","value":"this_year"}]}
        Q: top 5 departments by total gross in July 2026
        A: {"entity":"payroll","metrics":["total_gross"],"group_by":["department"],"filters":[{"field":"month","op":"period","value":"2026-07"}],"sort":{"by":"total_gross","dir":"desc"},"limit":5}
        Q: headcount by nationality
        A: {"error":"Nationality is not stored in this system."}

        Never invent a name. If the question needs anything the CATALOGUE does not list, or two entities at once, answer with the error shape and one sentence saying what is missing.
        PROMPT;
    }

    private function today(): string
    {
        return now()->toDateString();
    }

    /**
     * ox-alpha returns raw JSON when told to, but `response_format:
     * json_schema` is advertised and NOT honoured — a strict run came back
     * fenced with keys absent from the schema. So parse, then fall back.
     */
    private function extractJson(string $content): ?array
    {
        $content = trim($content);

        $direct = json_decode($content, true);
        if (is_array($direct)) {
            return $direct;
        }

        if (preg_match('/```(?:json)?\s*([\s\S]*?)```/', $content, $matches)) {
            $fenced = json_decode(trim($matches[1]), true);
            if (is_array($fenced)) {
                return $fenced;
            }
        }

        if (preg_match('/(\{[\s\S]*\})/', $content, $matches)) {
            $loose = json_decode($matches[1], true);
            if (is_array($loose)) {
                return $loose;
            }
        }

        return null;
    }

    /**
     * Secondary first: the planner sees no employee data, so the free cloaked
     * model is the right default here and the paid primary is the fallback.
     */
    private function providers(): array
    {
        $providers = [];

        $secondaryKey = config('services.ai.secondary_api_key');
        if (! empty($secondaryKey)) {
            $providers[] = [
                'base_url' => config('services.ai.secondary_base_url'),
                'api_key' => $secondaryKey,
                'models' => array_filter(array_map('trim', explode(',', (string) config('services.ai.secondary_models')))),
            ];
        }

        $primaryKey = config('services.ai.api_key');
        if (! empty($primaryKey)) {
            $providers[] = [
                'base_url' => config('services.ai.base_url'),
                'api_key' => $primaryKey,
                'models' => [config('services.ai.model')],
            ];
        }

        return $providers;
    }

    /**
     * A question ABOUT a withheld field is refused before anything else runs.
     *
     * `PlanValidator::refuseName()` already refuses a withheld column, but only
     * once a plan names one. "everyone's PAN number" never gets that far: no
     * entity scores above the retrieval floor, so it was refused as
     * NOT_A_DATA_QUESTION — which, once prose fallback existed, handed it to
     * the general assistant. That assistant answered helpfully:
     *
     *     "I cannot view employee PAN numbers directly. You can view or export
     *      employee tax and statutory details by going to Payroll Dashboard →
     *      Tax Declarations"
     *
     * Which is a route around the exclusion, offered by the system that exists
     * to enforce it. The exclusion has to be decided on the QUESTION, not only
     * on the plan, because the plan is what never got built.
     *
     * Matched on whole words, never substrings: "designation" contains "esi",
     * "company" contains "pan", and refusing those would refuse real questions
     * about job titles and organisations.
     */
    private function refuseWithheldSubject(string $question): void
    {
        $tokens = preg_split('/[^a-z0-9]+/', strtolower($question), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        $withheldWords = ['pan', 'uan', 'esic', 'aadhaar', 'aadhar', 'ifsc', 'password', 'passwords'];

        foreach ($withheldWords as $word) {
            if (in_array($word, $tokens, true)) {
                throw UnsupportedQuestionException::withheld(sprintf(
                    "'%s' is not available through this tool.",
                    strtoupper($word)
                ));
            }
        }

        // Two-word subjects the single-token pass cannot see. "account" alone
        // is far too common — "account for", "accounting" — to refuse on.
        $text = ' '.implode(' ', $tokens).' ';

        foreach ([
            ' bank account ' => 'Bank account details',
            ' account number ' => 'Account numbers',
            ' bank details ' => 'Bank details',
            ' esi number ' => 'ESI numbers',
        ] as $phrase => $label) {
            if (str_contains($text, $phrase)) {
                throw UnsupportedQuestionException::withheld(
                    $label.' are not available through this tool.'
                );
            }
        }
    }
}
