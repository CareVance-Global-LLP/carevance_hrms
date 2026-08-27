<?php

namespace App\Services\Ai\Actions;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use RuntimeException;

/**
 * Turns a plan into the §5 preview: the target, the diff, who it lands on, and
 * a token that ties an Apply back to this exact interpretation.
 *
 * Everything a person agrees to is decided here, which makes this the place
 * where "never act on an interpretation the person has not seen" is either true
 * or a slogan. Six rules carry it:
 *
 *  1. **`before` is READ, never echoed.** §4: "THE PREVIEW IS COMPUTED, NOT
 *     PROMISED." The model never states a current value and would not be
 *     believed if it did — every `from` comes off the live row at preview time.
 *     A diff quoting the model's idea of the present shows a change that never
 *     existed, and it reads exactly like a real one.
 *  2. **Tenancy is the global scope, not a filter written here.** There is no
 *     `where('organization_id', …)` in this file. Resolution runs through the
 *     model's ordinary query, so `BelongsToOrganization` applies structurally
 *     and a plan naming another organisation's row finds nothing. A written
 *     filter is a line somebody can forget on the fourth action.
 *  3. **Permission is checked BEFORE the target is resolved.** Otherwise the
 *     refusal differs depending on whether the row exists, and an unauthorised
 *     caller learns the contents of a table by reading error messages.
 *  4. **Bounds are refused here, by name, in the field's own words.** The
 *     alternative is a 422 from the endpoint at Apply — after a human has
 *     already agreed to it, and phrased in whatever language the FormRequest
 *     happens to use.
 *  5. **A no-op is reported, never tokenised.** A change to the value something
 *     already holds gets no Apply button: the write would do nothing and the
 *     audit would record a change that changed nothing.
 *  6. **Nothing is written.** A preview reads. Every side effect belongs to
 *     Apply, which goes through the real endpoint.
 *
 * @see docs/superpowers/specs/2026-08-26-ai-write-actions.md §4, §5, §6
 */
class ActionPreviewBuilder
{
    /**
     * Build the preview a human will be shown, or refuse.
     *
     * @param  array<string, mixed>  $plan  raw output of ActionPlanner — untrusted
     * @param  User  $actor  the person who asked, and the only one who may apply it
     * @param  string  $question  what they typed, carried inside the token for the audit
     * @return array{key: string, label: string, target: array{id: mixed, label: string}, changes: list<array<string, mixed>>, unchanged: list<array<string, mixed>>, impact: string, token: string|null, message: string|null}
     *
     * @throws ActionRefusedException
     */
    public function build(array $plan, User $actor, string $question): array
    {
        $this->assertScopeBelongsToActor($actor);

        if (isset($plan['error']) && is_string($plan['error'])) {
            // The planner's own refusal, carried word for word. It is already a
            // sentence about what is missing, and rephrasing it here would lose
            // the only actionable part.
            throw new ActionRefusedException($plan['error'], ActionRefusedException::UNKNOWN_ACTION);
        }

        $key = is_string($plan['action'] ?? null) ? trim($plan['action']) : '';
        $entry = ActionCatalogue::get($key);

        if ($entry === null) {
            throw ActionRefusedException::unknownAction($key);
        }

        ActionPermission::assert($actor, $entry);

        $target = $this->resolveTarget($plan['target'] ?? [], $key, $entry, $actor);

        [$changes, $unchanged] = $this->diff($plan['changes'] ?? null, $key, $entry, $target['model']);

        $previewed = [
            'action' => $key,
            /*
             * The target travels as an ID, not as the phrase it was found by.
             * `department.rename` changes the very column it resolves on, so a
             * re-lookup by name at Apply finds nothing the moment the rename
             * succeeds — and finds the WRONG row if somebody else has taken the
             * name in the meantime. The id still resolves inside the tenant
             * scope at execution, so this narrows the lookup without widening
             * what can be reached.
             */
            'target' => ['id' => $target['id'], 'label' => $target['label']],
            'changes' => array_column($changes, 'to', 'field'),
            /*
             * The question rides INSIDE the signature. §4 requires the audit to
             * record what was asked alongside who confirmed, and a question
             * posted again at Apply is one the client composes — an audit trail
             * the audited party can write is not one.
             */
            'question' => $question,
        ];

        return [
            'key' => $key,
            'label' => $entry['label'],
            'target' => ['id' => $target['id'], 'label' => $target['label']],
            'changes' => $changes,
            'unchanged' => $unchanged,
            'impact' => $this->impact($entry, $target, $actor),
            'token' => $changes === []
                ? null
                : ActionToken::issue($previewed, array_column($changes, 'from', 'field'), $actor->id),
            'message' => $changes === [] ? $this->nothingToDo($target['label'], $unchanged) : null,
        ];
    }

