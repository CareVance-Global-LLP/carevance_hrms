# Reliable Session Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop losing desktop app-usage sessions when a request fails, without ever creating a duplicate.

**Architecture:** The server already de-duplicates a replayed session on `local_id` + `device_id` (unique index `activity_sessions_idempotent`, added 2026-06-10), but the desktop tracker never sends those keys — so a retry would double-count, which is why no retry exists and a failed create is simply lost. This plan sends the keys, then adds a bounded in-memory retry queue that drains on the existing tick, then deletes the dead legacy offline app-usage path that would have written the same data into the retired `activities` model.

**Tech Stack:** React 18 + TypeScript (renderer), Electron (`desktop/main.cjs`), Laravel 12 + PostgreSQL, Vitest, PHPUnit.

**Spec:** [docs/superpowers/specs/2026-08-13-desktop-timeline-fidelity-design.md](../specs/2026-08-13-desktop-timeline-fidelity-design.md) — Increment 1, "Transport". The coverage-accounting half of Increment 1 is a separate plan.

## Global Constraints

- `npx tsc --noEmit` must stay at **0 errors** (CLAUDE.md).
- Never judge a suite by failure count. Diff failing test **names** against
  `.github/baselines/vitest.txt` (57) and `.github/baselines/phpunit.txt` (43).
  Zero new names.
- Do **not** hand-write `where('organization_id', ...)`. `BelongsToOrganization`
  applies a global scope already.
- No bare `catch {}`. Use `frontend/src/lib/reportSilentError.ts` where
  swallowing is genuinely right.
- Date-only columns cast as `'date:Y-m-d'`, never `'date'`.
- The legacy `activities` table keeps its **read** fallback. Only the dead
  offline **write** path is removed.
- Vitest JSON output written to `/tmp/x.json` lands at
  `C:/Users/ayush/AppData/Local/Temp/x.json` on this machine.

---

### Task 1: Send idempotency keys when opening a desktop session

Without `local_id` and `device_id` on the request, `ActivitySessionController::store`
cannot recognise a replay, so any retry added later would duplicate rows. This
task is a prerequisite for Task 2 and ships no behaviour change on its own.

**Files:**
- Modify: `frontend/src/hooks/useDesktopTracker.ts` (the `activitySessionApi.create` call inside `ensureDesktopSessionStarted`, ~line 863)
- Modify: `frontend/src/services/api.ts:1293-1299` (widen the `create` payload type)
- Test: `frontend/src/hooks/desktopSessionIdentity.test.ts` (new)

**Interfaces:**
- Consumes: `desktopDeviceIdentityRef.current?.device_id` (already resolved; the screenshot upload path uses it at `useDesktopTracker.ts:1086`).
- Produces: `newSessionLocalId(): string` exported from `frontend/src/hooks/desktopSessionIdentity.ts` — returns a UUIDv4 string. Task 2 reuses it for queued sessions.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/desktopSessionIdentity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { newSessionLocalId } from './desktopSessionIdentity';

