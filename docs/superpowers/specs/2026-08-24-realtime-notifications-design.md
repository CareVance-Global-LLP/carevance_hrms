# Real-time notifications — design

**Date:** 2026-08-24
**Status:** Approved for implementation (sub-project 1)
**Scope of this document:** sub-project 1 of 4. The decomposition is recorded
here because the ordering carries reasoning; sub-projects 2–4 get their own
specs.

---

## The complaint, and what it actually was

> "notifications are not coming quickly, they are coming in 10 sec like a delay"

The measured delay is **30 seconds**, not 10. Notification toasts fire only
from `Layout.tsx`'s `loadAlerts` poll, which runs a five-endpoint batch every
30s and only while the tab is visible. The 10s the user perceived is the chat
*thread-list* poll in `Chat.tsx`. Messages inside an already-open thread
refresh at 2.5s, which is why chat feels responsive right up until you navigate
away from it.

Nothing real-time exists anywhere in the stack: no Reverb, no Pusher, no Echo,
no socket library, and `BROADCAST_CONNECTION=log`. `routes/channels.php` and
`config/broadcasting.php` do not exist. This is greenfield.

## Decomposition

Four asks arrived together. They are not one project.

| # | Sub-project | Delivers | Depends on |
|---|---|---|---|
| **1** | **Reverb real-time transport** (this spec) | Sub-second notification delivery on web, desktop and mobile while open | — |
| 2 | Chunked resumable upload + progress | 200 MB attachments that actually work; live progress | — |
| 3 | Rich notification payload + previews | WhatsApp-style thumbnail and "Photo" summaries | 1, 2 |
| 4 | Web Push + reply-from-notification | Closed-browser delivery; Reply box on web and desktop (see §5 — mobile has no chat to reply into) | 3 |

**Order: 1 → 2 → 3 → 4.**

Two orderings are counter-intuitive and deliberate:

- **2 before 3.** Sub-project 3 generates thumbnails at upload time. Building
  that against today's single-POST upload path means writing it twice, because
  2 replaces that path. 2 also fixes a bug biting users *now* (below).
- **4 last.** It is the only piece with genuine platform risk — Windows
  Electron inline reply needs raw `toastXml` and a registered AUMID, and may
  have to degrade to click-to-open. That risk belongs after three certain wins,
  not in front of them.

### Two live bugs found while scoping

Both are real today and are fixed by sub-project 2, not this one. Recorded so
they are not lost:

1. **The 200 MB attachment limit is fiction.** `Chat.tsx` and
   `SendChatMessageRequest` (`max:204800`) both claim 200 MB. PHP caps uploads
   at **2 MB** in local dev and **10 MB** in production
   (`deploy/lightsail/final-fix.sh:169`). Above the ceiling PHP discards the
   body *before Laravel runs*, so the files array is empty and the validator
   reports "no attachment" — the user gets a confusing error rather than a size
   error.
2. **Notifications carry no attachment metadata.** `ChatService` sends the
   literal string `'Sent an attachment'` with no name, mime, size or thumbnail,
   so no client can render a preview.

---

# Sub-project 1 — Reverb real-time transport

## Why Reverb

Laravel 12.64 on PHP 8.5 — Reverb is first-party and fully supported. It speaks
the Pusher protocol, so `laravel-echo` + `pusher-js` work unchanged on web and
desktop, and the desktop app inherits it for free because it ships the same web
bundle.

The alternatives were considered and rejected:

- **Tighter polling** — cheapest, but the user explicitly asked for true push.
- **SSE** — sub-second with no new service, but holds a PHP-FPM worker per
  connected user for the life of their session. 50 concurrent users needs 50+
  workers. Cheap to write, expensive to run.

**The daemon concern was raised and is smaller than it first appeared.**
CLAUDE.md warns that long-running processes get forgotten — the
timers-run-all-night bug. That is a *local dev* problem: production is
docker-compose and already runs `queue` and `scheduler` as services. A `reverb`
service is one more block in a file that already has this pattern twice. The
local-dev risk is handled by the degradation path in §4.

## 1. Channel design

**One channel per user: `private-user.{id}`.** The authorization callback is
`(int) $user->id === $id` and nothing else.

