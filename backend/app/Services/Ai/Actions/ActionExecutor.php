<?php

namespace App\Services\Ai\Actions;

use App\Models\User;
use App\Services\Audit\AuditLogService;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\Facades\Route;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Apply: the one moment in AI mode that changes anything.
 *
 * THE WRITE GOES THROUGH THE REAL ENDPOINT. §4 is unambiguous — "EXECUTION GOES
 * THROUGH THE REAL ENDPOINT, NEVER ELOQUENT" — and the reason is specific to
 * this codebase rather than stylistic. There are **zero Laravel policies** here:
 * authorization is written inline in controllers, alongside the FormRequest
 * rules, the tenant checks, the slug regeneration and everything else a
 * controller does on the way past. `$model->update($changes)` would apply the
 * same diff and skip every one of them, and the row afterwards would look
 * identical to one written correctly. So the executor composes an HTTP request
 * and hands it to the router, which runs `api.token`, `mfa.enrolled`, the
 * route's own `role:` gate, `SanitizeInput`, model binding and the controller —
 * exactly what the browser gets.
 *
 * THE CREDENTIAL IS THE ACTING USER'S OWN, FORWARDED. `api.token` authenticates
 * a bearer and knows nothing about who this process thinks is logged in, so the
 * internal request carries the Authorization header (and the cookies) of the
 * request that reached us. Minting a token here instead would create a real,
 * second credential for a user who never asked for one, and any scheme that
 * skipped the middleware would be back to writing round the authorization this
 * whole design exists to preserve. If the caller presented nothing usable, the
 * sub-request 401s and the change is refused — fail-closed.
 *
 * A SIGNATURE IS PROVENANCE, NOT PERMISSION. The token proves the server issued
 * the plan. It says nothing about whether the catalogue still contains the
 * action, whether the bounds still admit the value, whether this person may
 * still do it, or whether the row still says what the preview showed. All four
 * are asked again, from scratch, before anything is dispatched — §4's
 * "re-validated from scratch", "checked against the acting user, twice", and
 * "RE-READ BEFORE WRITING".
 *
 * THE STALENESS CHECK IS THE ONE PEOPLE SKIP. Between preview and Apply
 * somebody else may have edited the row. Writing anyway does not merge — it
 * overwrites, silently, and the audit then records our change as though it were
 * the only one. So the live values are re-read and compared against the ones the
 * preview computed its diff from, and a mismatch REFUSES rather than proceeds.
 * Both sides come from `ActionPreviewBuilder`, so "5.00" from a decimal cast and
 * 5 from the token are the same value rather than a permanent false alarm.
 *
 * THE AUDIT NAMES THE HUMAN. Not a service account, not "AI": the actor is
 * whoever clicked Apply, with the question they typed stored beside it. "Who
 * changed this" has to stay answerable, and "why" is the half that makes the
 * answer useful a year later. It is written only after a 2xx — a trail that
 * records writes which did not happen is worse than none.
 *
 * @see docs/superpowers/specs/2026-08-26-ai-write-actions.md §4, §5, §6
 */
class ActionExecutor
{
    /**
     * The audit action for every AI-applied change.
     *
     * One value rather than one per catalogue key, so "everything AI mode has
     * ever changed" is a single indexed query. Which action it was lives in the
     * metadata, where it can be read without knowing today's catalogue.
     */
    public const AUDIT_ACTION = 'ai_action.applied';

    public function __construct(
        private readonly ActionPreviewBuilder $previews,
        private readonly AuditLogService $audit,
    ) {
    }