    /**
     * The live values of these fields, normalised exactly as a preview
     * normalises them.
     *
     * Public for ONE caller: §4's re-read at Apply. "If `before` no longer
     * matches the live value, the write is REFUSED" is only correct if both
     * sides were produced the same way — `carry_forward_cap` reads back from a
     * `decimal:2` cast as the string "5.00" while the token holds 5, and
     * `office_start_time` is stored "09:00:00" against a previewed "09:00". A
     * second normalisation written next to the executor would report every
     * apply as stale, which is a refusal nobody can ever get past and which
     * looks exactly like the concurrency guard working.
     *
     * @param  list<string>  $fields
     * @return array<string, mixed>
     */
    public function liveValuesFor(Model $row, string $action, array $fields): array
    {
        $entry = ActionCatalogue::get($action);

        if ($entry === null) {
            throw ActionRefusedException::unknownAction($action);
        }

        $values = [];

        foreach ($fields as $field) {
            $field = (string) $field;
            $spec = ActionCatalogue::field($action, $field);

            if ($spec === null) {
                throw ActionRefusedException::malformed(sprintf(
                    "'%s' is not something \"%s\" can change.",
                    $field,
                    $entry['label'],
                ));
            }

            $values[$field] = $this->liveValue($row, $field, $spec);
        }

        return $values;
    }

    /**
     * The same diff a preview computes, against a row read NOW.
     *
     * Public for §4's re-validation at Apply: "the catalogue, the permission and
     * the field bounds are all checked again". Checked again by RE-RUNNING this,
     * not by a second implementation beside the executor — a bounds check
     * written twice is one that eventually disagrees with itself, and the
     * disagreement shows up as an Apply that refuses what the preview offered.
     *
     * It also produces the live `from` values the staleness check compares
     * against the token, normalised identically to the ones the token carries.
     *
     * @param  array<string, mixed>  $changes  field => requested value
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>}  [moved, already-held]
     *
     * @throws ActionRefusedException
     */
    public function diffAgainst(string $action, Model $row, array $changes): array
    {
        $entry = ActionCatalogue::get($action);

        if ($entry === null) {
            throw ActionRefusedException::unknownAction($action);
        }

        return $this->diff($changes, $action, $entry, $row);
    }

    /**
     * The tenant scope reads the AMBIENT user; this class is handed one. If
     * they ever disagreed, every guarantee above would be about somebody else's
     * organisation.
     *
     * Loud rather than silent, and a programming error rather than a refusal:
     * it can only fire when the builder is called outside the request that
     * authenticated the actor — a console command or a queued job, where
     * `BelongsToOrganization` is deliberately a no-op and the resolution below
     * would run across every tenant.
     */
    private function assertScopeBelongsToActor(User $actor): void
    {
        if (! Auth::hasUser() || (int) Auth::id() !== (int) $actor->getKey()) {
            throw new RuntimeException(
                'An action preview must be built for the authenticated user; the tenant scope reads that user and nothing else.'
            );
        }
    }