Every `app_notifications` row is already per-user, so the mapping is 1:1 — and
there is **no org-level channel, therefore no cross-tenant leak surface**. Given
how structural tenancy is in this codebase (97 models on
`BelongsToOrganization`), not introducing a broadcast surface that could span
tenants is worth more than any convenience a shared channel would buy.

**Chat messages ride the same user channel** rather than getting
`private-conversation.{id}`. `ChatService` already resolves the recipient list
before writing notification rows; broadcasting to each recipient's own channel
reuses that logic exactly and adds zero new authorization surface. A
per-conversation channel would need its own membership check — a second place
for a tenancy mistake to live.

It also produces the behaviour actually asked for: the unread badge updates
live **even when the user is not on the Chat page**.

Cost: a 50-person group is 50 channel publishes. Laravel batches up to 100
channels per publish call, so that is one HTTP call to Reverb, not 50.

## 2. One insertion point

`AppNotificationService::sendToUsers()` is the choke point for every
notification in the product — leave approvals, task assignment, time-edit
requests, payslip delivery, announcements and chat. Broadcasting from there
gives every type real-time delivery from a single change, and any future caller
inherits it without knowing broadcasting exists.

The event is `NotificationCreated`, implementing **`ShouldBroadcastNow`, not
`ShouldBroadcast`**:

- `ShouldBroadcast` queues the broadcast, so delivery inherits queue-worker
  latency — and defeats the entire point of the sub-project on any deployment
  where the worker is busy or briefly down.
- `ShouldBroadcastNow` publishes inline to Reverb over the local docker network
  (~5ms). It adds that to the request that created the notification, which for
  a chat send is not perceptible.

`broadcastOn()` returns the recipient channels — the same filtered list that
`shouldStoreNotification()` produced, so a user who has muted a notification
type gets neither a row nor a broadcast. **This must be asserted by a test**;
it is the easiest thing to get wrong when adding a broadcast to an existing
write path.

## 3. Broadcasting auth

This is the part that does not work out of the box, and the reason is specific
to this codebase.

**There is no Sanctum.** The only guard in `config/auth.php` is `web`/session.
The API authenticates through a custom `AuthenticateApiToken` middleware that
reads a Bearer token (or the `carevance_api_token` cookie), hashes it against
`personal_access_tokens`, and additionally enforces deactivation, break-glass
session validity, and subscription state.

So Laravel's default `/broadcasting/auth` route is wrong twice:

1. **Wrong guard.** It would authenticate against the session guard, which no
   API caller ever populates.
2. **Wrong path.** Caddy proxies only `/api/*` to the backend
   (`deploy/lightsail/Caddyfile`). `/broadcasting/auth` would reach the frontend
   nginx container and 404.

**Resolution:** register the auth route explicitly inside the existing
`api.token` group in `routes/api.php`, giving `/api/broadcasting/auth`. It then
inherits the full middleware stack — token validation, deactivation refusal,
`mfa.enrolled`, subscription state — exactly as every other authenticated
endpoint does. No Caddy change is needed for auth.

Echo is configured with an `authorizer` that attaches the same Bearer header the
axios request interceptor uses, read from the same `getStoredAuthValue('token')`.

## 4. Recovery: sequence-based catch-up, not a timer

