<?php

namespace App\Services\Ai;

use App\Models\EmployeeWorkInfo;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Str;

/**
 * "give me all detail of kajal" — the single most obvious thing to ask an HR
 * assistant, and the data path refused it.
 *
 * WHY IT REFUSED, AND WHY NO EXISTING LEVER REACHED IT
 *
 * `EntityRetriever` indexes NAMES: entity keys, labels, table names, metrics,
 * dimensions, columns. It never indexes column VALUES, deliberately — values
 * change hourly and there are millions of them. A person's name is a value and
 * nothing else, so measured across the 150-entity catalogue on 26 Aug 2026:
 *
 *     "show me kajal"             every entity 0.00 → refused outright
 *     "everything about kajal"    every entity 0.00 → refused outright
 *     "details of kajal"          attendance_holidays 15.03, employees 0.00
 *     "kajal profile"             employee_profiles 36.24, employees 0.00
 *
 * All four then fell through to the prose assistant, which answered that the
 * data did not exist. It does — the people are in `employee_work_infos`.
 *
 * The `namedEntities()` reservation cannot fix this the way it fixed
 * productivity. That lever reads the question against the catalogue and the
 * synonym map, and it fires when a word NAMES a table. "kajal" names no table,
 * and no synonym map can ever list it: a map of every employee's name is a copy
 * of the roster that goes stale the day somebody is hired. The roster is the
 * only place the word means anything, so this class is where the question stops
 * being a scoring problem and becomes a lookup.
 *
 * THREE RULES HOLD THIS TOGETHER
 *
 * 1. **The probe is the SAME predicate the answer will run.** A `contains`
 *    filter compiles to `lower(col) like ?` in `QueryPlanExecutor`, and that is
 *    exactly what `anybodyNamed()` asks. Confirming with a cleverer match —
 *    a similarity score, a filter narrower than the one emitted — would mean
 *    this class counted one set and the answer showed another, and the
 *    divergence would be visible only to somebody who thought to compare them.
 *
 *    That is a rule about the PREDICATE, and it was read once as a rule about
 *    the whole gate, which cost a bug: "is this word a name" was answered with
 *    `like '%kra%'`, Vikram said yes, and a question about KRAs came back as a
 *    profile table. `everyWordNamesSomebody()` asks that question separately,
 *    at a word boundary, and selects nothing — so the predicate rule holds and
 *    the naming question finally gets asked by something able to answer it.
 *
 * 2. **Ambiguity is answered, never resolved.** Two people called Kajal produce
 *    two rows, because `contains 'kajal'` is one predicate that matches both. A
 *    row listing is already the shape that can say "there are two of them";
 *    picking one and showing it as though it were the answer is the failure
 *    this layer exists to prevent, and asking a clarifying question costs a
 *    round trip to say something both rows say better.
 *
 * 3. **A question about anything ELSE is not a person lookup.** The gate below
 *    passes only when every word is either a request for the row itself
 *    ("details", "profile", "everything") or part of the name. "what did kajal
 *    earn last month" is about pay and must reach the planner, which can filter
 *    payroll by a person; answering it with her profile would be a confident
 *    answer to a question nobody asked.
 */
final class PersonLookup
{
    /**
     * The `employees` list column carrying the person's name. It selects
     * `users.name` — the base query's own joined table, and the same expression
     * this class probes below.
     */
    private const NAME_FIELD = 'name';

    /**
     * A floor on the word, kept because two characters is never worth a query
     * — but it is NOT what stops an acronym being read as a name. Length was
     * asked to carry that and could not: "kra" is three characters and was
     * still taken for a person (see `everyWordNamesSomebody()`). Raising this
     * to four or five would have bought that one case and lost Anu, Raj, Dev
     * and Ram, who are people. Length and naming are different questions and
     * are now asked separately.
     */
    private const MIN_NAME_LENGTH = 3;

    /**
     * What separates one part of a name from the next, for the naming test.
     *
     * `partsOf()` splits on every non-alphanumeric character; SQL has no
     * character class, so the gate rewrites each of these to a space and asks
     * four LIKEs against the result. These four are what actually appears
     * between the parts of a human name — a hyphen, an initial's full stop, an
     * apostrophe, a comma in a surname-first record. Anything else falls to the
     * conservative side: the word is not confirmed as a naming and the question
     * goes to the planner, which is the failure this class prefers.
     */
    private const NAME_SEPARATORS = ['-', '.', "'", ','];

