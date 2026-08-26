<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithApiResponses;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Audit\AuditLogService;
use App\Services\Auth\DeviceLabelService;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * "Where you are signed in" — the acting user's own live sessions.
 *
 * Scoped to the caller and nothing else. This is deliberately NOT an admin
 * surface over other people's devices: showing one person another's IP
 * addresses and sign-in times is a different feature with a different
 * authorization question, and building it as a side effect of this one is how
 * that question gets skipped. So these routes sit in auth.php with the rest of
 * the self-service endpoints, not in security.php, whose whole group is behind
 * `role:admin` — a session list placed there would inherit exactly the wrong
 * gate.
 *
 * Everything the response says is measured. There is no geolocation: turning
 * an IP into "Mumbai, India" means posting our users' addresses to a third
 * party every time somebody opens a settings screen, which is a data transfer
 * we are not making for a line of copy. The address is shown as itself, and
 * the device is parsed locally from the stored user agent.
 */
class UserSessionController extends Controller
{
    use InteractsWithApiResponses;

    /**
     * How recent counts as "right now" for the concurrent-use signal.
     *
     * Fifteen minutes, not five: `last_used_at` only moves once a minute (the
     * activity throttle in AuthenticateApiToken), and somebody reading one long
     * screen makes no requests for several minutes at a time. A five-minute
     * window would keep flickering off while both devices were plainly in use,
     * and a signal that flickers is one people learn to ignore.
     */
    private const CONCURRENT_WINDOW_MINUTES = 15;

    /**
     * How many sessions the list will return.
     *
     * Nothing capped this, and nothing had to until the table was looked at:
     * one production account holds 163 live tokens, because seven days of
     * sign-ins accumulate and only logout deletes one. A list that renders a
     * row per token answers "is anyone else on my account" with a wall of
     * identical entries, which is not an answer.
     *
     * Fifty, ordered by recency, is far more than a real person's device
     * count and small enough to read. `total_count` always reports the truth
     * so the client can say what it is not showing, and "sign out everywhere
     * else" clears the backlog in one act rather than fifty confirmations.
     */
    private const MAX_LISTED = 50;

    public function __construct(
        private readonly AuditLogService $auditLogService,
        private readonly DeviceLabelService $deviceLabels,
    ) {
    }

