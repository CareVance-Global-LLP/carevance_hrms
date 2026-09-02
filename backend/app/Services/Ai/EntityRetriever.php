<?php

namespace App\Services\Ai;

use Illuminate\Support\Str;

/**
 * Picks the handful of entities a question is actually about, so the planner
 * prompt carries five entities instead of eighty.
 *
 * The schema derives to ~80 entities over 2,612 columns. Sending that catalogue
 * on every question would cost more tokens than the answer is worth, and would
 * grow every time somebody adds a table — planning latency would degrade as
 * coverage improved, which is exactly backwards. So retrieval runs FIRST, and
 * it runs LOCALLY: no model call, no embedding service, no network.
 *
 * Three ideas carry the whole thing:
 *
 *  1. An entity is reachable BY ITS OWN NAME. That is what makes 80 derived
 *     entities findable without an 80-entry map — the synonym map below only
 *     exists for the words that match no table name at all.
 *
 *  2. A token that matches EVERY entity names none of them. "status" is a
 *     column on attendance, leave, assets and tasks; returning all four is the
 *     same as returning nothing, except it costs a prompt and looks like an
 *     answer. So structural matches are weighted by how DISCRIMINATING the
 *     token is — inverse document frequency across the catalogue.
 *
 *  3. Every word is reduced to ONE canonical form, on both sides of the
 *     comparison. Emitting a word and its singular as two tokens double-counts
 *     any word the inflector rewrites: "beta" also yields "betum", so "beta"
 *     scored twice where "alpha" scored once and ties stopped being ties.
 */
final class EntityRetriever
{
    /** Below this, a match is noise and the question is refused instead. */
    private const FLOOR = 3.0;

    /**
     * A word must be at least this long before a single-character misspelling
     * of it is corrected.
     *
     * "make me an table with different department with whoes more produtive" is
     * a real question, typed by a real person, and it has to work. `produtive`
     * matches nothing in the catalogue and nothing in the map, so before this
     * it scored 0.00 everywhere and the question was decided entirely by the
     * word "department" — which two payroll template tables win outright.
     *
     * Six characters and edit distance 1 is deliberately timid. Short words are
     * excluded because one edit reaches too much at that length ("pay"/"day",
     * "task"/"tasks"), and a correction is only applied to a token the
     * catalogue does NOT recognise, so a word that means something real is
     * never quietly rewritten into something else. If two synonyms are equally
     * close the token is left alone — guessing between them would answer a
     * different question with full confidence.
     */
    private const FUZZY_MIN_LENGTH = 6;

    private const DEFAULT_TOP = 5;

    /** A synonym that names the entity outright — the strongest signal there is. */
    private const SYNONYM_NAMES = 10.0;

    /**
     * A synonym that points at the CONCEPT rather than one table. In a derived
     * schema "salary" should surface payroll_runs and payroll_monthly_runs
     * behind payroll_items, rather than only the one table named below.
     */
    private const SYNONYM_POINTS_AT = 5.0;

    /** Where a token matched matters: an entity's name beats a column's. */
    private const WEIGHTS = [
        'identity' => 6.0,   // entity key, label, table name
        'metric' => 4.0,
        'dimension' => 2.0,
        'column' => 1.0,
    ];