    /**
     * Apply a previewed change, or refuse.
     *
     * @param  string  $token  the opaque handle the preview issued
     * @param  User  $actor  the human who clicked Apply — the only one it may be
     * @param  Request  $origin  the inbound request, for its credential and its provenance
     * @return array{applied: true, action: string, label: string, target: array{id: mixed, label: string}, changes: list<array<string, mixed>>, message: string, route: string|null}
     *
     * @throws ActionRefusedException
     */
    public function execute(string $token, User $actor, Request $origin): array
    {
        $this->assertScopeBelongsToActor($actor);

        $opened = ActionToken::open($token, (int) $actor->getKey());

        if ($opened === null) {
            throw ActionRefusedException::noPreview();
        }

        [$key, $targetId, $changes, $question] = $this->readPlan($opened['plan']);

        $entry = ActionCatalogue::get($key);

        if ($entry === null) {
            // Re-read from the catalogue rather than trusted from the token.
            // The catalogue is where "no payroll state transitions, no deletes,
            // no money" is enforced, and a token minted before an action was
            // withdrawn must not outlive it.
            throw ActionRefusedException::unknownAction($key);
        }

        // §4's second check. A role can change between the two requests, and
        // this is the one that is load-bearing — the first is a courtesy.
        ActionPermission::assert($actor, $entry);

        $row = $this->resolveTarget($entry, $targetId, $actor, $key);

        // Bounds AND the live values, computed by the code the preview used.
        [$moved, $held] = $this->previews->diffAgainst($key, $row, $changes);

        $this->assertTheRowHasNotMoved($moved, $held, $opened['before'], $entry);

        // Resolved once and used twice — dispatched, then named in the audit, so
        // the trail says which authority actually wrote the row.
        [$method, $path] = $this->endpointFor($entry, $row);

        $response = $this->dispatch($entry, $row, $this->payload($moved, $held), $origin, $method, $path);

        $status = $response->getStatusCode();

        if ($status < 200 || $status >= 300) {
            throw $this->refusalFor($status, $response, $entry);
        }

        // Read back through the same scoped lookup rather than from the
        // response: what the row now holds is the fact, and a controller is
        // free to have stored something other than what it was sent.
        $applied = $this->resolveTarget($entry, $targetId, $actor, $key);
        $after = $this->previews->liveValuesFor($applied, $key, array_keys($changes));

        $this->recordAudit($entry, $key, $applied, $actor, $origin, $question, $opened['before'], $after, $method.' '.$path, $status);

        return [
            'applied' => true,
            'action' => $key,
            'label' => (string) $entry['label'],
            'target' => ['id' => $applied->getKey(), 'label' => $this->labelOf($applied)],
            'changes' => $this->appliedChanges($moved, $after),
            'message' => $this->message($this->labelOf($applied), $moved, $after),
            'route' => isset($entry['view_route']) ? (string) $entry['view_route'] : null,
        ];
    }

    /**
     * The tenant scope reads the AMBIENT user; this class is handed one.
     *
     * The same guard `ActionPreviewBuilder` carries and for the same reason: if
     * the two ever disagreed, the target resolution below would run against
     * somebody else's organisation. A programming error rather than a refusal —
     * it can only fire when the executor is called outside the request that
     * authenticated the actor.
     */
    private function assertScopeBelongsToActor(User $actor): void
    {
        if (! Auth::hasUser() || (int) Auth::id() !== (int) $actor->getKey()) {
            throw new RuntimeException(
                'An action must be executed for the authenticated user; the tenant scope reads that user and nothing else.'
            );
        }
    }

    /**
     * The four parts of a previewed plan, or a refusal.
     *
     * A signed token cannot have been edited, so anything wrong in here means
     * this server issued something malformed. It is still checked, because
     * "trusted because we signed it" is how a bug in one component becomes a
     * write in another.
     *
     * @param  array<string, mixed>  $plan
     * @return array{0: string, 1: mixed, 2: array<string, mixed>, 3: string}
     */
    private function readPlan(array $plan): array
    {
        $key = is_string($plan['action'] ?? null) ? trim($plan['action']) : '';
        $target = is_array($plan['target'] ?? null) ? $plan['target'] : [];
        $changes = is_array($plan['changes'] ?? null) ? $plan['changes'] : [];
        $question = is_string($plan['question'] ?? null) ? $plan['question'] : '';

        if ($key === '' || ! isset($target['id']) || ! is_scalar($target['id']) || $changes === []) {
            throw ActionRefusedException::noPreview();
        }

        return [$key, $target['id'], $changes, $question];
    }