    /**
     * A phrase becomes one row, or it becomes a refusal.
     *
     * NO ORGANISATION FILTER IS WRITTEN HERE. `$entry['model']::query()` carries
     * `BelongsToOrganization`'s global scope, so a name belonging to another
     * tenant matches nothing and comes back as "I couldn't find it" — the same
     * answer as a name that genuinely does not exist, which is also the only
     * answer that tells a caller nothing about another tenant's records.
     *
     * @param  array<string, mixed>  $entry
     * @return array{model: Model, id: mixed, label: string}
     */
    private function resolveTarget(mixed $target, string $key, array $entry, User $actor): array
    {
        if (! is_array($target)) {
            throw ActionRefusedException::malformed('I could not tell which record you meant.');
        }

        $subject = $this->subject($key);
        $lookups = (array) $entry['target_by'];

        if (in_array(ActionCatalogue::TARGET_ACTING_ORGANIZATION, $lookups, true)) {
            return $this->actingOrganization($target, $subject, $actor);
        }

        foreach ($target as $lookup => $value) {
            if (! in_array((string) $lookup, $lookups, true)) {
                throw ActionRefusedException::malformed(sprintf(
                    "'%s' is not a way to find a %s.",
                    $lookup,
                    $subject,
                ));
            }

            if (! is_scalar($value)) {
                throw ActionRefusedException::malformed(sprintf(
                    'I could not read the %s you named.',
                    $subject,
                ));
            }
        }

        if ($target === []) {
            throw ActionRefusedException::notFound(sprintf('I could not tell which %s you meant.', $subject));
        }

        $query = $entry['model']::query();

        foreach ($target as $lookup => $value) {
            /*
             * Case-insensitive, because case is how a person types a name and
             * not a different row: somebody says "casual leave" about a row
             * called "Casual Leave". The column comes from the catalogue, which
             * is hand-written and checked against the real schema by
             * ActionCatalogueTest, and is re-checked here anyway — a raw
             * fragment is not the place to trust a caller.
             */
            $column = (string) $lookup;

            if (preg_match('/^[a-z_][a-z0-9_]*$/', $column) !== 1) {
                throw ActionRefusedException::malformed(sprintf("'%s' is not a way to find a %s.", $column, $subject));
            }

            $query->whereRaw(sprintf('LOWER(%s) = ?', $column), [mb_strtolower(trim((string) $value))]);
        }

        // Two is all it takes to know the answer is "more than one", and
        // fetching the rest would be a directory read nobody asked for.
        $matches = $query->limit(2)->get();

        $named = implode(', ', array_map(static fn ($value): string => (string) $value, array_values($target)));

        if ($matches->count() > 1) {
            throw ActionRefusedException::ambiguous(sprintf(
                "More than one %s is called '%s', so I can't tell which one you mean.",
                $subject,
                $named,
            ));
        }

        $row = $matches->first();

        if ($row === null) {
            throw ActionRefusedException::notFound(sprintf(
                "I couldn't find a %s called '%s'.",
                $subject,
                $named,
            ));
        }

        return ['model' => $row, 'id' => $row->getKey(), 'label' => $this->labelOf($row)];
    }

    /**
     * There is exactly one addressable organisation and it is the acting user's
     * own.
     *
     * A supplied target is therefore a CLAIM about which row that is, not a
     * lookup — and a claim that does not match is refused rather than quietly
     * applied to whichever organisation the caller happens to be in. Ignoring
     * it would turn "rename Beta Ltd to X", typed by somebody signed in to
     * Acme, into a rename of Acme.
     *
     * @param  array<array-key, mixed>  $target
     * @return array{model: Model, id: mixed, label: string}
     */
    private function actingOrganization(array $target, string $subject, User $actor): array
    {
        $organization = $actor->organization;

        if ($organization === null) {
            throw ActionRefusedException::notFound('Your account is not attached to an organization.');
        }

        foreach ($target as $lookup => $value) {
            $attribute = (string) $lookup;
            $stored = $organization->getAttribute($attribute);

            /*
             * Scalar on both sides or it is not a name somebody could have
             * meant. `settings` is a real attribute holding an array, and
             * comparing it as a string is a PHP warning rather than a claim
             * anybody made.
             */
            if (! array_key_exists($attribute, $organization->getAttributes())
                || ! is_scalar($value)
                || ! (is_scalar($stored) || $stored === null)
            ) {
                throw ActionRefusedException::malformed(sprintf(
                    "'%s' is not a way to find an %s.",
                    $attribute,
                    $subject,
                ));
            }

            $claimed = mb_strtolower(trim((string) $value));
            $actual = mb_strtolower(trim((string) $stored));

            if ($claimed !== $actual) {
                throw ActionRefusedException::notFound(sprintf(
                    "You are signed in to %s, so I can't change '%s'.",
                    $this->labelOf($organization),
                    (string) $value,
                ));
            }
        }

        return [
            'model' => $organization,
            'id' => $organization->getKey(),
            'label' => $this->labelOf($organization),
        ];
    }

