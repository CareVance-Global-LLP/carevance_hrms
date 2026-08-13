# Desktop Timeline Fidelity Design

Phase 5 of the rollout begun in
[2026-04-21-exact-activity-tracking-rollout-design.md](2026-04-21-exact-activity-tracking-rollout-design.md).
That document moved desktop tracking from cumulative duration snapshots to exact
start/end sessions and added the browser extension. Its architecture, canonical
rules and non-goals still hold; nothing here replaces them.

## Summary

Three increments that make the desktop app timeline accurate enough to defend,
in this order:

1. **Transport and coverage** — buffer sessions locally, upload in idempotent
   batches, and account for every second of a tracked timer explicitly.
2. **Switch fidelity** — remove the blocking work from the foreground watcher,
   cut switch misattribution from up to 1000 ms to under 250 ms, and store
   millisecond precision.
3. **Activity signal** — count keyboard and mouse events per session, and
   report active and passive time separately.

## The thesis

Competing trackers — Hubstaff, Time Doctor, ActivTrak, DeskTime, Insightful —
already do per-app foreground segments, window titles and productivity
classification. CareVance has all three. Matching them feature-for-feature is
not a differentiator.

What CareVance has that they do not is `ProductivityPayrollService`: this
timeline is an input to pay. A timeline that feeds payroll has to answer "where
did the other six minutes go?", and today it cannot — an unexplained gap is
indistinguishable from a gap that was correctly recorded as idle.

So the differentiator is not more surveillance. It is an **auditable** timeline:
every second of a tracked timer resolves to a named state, and the states that
mean "we do not know" say so out loud. This follows the existing rule from Phase
1 that an explicit fallback label beats a confident wrong one, and extends it
from labels to time itself.

## Goals

- No silent time loss: for any time entry, the sum of accounted seconds and
  explicitly-unaccounted seconds equals its duration.
- App-switch misattribution under 250 ms.
- Sub-second app visits survive as merged detail rather than disappearing.
- A per-session activity signal that resists mouse jigglers and does not punish
  reading.
- Session upload survives network loss, rapid switching and process death
  without duplicating or dropping rows.

## Non-goals

- Keystroke *content* logging, screen OCR, or anything else in the Teramind
  category. Counts only, never content. Reversing this needs an explicit written
  decision like the one recorded in `config/screenshots.php`.
- macOS or Linux support. The desktop build targets Windows NSIS only.
- Replacing `get-windows` with a native focus-hook addon. Evaluated and
  deferred — see Risks.
- Removing the legacy `activities` read fallback. Phase 2 of the predecessor
  deliberately kept it during the session-first migration.
- Changing the browser-extension path. Website sessions already arrive from real
  browser events.

## Increment 1: Transport and coverage

### Why this is first

Today each foreground change is its own HTTP round-trip
(`activitySessionApi.create`, then a close on the next change). Two consequences:

- A network blip loses the session outright. There is no retry and no buffer, so
  the timeline gets a hole.
- Increment 2 makes switches *more* frequent. Doing it before fixing transport
  multiplies the number of failures.

There is an offline SQLite store (`desktop/offline/offline-db.cjs`) with an
`app_usage` table, a sync queue and IPC plumbing — and **zero callers**. It
posts to `POST /api/activities`, the legacy flat model, while the live path
writes `activity_sessions`. Reviving it would make the timeline disagree with
itself depending on whether the user was online. It is deleted, not revived.
The legacy `activities` *read* fallback is untouched.

### Local buffer

Sessions are written to a new `pending_activity_sessions` table in the existing
offline database, shaped to `activity_sessions` rather than to the legacy model.

`offline-db.cjs` persists by exporting the whole database and rewriting the file
(`db.export()` then `writeFileSync`). At one write per app switch that rewrites
the entire file on every switch. The buffer therefore accumulates in memory and
persists on whichever comes first:

- 25 buffered sessions,
- 30 seconds since the last persist,
- any app lifecycle event that could lose memory (`before-quit`, `suspend`,
  `lock-screen`).

Losing up to 30 seconds of buffered sessions to a hard kill is acceptable; the
coverage record in the next section makes that loss visible rather than silent.

### Idempotent batch upload

New endpoint: `POST /api/activity-sessions/batch`.

- Body: `{ sessions: [...] }`, at most 200 per request.
- Every session carries a client-generated `client_uuid` (UUIDv4, minted when
  the session opens).