    /**
     * Every live session on this account, most recently used first.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $currentTokenId = $this->currentTokenId($request);

        $rows = $this->liveSessionsQuery($user)
            // Never select('*'). The token hash lives in this table, and a
            // select that takes whatever the table happens to have is one
            // schema change away from serialising it. Naming the columns means
            // a new secret column cannot leak through this endpoint by default.
            ->select([
                'id',
                'abilities',
                'created_ip',
                'created_user_agent',
                'last_ip',
                'last_used_at',
                'expires_at',
                'created_at',
            ])
            // Ordered by activity, falling back to creation for a session that
            // has never made a second request — otherwise a sign-in from thirty
            // seconds ago sorts to the bottom, which is the opposite of what
            // somebody checking "did that just happen" is looking for.
            ->orderByRaw('COALESCE(last_used_at, created_at) DESC')
            ->orderByDesc('id')
            ->limit(self::MAX_LISTED)
            ->get();

        $total = $this->liveSessionsQuery($user)->count();

        $sessions = $rows
            ->map(fn ($row) => $this->present($row, $currentTokenId))
            ->values()
            ->all();

        // An audit row for a read, which is unusual here and is on purpose:
        // this endpoint discloses the addresses an account has been used from,
        // and a break-glass engineer acting AS that user can reach it. "Who
        // looked at this" is a question that surface has to be able to answer.
        $this->auditLogService->log(
            action: 'auth.sessions_viewed',
            actor: $user,
            target: $user,
            metadata: ['session_count' => $total],
            request: $request,
        );

        return $this->successResponse([
            'data' => $sessions,
            // What is on this account, versus what is in `data`. Reporting
            // only the rows we chose to send would let a list quietly stop
            // mentioning sessions once somebody has enough of them, which is
            // exactly the account that needs to know.
            'total_count' => $total,
            'listed_count' => count($sessions),
            ...$this->concurrentUse($sessions),
        ]);
    }

    /**
     * Revoke one session.
     *
     * A token belonging to somebody else gets the SAME 404 as an id that does
     * not exist. Distinguishing them would turn this into an oracle for which
     * token ids are live across the whole deployment, and the caller's next
     * step is identical either way.
     *
     * NOT broadcast, deliberately. SessionRevoked can only address a whole
     * user: its channel is `user.{id}`, its payload carries nothing that
     * identifies a session, and the frontend handler clears credentials
     * unconditionally. Firing it here would sign every one of this person's
     * devices out because they revoked one — including the tab they clicked
     * from. Revoking one session while the others stay signed in is the entire
     * feature, so the revoked device instead discovers it on its next request
     * (a 401, within seconds of any real use) and an already-open notification
     * socket lingers until then. Giving the event a per-session discriminator
     * is the change that would make a broadcast correct; until it has one, not
     * broadcasting is the smaller failure.
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();

        $row = $this->liveSessionsQuery($user)
            ->where('id', $id)
            ->select(['id', 'abilities', 'created_user_agent'])
            ->first();

        if (! $row) {
            return $this->notFound();
        }

        $deleted = DB::table('personal_access_tokens')
            ->where('id', $row->id)
            ->where('tokenable_type', User::class)
            ->where('tokenable_id', $user->id)
            ->delete();

        if ($deleted === 0) {
            // Something removed it between the read and the write — a
            // concurrent logout, or the nightly prune. The session is gone
            // either way, which is what was asked for.
            return $this->notFound();
        }

        $wasCurrent = $this->currentTokenId($request) === (int) $row->id;

        $this->auditLogService->log(
            action: 'auth.session_revoked',
            actor: $user,
            target: $user,
            metadata: [
                // 'token_id', never 'token': AuditLogService redacts any key
                // literally named 'token', so the id would be stored as
                // '[REDACTED]' and the row would record nothing useful.
                'token_id' => (int) $row->id,
                'device' => $this->deviceLabels->describeToken(
                    $row->created_user_agent ?? null,
                    $row->abilities ?? null,
                ),
                'was_current_session' => $wasCurrent,
            ],
            request: $request,
        );

        return $this->successResponse([
            // The caller needs to know it has just revoked itself, so it can
            // clear its own credentials rather than fire the next request into
            // a 401 and look like a crash.
            'was_current_session' => $wasCurrent,
        ], $wasCurrent
            ? 'Signed out on this device.'
            : 'That device has been signed out.');
    }

    /**
     * Sign out everywhere except here.
     *
     * The one action that scales. Revoking sessions one at a time is fine for
     * the two or three a person recognises, and useless against the backlog a
     * seven-day token TTL accumulates — an account with 163 live tokens would
     * need 162 confirmations, so in practice nobody would do it and the list
     * would stay unreadable forever. This is also the thing somebody wants at
     * the moment they decide their password has leaked: everything but this
     * browser, now, without reading anything.
     *
     * EXPIRED ROWS GO TOO. They authenticate nothing, so deleting them is not
     * revocation, but leaving them behind means the prune's grace period
     * decides how long a signed-out device keeps showing up.
     *
     * The current session is kept by id. If we could not identify it — which
     * would mean the middleware did not set the token attribute — this refuses
     * rather than deleting every row including the caller's own: signing
     * somebody out of the browser they clicked "sign out my OTHER devices" in
     * is not a smaller version of what they asked for.
     *
     * Not broadcast, for the same reason destroy() is not; see above.
     */
    public function destroyOthers(Request $request): JsonResponse
    {
        $user = $request->user();
        $currentTokenId = $this->currentTokenId($request);

        if ($currentTokenId === null) {
            return response()->json([
                'success' => false,
                'message' => 'We could not tell which session you are using, so nothing was signed out.',
                'error_code' => 'CONFLICT',
            ], 409);
        }

        $revoked = DB::table('personal_access_tokens')
            ->where('tokenable_type', User::class)
            ->where('tokenable_id', $user->id)
            ->where('id', '!=', $currentTokenId)
            ->delete();

        $this->auditLogService->log(
            action: 'auth.other_sessions_revoked',
            actor: $user,
            target: $user,
            metadata: [
                'revoked_count' => $revoked,
                // 'token_id', never 'token' — AuditLogService redacts any key
                // literally named 'token'.
                'kept_token_id' => $currentTokenId,
            ],
            request: $request,
        );

        return $this->successResponse(
            ['revoked_count' => $revoked],
            $revoked === 1
                ? 'One other device has been signed out.'
                : $revoked.' other devices have been signed out.',
        );
    }

    /**
     * Live sessions only — the same expiry filter AuthenticateApiToken applies.
     *
     * An expired row cannot authenticate anything, so listing it would invite
     * somebody to revoke a session that is already dead and leave a live one
     * alone. It is housekeeping for the prune command, not a session.
     */
    private function liveSessionsQuery(User $user): Builder
    {
        return DB::table('personal_access_tokens')
            ->where('tokenable_type', User::class)
            ->where('tokenable_id', $user->id)
            ->where(function ($query) {
                $query->whereNull('expires_at')
                    ->orWhere('expires_at', '>', now());
            });
    }