    /**
     * A word must be at least this long before a one-character misspelling of
     * it is resolved against the roster.
     *
     * ONE SHORTER THAN `EntityRetriever::FUZZY_MIN_LENGTH`, and the difference
     * is not a compromise. That constant governs rewriting a word in the
     * QUESTION, where a wrong correction silently answers something else and
     * the reader has no way to see it happened. This one governs a lookup whose
     * result is a table with the matched person's NAME in the first column: a
     * wrong correction arrives labelled, in front of the person who typed it.
     * It also cannot invent a subject — only somebody already on the roster can
     * come back — and every candidate is returned rather than the closest one,
     * so there is no silent pick to be wrong about.
     *
     * Five specifically, because the given names this exists for cluster there:
     * Kajal, Priya, Rahul, Sneha, Aarti. A floor of six excludes all five.
     */
    private const FUZZY_MIN_LENGTH = 5;

    /** More name words than this in one question is not somebody's name. */
    private const MAX_NAME_WORDS = 4;

    /** `PlanValidator::MAX_IN_VALUES`. A correction that cannot fit is not made. */
    private const MAX_NAMES = 50;

    /**
     * How many rows the fuzzy prefilter may return before this gives up. The
     * SQL there is a deliberately loose superset that `levenshtein()` narrows,
     * so a truncated candidate list would produce a confirmed set drawn from
     * part of the roster — the silent pick rule 2 refuses to make.
     */
    private const MAX_PREFILTERED = 200;

    /**
     * Words that ask for the ROW rather than for a fact about it.
     *
     * Written singular and compared after `Str::singular()`, so "details" and
     * "records" arrive here as themselves. Several are also real schema words —
     * `attendance_holidays` has a `details` column, `employee_profiles` is a
     * table, "who" is a synonym for the employee entity — and being on this
     * list beats that, because in a sentence carrying a person's name they are
     * asking for the person, not for a holiday note. A question that also names
     * a real subject is stopped by the gate on that subject, never by these.
     */
    private const DETAIL_WORDS = [
        'about', 'bio', 'detail', 'everything', 'info', 'information',
        'overview', 'profile', 'record', 'summary', 'who',
    ];

    /**
     * The filters that narrow a row listing to the person this question names,
     * or null when it does not name one.
     *
     * Several filters rather than one, because a full name is several words and
     * they are ANDed: "kajal sharma" must not match Kajal Mehta.
     *
     * @param  array<string, array<string, mixed>>  $catalogue
     * @return list<array{field: string, op: string, value: mixed}>|null
     */
    public static function nameFiltersFor(string $question, array $catalogue): ?array
    {
        $words = EntityRetriever::questionWords($question, $catalogue);

        /*
         * Anything the catalogue recognises that is not a request for the row
         * is a SUBJECT, and the question is about that subject rather than
         * about a person. "kajal attendance last month" belongs to the planner.
         */
        foreach ($words['known'] as $word) {
            if (! self::isDetailWord($word)) {
                return null;
            }
        }

        $candidates = [];

        foreach ($words['unknown'] as $word) {
            if (self::isDetailWord($word)) {
                continue;
            }

            /*
             * A word too short to be a naming abandons the whole lookup rather
             * than being skipped past. Skipping is the tempting reading — "ka"
             * in "kajal ka details" is noise, and dropping it would still find
             * her — but the same leniency turns "kajal vs ravi" into one
             * profile presented as the answer to a comparison. An unrecognised
             * word this class cannot account for is a question it does not
             * understand, and the honest outcome is to leave it to the planner.
             */
            if (strlen($word) < self::MIN_NAME_LENGTH) {
                return null;
            }

            $candidates[] = $word;
        }

        if ($candidates === [] || count($candidates) > self::MAX_NAME_WORDS) {
            return null;
        }

        /*
         * Two questions, asked separately because they are different questions
         * and one predicate cannot answer both. `everyWordNamesSomebody()`
         * asks whether these words are NAMES at all; `anybodyNamed()` asks
         * whether one person carries them together, in the executor's own
         * predicate. The second was carrying the first by accident, and a
         * substring is not a naming.
         */
        if (self::everyWordNamesSomebody($candidates) && self::anybodyNamed($candidates)) {
            return array_map(
                fn (string $word): array => ['field' => self::NAME_FIELD, 'op' => 'contains', 'value' => $word],
                $candidates
            );
        }

        return self::correctedFilter($candidates);
    }