- `client_uuid` gets a unique index. Insert is an upsert on it, so a retry after
  a timeout that actually succeeded cannot double-count.
- Partial success is explicit: the response reports accepted and rejected
  `client_uuid`s. The client only clears what was accepted.

`store` and `update` remain for the live online path; the batch endpoint is the
recovery and bulk path.

### Coverage records

A new `activity_coverage` table records what the tracker believed it was doing,
independent of what it observed:

| Column | Meaning |
|---|---|
| `user_id`, `time_entry_id` | scope |
| `state` | one of the states below |
| `started_at`, `ended_at` | ms precision |
| `reason` | free text for `unmonitored`, e.g. `screen-permission-denied` |

States:

- `monitored` — the watcher was running and reporting.
- `suspended` — machine slept or locked. `powerMonitor` already emits
  `suspend`/`resume`/`lock-screen`/`unlock-screen`; they are wired for
  auto-stop but not recorded as coverage.
- `unmonitored` — the tracker was running but could not determine the
  foreground window.
- `buffered` — captured locally, not yet uploaded. Transient.

`gap` is not stored. It is derived server-side as the part of a time entry no
coverage row claims, which is exactly the case where the tracker was not running
at all and so could not have written anything.

A time entry's coverage percentage becomes a first-class, queryable number.

### Clock trust

Each session and coverage row records `client_reported_at` alongside the
server's received-at timestamp, and the batch request carries the device's
monotonic uptime. A device clock that disagrees with the server, or jumps, is
then detectable after the fact instead of silently corrupting a payroll input.

No enforcement in this increment — record first, decide policy once there is
data.

## Increment 2: Switch fidelity

### Unblock the watcher

`getProcessDescription` and `getAllProcessesWithWindows` call `execSync` with
PowerShell, with 2 s and 5 s timeouts, **on the Electron main process** — the
same process running the 1 s poll. A slow PowerShell start delays or skips
foreground detection outright. This is a correctness bug, not a performance
nicety.

Changes:

- Move both to `execFile` with a callback; never block.
- The description is cosmetic metadata. Fetch it off the hot path and attach it
  when it arrives; a session opens immediately with the app name it already has.
- `processMetadataCache` already memoises per process name and is kept.

### Poll interval and precision

- `FOREGROUND_WINDOW_POLL_INTERVAL_MS` 1000 → 250, behind a constant so it can
  be tuned without a code hunt.
- `activity_sessions.duration_seconds` (unsigned int) → `duration_ms`
  (unsigned bigint), with `started_at`/`ended_at` at millisecond precision.
  `duration_seconds` becomes a generated read-only column for existing readers
  during migration.

250 ms is a deliberate stopping point. It brings worst-case misattribution to
250 ms — below the 100–300 ms of human intent behind a deliberate app switch,
and well below the clock skew between a laptop and the server. Chasing lower
buys precision the surrounding system cannot honour.

### Flicker merging

At 250 ms, alt-tabbing through several windows produces many very short
sessions. Dropping them loses the fact that it happened; keeping each as a row
buries the timeline.

Sessions shorter than 1000 ms are merged into an adjacent session of the same
app when one exists within 5 seconds. Otherwise they are kept, with
`metadata.flicker = true`. Nothing is discarded — the timeline stays complete
and the UI can collapse flicker runs.

## Increment 3: Activity signal

### Mechanism

`uiohook-napi` provides a global input hook. It counts:

- key-down events, discarding which key,
- mouse button and movement events.

Content is never read, stored or transmitted. The hook is started only while a
timer is running and stopped the moment it stops.

### What is stored

Added to `activity_sessions`:

- `keyboard_count`, `mouse_count` — raw event counts.
- `input_seconds` — the number of distinct one-second buckets within the session
  containing at least one input event.

`input_seconds / duration_seconds` is the activity ratio. It is the headline
number because it is far harder to inflate than raw counts: a mouse jiggler or a
held key produces a large `mouse_count` or `keyboard_count` but cannot exceed
one input-second per second. Raw counts are retained because they distinguish
typing from clicking, which is genuinely useful for classification.

### How it is presented

Active and passive time are shown **separately**, never blended into a single
productivity score. A session with low input is passive, not unproductive —
reading a specification, reviewing a design, sitting in a call. Conflating those
is the standard and deserved criticism of activity-percentage metrics, and an
HRMS whose timeline feeds payroll should not repeat it.

The UI states plainly that activity measures input, not value.