    /**
     * The requested fields, split into what would move and what already holds
     * the value asked for.
     *
     * Both halves are returned. A field silently dropped because it was already
     * right leaves the reader wondering whether it was understood at all, and a
     * field included in the diff at its current value is an Apply button for
     * nothing.
     *
     * @param  array<string, mixed>  $entry
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>}
     */
    private function diff(mixed $changes, string $key, array $entry, Model $row): array
    {
        if (! is_array($changes) || $changes === []) {
            throw ActionRefusedException::malformed(sprintf(
                '"%s" was asked for without saying what to change.',
                $entry['label'],
            ));
        }

        $moved = [];
        $held = [];

        foreach ($changes as $field => $value) {
            $field = (string) $field;
            $spec = ActionCatalogue::field($key, $field);

            if ($spec === null) {
                // Scoped to the ACTION, never to the table. `is_active` is a
                // real column on `leave_types` and deliberately not a field of
                // this action; finding it on the model would make the catalogue
                // advisory rather than authoritative.
                throw ActionRefusedException::malformed(sprintf(
                    "'%s' is not something \"%s\" can change.",
                    $field,
                    $entry['label'],
                ));
            }

            $to = $this->requestedValue($value, $spec);
            $from = $this->liveValue($row, $field, $spec);

            if ($this->same($from, $to, $spec)) {
                $held[] = ['field' => $field, 'label' => $spec['label'], 'value' => $to];

                continue;
            }

            $moved[] = [
                'field' => $field,
                'label' => $spec['label'],
                'from' => $from,
                'to' => $to,
                'unit' => $spec['unit'] ?? null,
            ];
        }

        return [$moved, $held];
    }

    /**
     * The live value, from the row, at preview time.
     *
     * A column first; failing that, the model's own settings blob. The
     * organisation's timezone and working day are stored inside
     * `organizations.settings` rather than in columns of their own — the
     * endpoint merges them key by key — so a preview that could only read
     * columns would report every one of them as null and show a diff out of
     * nothing.
     *
     * A field spec may name its own path with `read`, which wins. The search
     * below is the fallback, and it is deliberately shallow: the blob's top
     * level, then one level of nesting, and a key found in two places with two
     * different values is a REFUSAL rather than a coin toss.
     *
     * @param  array<string, mixed>  $spec
     */
    private function liveValue(Model $row, string $field, array $spec): mixed
    {
        if (isset($spec['read']) && is_string($spec['read'])) {
            return $this->presentLive(data_get($row, $spec['read']), $spec);
        }

        if (array_key_exists($field, $row->getAttributes())) {
            return $this->presentLive($row->getAttribute($field), $spec);
        }

        return $this->presentLive($this->fromStoredSettings($row, $field), $spec);
    }

    private function fromStoredSettings(Model $row, string $field): mixed
    {
        $top = [];
        $nested = [];

        foreach (array_keys($row->getAttributes()) as $attribute) {
            $value = $row->getAttribute($attribute);

            if (! is_array($value)) {
                continue;
            }

            if (array_key_exists($field, $value)) {
                $top[] = $value[$field];
            }

            foreach ($value as $group) {
                if (is_array($group) && array_key_exists($field, $group)) {
                    $nested[] = $group[$field];
                }
            }
        }

        $found = $top !== [] ? $top : $nested;

        if ($found === []) {
            return null;
        }

        if (count(array_unique($found, SORT_REGULAR)) > 1) {
            throw ActionRefusedException::ambiguous(sprintf(
                "'%s' is stored in more than one place with different values, so I can't preview a change to it.",
                $field,
            ));
        }

        return $found[0];
    }