    /**
     * The words people use for things the schema calls something else. Nobody
     * types "payroll_items", and "wage" appears in no column name.
     *
     * Each target is either an entity KEY or a TABLE name, and the two forms
     * behave differently on purpose:
     *
     *   - a single word ("payroll") is a CONCEPT: it matches that entity
     *     exactly, and also any other entity whose own name carries the word —
     *     which is how sibling tables reach the prompt as secondary candidates.
     *   - a name with underscores ("payroll_items") is one specific table and is
     *     exact-match only, so "employee_work_infos" cannot drag in every table
     *     with "work" in its name.
     *
     * The hand-written and the derived catalogues are keyed differently
     * ("payroll" vs "payroll_items") and retrieval has to work on both, so
     * every concept lists both spellings.
     *
     * @var array<string, list<string>>
     */
    private const SYNONYMS = [
        // salary|pay|ctc|payroll|wage -> payroll
        'salary' => ['payroll', 'payroll_items'],
        'pay' => ['payroll', 'payroll_items'],
        'ctc' => ['payroll', 'payroll_items'],
        'payroll' => ['payroll', 'payroll_items'],
        'wage' => ['payroll', 'payroll_items'],
        'payslip' => ['payroll', 'payroll_items'],
        'compensation' => ['payroll', 'payroll_items'],
        'earning' => ['payroll', 'payroll_items'],
        'deduction' => ['payroll', 'payroll_items'],

        // absent|present|late|attendance -> attendance
        'absent' => ['attendance', 'attendance_records'],
        'present' => ['attendance', 'attendance_records'],
        'late' => ['attendance', 'attendance_records'],
        'attendance' => ['attendance', 'attendance_records'],
        'punch' => ['attendance', 'attendance_records'],
        'clock' => ['attendance', 'attendance_records'],
        'absence' => ['attendance', 'attendance_records'],

        // leave|holiday|pto|vacation -> leave
        'leave' => ['leave', 'leave_requests'],
        'holiday' => ['leave', 'leave_requests'],
        'pto' => ['leave', 'leave_requests'],
        'vacation' => ['leave', 'leave_requests'],
        'sick' => ['leave', 'leave_requests'],
        'casual' => ['leave', 'leave_requests'],

        /*
         * who|people|staff|employee|headcount -> employees
         *
         * Three targets, because in a derived schema the PERSON and their
         * EMPLOYMENT are different tables and a question about staff may need
         * either. Order here decides nothing — ties break on catalogue order.
         */
        'who' => ['employees', 'users', 'employee_work_infos'],
        'people' => ['employees', 'users', 'employee_work_infos'],
        'staff' => ['employees', 'users', 'employee_work_infos'],
        'employee' => ['employees', 'users', 'employee_work_infos'],
        'headcount' => ['employees', 'users', 'employee_work_infos'],
        'joiner' => ['employees', 'users', 'employee_work_infos'],
        'workforce' => ['employees', 'users', 'employee_work_infos'],
        'team' => ['employees', 'users', 'employee_work_infos'],

        // asset|laptop|device -> assets
        'asset' => ['assets'],
        'laptop' => ['assets'],
        'device' => ['assets'],
        'equipment' => ['assets'],
        'hardware' => ['assets'],

        // task|project|work -> work
        'task' => ['work', 'tasks'],
        'project' => ['work', 'tasks'],
        'work' => ['work', 'tasks'],
        'timesheet' => ['work', 'tasks'],
        'todo' => ['work', 'tasks'],

        // candidate|hiring|applicant|job -> hiring
        'candidate' => ['hiring', 'candidates'],
        'hiring' => ['hiring', 'candidates'],
        'applicant' => ['hiring', 'candidates'],
        'job' => ['hiring', 'candidates'],
        'recruitment' => ['hiring', 'candidates'],
        'interview' => ['hiring', 'candidates'],
        'offer' => ['hiring', 'candidates'],
        'opening' => ['hiring', 'candidates'],
        'vacancy' => ['hiring', 'candidates'],

        /*
         * productive|productivity|idle|utilisation|tracker -> activities
         *
         * THE BUG THIS GROUP EXISTS FOR. Retrieval indexes names and labels,
         * never column VALUES. "productive" is a VALUE of
         * `activities.classification`; the only NAMES carrying that word
         * anywhere in a 150-entity catalogue are `payroll_items`'
         * `total_productive_seconds` and `productivity_score`. So "which
         * department is most productive" scored payroll 35.07 and activities
         * 0.00, the planner averaged a payroll snapshot that holds no rows
         * until a run has been processed, and the product answered "no records"
         * to a question 10,548 classified activity rows could answer.
         *
         * A synonym alone would not have been enough — SYNONYM_NAMES is 10.0
         * and loses to 35.07 on score — but naming an entity RESERVES it a
         * slot (see `namedEntities()`), which is the mechanism that was already
         * built for exactly this: a word that names a table is a promise about
         * which table is meant, not evidence to be weighed against how many
         * column names happen to collide.
         *
         * One target, not two. The `activity` concept owns `activity_sessions`
         * and is reachable by its own name; `activities` is the row-level table
         * the classification actually lives on.
         */
        'productive' => ['activities'],
        'productivity' => ['activities'],
        'unproductive' => ['activities'],
        'active' => ['activities'],
        'idle' => ['activities'],
        'utilisation' => ['activities'],
        'utilization' => ['activities'],
        'efficiency' => ['activities'],
        'monitoring' => ['activities'],
        'tracker' => ['activities'],
        'tracking' => ['activities'],
        'usage' => ['activities'],
    ];