    /**
     * @return array<string, mixed>
     */
    private function present(object $row, ?int $currentTokenId): array
    {
        return [
            'id' => (int) $row->id,
            'device' => $this->deviceLabels->describeToken(
                $row->created_user_agent ?? null,
                $row->abilities ?? null,
            ),
            // Where it is answering from now, falling back to where it signed
            // in. Both are recorded facts; neither is inferred.
            'ip' => $row->last_ip ?? $row->created_ip ?? null,
            'signed_in_ip' => $row->created_ip ?? null,
            'last_used_at' => $this->iso($row->last_used_at ?? null),
            'created_at' => $this->iso($row->created_at ?? null),
            // Remember-me and a plain sign-in produce genuinely different
            // lifetimes (7 days versus 12 hours) from the same login form, so
            // the client gets the real value rather than a blanket sentence
            // that would be wrong for half the rows.
            'expires_at' => $this->iso($row->expires_at ?? null),
            'is_current' => $currentTokenId !== null && (int) $row->id === $currentTokenId,
        ];
    }

    /**
     * "Is another machine using this account right now."
     *
     * Counts DISTINCT devices active in the window. Devices are grouped by
     * ADDRESS first, and within an address by label, so two browsers at one
     * address still count as two (an over-report we keep on purpose — see
     * below) while two windows onto the same machine count as one.
     *
     * OUR OWN DESKTOP SHELL DOES NOT ADD A DEVICE. The tracker and a browser
     * on one PC share an address and differ only in label, so pairing address
     * with label counted them as two — and since running the tracker all day
     * is what the desktop product IS, the banner was on permanently for the
     * people most likely to see it. A signal that is always on carries nothing,
     * and the day somebody really did sign in from elsewhere it would have
     * looked exactly like yesterday. So a desktop-shell session at an address
     * where the account is already active adds nothing; alone at an address it
     * still counts as the one device it is.
     *
     * The remaining known error is the opposite one: two PCs behind a single
     * office NAT, running the same browser and OS, collapse into one. That
     * under-reports, and it is the error to accept — the alternative was
     * over-reporting on every tracked employee every day, which is how a
     * warning gets trained out of people.
     *
     * A session with no `last_used_at` is not counted. It has authenticated
     * nothing since it was minted, so it is not in use by any reading.
     *
     * @param  array<int, array<string, mixed>>  $sessions
     * @return array<string, mixed>
     */
    private function concurrentUse(array $sessions): array
    {
        $threshold = now()->subMinutes(self::CONCURRENT_WINDOW_MINUTES);

        /** @var array<string, array{labels: array<string, true>, desktop: bool}> $byAddress */
        $byAddress = [];

        foreach ($sessions as $session) {
            $lastUsed = $session['last_used_at'] ?? null;

            if ($lastUsed === null) {
                continue;
            }

            try {
                if (Carbon::parse($lastUsed)->lessThan($threshold)) {
                    continue;
                }
            } catch (\Throwable) {
                continue;
            }

            $address = $session['ip'] ?? 'unknown-ip';
            $byAddress[$address] ??= ['labels' => [], 'desktop' => false];

            if ($session['device'] === DeviceLabelService::DESKTOP) {
                $byAddress[$address]['desktop'] = true;

                continue;
            }

            $byAddress[$address]['labels'][$session['device']] = true;
        }

        $count = 0;

        foreach ($byAddress as $address) {
            // The tracker only counts where nothing else at that address does.
            $count += count($address['labels']) ?: 1;
        }

        return [
            'concurrent_use' => $count > 1,
            'active_device_count' => $count,
            'concurrent_window_minutes' => self::CONCURRENT_WINDOW_MINUTES,
        ];
    }

    private function currentTokenId(Request $request): ?int
    {
        $token = $request->attributes->get('access_token');

        return isset($token->id) ? (int) $token->id : null;
    }

    /**
     * Query-builder rows hand back raw driver values — a string on PostgreSQL,
     * a differently shaped string on SQLite, and occasionally a DateTime.
     * Normalise once, here, so no client is ever asked to guess.
     */
    private function iso(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        try {
            return Carbon::parse($value)->toIso8601String();
        } catch (\Throwable) {
            return null;
        }
    }

    private function notFound(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => 'That session was not found.',
            'error_code' => 'NOT_FOUND',
        ], 404);
    }
}