describe('newSessionLocalId', () => {
  it('returns a distinct id per call', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newSessionLocalId()));

    expect(ids.size).toBe(500);
  });

  it('fits the 120-character column the server matches on', () => {
    // activity_sessions.local_id is string(120); a longer value would be
    // truncated by the database and stop matching on replay.
    expect(newSessionLocalId().length).toBeLessThanOrEqual(120);
  });

  it('is a UUID v4', () => {
    expect(newSessionLocalId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/desktopSessionIdentity.test.ts`
Expected: FAIL — `Failed to resolve import "./desktopSessionIdentity"`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/hooks/desktopSessionIdentity.ts`:

```ts
/**
 * Client-minted identity for one desktop activity session.
 *
 * `activity_sessions` has a unique index on (local_id, device_id) and
 * ActivitySessionController::store returns the existing row when it sees a
 * pair it already holds. That is what makes a retry safe; without these keys
 * a retry inserts a second row for the same stretch of time.
 */
export const newSessionLocalId = (): string => {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Electron's renderer has randomUUID, but happy-dom in tests and any older
  // embedded runtime may not. getRandomValues is far more widely present.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/desktopSessionIdentity.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Widen the API client payload type**

In `frontend/src/services/api.ts`, replace the `activitySessionApi` block at lines 1293-1299:

```ts
export const activitySessionApi = {
  create: (data: Partial<ActivitySession> & { local_id?: string; device_id?: string | null }) =>
    api.post<ActivitySession>('/activity-sessions', data),

  update: (id: number, data: Partial<ActivitySession>) =>
    api.patch<ActivitySession>(`/activity-sessions/${id}`, data),
};
```

- [ ] **Step 6: Send the keys from the tracker**

In `frontend/src/hooks/useDesktopTracker.ts`, add the import beside the other local imports:

```ts
import { newSessionLocalId } from './desktopSessionIdentity';
```

Then in `ensureDesktopSessionStarted`, replace the `activitySessionApi.create({...})` call with:

```ts
      const response = await activitySessionApi.create({
        time_entry_id: activeEntry.id,
        source: 'desktop',
        activity_kind: 'desktop_app',
        tool_type: 'software',
        display_name: displayName,
        app_name: appName,
        window_title: windowTitle,
        url: payload.url || null,
        started_at: capturedAt,
        confidence: 100,
        // Lets the server recognise a replay instead of inserting a second row
        // for the same stretch of time. Without these, the retry in the queue
        // below would double-count.
        local_id: newSessionLocalId(),
        device_id: desktopDeviceIdentityRef.current?.device_id ?? null,
      });
```

- [ ] **Step 7: Verify types and the full suite**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (0 errors)

Run: `cd frontend && npx vitest run --reporter=json --outputFile=/tmp/vitest-task1.json`
Then diff failing names against the baseline:

```bash
cd frontend && node -e "
const fs=require('fs'), path=require('path');
const r=JSON.parse(fs.readFileSync('C:/Users/ayush/AppData/Local/Temp/vitest-task1.json','utf8'));
const keys=[];
for(const t of r.testResults||[]){
  const rel=path.relative(process.cwd(),t.name).split(path.sep).join('/');
  for(const a of t.assertionResults||[]) if(a.status==='failed')
    keys.push(rel+'::'+[...(a.ancestorTitles||[]),a.title].join(' > '));
}
fs.writeFileSync('C:/Users/ayush/AppData/Local/Temp/f1.txt', keys.sort().join('\n')+'\n');
console.log('failed:', keys.length);
"
sort .github/baselines/vitest.txt > "C:/Users/ayush/AppData/Local/Temp/base.sorted"
comm -13 "C:/Users/ayush/AppData/Local/Temp/base.sorted" "C:/Users/ayush/AppData/Local/Temp/f1.txt"
```

Expected: the `comm` output is empty (no new failure names).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/desktopSessionIdentity.ts frontend/src/hooks/desktopSessionIdentity.test.ts frontend/src/hooks/useDesktopTracker.ts frontend/src/services/api.ts
git commit -m "feat(tracker): send idempotency keys when opening a desktop session

activity_sessions has had a unique (local_id, device_id) index and
server-side replay resolution since June, but the live path never sent
the keys - so a retry would have duplicated rows, which is why no retry
exists. Sending them is the prerequisite for retrying at all."
```

---

### Task 2: Retry failed session creates instead of losing them

Today a failed `create` throws, the session is never recorded, and the timeline
gets a hole. With Task 1 in place a retry is safe.

**Files:**
- Create: `frontend/src/hooks/pendingSessionQueue.ts`
- Create: `frontend/src/hooks/pendingSessionQueue.test.ts`
- Modify: `frontend/src/hooks/useDesktopTracker.ts` (`ensureDesktopSessionStarted`, and the `tick` function at ~line 1572)

**Interfaces:**
- Consumes: `newSessionLocalId()` from Task 1.
- Produces: `createPendingSessionQueue({ maxSize })` returning
  `{ enqueue(payload: PendingSession): void; drain(send: (p: PendingSession) => Promise<unknown>): Promise<void>; size(): number; droppedCount(): number }`.
  `PendingSession` is the exact object passed to `activitySessionApi.create`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/pendingSessionQueue.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPendingSessionQueue } from './pendingSessionQueue';

const session = (localId: string) => ({
  time_entry_id: 1,
  source: 'desktop',
  activity_kind: 'desktop_app',
  tool_type: 'software',
  display_name: 'Code',
  started_at: '2026-08-13T10:00:00.000Z',
  local_id: localId,
  device_id: 'device-1',
});

describe('pendingSessionQueue', () => {
  it('drains in the order sessions happened', async () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });
    const sent: string[] = [];
    queue.enqueue(session('a'));
    queue.enqueue(session('b'));

    await queue.drain(async (p) => { sent.push(p.local_id); });

    // Out-of-order replay would interleave one app's segments with another's.
    expect(sent).toEqual(['a', 'b']);
    expect(queue.size()).toBe(0);
  });

  it('keeps a session that failed to send', async () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });
    queue.enqueue(session('a'));

    await queue.drain(async () => { throw new Error('offline'); });

    expect(queue.size()).toBe(1);
  });

  it('stops draining at the first failure so order is preserved', async () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });
    const sent: string[] = [];
    queue.enqueue(session('a'));
    queue.enqueue(session('b'));

    await queue.drain(async (p) => {
      if (p.local_id === 'a') throw new Error('offline');
      sent.push(p.local_id);
    });

    // 'b' must not jump ahead of 'a'.
    expect(sent).toEqual([]);
    expect(queue.size()).toBe(2);
  });

  it('drops the oldest when full and counts the loss', () => {
    const queue = createPendingSessionQueue({ maxSize: 2 });
    queue.enqueue(session('a'));
    queue.enqueue(session('b'));
    queue.enqueue(session('c'));

    // Unbounded growth during a long outage would exhaust renderer memory.
    // Dropping the oldest is the least-bad option, and it is counted so the
    // loss is reportable rather than silent.
    expect(queue.size()).toBe(2);
    expect(queue.droppedCount()).toBe(1);
  });

  it('does not run two drains concurrently', async () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });
    queue.enqueue(session('a'));
    let inFlight = 0;
    let maxConcurrent = 0;

    const send = async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((resolve) => { setTimeout(resolve, 10); });
      inFlight -= 1;
    };

    await Promise.all([queue.drain(send), queue.drain(send)]);

    expect(maxConcurrent).toBe(1);
  });

  it('reports nothing to drain as a no-op', async () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });
    const send = vi.fn();

    await queue.drain(send);

    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/pendingSessionQueue.test.ts`
Expected: FAIL — `Failed to resolve import "./pendingSessionQueue"`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/hooks/pendingSessionQueue.ts`:

```ts
export interface PendingSession {
  time_entry_id: number;
  source: string;
  activity_kind: string;
  tool_type: string;
  display_name: string;
  app_name?: string | null;
  window_title?: string | null;
  url?: string | null;
  started_at: string;
  confidence?: number;
  local_id: string;
  device_id: string | null;
}

export interface PendingSessionQueue {
  enqueue: (payload: PendingSession) => void;
  drain: (send: (payload: PendingSession) => Promise<unknown>) => Promise<void>;
  size: () => number;
  droppedCount: () => number;
}

/**
 * Holds desktop sessions whose create failed, so a network blip costs a retry
 * rather than a hole in the timeline.
 *
 * Retrying is only safe because every session carries (local_id, device_id) and
 * the server resolves a replay against its unique index instead of inserting
 * again — see desktopSessionIdentity.ts.
 *
 * In memory on purpose. The offline SQLite store rewrites its whole file on
 * every write (offline-db.cjs `_persist`), which is too expensive per app
 * switch, and its existing app-usage table targets the retired `activities`
 * model. Persisting across a process restart is a separate piece of work.
 */
export const createPendingSessionQueue = ({ maxSize }: { maxSize: number }): PendingSessionQueue => {
  const items: PendingSession[] = [];
  let dropped = 0;
  let draining = false;

  return {
    enqueue: (payload) => {
      items.push(payload);
      while (items.length > maxSize) {
        items.shift();
        dropped += 1;
      }
    },

    drain: async (send) => {
      // A second concurrent drain would send the same head twice and reorder
      // the tail. The tick that calls this can overlap with a reconnect.
      if (draining) return;
      draining = true;

      try {
        while (items.length > 0) {
          try {
            await send(items[0]);
          } catch {
            // Stop at the first failure. Skipping ahead would deliver a later
            // session before an earlier one, and the next drain retries this
            // same head.
            return;
          }
          items.shift();
        }
      } finally {
        draining = false;
      }
    },

    size: () => items.length,
    droppedCount: () => dropped,
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/pendingSessionQueue.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Wire the queue into the tracker**

In `frontend/src/hooks/useDesktopTracker.ts`, add the import:

```ts
import { createPendingSessionQueue, type PendingSession } from './pendingSessionQueue';
```

Add a ref beside the other refs (near `activeDesktopSessionRef`, ~line 421):

```ts
  // ~8 hours of switching at one session per 10s, then oldest-first drop.
  const pendingSessionQueueRef = useRef(createPendingSessionQueue({ maxSize: 3000 }));