    /** Words that carry no signal about WHICH entity is meant. */
    private const STOPWORDS = [
        'a', 'an', 'and', 'are', 'as', 'at', 'average', 'avg', 'be', 'by', 'compare',
        'count', 'created', 'do', 'each', 'every', 'find', 'for', 'from', 'get', 'give',
        'group', 'has', 'have', 'how', 'in', 'is', 'it', 'list', 'many', 'me', 'more',
        'most', 'much', 'my', 'of', 'on', 'or', 'our', 'per', 'show', 'sum', 'than',
        'that', 'the', 'their', 'then', 'there', 'this', 'to', 'top', 'total', 'value',
        'was', 'were', 'what', 'when', 'where', 'which', 'with', 'number', 'all',
    ];

    /**
     * The entities a question is about, ranked, capped at $top, and only those
     * above the floor. An empty return is a refusal — scoreAll() is what the
     * refusal reads to say what it considered.
     *
     * @param  array<string, array<string, mixed>>  $catalogue
     * @return array<string, array<string, mixed>>  entity key => its definition
     */
    public static function forQuestion(string $question, array $catalogue, int $top = self::DEFAULT_TOP): array
    {
        /*
         * A caller that omits the cap sends null; one that means "no cap" sends
         * 0. Both mean "use the default" — honouring a 0 would starve the
         * prompt of every entity and refuse every question, which is the
         * mistake `limit` made in PlanValidator.
         */
        $top = $top > 0 ? $top : self::DEFAULT_TOP;

        $scores = self::scoreAll($question, $catalogue);

        /*
         * AN ENTITY THE QUESTION NAMED OUTRIGHT IS RESERVED A SLOT.
         *
         * Scoring alone let the SUBJECT of a sentence lose to its own
         * predicate. "list employees with no bank account" scored
         * `employee_bank_accounts` 105.6 and `employees` 18.7 — eighth, past
         * the cap, so the prompt never saw the entity the question was about
         * and the model answered "the employee master entity is not in this
         * system's catalogue". Four bank-named tables matched "bank" and
         * "account" structurally and buried the one word that was a naming.
         *
         * `SYNONYM_NAMES` already encodes the distinction: a synonym that
         * names an entity is a promise about which table is meant, not
         * evidence to be weighed against how many column names happen to
         * collide. Scoring it 10 and then letting 105 outrank it discards
         * that. So a named entity is placed first, and the remaining slots
         * are filled by score as before.
         *
         * The predicate's tables still come — they are what a cross-entity
         * filter would need — they just no longer come INSTEAD.
         */
        $picked = [];

        foreach (self::namedEntities($question, $catalogue) as $key) {
            if (count($picked) >= $top) {
                break;
            }

            $picked[$key] = $catalogue[$key];
        }

        foreach ($scores as $key => $score) {
            if (count($picked) >= $top) {
                break;
            }

            if ($score < self::FLOOR) {
                break; // ranked, so the first entity below the floor ends it
            }

            $picked[$key] = $catalogue[$key];
        }

        return $picked;
    }