    /**
     * A single mistyped name, resolved against the roster.
     *
     * ONE word only. Two unrecognised words that both need correcting is not a
     * typo — it is a question about something this system does not hold, and
     * guessing twice is how a sentence about nothing becomes a confident table
     * about somebody.
     *
     * The filter is `in` over the resolved names rather than `contains` over
     * the corrected word, because a correction must never widen after the fact:
     * `contains 'sharma'` would pull in Sharmandeep, whom nothing here matched.
     *
     * @param  list<string>  $candidates
     * @return list<array{field: string, op: string, value: mixed}>|null
     */
    private static function correctedFilter(array $candidates): ?array
    {
        if (count($candidates) !== 1 || strlen($candidates[0]) < self::FUZZY_MIN_LENGTH) {
            return null;
        }

        $names = self::namesOneEditFrom($candidates[0]);

        if ($names === [] || count($names) > self::MAX_NAMES) {
            return null;
        }

        return [['field' => self::NAME_FIELD, 'op' => 'in', 'value' => $names]];
    }

    /**
     * Whether each of these words NAMES somebody — is a whole part of a name on
     * this roster — rather than merely a run of characters sitting inside one.
     *
     * THE DEFECT. `anybodyNamed()` asks `lower(name) like '%kra%'`, and Vikram
     * answers yes. So "what is a kra" — three letters of ordinary HR
     * vocabulary, in no table name and in no synonym, therefore unrecognised —
     * came back as Vikram's profile table instead of an explanation. Measured
     * over 34 realistic non-person questions on 26 Aug 2026 that was the one
     * that hijacked, and it hijacked because a substring was being read as a
     * naming. 'lop' inside Lopamudra and 'ram' inside Vikram are the same bug
     * waiting for the next reader.
     *
     * THIS IS NOT A SECOND FILTER, WHICH IS WHY RULE 1 ABOVE SURVIVES INTACT.
     * It selects nothing and narrows nothing: the emitted filters are still
     * `contains`, `anybodyNamed()` still asks the executor's own predicate, and
     * the set counted is still the set shown. What this adds is a PRIOR
     * question — is this word a name — that the `contains` probe was never able
     * to answer and was being asked anyway.
     *
     * Word-part EQUALITY, not a prefix. A prefix still takes 'lop' for
     * Lopamudra and hands somebody asking about loss of pay a colleague's
     * profile. Nobody refers to a person by the first three letters of their
     * name, so the leniency buys nothing real and costs the acronyms.
     *
     * ROSTER-WIDE, not per person. Whether "sharma" is a name is a fact about
     * the roster; whether one person is called both Kajal and Sharma is
     * `anybodyNamed()`'s question, and asking this one per row would quietly
     * make it a second, stricter filter than the one the answer runs.
     *
     * @param  list<string>  $words
     */
    private static function everyWordNamesSomebody(array $words): bool
    {
        foreach ($words as $word) {
            if (! self::isANameOnTheRoster($word)) {
                return false;
            }
        }

        return true;
    }

    /**
     * One word, matched against the roster at a word boundary.
     *
     * Four patterns rather than a regex: `LIKE` is the only pattern operator
     * SQLite and Postgres spell the same way, and this runs under both. A name
     * that IS the word, one that starts with it, one that ends with it, one
     * that carries it in the middle — after every separator has been rewritten
     * to a space, so "K.Sharma" and "Anne-Marie" are two parts each rather than
     * one long one.
     *
     * The word arrives from `EntityRetriever`'s tokeniser, which splits on
     * `[^a-z0-9]`, so it carries no `%` and no `_` and there is nothing here to
     * escape.
     */
    private static function isANameOnTheRoster(string $word): bool
    {
        $name = 'lower(users.name)';

        foreach (self::NAME_SEPARATORS as $separator) {
            $name = "replace({$name}, '".str_replace("'", "''", $separator)."', ' ')";
        }

        return self::roster()
            ->where(function (Builder $query) use ($name, $word): void {
                foreach ([$word, $word.' %', '% '.$word, '% '.$word.' %'] as $pattern) {
                    $query->orWhereRaw($name.' like ?', [$pattern]);
                }
            })
            ->exists();
    }