```

In `ensureDesktopSessionStarted`, wrap the create so a failure queues instead of throwing. Replace the whole `const response = await activitySessionApi.create({...})` statement and the `activeDesktopSessionRef.current = {...}` assignment that follows it with:

```ts
      const pending: PendingSession = {
        time_entry_id: activeEntry.id,
        source: 'desktop',
        activity_kind: 'desktop_app',
        tool_type: 'software',
        display_name: displayName,
        app_name: appName,
        window_title: windowTitle,
        url: payload.url || null,
        started_at: capturedAt,
        confidence: 100,
        local_id: newSessionLocalId(),
        device_id: desktopDeviceIdentityRef.current?.device_id ?? null,
      };

      const startedAtMs = Date.parse(capturedAt);
      const resolvedStartedAtMs = Number.isFinite(startedAtMs) ? startedAtMs : Date.now();

      let sessionId: number | null = null;
      try {
        const response = await activitySessionApi.create(pending);
        sessionId = response.data.id;
      } catch (error) {
        // The session still happened. Queue it and keep local state so the
        // segment is not lost; the tick below retries it.
        pendingSessionQueueRef.current.enqueue(pending);
        reportSilentError('desktop-tracker', error);
      }

      activeDesktopSessionRef.current = {
        sessionId,
        timeEntryId: activeEntry.id,
        signature,
        startedAt: capturedAt,
        startedAtMs: resolvedStartedAtMs,
        lastSeenAtMs: resolvedStartedAtMs,
      };
```

Widen the type at `useDesktopTracker.ts:198-205`:

```ts
type ActiveDesktopSession = {
  // null while the create is still queued: the session is real and locally
  // known, but the server has not issued an id yet, so there is nothing to
  // PATCH. The queued create carries started_at, so nothing is lost.
  sessionId: number | null;
  timeEntryId: number;
  signature: string;
  startedAt: string;
  startedAtMs: number;
  lastSeenAtMs: number;
};
```

Then guard both users of `sessionId`. In `closeActiveDesktopSession`, extend the existing early return (~line 750):

```ts
      const activeDesktopSession = activeDesktopSessionRef.current;
      if (!activeDesktopSession) {
        return;
      }

      if (activeDesktopSession.sessionId === null) {
        // Never reached the server. Its create is queued and will be retried
        // with the start time already on it; there is no row to close.
        activeDesktopSessionRef.current = null;
        return;
      }