    /**
     * The entities this question NAMED, best-scoring first.
     *
     * Naming is the `SYNONYM_NAMES` case of `synonymScore()` — the token
     * matched the entity key or its table, rather than pointing at a concept
     * one of its columns happens to carry.
     *
     * @param  array<string, array<string, mixed>>  $catalogue
     * @return list<string>
     */
    private static function namedEntities(string $question, array $catalogue): array
    {
        $tokens = self::tokensFor($question, self::documentFrequency($catalogue));
        $named = [];

        foreach ($catalogue as $key => $entity) {
            $table = (string) ($entity['table'] ?? $key);

            foreach ($tokens as $token) {
                /*
                 * A token that IS the entity's name names it, before any map is
                 * consulted. This case is not redundant with the synonym below:
                 * "project" is mapped to the `work` concept, whose table is
                 * `tasks`, so against a schema-derived catalogue the map named
                 * `tasks` and left the literal `projects` table to fight for a
                 * slot on score alone.
                 */
                $canonical = self::normalise($token);

                if ($canonical === self::normalise($key) || $canonical === self::normalise($table)) {
                    $named[] = $key;
                    continue 2;
                }

                foreach (self::synonymTargets($token) as $target) {
                    if ($target === $key || $target === $table) {
                        $named[] = $key;
                        continue 3;
                    }
                }
            }
        }

        if (count($named) < 2) {
            return $named;
        }

        // More than one entity named — "leave taken by employee" names both.
        // Order them by their own score so the stronger subject leads.
        $scores = self::scoreAll($question, $catalogue);
        usort($named, fn (string $left, string $right) => ($scores[$right] ?? 0.0) <=> ($scores[$left] ?? 0.0));

        return $named;
    }

    /**
     * Every entity with its score, ranked highest first, ties broken by
     * catalogue order.
     *
     * Entities that matched nothing score 0.0 and are still present: a refusal
     * has to be able to say what it considered, or "I can't answer that" gives
     * the reader nothing to rephrase against.
     *
     * @param  array<string, array<string, mixed>>  $catalogue
     * @return array<string, float>
     */
    public static function scoreAll(string $question, array $catalogue): array
    {
        $documentFrequency = self::documentFrequency($catalogue);
        $tokens = self::tokensFor($question, $documentFrequency);
        $entityCount = max(1, count($catalogue));

        $scores = [];
        $position = [];
        $index = 0;

        foreach ($catalogue as $key => $entity) {
            $position[$key] = $index++;
            $haystack = self::haystackFor($key, $entity);
            $table = is_string($entity['table'] ?? null) ? $entity['table'] : '';
            $score = 0.0;

            foreach ($tokens as $token) {
                $score += self::synonymScore($token, $key, $table, $haystack['identity']);

                // Structural matches, discounted by how many entities the token
                // reaches. A token on every table discriminates nothing.
                $reach = $documentFrequency[$token] ?? 0;

                if ($reach === 0) {
                    continue;
                }

                $idf = log($entityCount / $reach);

                if ($idf <= 0.0) {
                    continue; // on every entity — carries no signal at all
                }

                foreach (self::WEIGHTS as $field => $weight) {
                    if (isset($haystack[$field][$token])) {
                        $score += $weight * $idf;
                    }
                }
            }

            $scores[$key] = round($score, 4);
        }

        /*
         * Score descending, catalogue order on a tie. Written out rather than
         * leaning on PHP 8's stable sort, because "two entities scored the same
         * and we returned them in the order they are defined" is a rule a
         * reviewer should be able to read off the code.
         */
        uksort($scores, fn (string $a, string $b): int => ($scores[$b] <=> $scores[$a]) ?: ($position[$a] <=> $position[$b]));

        return $scores;
    }

