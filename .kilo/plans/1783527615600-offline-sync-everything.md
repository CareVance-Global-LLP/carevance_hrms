# Plan: Full Offline Capture + Sync (desktop → server)

## Goal
When the tracker runs with **no internet at all**, every desktop-generated record — check-in/check-out (attendance), timer start/stop (time entries), screenshots, app usage, website usage, activities, and timeline — must be stored locally and then synced to the server automatically when connectivity returns. Today only screenshots actually sync; the other six record types are saved to the local DB but the sync engine never POSTs them (stubbed), and the backend controllers don't accept offline metadata/timestamps.

## Current state (verified)
- **Capture (local save):** implemented for all types via `frontend/src/services/offlineService.ts` → `desktop/preload.cjs` → `desktop/main.cjs` IPC → `desktop/offline/offline-db.cjs`. Tables + `sync_queue` exist.
- **Sync engine:** `desktop/offline/sync-engine.cjs`
  - `_syncScreenshot` (line 397) is REAL and works.
  - `_syncAttendance` (262), `_syncTimeEntry` (287), `_syncTimeline` (310), `_syncActivity` (330), `_syncAppUsage` (353), `_syncWebsiteUsage` (374) are **no-op stubs** (just `markSynced`, real code commented out).
- **Backend controllers** do NOT accept offline keys/timestamps:
  - `TimeEntry` model `$fillable` (TimeEntry.php:11) lacks `local_id`/`device_id`; `start()` hardcodes `now()` (TimeEntryController.php:252) and ignores `started_at`/`local_id`.
  - `Activity`/`ActivitySession` models lack `local_id`/`device_id`; `ActivitySessionController::store` (ActivitySessionController.php:25) validates but doesn't persist them.
  - `AttendanceController::checkIn/checkOut` (AttendanceController.php:34/45) don't accept `punch_at`/`local_id`/`device_id`.
  - `Screenshot` already supports `local_id`/`device_id`/`captured_at` (works).
  - `IdempotentSync` middleware (IdempotentSync.php) exists but is **not registered/applied to any route**; `MODEL_MAP` already lists Screenshot/Activity/ActivitySession/TimeEntry/AttendancePunch/AttendanceRecord.
- **Fully-offline-start linkage gap:** when the timer starts offline, frontend uses placeholder id `offline-<ts>` (DesktopTimerDashboard.tsx:152) as `time_entry_id` for screenshots/activities. Backend requires `time_entry_id exists:time_entries,id` (ScreenshotController.php:200). So dependent records can't sync until the offline time entry is real and its server id is resolved.

## Approach (decisions)
1. **Backend becomes offline-aware** for all create endpoints: accept `local_id`, `device_id`, and original timestamps; persist them; apply `IdempotentSync` middleware so retries are deduplicated.
2. **Sync engine implements the 6 stubbed `_sync*` methods**, sending idempotency keys + original timestamps to the matching endpoints.
3. **Offline time-entry → server id mapping** resolves dependent records:
   - Frontend uses the **desktop-returned offline `local_id`** (`off_xxx`) as the session id when offline (instead of `offline-<ts>`), so screenshots/activities reference it.
   - Offline DB stores that reference separately (`time_entry_local_id TEXT`) and a `offline_sync_map(local_id, server_id, record_type)` table.
   - Sync engine syncs time entries first (priority 1), records the `off_xxx → server.id` mapping, then rewrites dependent screenshot/activity `time_entry_id` to the server id before POSTing. Unresolved references are deferred (retried), never permanently failed.

## Tasks

### A. Backend — offline-aware controllers
1. Register middleware alias: add `'idempotent.sync' => \App\Http\Middleware\IdempotentSync::class` to the route middleware map (bootstrap/app.php / RouteServiceProvider).
2. `TimeEntry` model `$fillable`: add `local_id`, `device_id`.
   - `TimeEntryController::start`: accept nullable `local_id`, `device_id`, `started_at` (date); use `started_at` when present for `start_time`; persist keys. Apply `idempotent.sync:TimeEntry` to `POST /time-entries/start` and `/stop`.
   - `stop` already accepts `ended_at` (line 286) — also persist `local_id`/`device_id` on the matched entry.
3. `Activity` + `ActivitySession` models `$fillable`: add `local_id`, `device_id`.
   - `ActivityController::store` (bulk, ~line 205) and `ActivitySessionController::store`: accept + persist `local_id`, `device_id`, `recorded_at`/`started_at`. Apply `idempotent.sync` middleware to these store routes.