    /**
     * The value asked for, checked against the bounds the catalogue declares.
     *
     * Refused HERE, naming the field, in that field's own units. The endpoint
     * would refuse it too — as a 422, at Apply, after a human has agreed to it,
     * phrased however the FormRequest happens to phrase things.
     *
     * @param  array<string, mixed>  $spec
     */
    private function requestedValue(mixed $value, array $spec): mixed
    {
        $label = (string) $spec['label'];
        $unit = isset($spec['unit']) ? ' '.$spec['unit'] : '';

        switch ($spec['type']) {
            case 'integer':
            case 'number':
                if (is_bool($value) || ! is_numeric($value)) {
                    throw ActionRefusedException::outOfBounds(sprintf(
                        '%s must be a number between %s and %s%s.',
                        $label, $spec['min'], $spec['max'], $unit,
                    ));
                }

                $number = (float) $value;

                if ($spec['type'] === 'integer' && floor($number) !== $number) {
                    throw ActionRefusedException::outOfBounds($unit === ''
                        ? sprintf('%s must be a whole number.', $label)
                        : sprintf('%s must be a whole number of %s.', $label, trim($unit)));
                }

                if ($number < (float) $spec['min'] || $number > (float) $spec['max']) {
                    throw ActionRefusedException::outOfBounds(sprintf(
                        '%s must be between %s and %s%s.',
                        $label, $spec['min'], $spec['max'], $unit,
                    ));
                }

                return $this->asNumber($number);

            case 'text':
                if (! is_string($value)) {
                    throw ActionRefusedException::outOfBounds(sprintf('%s must be text.', $label));
                }

                $text = trim($value);

                if ($text === '') {
                    throw ActionRefusedException::outOfBounds(sprintf('%s cannot be blank.', $label));
                }

                if (mb_strlen($text) > (int) $spec['max_length']) {
                    throw ActionRefusedException::outOfBounds(sprintf(
                        '%s must be at most %d characters.',
                        $label, (int) $spec['max_length'],
                    ));
                }

                return $text;

            case 'time':
                $time = is_scalar($value) ? $this->asTime((string) $value, $spec) : null;

                if ($time === null) {
                    throw ActionRefusedException::outOfBounds(sprintf(
                        '%s must be a 24-hour time such as 09:30.',
                        $label,
                    ));
                }

                return $time;

            case 'timezone':
                /*
                 * Checked against PHP's own list rather than a regex. A
                 * plausible-looking typo — Asia/Kolkatta — is accepted by any
                 * pattern loose enough to allow the real names, and an
                 * organisation whose timezone does not resolve gets every
                 * attendance boundary computed in UTC.
                 */
                if (! is_string($value) || ! in_array($value, timezone_identifiers_list(), true)) {
                    throw ActionRefusedException::outOfBounds(sprintf(
                        "%s must be an IANA name such as Asia/Kolkata; '%s' is not one I recognise.",
                        $label,
                        is_scalar($value) ? (string) $value : 'that',
                    ));
                }

                return $value;
        }

        throw ActionRefusedException::malformed(sprintf('%s cannot be changed from here.', $label));
    }

    /**
     * A stored value rendered the way the diff will compare and display it.
     *
     * This one never refuses. A value already in the database that is outside
     * today's bounds — a cap of 400 set before the bound existed — is a fact
     * about the row, and refusing to preview it would make the field
     * uneditable precisely where it most needs fixing.
     *
     * @param  array<string, mixed>  $spec
     */
    private function presentLive(mixed $value, array $spec): mixed
    {
        if ($value === null) {
            return null;
        }

        return match ($spec['type']) {
            'integer', 'number' => is_numeric($value) ? $this->asNumber((float) $value) : null,
            'text', 'timezone' => is_scalar($value) ? trim((string) $value) : null,
            'time' => is_scalar($value) ? $this->asTime((string) $value, $spec) : null,
            default => is_scalar($value) ? $value : null,
        };
    }