    /**
     * The question's content words, split by whether this catalogue means
     * anything at all by them.
     *
     * THE WORD THAT IS A VALUE, WHICH RETRIEVAL CAN NEVER SEE.
     *
     * Everything above indexes NAMES — entity keys, labels, table names,
     * metric, dimension and column names. It never indexes column VALUES, and
     * it never can: values change hourly and there are millions of them. The
     * consequence is invisible until somebody asks about a PERSON, because a
     * person's name is the one thing an HR admin asks about that appears in no
     * table name, no label and no column anywhere in the schema.
     *
     * Measured on the 150-entity catalogue, 26 Aug 2026. "show me kajal" and
     * "everything about kajal" scored 0.00 on every single entity and were
     * refused outright. "give me all detail of kajal" was decided entirely by
     * the word "detail", which won `attendance_holidays` 15.03 on its `details`
     * column; "kajal profile" won `employee_profiles` 36.24. In all four the
     * `employees` entity — the one the question is about — scored 0.00.
     *
     * `namedEntities()` is the lever that fixes a question whose SUBJECT loses
     * to its predicate, and it cannot fire here: it reads the question against
     * the catalogue and the synonym map, and a colleague's first name is in
     * neither. The only place "kajal" means anything is the roster, which is
     * DATA — so this method stops at the honest boundary. It reports which
     * words this catalogue cannot account for and never guesses what they are;
     * `PersonLookup` is what asks the roster, and it is the only caller.
     *
     * Words come back in the form the person TYPED, for the reason
     * `contentWords()` gives.
     *
     * @param  array<string, array<string, mixed>>  $catalogue
     * @return array{known: list<string>, unknown: list<string>}
     */
    public static function questionWords(string $question, array $catalogue): array
    {
        $documentFrequency = self::documentFrequency($catalogue);

        $split = ['known' => [], 'unknown' => []];

        foreach (self::contentWords($question) as $word => $canonical) {
            $recognised = isset($documentFrequency[$canonical]) || self::synonymTargets($canonical) !== [];

            // Cast because PHP turns a wholly numeric array key into an int,
            // so an employee code typed as a question would arrive here as one
            // and reach a caller that was promised a string.
            $split[$recognised ? 'known' : 'unknown'][] = (string) $word;
        }

        return $split;
    }

    /**
     * What one token is worth to one entity as a synonym: it either NAMES the
     * entity or points at its concept, and the better of the two counts once.
     * Summing every matching target would score an entity twice for one word.
     *
     * @param  array<string, true>  $identity
     */
    private static function synonymScore(string $token, string $key, string $table, array $identity): float
    {
        $best = 0.0;

        foreach (self::synonymTargets($token) as $target) {
            if ($target === $key || $target === $table) {
                return self::SYNONYM_NAMES; // nothing beats naming the entity
            }

            if (! str_contains($target, '_') && isset($identity[self::normalise($target)])) {
                $best = max($best, self::SYNONYM_POINTS_AT);
            }
        }

        return $best;
    }

    /**
     * The map is looked up by canonical form, so the plural a person typed finds
     * the singular somebody wrote down — and so "people", whose canonical form
     * is "person", stays reachable at all.
     *
     * @return list<string>
     */
    private static function synonymTargets(string $token): array
    {
        return self::normalisedSynonyms()[$token] ?? [];
    }

    /**
     * The map keyed by canonical form, built once.
     *
     * @return array<string, list<string>>
     */
    private static function normalisedSynonyms(): array
    {
        static $normalised = null;

        if ($normalised === null) {
            $normalised = [];

            foreach (self::SYNONYMS as $word => $targets) {
                $normalised[self::normalise($word)] = $targets;
            }
        }

        return $normalised;
    }

    /**
     * The question's tokens, with an unrecognisable word corrected to the
     * synonym it is one character away from.
     *
     * @param  array<string, int>  $documentFrequency
     * @return list<string>
     */
    private static function tokensFor(string $question, array $documentFrequency): array
    {
        $tokens = [];

        foreach (self::tokenise($question) as $token) {
            $tokens[] = self::correct($token, $documentFrequency);
        }

        // Corrections can collide two tokens into one ("productive produtive"),
        // and a token counted twice would score twice.
        return array_values(array_unique($tokens));
    }

    /**
     * One token, corrected only if leaving it alone tells us nothing.
     *
     * The guard is what makes this safe: a token the catalogue reaches — any
     * entity name, metric, dimension or column — or that the map already knows
     * is returned untouched. Only a word that means NOTHING here is a candidate
     * for having been mistyped, and even then it must be within one edit of
     * exactly one synonym.
     *
     * @param  array<string, int>  $documentFrequency
     */
    private static function correct(string $token, array $documentFrequency): string
    {
        if (isset($documentFrequency[$token]) || self::synonymTargets($token) !== []) {
            return $token; // it means something already; never rewrite it
        }

        if (strlen($token) < self::FUZZY_MIN_LENGTH) {
            return $token;
        }

        $match = null;
        $candidates = 0;

        foreach (array_keys(self::normalisedSynonyms()) as $word) {
            if (strlen($word) < self::FUZZY_MIN_LENGTH || abs(strlen($word) - strlen($token)) > 1) {
                continue;
            }

            if (levenshtein($token, $word) !== 1) {
                continue;
            }

            $match = $match ?? $word;
            $candidates++;
        }

        return $candidates === 1 ? (string) $match : $token;
    }