```

And in `extendActiveDesktopSession`, after its existing null check (~line 777):

```ts
      if (activeDesktopSession.sessionId === null) {
        return;
      }
```

- [ ] **Step 6: Drain the queue on each tick**

In `tick`, immediately after the existing `syncScreenshotInterval(activeEntryRef.current?.id || null);` line (~line 1618), add:

```ts
        // Retry anything a network blip lost. Safe to repeat: every queued
        // session carries (local_id, device_id) and the server resolves a
        // replay to the row it already created.
        void pendingSessionQueueRef.current.drain((p) => activitySessionApi.create(p));
```

- [ ] **Step 7: Verify types and the full suite**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (0 errors)

Run the full suite and baseline diff exactly as in Task 1 Step 7, writing to `/tmp/vitest-task2.json` and `f2.txt`.
Expected: the `comm` output is empty.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/pendingSessionQueue.ts frontend/src/hooks/pendingSessionQueue.test.ts frontend/src/hooks/useDesktopTracker.ts
git commit -m "feat(tracker): retry desktop sessions a failed request would have lost

A failed create threw and the segment was gone, leaving a hole in the
timeline with nothing recording that anything was missing. Sessions now
queue and drain on the tick. Retrying is only safe because of the
idempotency keys added in the previous commit."
```

---

### Task 3: Delete the dead legacy offline app-usage path

`saveAppUsageOffline` has **zero callers**. It posts to `POST /api/activities`,
the retired flat `Activity` model, while the live path writes
`activity_sessions`. Wiring it up would have made the timeline disagree with
itself depending on whether the user was online — the same split CLAUDE.md
records for `payrolls` vs `payroll_monthly_runs`. Removing it makes Task 2 the
only buffering mechanism, so a future maintainer cannot revive the wrong one.

The legacy `activities` **read** fallback is deliberately retained and is not
touched. `website_usage` is left alone — it is out of scope here.

**Files:**
- Modify: `desktop/main.cjs` (remove the `desktop:offline-save-app-usage` handler, ~line 1934)
- Modify: `desktop/preload.cjs:116` (remove `saveAppUsageOffline`)
- Modify: `desktop/offline/offline-db.cjs` (remove `saveAppUsage` and its `_dequeueSync` partner, ~lines 686-699)
- Modify: `desktop/offline/sync-engine.cjs` (remove `_syncAppUsage` and its `case 'app_usage'`)
- Modify: `frontend/src/services/offlineService.ts:147-157` (remove `saveAppUsageOffline`)
- Modify: `frontend/src/vite-env.d.ts:164` (remove the `saveAppUsageOffline` declaration)
- Test: `frontend/src/services/offlineService.test.ts` (new, if absent)

- [ ] **Step 1: Confirm it is genuinely dead before deleting anything**

```bash
cd /d/CareVance_Hrms_IDE
grep -rn "saveAppUsageOffline\|offline-save-app-usage\|saveAppUsage\|_syncAppUsage" \
  frontend/src desktop --include=*.ts --include=*.tsx --include=*.cjs
```

Expected: matches ONLY at the six file locations listed above — the definitions
and their wiring, with no consumer. If any other caller appears, **stop**: the
path is live and this task's premise is wrong.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/services/offlineService.test.ts` (or add to it if present):

```ts
import { describe, expect, it } from 'vitest';
import * as offlineService from './offlineService';

describe('offlineService surface', () => {
  it('exposes no app-usage writer', () => {
    // The legacy path wrote to POST /api/activities, the retired flat model,
    // while live sessions write activity_sessions. Two writers for one
    // timeline is how the record starts disagreeing with itself depending on
    // whether the user happened to be online.
    expect('saveAppUsageOffline' in offlineService).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/services/offlineService.test.ts`
Expected: FAIL — `expected true to be false`

- [ ] **Step 4: Delete the renderer half**