    /**
     * The row, re-read now, inside the tenant scope.
     *
     * BY ID, never by the phrase the preview found it with: `department.rename`
     * changes the very column it resolved on, so a re-lookup by name finds
     * nothing once the rename lands — and finds the WRONG row if somebody else
     * has taken the name in between.
     *
     * There is no `where('organization_id', …)` here. `$entry['model']::query()`
     * carries `BelongsToOrganization`, so a row that has moved tenant, or never
     * belonged to this one, is simply absent. The one exception is
     * `Organization` itself, which is deliberately outside that trait because
     * the scope resolves *through* it — so the acting user's own organisation is
     * the only addressable one, checked explicitly.
     *
     * @param  array<string, mixed>  $entry
     */
    private function resolveTarget(array $entry, mixed $id, User $actor, string $key): Model
    {
        $subject = str_replace('_', ' ', explode('.', $key)[0]);

        if (in_array(ActionCatalogue::TARGET_ACTING_ORGANIZATION, (array) $entry['target_by'], true)
            && (int) $id !== (int) $actor->organization_id) {
            throw ActionRefusedException::notFound(sprintf(
                'That %s is not the one you are signed in to.',
                $subject,
            ));
        }

        $row = $entry['model']::query()->whereKey($id)->first();

        if (! $row instanceof Model) {
            throw ActionRefusedException::notFound(sprintf(
                "The %s I previewed is no longer there, so I haven't changed anything.",
                $subject,
            ));
        }

        return $row;
    }

    /**
     * §4: "RE-READ BEFORE WRITING. If `before` no longer matches the live value,
     * the write is REFUSED and the preview is regenerated."
     *
     * Both halves of the diff are checked. A field that still differs from the
     * requested value is compared against the token's before; a field that
     * already HOLDS the requested value has necessarily got there since the
     * preview, because a preview never tokenises a no-op — so it is the same
     * failure wearing different clothes, and applying it would report a change
     * this Apply did not make.
     *
     * The comparison is strict, and it can be, because both sides are produced
     * by `ActionPreviewBuilder`. A second normalisation written here would find
     * "5.00" and 5 different on an untouched row and refuse every apply forever,
     * looking exactly like the guard working.
     *
     * @param  list<array<string, mixed>>  $moved
     * @param  list<array<string, mixed>>  $held
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $entry
     */
    private function assertTheRowHasNotMoved(array $moved, array $held, array $before, array $entry): void
    {
        // `from` on a field that would still move, `value` on one that already
        // holds what was asked for: both are the live reading of that field.
        $live = array_merge(
            array_column($moved, 'from', 'field'),
            array_column($held, 'value', 'field'),
        );
        $labels = array_merge(
            array_column($moved, 'label', 'field'),
            array_column($held, 'label', 'field'),
        );

        foreach ($live as $field => $value) {
            if (! array_key_exists($field, $before)) {
                // A preview records a before for every field it tokenises, so a
                // token missing one is not a preview this server issued.
                throw ActionRefusedException::noPreview();
            }

            if ($value !== $before[$field]) {
                throw $this->stale($labels[$field], $before[$field], $value);
            }
        }

        if ($moved === []) {
            // Every field already held its requested value, and held it at
            // preview time too — which a preview would never have tokenised.
            throw ActionRefusedException::malformed(sprintf(
                '"%s" would not change anything, so I have not run it.',
                $entry['label'],
            ));
        }
    }

    private function stale(mixed $label, mixed $shown, mixed $live): ActionRefusedException
    {
        return ActionRefusedException::stale(sprintf(
            "%s is now %s, not %s — it changed after I showed you that, so I haven't applied anything. Ask again and I'll show you a fresh preview.",
            (string) $label,
            $this->render($live),
            $this->render($shown),
        ));
    }