    /**
     * `decimal:2` reads back as the string "5.00", and the plan says 10. Both
     * have to become the same kind of thing or every diff is a difference.
     */
    private function asNumber(float $number): int|float
    {
        $rounded = round($number, 2);

        return $rounded === floor($rounded) ? (int) $rounded : $rounded;
    }

    /** @param  array<string, mixed>  $spec */
    private function asTime(string $value, array $spec): ?string
    {
        if (preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/', trim($value), $parts) !== 1) {
            return null;
        }

        [$hour, $minute, $second] = [(int) $parts[1], (int) $parts[2], (int) ($parts[3] ?? 0)];

        if ($hour > 23 || $minute > 59 || $second > 59) {
            return null;
        }

        return ($spec['format'] ?? 'H:i') === 'H:i:s'
            ? sprintf('%02d:%02d:%02d', $hour, $minute, $second)
            : sprintf('%02d:%02d', $hour, $minute);
    }

    /**
     * Whether the row already holds what was asked for.
     *
     * Compared on the NORMALISED pair, so "09:00:00" against "09:00" and "5.00"
     * against 5 are correctly the same value. Getting this wrong in the strict
     * direction is the expensive one: it puts an Apply button on a write with
     * no effect and records it in the audit as a change.
     *
     * @param  array<string, mixed>  $spec
     */
    private function same(mixed $from, mixed $to, array $spec): bool
    {
        if ($from === null || $to === null) {
            return $from === $to;
        }

        if ($spec['type'] === 'number' || $spec['type'] === 'integer') {
            return abs((float) $from - (float) $to) < 0.00001;
        }

        return (string) $from === (string) $to;
    }

    /**
     * §3: the impact "answers 'and who does this land on?' — a COUNT, never a
     * list of names". A preview is not a directory export, and a person
     * confirming a policy change does not need to be shown everybody's name to
     * understand its reach.
     *
     * @param  array<string, mixed>  $entry
     * @param  array{model: Model, id: mixed, label: string}  $target
     */
    private function impact(array $entry, array $target, User $actor): string
    {
        switch ($entry['impact']) {
            case 'employees_in_organization':
                $organization = $actor->organization;

                return $this->people($organization === null ? 0 : $organization->users()->count(), '');

            case 'employees_in_department':
                if (! method_exists($target['model'], 'users')) {
                    break;
                }

                return $this->people($target['model']->users()->count(), ' in this department');
        }

        /*
         * An impact nothing can compute is a preview that cannot say who is
         * affected — the one thing §3 says the preview is for. Refused rather
         * than rendered as "Affects 0 employees", which is a false statement
         * that looks like a computed one.
         */
        throw ActionRefusedException::malformed(sprintf(
            'I cannot work out who "%s" would affect, so I will not preview it.',
            $entry['label'],
        ));
    }

    private function people(int $count, string $qualifier): string
    {
        return match (true) {
            $count === 0 => 'Affects nobody'.$qualifier,
            $count === 1 => 'Affects 1 employee'.$qualifier,
            default => sprintf('Affects %d employees%s', $count, $qualifier),
        };
    }

    /** @param  list<array<string, mixed>>  $unchanged */
    private function nothingToDo(string $target, array $unchanged): string
    {
        if (count($unchanged) === 1) {
            return sprintf(
                '%s already has %s set to %s.',
                $target,
                lcfirst((string) $unchanged[0]['label']),
                (string) $unchanged[0]['value'],
            );
        }

        return sprintf('%s already holds every value you asked for.', $target);
    }

    /** The label a person recognises the row by, falling back to its key. */
    private function labelOf(Model $row): string
    {
        $name = $row->getAttribute('name');

        return is_scalar($name) && trim((string) $name) !== ''
            ? trim((string) $name)
            : '#'.$row->getKey();
    }

    /**
     * The thing an action acts on, taken from the key's first segment:
     * `leave_type.update` is about a leave type. Derived rather than declared
     * because it is already written down — a second copy in the catalogue would
     * be a second thing to keep in step.
     */
    private function subject(string $key): string
    {
        return str_replace('_', ' ', explode('.', $key)[0]);
    }
}