In `frontend/src/services/offlineService.ts`, delete the entire
`saveAppUsageOffline` export (lines ~147-157).

In `frontend/src/vite-env.d.ts`, delete the `saveAppUsageOffline?: (payload: {...}) => ...` declaration at ~line 164.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/services/offlineService.test.ts`
Expected: PASS

- [ ] **Step 6: Delete the desktop half**

In `desktop/preload.cjs`, delete line 116 (`saveAppUsageOffline: ...`).

In `desktop/main.cjs`, delete the whole
`ipcMain.handle('desktop:offline-save-app-usage', ...)` block starting at ~line 1934.

In `desktop/offline/offline-db.cjs`, delete `OfflineDatabase.prototype.saveAppUsage`
and the matching `_dequeueSync('app_usage', ...)` function (~lines 686-699).

In `desktop/offline/sync-engine.cjs`, delete `SyncEngine.prototype._syncAppUsage`
(~lines 510-526) and its `case 'app_usage': await this._syncAppUsage(record); break;`
(~lines 241-243).

Leave the `app_usage` **table definition** in the offline schema. Dropping a
table from an existing installed database needs a migration path in the offline
store, and an unused table is harmless; the code that could write to it is gone.

- [ ] **Step 7: Verify nothing references the removed path**

```bash
cd /d/CareVance_Hrms_IDE
grep -rn "saveAppUsageOffline\|offline-save-app-usage\|saveAppUsage\|_syncAppUsage" \
  frontend/src desktop --include=*.ts --include=*.tsx --include=*.cjs
node -e "require('./desktop/offline/offline-db.cjs'); require('./desktop/offline/sync-engine.cjs'); console.log('modules still load')"
```

Expected: the grep returns nothing, and the node command prints `modules still load`.

- [ ] **Step 8: Verify types and the full suite**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (0 errors)

Run the full suite and baseline diff exactly as in Task 1 Step 7, writing to `/tmp/vitest-task3.json` and `f3.txt`.
Expected: the `comm` output is empty.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/services/offlineService.ts frontend/src/services/offlineService.test.ts frontend/src/vite-env.d.ts desktop/preload.cjs desktop/main.cjs desktop/offline/offline-db.cjs desktop/offline/sync-engine.cjs
git commit -m "refactor(tracker): delete the dead legacy offline app-usage path

Zero callers, and it posted to /api/activities - the retired flat model -
while live sessions write activity_sessions. Reviving it would have made
the timeline disagree with itself depending on whether the user was
online. The pending-session queue is now the only buffer. The legacy
activities read fallback is unchanged."
```

---

### Task 4: Prove the round trip against the real server

Tasks 1-3 are unit-level. This asserts the property that actually matters end to
end: a replayed session does not double-count.