A socket is the fast path, never the only path. Sockets drop for reasons
unrelated to application code: Wi-Fi to LTE handoff, laptop sleep, proxy idle
timeouts, and every deploy. A transport with no recovery path does not fail
loudly — it silently stops delivering, which is the failure mode this codebase
has already been bitten by twice (the scheduler bug; the "keep last known badge
counts" comment in `Layout.tsx`).

The recovery path is **sequence-based catch-up**, the model Discord (`RESUME`
plus sequence number) and Slack use — not a timed reconcile:

| Socket state | Behaviour |
|---|---|
| Connected and healthy | Events only. **Zero HTTP polling.** |
| On connect / reconnect | **One** `GET /notifications?since_id=N` fetching the exact gap. |
| Cannot connect at all | Degrade to the **existing 30s** `loadAlerts` poll. |
| Tab hidden → visible | Immediate refresh, unchanged from today. |

This is strictly better than a periodic reconcile: fewer requests while healthy,
and *exact* recovery rather than a guess. The client already has the
`latestMessageIdRef` / `seenNotificationIdsRef` pattern to build the watermark
on.

**The degraded poll stays at 30s — today's interval — not slower.** An earlier
draft of this spec said 60s on the reasoning that a backstop should be cheap.
That is a regression disguised as an optimisation: if Reverb is down, users
would get notifications *later than they do today*, and the change would have
made the product worse on exactly the day the new daemon failed. The rule is
that the degraded path is never worse than the status quo it replaced.

The degraded branch is not a nicety. It is what keeps local dev working when
nobody has run `reverb:start`, and what keeps the product working behind a
corporate proxy that blocks WebSocket upgrades.

### `since_id` does not exist yet

`ListNotificationsRequest` accepts `limit`, `type`, `exclude_types`, `q` and
`unread_only` — there is no watermark parameter, and `NotificationController::index`
has nothing to filter on. **The catch-up call is new backend work, not reuse of
an existing endpoint.** It needs:

- `since_id` added to `ListNotificationsRequest` (`nullable|integer|min:0`).
- `NotificationController::index` filtering `where('id', '>', $sinceId)` when
  present, ordered ascending so the client can advance its watermark
  deterministically.
- The same `limit` cap (max 100) applies. A client returning from a long
  disconnect can exceed it, so the response reports whether more remain; the
  client repeats until drained rather than assuming one call is the whole gap.
  Silently truncating the catch-up would lose notifications permanently — worse
  than the delay this whole sub-project exists to remove.

**Connection state is visible.** A subtle "reconnecting" affordance in the
header — not a banner — whenever the client is on the degraded path. This is the
health signal that makes a dead daemon discoverable instead of invisible.

`pusher-js` provides exponential backoff with jitter and protocol-level
heartbeats natively; no reconnect logic is hand-written.

## 5. Mobile: foreground/background handover

- **Foreground:** Echo, over the same `private-user.{id}` channel.
- **Background:** Expo push. **Already built** (`ExpoPushService`,
  `usePushNotifications`) and unchanged by this work.

**The trap is double-delivery.** While the app is foregrounded, Echo renders the
notification *and* the Expo push banner arrives for the same event. The fix is
deduplication by notification id, not by timing:
`usePushNotifications.tsx` already owns `setNotificationHandler`, which
suppresses the banner for any `notification_id` the socket has already rendered.

**AS BUILT — the dedupe key is `broadcast_id`, not `notification_id`.**

This section originally called for per-recipient `notification_id` in the Expo
push payload, which would have required changing `AppNotification::insert()` to
capture generated ids. Implementation found a better key already in the schema.

The row id differs per recipient; the content does not. Putting a
`user_id => notification_id` map in the broadcast payload would hand every
recipient the other recipients' ids over their own private channel — a small
leak with no upside in an HR product. It would also make the payload
recipient-specific, forcing one publish per person instead of one publish per
100 channels.

`broadcast_id` is identical across every recipient of a single publish, so it
solves both: one batched publish, no cross-recipient identifiers, and a stable
key the Expo push and the socket event can both carry. `sendToUsers()` now
mints one whenever the caller supplies none — previously only
`/notifications/publish` set it, leaving chat and every service-originated
notification with null.

The event therefore carries `{ broadcast_id, type }` and nothing else. It is a
signal that something arrived; the client fetches the rows through the API it
already uses, which keeps one rendering path rather than two that must be kept
in step, and means mark-read works because real ids are present.

### Mobile has no chat, and this has two consequences

The mobile app's screens are `approval-inbox`, `attendance`, `comp-off`,
`leave`, `notifications`, `payslip` and `regularization`. **There is no chat
screen and no chat endpoint in `mobile-app/src/api/endpoints.ts`.** Chat is a
web and desktop feature.

1. **A chat notification on mobile routes nowhere — today, already.** The push
   is delivered and the row appears in the notifications list, but
   `handleNotificationResponse` does `router.push(data.route)` and `/chat` is
   not a route that exists. This is a pre-existing bug, not one this
   sub-project introduces, and it is not fixed here. It is recorded so it is
   not mistaken for a regression caused by this work.
2. **Sub-project 4's reply-from-notification cannot include mobile.** There is
   nothing to reply *into*. Mobile reply requires a mobile chat client first —
   a fifth project that nobody has scoped or asked for. Sub-project 4 therefore
   covers reply on **web and desktop only**, and its spec must say so rather
   than discovering it during implementation.

Everything else in this sub-project is unaffected: notifications for leave,
approvals, payslips and announcements all have mobile screens and work as
described.

## 6. Deployment

- **`reverb` service** in `deploy/lightsail/docker-compose.yml` — same image and
  shape as the existing `queue` and `scheduler` services, running
  `php artisan reverb:start --host=0.0.0.0 --port=8080`.
- **Caddy** gains `handle /app/* { reverse_proxy reverb:8080 }`. Caddy already
  terminates TLS and upgrades WebSockets transparently, so `wss://` needs no
  further work.
- **Client config** flows through `window.__APP_CONFIG__` / `runtimeConfig.ts`
  like every other runtime setting, so the same build works in every
  environment. New keys: `VITE_REVERB_KEY`, `VITE_REVERB_HOST`,
  `VITE_REVERB_PORT`, `VITE_REVERB_SCHEME`.
- **`.env.example`** gains `BROADCAST_CONNECTION=reverb` and the `REVERB_*` set.
- **CLAUDE.md** gains the daemon in its "processes you must actually run"
  section, beside the queue worker and the scheduler. That section exists
  because these get forgotten; adding a third without documenting it there
  repeats the exact mistake the section was written about.

## 7. One security consequence, and its fix

Channel authorization happens **once, at subscribe time**. An already-open
socket therefore survives token revocation: a SCIM-deprovisioned leaver keeps
receiving notifications for as long as their tab stays open.

That is precisely the failure CLAUDE.md says SCIM exists to prevent — "a flag
alone leaves a leaver's existing token reading payroll on Monday". Introducing
a transport that reopens it would be a regression against a documented product
commitment.

**Fix:** a `force-disconnect` event on the user's own channel, emitted when
`deactivated_at` is set or personal access tokens are revoked. The client tears
down the socket and clears auth storage on receipt. Covered by a test.

## 8. Verification

Backend:

- Channel authorization: user A cannot subscribe to `user.B`.
- `sendToUsers()` broadcasts only to recipients that `shouldStoreNotification()`
  retained — a muted user receives no row *and* no broadcast.
- Broadcast channels match the stored rows exactly (no over-broadcast).
- `force-disconnect` fires on deactivation and on token revocation.
- `/api/broadcasting/auth` refuses an expired token, a revoked token, and a
  deactivated user.
- `GET /notifications?since_id=N` returns only rows above the watermark, in
  ascending id order, and is still scoped to the calling user.
- A gap larger than `limit` reports that more remain rather than truncating
  silently.

Frontend:

- The Echo event updates badge state and raises a desktop notification.
- Reconnect issues exactly one `since_id` catch-up call, not a poll.
- A catch-up that reports more remaining is drained to completion.
- Failure to connect enables the 30s degraded poll; a successful connect
  disables it.
- The connection-state affordance renders only on the degraded path.

Mobile:

- A push whose `notification_id` was already delivered over the socket does not
  raise a second banner.

**Gating:** compare failing test *names* against the committed baseline
(`.github/baselines/phpunit.txt`) via `scripts/ci/test-baseline.mjs`. Never
compare counts — both suites carry a known tail (36 backend, 49 frontend).

## Out of scope for sub-project 1

Named explicitly so they are not smuggled in:

- Web Push / Service Worker / closed-browser delivery → sub-project 4.
- Reply-from-notification → sub-project 4.
- Attachment previews and thumbnails → sub-project 3.
- Chunked upload and progress → sub-project 2.
- Live typing indicators and presence. Reverb makes these cheap and they are
  tempting; they are not what was asked for and they are not free to get right.
- Replacing the 2.5s in-thread message poll in `Chat.tsx`. It will become
  redundant once chat events arrive over the socket, but removing it is a
  separate change with its own regression risk, and it is not what makes the
  product feel slow.