    /**
     * The values that will actually be SENT: the diff's, never the plan's.
     *
     * WHAT EXECUTES IS WHAT THE DIFF SAYS, down to the character. `$moved` and
     * `$held` carry the values after `ActionPreviewBuilder::requestedValue()`
     * has normalised them, and normalisation is not cosmetic: `"9:30"` becomes
     * **09:30**, which is what the preview displayed AND the only form
     * `UpdateOrganizationRequest`'s time rule accepts; `"  Acme  "` is trimmed,
     * which is what `presentLive()` reads back.
     *
     * `$changes` normally holds the same values, because `build()` tokenises
     * the diff rather than the model's raw plan. Taking them from the diff
     * anyway keeps that a property of THIS method rather than of a token minted
     * somewhere else — a token proves this server issued the plan, never that
     * the plan is in the shape the endpoint needs. Sending anything but the
     * re-derived diff makes the write and the confirmation two different
     * claims, and the confirmation is the one the human reads.
     *
     * @param  list<array<string, mixed>>  $moved
     * @param  list<array<string, mixed>>  $held
     * @return array<string, mixed>
     */
    private function payload(array $moved, array $held): array
    {
        return array_merge(
            // A field that already holds its requested value is still sent —
            // the endpoint decides what a no-op field means, not this class.
            array_column($held, 'value', 'field'),
            array_column($moved, 'to', 'field'),
        );
    }

    /**
     * Compose the HTTP request and hand it to the router.
     *
     * The payload is the previewed changes plus `required_by_endpoint` — fields
     * a FormRequest marks `required` even for a partial edit, echoed at their
     * CURRENT value. `UpdateOrganizationRequest` requires `name` and `slug`
     * whatever is being changed, so without this a timezone edit is a 422 at the
     * last step, after a human has already confirmed.
     *
     * @param  array<string, mixed>  $entry
     * @param  array<string, mixed>  $changes
     */
    private function dispatch(array $entry, Model $row, array $changes, Request $origin, string $method, string $path): Response
    {
        $payload = $changes;

        foreach ((array) ($entry['required_by_endpoint'] ?? []) as $field) {
            $field = (string) $field;

            if (array_key_exists($field, $payload)) {
                continue;
            }

            if (! array_key_exists($field, $row->getAttributes())) {
                throw new RuntimeException(sprintf(
                    "'%s' is declared required_by_endpoint but is not an attribute of %s.",
                    $field,
                    $row::class,
                ));
            }

            $payload[$field] = $row->getAttribute($field);
        }

        $server = [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'REMOTE_ADDR' => (string) ($origin->server('REMOTE_ADDR') ?: '127.0.0.1'),
        ];

        /*
         * The acting user's own credential, forwarded. `api.token` reads a
         * bearer or the auth cookie and resolves the user itself — which is the
         * point: the sub-request is authenticated by the same middleware, as the
         * same person, with deactivation and subscription state re-checked.
         */
        foreach (['Authorization', 'User-Agent'] as $header) {
            $value = $origin->headers->get($header);

            if (is_string($value) && $value !== '') {
                $server['HTTP_'.strtoupper(str_replace('-', '_', $header))] = $value;
            }
        }

        $request = Request::create(
            $path,
            $method,
            [],
            $origin->cookies->all(),
            [],
            $server,
            json_encode($payload, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION),
        );

        return $this->routeInternally($request, $method.' '.$path);
    }

    /**
     * The method and the path this action writes to, with its one placeholder
     * bound to the target's key.
     *
     * Every catalogue endpoint addresses exactly one row, so a route with two
     * parameters is a declaration this executor cannot honour — loud rather than
     * guessed, because guessing means writing to whatever the second segment
     * happened to resolve to.
     *
     * @param  array<string, mixed>  $entry
     * @return array{0: string, 1: string}
     */
    private function endpointFor(array $entry, Model $row): array
    {
        [$method, $uri] = $entry['endpoint'];

        $path = preg_replace(
            '/\{[^}]+\}/',
            rawurlencode((string) $row->getKey()),
            (string) $uri,
            -1,
            $count,
        );

        if ($count > 1) {
            throw new RuntimeException(sprintf(
                "'%s' takes more than one route parameter, and an action targets one row.",
                $uri,
            ));
        }

        return [strtoupper((string) $method), '/'.ltrim((string) $path, '/')];
    }