**Files:**
- Test: `backend/tests/Feature/ActivitySessionIdempotencyTest.php` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/Feature/ActivitySessionIdempotencyTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Models\ActivitySession;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ActivitySessionIdempotencyTest extends TestCase
{
    use RefreshDatabase;

    private function actor(): array
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);
        $user = User::create([
            'name' => 'Tracked User',
            'email' => 'tracked@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);
        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'organization_id' => $organization->id,
            'start_time' => now()->subHour(),
        ]);

        return [$user, $entry];
    }

    private function payload(TimeEntry $entry): array
    {
        return [
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'desktop_app',
            'tool_type' => 'software',
            'display_name' => 'Visual Studio Code',
            'app_name' => 'Code',
            'window_title' => 'plan.md',
            'started_at' => now()->subMinutes(5)->toIso8601String(),
            'confidence' => 100,
            'local_id' => 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
            'device_id' => 'device-1',
        ];
    }

    public function test_a_replayed_session_does_not_create_a_second_row(): void
    {
        [$user, $entry] = $this->actor();
        $payload = $this->payload($entry);

        $first = $this->postJson('/api/activity-sessions', $payload, $this->apiHeadersFor($user));
        $first->assertSuccessful();

        // The retry the tracker's queue performs after a timeout that had in
        // fact succeeded. It must resolve to the original row.
        $second = $this->postJson('/api/activity-sessions', $payload, $this->apiHeadersFor($user));
        $second->assertSuccessful();

        $this->assertSame($first->json('id'), $second->json('id'));
        $this->assertSame(1, ActivitySession::where('local_id', $payload['local_id'])->count());
    }

    public function test_the_same_local_id_from_another_device_is_a_different_session(): void
    {
        [$user, $entry] = $this->actor();

        $this->postJson('/api/activity-sessions', $this->payload($entry), $this->apiHeadersFor($user))
            ->assertSuccessful();

        // Idempotency is scoped to the pair. Two devices minting the same UUID
        // is vanishingly unlikely, but collapsing them would silently discard
        // one machine's work.
        $otherDevice = array_merge($this->payload($entry), ['device_id' => 'device-2']);
        $this->postJson('/api/activity-sessions', $otherDevice, $this->apiHeadersFor($user))
            ->assertSuccessful();

        $this->assertSame(2, ActivitySession::where('local_id', $this->payload($entry)['local_id'])->count());
    }

    public function test_a_session_without_idempotency_keys_is_still_accepted(): void
    {
        // The browser-extension path does not mint them; it must keep working.
        [$user, $entry] = $this->actor();
        $payload = $this->payload($entry);
        unset($payload['local_id'], $payload['device_id']);

        $this->postJson('/api/activity-sessions', $payload, $this->apiHeadersFor($user))
            ->assertSuccessful();

        $this->assertSame(1, ActivitySession::where('user_id', $user->id)->count());
    }
}
```

- [ ] **Step 2: Run the test**

Run: `cd backend && php artisan test --filter=ActivitySessionIdempotencyTest`

Expected: PASS. These assert existing server behaviour, so if any fail the
server's idempotency is weaker than this plan assumes — **stop and report**,
because Task 2's retry depends on it. In particular, if
`test_a_replayed_session_does_not_create_a_second_row` fails, the queue can
double-count and Task 2 must be reverted until it is fixed.

- [ ] **Step 3: Run the backend suite and diff against the baseline**

```bash
cd backend && php artisan test --log-junit "C:/Users/ayush/AppData/Local/Temp/phpunit-task4.xml" > /dev/null 2>&1
cd /d/CareVance_Hrms_IDE && node scripts/ci/test-baseline.mjs \
  --junit "C:/Users/ayush/AppData/Local/Temp/phpunit-task4.xml" \
  --baseline .github/baselines/phpunit.txt --check --label phpunit
```

Expected: `[phpunit] no new failures.`

- [ ] **Step 4: Commit**

```bash
git add backend/tests/Feature/ActivitySessionIdempotencyTest.php
git commit -m "test(tracker): pin replay behaviour the session retry depends on

The queue may only retry because the server resolves (local_id, device_id)
to the row it already created. That property was untested, so nothing
would have caught a regression that turned every retry into a duplicate."
```

---

## Manual verification

Automated tests cannot exercise the Electron bridge. After Task 3, on the
Windows desktop app:

1. Start a timer, switch between three applications, confirm three rows in
   Monitoring → Web & App Usage.
2. Disconnect the network. Switch between two more applications. The console
   should show no unhandled rejection.
3. Reconnect. Within one tick, the two sessions from the outage should appear —
   once each, not twice.
4. Confirm timestamps still line up with when you actually switched.

## What this plan does not do

- **Persist the queue across a process restart.** Killing the app still loses
  what is buffered. The coverage plan makes that loss visible; only then is
  persistence worth its cost, given `_persist` rewrites the whole database file.
- **Add a batch endpoint.** Sequential idempotent retry is correct. Batching is
  a throughput optimisation with nothing yet measured to justify it.
- **Touch switch fidelity or ms precision.** Increment 2.