4. `AttendancePunch`/`AttendanceRecord` models: confirm `local_id`/`device_id` in `$fillable` (migration added columns — verify model). `AttendanceController::checkIn/checkOut`: accept `local_id`, `device_id`, `punch_at`/`timestamp`; persist; apply `idempotent.sync:AttendancePunch`.
5. Keep `ScreenshotController` as-is (already offline-correct).

### B. Desktop — implement the 6 sync methods (sync-engine.cjs)
Replace each stub with a real `_apiRequest` POST mirroring `_syncScreenshot`:
- `_syncTimeEntry`: start → `POST /api/time-entries/start` `{local_id, device_id, started_at, project_id, task_id, timer_slot}`; stop → `POST /api/time-entries/stop` `{local_id, device_id, ended_at, timer_slot, auto_stopped_for_idle, idle_seconds, last_activity_at}`. Capture response `id` → store mapping.
- `_syncAttendance`: `POST /api/attendance/check-in|check-out` `{local_id, device_id, punch_at, session_id, latitude, longitude}`.
- `_syncActivity`: `POST /api/activities` `{local_id, device_id, type, name, title, url, duration, recorded_at, time_entry_id(resolved)}`.
- `_syncAppUsage`: `POST /api/activities` type `app` (or dedicated endpoint) `{local_id, device_id, app_name, duration, timestamp, title}`.
- `_syncWebsiteUsage`: same with type `browser`.
- `_syncTimeline`: `POST /api/activity-sessions` `{local_id, device_id, started_at, ended_at, activity_data, time_entry_id(resolved)}`.
- All must honor rate-limit/429 backoff (existing pattern) and `markFailed`/`markSynced` correctly.

### C. Desktop — offline time-entry linkage
1. `offline-db.cjs`: add `time_entry_local_id TEXT` to `offline_screenshots` and `offline_activity_records` (migration v3 in `_migrate`); add `offline_sync_map(local_id TEXT PRIMARY KEY, server_id INTEGER, record_type TEXT)`.
   - `saveScreenshot`/`saveActivityRecord`: accept + store `time_entry_local_id`.
2. `saveTimeEntryOffline` (main.cjs:1577) already returns the desktop `local_id`; ensure frontend consumes it (Task D).
3. `sync-engine.cjs`: maintain in-memory + persisted map; after syncing a time entry, write mapping and update dependent records' `time_entry_id` to the server id (batch UPDATE via `offlineDb.resolveTimeEntryReferences(local_id, serverId)`). In each `_sync*`, resolve `time_entry_id` from map when `time_entry_local_id` is set; if mapping missing, defer (return without `markSynced`, leave pending) so it retries after the time entry syncs.

### D. Frontend — use offline session id
1. `offlineApiWrapper.ts` / `DesktopTimerDashboard.tsx` start path: when `saveTimeEntryOffline` (start) returns `{saved, local_id}`, set the active entry id to that `local_id` (not `offline-${Date.now()}`).
2. Ensure screenshot + activity capture paths pass that offline `local_id` as the time-entry reference (they already use `activeEntry.id`).
3. Verify the tracker also saves app usage / website usage / timeline offline (via `saveAppUsageOffline`/`saveWebsiteUsageOffline`/timeline) during an offline session; wire any missing capture.

### E. Validation
- **Backend tests:** extend `tests/Feature` to POST each endpoint with `local_id`+`device_id` twice → assert single row (idempotency) and original `started_at`/`punch_at` preserved. Cover screenshot/dashboard visibility.
- **Desktop tests:** extend `desktop/tests` to assert `_syncTimeEntry`/`_syncAttendance`/`_syncActivity` actually POST (mock server) and that an offline-started timer's screenshots get the server `time_entry_id` after the time entry syncs.
- **Manual E2E:** disconnect network → start timer in desktop app → capture several screenshots + generate app/web usage + check-in → reconnect → confirm all appear on the monitoring dashboard with correct timestamps and no duplicates.

## Risks / open questions
- Activities/app/website usage currently may not carry a `time_entry_id` at all offline (need to confirm in tracker hook); if so they sync independently and skip linkage. Confirm during Task D.
- Attendance check-in/offline-start ordering: ensure attendance doesn't require a running time entry server-side.
- `IdempotentSync` middleware `_check_idempotent` pre-flight path is unused by the sync engine; engine relies on `local_id`+`device_id` uniqueness (DB unique indexes exist) — keep server-side dedupe as the safety net.