    /**
     * Run the request through the router — the real middleware, the real
     * controller.
     *
     * The container's `request` is rebound for the duration and restored
     * afterwards. Without that a controller type-hinting `Request` would be
     * handed the OUTER request by the container and would validate the Apply
     * payload instead of ours — the bug would look like the endpoint ignoring
     * every field it was sent. Rebinding also moves the URL generator onto the
     * sub-request and back, since it follows the same binding.
     *
     * Exceptions raised inside the route pipeline are already turned into
     * responses by `Illuminate\Routing\Pipeline`, so a FormRequest failure
     * arrives here as a 422 to be read rather than as a throw to be caught. A
     * route that does not resolve is a catalogue error, not a user error, and is
     * raised as one — `ActionCatalogueTest` checks every declared endpoint
     * against the registered routes precisely so this cannot reach production.
     *
     * THE KERNEL IS RESOLVED ON PURPOSE, and it is not a spare line. The router
     * knows middleware ALIASES from the service provider but learns the middleware
     * GROUPS only when the HTTP kernel is constructed — its constructor is what
     * calls `syncMiddlewareToRouter()`. Serving a real request always builds the
     * kernel first, so the omission is invisible in production and fatal
     * everywhere else: with no groups registered, `gatherRouteMiddleware()` leaves
     * the literal string 'api' in the pipeline and the container tries to resolve
     * a class named "api", which surfaces as a 500 from the endpoint rather than
     * as anything resembling its cause. The kernel is a singleton, so asking for
     * it costs nothing on the path that already has one.
     */
    private function routeInternally(Request $request, string $signature): Response
    {
        $container = app();
        $container->make(HttpKernel::class);

        $previous = $container->bound('request') ? $container->make('request') : null;

        $container->instance('request', $request);
        Facade::clearResolvedInstance('request');

        try {
            return Route::dispatch($request);
        } catch (NotFoundHttpException|MethodNotAllowedHttpException $e) {
            throw new RuntimeException(sprintf('%s is not a route this application registers.', $signature), 0, $e);
        } finally {
            if ($previous !== null) {
                $container->instance('request', $previous);
            }

            Facade::clearResolvedInstance('request');
        }
    }

    /**
     * The endpoint said no, and its words are the ones that get repeated.
     *
     * A controller refusing is not a bug to be swallowed and not a 500 to be
     * shown — it is the authority this design routes through doing its job, and
     * the only description of the objection that exists. `assertUniqueGroupName`
     * knows about a duplicate department name; the catalogue never will.
     *
     * @param  array<string, mixed>  $entry
     */
    private function refusalFor(int $status, Response $response, array $entry): ActionRefusedException
    {
        $said = $this->endpointMessage($response);
        $detail = $said === ''
            ? sprintf('"%s" was refused and nothing has changed.', $entry['label'])
            : sprintf('"%s" was refused: %s', $entry['label'], $said);

        return match (true) {
            $status === 401 || $status === 403 => ActionRefusedException::notPermitted($detail),
            $status === 404 => ActionRefusedException::notFound($detail),
            default => ActionRefusedException::rejected($detail),
        };
    }

    private function endpointMessage(Response $response): string
    {
        // Not every refusal is JSON — a middleware can answer with plain text or
        // with nothing at all, and the caller's fallback sentence covers that.
        $body = json_decode((string) $response->getContent(), true);

        if (! is_array($body)) {
            return '';
        }

        // The field errors first: Laravel's top-level `message` on a 422 is the
        // first of them anyway, and on a multi-field failure it is the more
        // specific of the two.
        foreach ((array) ($body['errors'] ?? []) as $messages) {
            foreach ((array) $messages as $message) {
                if (is_string($message) && trim($message) !== '') {
                    return trim($message);
                }
            }
        }

        $message = $body['message'] ?? null;

        return is_string($message) ? trim($message) : '';
    }