### Disclosure

Input counting is a material change in what is collected. It ships with:

- an explicit employee-facing disclosure in the tracker,
- an organization setting, defaulting **off**, so an organization opts in,
- a line in the same place `config/screenshots.php` records the capture-interval
  reasoning.

## Data model changes

| Table | Change |
|---|---|
| `activity_sessions` | `+ client_uuid` (unique), `+ duration_ms`, `+ keyboard_count`, `+ mouse_count`, `+ input_seconds`, `+ client_reported_at`; `started_at`/`ended_at` to ms precision |
| `activity_coverage` | new |
| offline `pending_activity_sessions` | new, replaces the dead `app_usage` path |
| legacy `activities` | untouched; read fallback preserved |

Migrations are additive. `duration_seconds` survives as a generated column so
`UsageProcessingService` and existing reports keep working unchanged until they
are migrated deliberately.

## Testing strategy

Per increment, gated on failing-test-name diffs against the committed baselines
rather than counts.

**Increment 1**
- A batch replayed twice inserts one row per `client_uuid`.
- A partially rejected batch clears only accepted rows from the buffer.
- Killing the process with a full buffer loses at most the un-persisted window,
  and the lost span appears as a derived gap rather than vanishing.
- Coverage plus gaps equals the time entry duration, exactly, for a synthetic
  day including a sleep and a permission failure.
- The legacy offline `app_usage` path is gone and nothing references it.

**Increment 2**
- A foreground change is reflected within 250 ms of the OS reporting it.
- A slow PowerShell description does not delay session opening (inject a
  deliberately slow lookup).
- A 300 ms visit to an app already seen 2 s earlier merges; an isolated 300 ms
  visit is retained and flagged.
- `duration_seconds` equals `duration_ms` truncated to whole seconds, and a
  900 ms session therefore reads as 0 seconds to a legacy reader while
  `duration_ms` retains it. Asserted explicitly, because that truncation is the
  compatibility cost of keeping old readers working.

**Increment 3**
- `input_seconds` never exceeds the session's elapsed seconds, under a
  synthetic 1 kHz event storm — the jiggler-resistance property.
- No key identity appears in any stored field or request body.
- With the org setting off, the hook is never started.
- Stopping the timer stops the hook.

## Risks

**Native module packaging.** `uiohook-napi` is the only node-gyp dependency this
project would have. `npmRebuild: false`, `asar: true`, and the current deps are
deliberately native-free (`get-windows` ships prebuilds; `sql.js` is WASM). This
is why Increment 3 is last: if prebuilds fight electron-builder or auto-update,
increments 1 and 2 have already shipped. Mitigation: verify a packaged NSIS
build on a clean machine before any of Increment 3 merges, not after.

**A native focus-hook addon was considered and rejected for now.** Windows
`SetWinEventHook` via a native addon would give ~10 ms detection instead of
250 ms polling. Rejected because it is a second native module for an
improvement below the system's clock-skew floor. Revisit only if Increment 3
proves the native packaging story.

**More visible gaps.** Coverage will expose time that today silently belongs to
whatever app was open. Same shape as the Phase 1 risk in the predecessor
document, and the same answer: this is a correctness win, and the UI must
explain that named gaps are intentional.

**Buffer growth offline.** A long offline period accumulates sessions. Capped at
50,000 rows; beyond that the oldest are dropped and the drop is recorded as an
`unmonitored` coverage span, so over-retention never silently becomes
over-reporting.

## Success criteria

- Coverage plus derived gaps equals time-entry duration for every entry.
- Measured switch misattribution under 250 ms.
- A network outage during a tracked session produces a complete timeline after
  reconnect, with no duplicates.
- Activity ratio cannot be pushed above 100% by any input-flooding tool.
- No new failing test names against either committed baseline.

## Implementation order

1. Increment 1 — transport and coverage
2. Increment 2 — switch fidelity
3. Increment 3 — activity signal

Each is independently shippable and independently valuable. Stopping after
Increment 1 still leaves the timeline materially more trustworthy than it is
today.

**One implementation plan per increment.** All three in a single plan would be
too large to execute or review well, and increments 2 and 3 both depend on
decisions that Increment 1 will settle in practice — the real cost of the
coverage model, and whether the buffer's flush policy holds at 250 ms. The plan
that follows this spec covers **Increment 1 only**; 2 and 3 get their own plans,
written against what Increment 1 actually turns out to be.