    /**
     * How many entities each token reaches, for the IDF discount.
     *
     * @param  array<string, array<string, mixed>>  $catalogue
     * @return array<string, int>
     */
    private static function documentFrequency(array $catalogue): array
    {
        $frequency = [];

        foreach ($catalogue as $key => $entity) {
            $seen = [];

            foreach (self::haystackFor($key, $entity) as $bucket) {
                foreach (array_keys($bucket) as $token) {
                    $seen[$token] = true;
                }
            }

            foreach (array_keys($seen) as $token) {
                $frequency[$token] = ($frequency[$token] ?? 0) + 1;
            }
        }

        return $frequency;
    }

    /**
     * The searchable words of one entity, bucketed by where they came from.
     *
     * Keys are split on underscores, so `absent_days` is reachable by "absent"
     * and by "days" — people ask in words, not in column names.
     *
     * @param  array<string, mixed>  $entity
     * @return array<string, array<string, true>>
     */
    private static function haystackFor(string $key, array $entity): array
    {
        $buckets = ['identity' => [], 'metric' => [], 'dimension' => [], 'column' => []];

        $add = function (string $bucket, ?string $text) use (&$buckets): void {
            foreach (self::tokenise((string) $text) as $token) {
                $buckets[$bucket][$token] = true;
            }
        };

        $add('identity', $key);
        $add('identity', is_string($entity['label'] ?? null) ? $entity['label'] : null);
        $add('identity', is_string($entity['table'] ?? null) ? $entity['table'] : null);

        foreach (['metrics' => 'metric', 'dimensions' => 'dimension', 'list_columns' => 'column'] as $source => $bucket) {
            foreach ((array) ($entity[$source] ?? []) as $itemKey => $item) {
                $add($bucket, (string) $itemKey);
                $add($bucket, is_array($item) && is_string($item['label'] ?? null) ? $item['label'] : null);
            }
        }

        return $buckets;
    }

    /**
     * Lowercase, split on anything non-alphanumeric, drop stopwords, and reduce
     * each word to ONE canonical form.
     *
     * @return list<string>
     */
    private static function tokenise(string $text): array
    {
        return array_values(array_unique(array_values(self::contentWords($text))));
    }

    /**
     * The words a text is actually about, as TYPED => canonical.
     *
     * Both forms are kept because the two readers need different ones and
     * neither may derive the other for itself. Scoring compares canonical forms
     * on both sides — that is what makes "salaries" reach payroll. A reader
     * resolving a word against real DATA needs what the person typed, because
     * the inflector rewrites words it has no business rewriting once a name is
     * in play: a surname ending in "s" singularises into a name nobody has, and
     * looking that up finds nobody while the person is sitting in the roster.
     *
     * @return array<string, string>
     */
    private static function contentWords(string $text): array
    {
        $parts = preg_split('/[^a-z0-9]+/i', strtolower($text), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        $words = [];

        foreach ($parts as $part) {
            $canonical = self::normalise($part);

            if (strlen($canonical) < 2) {
                continue;
            }

            if (in_array($part, self::STOPWORDS, true) || in_array($canonical, self::STOPWORDS, true)) {
                continue;
            }

            $words[$part] = $canonical;
        }

        return $words;
    }

    /**
     * One word, one form. Singularising is what makes "salaries" reach payroll
     * and "laptops" reach assets; doing it on BOTH sides of every comparison is
     * what stops a word the inflector rewrites from scoring twice.
     */
    private static function normalise(string $word): string
    {
        return Str::singular(strtolower($word));
    }
}
