<?php

namespace App\Services\Ai\Actions;

use App\Http\Middleware\EnsureUserHasRole;
use App\Models\User;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Whether this person may run this action — asked at preview, and asked again
 * at execution.
 *
 * §4: "PERMISSION IS CHECKED AGAINST THE ACTING USER, TWICE. Once when building
 * the preview, so an unauthorised person is told immediately rather than after
 * composing a change; and once at execution, because the two are separate
 * requests and a role can change between them."
 *
 * Twice means two CALLS, not two implementations. Written out in both places,
 * the two would eventually disagree, and the disagreement is silent in either
 * direction: a preview stricter than the executor turns people away from
 * something they may do, and a preview looser than the executor walks them
 * through a diff and refuses at the end. So it is written once, here.
 *
 * BOTH the capability and the route's own gate, because they are not the same
 * set. `settings.manage` is granted to admin, hr and payroll_manager while the
 * leave-type route is `role:admin` — checking the capability alone lets an HR
 * user compose a change the endpoint will 403.
 *
 * @see docs/superpowers/specs/2026-08-26-ai-write-actions.md §4
 */
class ActionPermission
{
    /**
     * @param  array<string, mixed>  $entry  a catalogue entry
     *
     * @throws ActionRefusedException
     */
    public static function assert(User $actor, array $entry): void
    {
        $permission = (string) $entry['permission'];

        if (! $actor->hasPermission($permission)) {
            // The permission is NAMED. "Forbidden" leaves an admin guessing
            // which of thirty capabilities to grant.
            throw ActionRefusedException::notPermitted(sprintf(
                "\"%s\" needs the '%s' permission, which you do not have.",
                $entry['label'],
                $permission,
            ));
        }

        $roles = array_values(array_filter((array) ($entry['roles'] ?? [])));

        if ($roles !== [] && ! self::passesRoleGate($actor, $roles)) {
            throw ActionRefusedException::notPermitted(sprintf(
                '"%s" is limited to %s.',
                $entry['label'],
                self::englishList($roles),
            ));
        }
    }

    /**
     * The gate is the middleware ITSELF, called directly.
     *
     * A copy of its hierarchy map here would drift the first time that map
     * changed — and it has changed, twice, each time because a role was missing
     * from it. Both drifts would be silent: too generous refuses nobody here and
     * 403s at the endpoint, too strict refuses somebody the endpoint would have
     * let through.
     *
     * @param  list<string>  $roles
     */
    private static function passesRoleGate(User $actor, array $roles): bool
    {
        $request = Request::create('/', 'GET');
        $request->setUserResolver(static fn () => $actor);

        $response = app(EnsureUserHasRole::class)->handle(
            $request,
            static fn () => new Response('', 200),
            ...array_map(static fn ($role): string => (string) $role, $roles),
        );

        return $response->getStatusCode() !== 403;
    }

    /** @param  list<string>  $items */
    private static function englishList(array $items): string
    {
        if (count($items) === 1) {
            return $items[0];
        }

        $last = array_pop($items);

        return implode(', ', $items).' and '.$last;
    }
}