    /**
     * @param  array<string, mixed>  $entry
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $after
     */
    private function recordAudit(
        array $entry,
        string $key,
        Model $row,
        User $actor,
        Request $origin,
        string $question,
        array $before,
        array $after,
        string $endpoint,
        int $status,
    ): void {
        $this->audit->log(
            action: self::AUDIT_ACTION,
            actor: $actor,
            target: $row,
            metadata: [
                /*
                 * That it came from AI mode, and that a person nonetheless
                 * agreed to it. Both matter: the first is how somebody reviewing
                 * the trail finds every change made this way, and the second is
                 * why the change is attributable to a human at all.
                 */
                'ai_initiated' => true,
                'source' => 'ai_mode',
                /*
                 * `actor_user_id` is the durable answer and the name is the one
                 * a reader recognises — a snapshot of who they were at the time,
                 * which is what a trail wants. The email is deliberately not
                 * copied in: it is reachable through the actor relation, and a
                 * second copy of somebody's address in a JSON blob is one more
                 * place it has to be found when it changes.
                 */
                'confirmed_by' => [
                    'id' => $actor->getKey(),
                    'name' => (string) $actor->name,
                ],
                // The words that were typed. A change nobody remembers making is
                // explained by the request, not by the diff.
                'question' => $question,
                'action' => $key,
                'label' => (string) $entry['label'],
                'target' => ['id' => $row->getKey(), 'label' => $this->labelOf($row)],
                // Named so the trail says which authority actually wrote it.
                'endpoint' => $endpoint,
                'status' => $status,
                'before' => $before,
                'after' => $after,
            ],
            request: $origin,
        );
    }

    /**
     * The diff as it actually landed.
     *
     * `to` comes from the row afterwards rather than from the plan, because the
     * two can legitimately differ — input sanitisation, a controller normalising
     * a value — and reporting what we sent would describe a write nobody made.
     *
     * @param  list<array<string, mixed>>  $moved
     * @param  array<string, mixed>  $after
     * @return list<array<string, mixed>>
     */
    private function appliedChanges(array $moved, array $after): array
    {
        return array_map(static fn (array $change): array => [
            'field' => $change['field'],
            'label' => $change['label'],
            'from' => $change['from'],
            'to' => array_key_exists($change['field'], $after) ? $after[$change['field']] : $change['to'],
            'unit' => $change['unit'] ?? null,
        ], $moved);
    }

    /**
     * @param  list<array<string, mixed>>  $moved
     * @param  array<string, mixed>  $after
     */
    private function message(string $target, array $moved, array $after): string
    {
        $parts = [];

        foreach ($this->appliedChanges($moved, $after) as $change) {
            $unit = $change['unit'] === null ? '' : ' '.$change['unit'];

            $parts[] = sprintf(
                '%s changed from %s to %s%s',
                lcfirst((string) $change['label']),
                $this->render($change['from']),
                $this->render($change['to']),
                $unit,
            );
        }

        return count($parts) === 1
            ? sprintf('%s %s.', $target, $parts[0])
            : sprintf('%s: %s.', $target, implode('; ', $parts));
    }

    /** A value as a person reads it. Null is "nothing", never the empty string. */
    private function render(mixed $value): string
    {
        if ($value === null || $value === '') {
            return 'nothing';
        }

        return is_scalar($value) ? (string) $value : 'that';
    }

    private function labelOf(Model $row): string
    {
        $name = $row->getAttribute('name');

        return is_scalar($name) && trim((string) $name) !== ''
            ? trim((string) $name)
            : '#'.$row->getKey();
    }
}
