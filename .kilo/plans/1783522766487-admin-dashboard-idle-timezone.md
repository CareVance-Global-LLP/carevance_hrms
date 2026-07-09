# Admin Dashboard: idle time missing (appears only after "View in my timezone" + refresh)

## Symptom
On the admin dashboard, for test employee 1 the idle time is "not available" (shows `0` / "No idle data available"), but it **is** available on the **Check in / Check out** view. Selecting **"View all in my timezone"** and refreshing makes the idle appear.

## Root cause
The dashboard idle value is sourced from the **activity-based report**, not from attendance:

- Dashboard idle → `reportApi.overall` / `reportApi.employeeInsights` (`AdminDashboard.tsx:812,1572`) → backend `ReportController::overall()` / `employeeInsights()`.
- Those endpoints compute `idle_duration` via `ActivityFeedService::forUsersInRangeForIdle()` which filters `activities.recorded_at` between `start_date`/`end_date` (`ActivityFeedService.php:50-51`).
- The date window is built with **no timezone**: `Carbon::parse($start_date)->startOfDay()` / `->endOfDay()` (`ReportController.php:796-797`). `Carbon::parse('2026-07-08')` resolves to **app timezone** (`config/app.php:68` → `Asia/Kolkata`).
- `config/database.php` sets **no connection `timezone`**, so MySQL interprets those naive datetime strings in the server session timezone (commonly **UTC**). Result: a ~5:30h offset between the intended app-tz window and the actual `recorded_at` comparison. Idle activities that fall in the early/late part of the employee's day get excluded → `idle_duration = 0` → dashboard shows nothing.
- The **Check in / Check out** view is immune because it reads `attendance_date` (a `DATE` column) and per-punch `idle_duration` that are **date-bucketed**, not timestamp-range-filtered in app tz. Hence it is correct while the dashboard isn't.

The "View all in my timezone" toggle (`AdminDashboard.tsx:703,2302`) currently only changes timestamp **formatting**, not the query — so toggling alone should not change the value. The fact that it "appears after refresh" is most consistent with a stale-cache / initial-load race that a hard refresh resolves, while the underlying discrepancy is the timezone shift. (Verify during implementation — see Open Questions.)

## Fix
Make the report date window timezone-consistent with how `recorded_at` is stored.

### Option A — Recommended (lowest risk, one config change)
Set the MySQL connection timezone to the application timezone so every naive Carbon boundary is interpreted consistently with stored timestamps:
- `backend/config/database.php`: add `'timezone' => config('app.timezone')` to each connection (or at least the default/`mysql` connection).
- This makes `Carbon::parse('2026-07-08')->startOfDay()` (Asia/Kolkata) compare correctly against `recorded_at` (stored in the same wall clock when connection tz == app tz). Fixes all timestamp-range reports at once (overall, employeeInsights, working-time, activity feed) and aligns them with attendance.

### Option B — Robust but larger (explicit per-request timezone)
- Add an optional `timezone` param to `overall`, `employeeInsights`, and the working-time endpoints; parse `start_date`/`end_date` in that timezone, then convert the boundaries to UTC (or connection tz) before filtering `recorded_at`.
- Frontend: send `timezone: displayTimezone` (`resolveTimeZone(user?.settings?.timezone || DEFAULT_APP_TIMEZONE)`, `AdminDashboard.tsx:695`) with `reportApi.overall`, `reportApi.employeeInsights`, `userApi.getProfile360`, and `activityApi.getAllPages`; and compute `selectedStartDate`/`selectedEndDate` in that timezone instead of raw local browser time (`todayIso()` uses `new Date()` — `formatters.ts:14`).

Prefer **Option A** first (verify it resolves the symptom); add **Option B** only if per-viewer timezone display must differ from the reporting timezone.

## Files to change
- `backend/config/database.php` (Option A) — add connection `timezone`.
- `backend/app/Http/Controllers/Api/ReportController.php` (Option B) — accept/use `timezone` on `overall`/`employeeInsights` and convert boundaries.
- `frontend/src/lib/formatters.ts` (Option B) — `todayIso()`/`toIsoDate()` accept a timezone.
- `frontend/src/pages/AdminDashboard.tsx` (Option B) — pass `timezone` to report/insights/profile360/activity queries and build range in display timezone.

## Validation
- Feature test (new or extend `tests/Feature/ReportWorkingTimeTest.php`): seed a user with an `idle` activity whose `recorded_at` is near the day boundary in a non-app tz; call `overall`/`employeeInsights` and assert `idle_duration > 0` for that day after the fix.
- Manual: open Admin Dashboard → select test employee 1 (single-day "today") → idle now shows **without** toggling; value matches Check in / Check out.
- Regression: run `php artisan test --filter ReportWorkingTimeTest`, `AttendanceAndTimerFlowTest`; `npm run test` (frontend `useDesktopTracker` + dashboard suites).

## Open questions / verify during implementation
1. Confirm the DB server/session timezone is actually UTC (or != app tz) — e.g. `SELECT @@session.time_zone;` — to confirm Option A is the trigger.
2. Confirm whether "View in my timezone" + refresh is purely a cache/race (no data change expected) vs. actually altering the query; if it alters the query, locate that wiring (none found in `AdminDashboard.tsx` — toggle only affects `formatDateTimeForTimezone`).
3. Verify attendance timestamps are not negatively affected by Option A (they should become *more* consistent, not less).