    /**
     * Whether one person carries every one of these words in their name.
     *
     * ANDed rather than ORed: "kajal sharma" is one person, and matching either
     * word would answer with every Sharma in the company beside her.
     *
     * @param  list<string>  $words
     */
    private static function anybodyNamed(array $words): bool
    {
        $query = self::roster();

        foreach ($words as $word) {
            $query->whereRaw('lower(users.name) like ?', ['%'.$word.'%']);
        }

        return $query->exists();
    }

    /**
     * Every roster name exactly one edit away from this word.
     *
     * The SQL is a PREFILTER and is deliberately loose — `_` stands for the one
     * character typed wrong, and the word with a character removed catches the
     * one typed twice or left out. Neither is edit distance; `levenshtein()`
     * below is what makes it exact, and it is applied to each PART of a name so
     * a given name matches a given name rather than a fragment of a full one.
     *
     * @return list<string>
     */
    private static function namesOneEditFrom(string $word): array
    {
        $patterns = [];
        $length = strlen($word);

        for ($index = 0; $index < $length; $index++) {
            $head = substr($word, 0, $index);
            $tail = substr($word, $index + 1);

            $patterns[] = '%'.$head.'_'.$tail.'%';
            $patterns[] = '%'.$head.$tail.'%';
        }

        $candidates = self::roster()
            ->where(function (Builder $query) use ($patterns): void {
                foreach ($patterns as $pattern) {
                    $query->orWhereRaw('lower(users.name) like ?', [$pattern]);
                }
            })
            ->distinct()
            ->limit(self::MAX_PREFILTERED + 1)
            ->pluck('users.name')
            ->all();

        if (count($candidates) > self::MAX_PREFILTERED) {
            return [];
        }

        $matched = [];

        foreach ($candidates as $name) {
            foreach (self::partsOf((string) $name) as $part) {
                if (levenshtein($word, $part) === 1) {
                    $matched[(string) $name] = true;
                    break;
                }
            }
        }

        $names = array_keys($matched);

        /*
         * Sorted, because the prefilter's row order is whatever the storage
         * engine handed back. An unordered `in` list means the same question
         * emits a different plan on two runs — nothing can pin that, and the
         * golden fixture asserts this list verbatim.
         */
        sort($names);

        return $names;
    }

    /**
     * The roster, scoped the way the ANSWER will be scoped.
     *
     * `EmployeeWorkInfo`, never `User`. `User` deliberately carries no
     * `BelongsToOrganization` — that scope resolves the acting user through
     * Auth — so `User::query()` reads every tenant on the platform, and a lookup
     * built on it would confirm a name belonging to another customer and then
     * answer with an empty table. `QueryPlanExecutor` makes the same choice for
     * the same reason and states it on `BASE_QUERIES`; sharing the base is what
     * guarantees this class can never find somebody the answer would not show.
     *
     * A word reaches here from `EntityRetriever`'s tokeniser, which splits on
     * `[^a-z0-9]`, so it carries no `%` and no `_` and needs no escaping — and
     * the fuzzy patterns above insert a `_` on purpose, which is the other half
     * of why escaping belongs nowhere near here.
     */
    private static function roster(): Builder
    {
        return EmployeeWorkInfo::query()
            ->join('users', 'users.id', '=', 'employee_work_infos.user_id');
    }

    /** @return list<string> */
    private static function partsOf(string $name): array
    {
        return preg_split('/[^a-z0-9]+/', strtolower($name), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    }

    private static function isDetailWord(string $word): bool
    {
        return in_array(Str::singular(strtolower($word)), self::DETAIL_WORDS, true);
    }
}
