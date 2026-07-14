# CareVance HRMS — Performance & Goals Audit + Remediation Plan

**Scope:** Full audit + prioritized remediation across the Laravel 12 backend API and the React 18 / Vite web frontend. (Desktop tracker + browser-extension are separate components and are **out of scope** unless added later.) Deliverable of this document: an ordered, prioritized plan an implementation agent can execute.

**Confirmed architecture (from code):**
- Backend: `backend/` — 74+ API controllers, ~155 tables, PostgreSQL. Several migrations already named for performance indexes (`2026_05_15_000001_add_critical_performance_indexes`, `add_monitoring_indexes`, `add_productivity_reclassification_indexes`).
- Frontend: `frontend/` — React 18 + TS + Vite 7, TanStack Query 5, recharts, framer-motion, react-virtuoso. Route-level code splitting IS present (`App.tsx` uses `lazyWithChunkRetry(() => import(...))` on ~110 routes) plus vendor `manualChunks` in `vite.config.ts`.

---

## Phase 0 — Establish a measurement baseline (do this first)
The audit must be data-driven, not guesswork. Before fixing anything:
1. **Backend query profiling:** enable `DB::enableQueryLog()` guarded by an env flag, or install Laravel Telescope/Clockwork in a non-prod env. Log query count + slow queries per request.
2. **Endpoint timing harness:** script `curl`/`artisan tinker` calls (or a small Pest smoke test) hitting the hot endpoints as admin for a mid-size org (e.g. 50 users, 1 month of data): `/api/reports/daily|weekly|monthly|team|overall`, `/api/dashboard`, `/api/reports/employee-insights`, monitoring/screenshots list.
3. **Frontend bundle + runtime:** run `npm run build` and capture per-chunk sizes; run Lighthouse (or `npx unlighthouse`) on `/login` and `/dashboard`; record TTI / bundle KB / longest task.
4. Record numbers in the plan's tracking table so each fix is verifiable against a before/after.

---

## Phase 1 — Backend: N+1 queries & unpaginated list endpoints (highest impact)
**Concrete findings (verified in code):**
- **`ReportController::team()` (lines 753–765):** loads all org users, then executes one `TimeEntry::where('user_id', ...)->whereBetween(...)->get()` **per user** — a textbook N+1, and it returns full entry models. Worst offender; will not scale past a handful of users. Fix: bulk-load entries with `whereIn('user_id', $userIds)->whereBetween(...)` once, then `groupBy('user_id')` in PHP (exactly the pattern already used correctly in `overall()`/`buildLiteOverallReport()` at lines 880–892). Also stop returning full `entries` per user unless the UI needs them.
- **`ReportController::daily()/weekly()/monthly()` (lines 591/623/666):** `TimeEntry::...->get()` with **no pagination/limit**. For an org-wide monthly range this materializes thousands of rows into memory and serializes them all. `overall()` already supports `page`/`per_page`; apply the same to `daily/weekly/monthly`, or at minimum cap with a sensible `limit()` and document it.
- **166 `->get()` calls** across API controllers (grep result). Many are fine (small reference data) but several hit large tables: `ScreenshotController` already caps at 1000 (good); sweep `Payroll*`, `Activity*`, `Monitoring`/`ProductivityClassification`, `ReportController` (lines 1563, 1619, 1726, 1901, 2335, etc.) for list endpoints lacking `paginate()`/`limit()`.
- **`EmployeeDashboardController::index()` (lines 24–53):** 4 sequential queries for one small payload. Combine into a single query / use `selectRaw` aggregates; low priority but cheap.

**Tasks:**
1. Rewrite `ReportController::team()` to the bulk-load-then-group pattern. Add/keep a unit/Pest test asserting query count is constant vs user count.
2. Add pagination (`paginate`/`simplePaginate`) or hard `limit()` to `daily/weekly/monthly` and audit the other 166 `->get()` sites; convert list endpoints on high-volume tables.
3. Add eager loading (`->with(...)`) where relationships are accessed post-load to avoid relation N+1 in serialized responses (e.g. report payloads that embed `user`/`project`/`task`).

## Phase 2 — Backend: caching for expensive aggregate endpoints
- `employee_insights` already uses `Cache::remember` (`buildCachedUserRangeSummary`, lines 1268–1299) and `usage_processing.cache.ttl` — good pattern.
- **Gap:** `daily/weekly/monthly/team/overall` have **no caching**; repeated admin views of the same range recompute fully. Add short-TTL `Cache::remember` keyed on `user/role scope + date range + data fingerprint` (mirror the existing fingerprint approach), with cache invalidation on time-entry/attendance writes.
- Verify cache driver is Redis (or DB) in prod, not `array` (per-request, no benefit).

## Phase 3 — Backend: index coverage verification (confirm, fill gaps)
- Hot-path indexes already exist: `time_entries(user_id, start_time)`, `time_entries(user_id, end_time)`, `activities(user_id, recorded_at)`, `activity_sessions(...)`, `attendance_records(user_id, attendance_date)` + `(organization_id, attendance_date)`, `leave_requests(...)`. Good.
- **Verify/extend:** `users.organization_id` (used by every `visibleUsersQuery` / org scoping), `time_entries.organization_id` if any org-scoped direct query exists, and `screenshots(user_id, captured_at)` / `activities(recorded_at)` for monitoring list views. Use `EXPLAIN ANALYZE` on the Phase-0 slow queries to confirm index usage and detect seq scans.

## Phase 4 — Frontend: bundle, runtime & data fetching
- **Code splitting is already in place** (`App.tsx` lazy routes + `vite.config.ts` vendor chunks). Focus instead on:
  1. **Bundle weight:** recharts + framer-motion are heavy. Run `vite build` and check chunk sizes; consider lazy-loading chart-heavy routes only when rendered, and/or swapping recharts for a lighter chart lib if Lighthouse flags it. Add `build` gzip/brotli reporting.
  2. **React Query hygiene:** confirm a single `QueryClient` with explicit `staleTime`/`gcTime` defaults (verify in `src/` query-client setup — earlier grep was inconclusive due to regex). Check pages for missing/duplicated query keys (causes refetch storms) and for `enabled` gating on authed/org params.
  3. **Over-fetching:** report/monitoring pages should request only needed fields; reuse the backend's `dashboard_lite`/`skip_activity` flags already provided by `overall`.
  4. **Lists:** confirm `react-virtuoso` is used for long tables (screenshots, activity feeds, users); add where missing.

## Phase 5 — Goals / feature-completeness verification (vs README)
Map the README "Core Features" to implemented code. Verified present in code:
- HRMS/employee management, roles/permissions, attendance+leave+approvals, time tracking + idle/screenshot monitoring, productivity rules, chat (DM/groups), payroll (runs, payslips, templates, filings, tax, reimbursement, FNF, loans), projects/tasks, reports/analytics, invoices/billing/subscriptions, super-admin multi-tenant, audit logs, notifications, settings.
- **To confirm during execution (likely present, verify):** desktop auto-start/idle behavior (separate component), browser-extension exact tracking (separate component), geofencing, performance reviews/goals (`PerformanceGoalController` exists), Stripe/Razorpay flows.
- **Flag for owner decision:** any feature in README not found in code becomes either a build task or a documentation correction. The payroll + monitoring + reporting surface is very large — confirm there is no half-implemented route returning empty/partial data (e.g. legacy routes at `App.tsx:673–675` redirect into new shells; confirm no dead endpoints).

---

## Validation plan
- **Backend:** Pest tests asserting (a) `team()` and org reports issue a bounded, constant number of queries regardless of user count (use `DB::enableQueryLog()` or a query-count assertion), (b) list endpoints return paginated metadata, (c) cache hit on repeated identical report requests. Re-run Phase-0 timings; target measurable reduction on `team`/`overall`/`monthly`.
- **Frontend:** `vite build` chunk-size budget check; Lighthouse TTI/performance score improvement on `/dashboard`; React Query devtools showing stable cache (no duplicate in-flight requests).
- **Goals:** a checklist table (README feature → controller/route → status) committed to `docs/` or the plan.

## Risks / open questions
- "Completely everything in detail" is unbounded for a 155-table + ~110-route codebase; this plan prioritizes by impact (reporting/monitoring endpoints are the hot path). Owner may want to narrow to one module (e.g. payroll only).
- Production-like data volume is needed to truly validate; current DB has only 16 demo users reseeded 2026-07-13 — generate a realistic seed (e.g. 50–200 users, months of time_entries/activities) before benchmarking.
- Frontend React Query config details need a quick confirm (grep inconclusive); verify before Phase 4.2.
- Desktop tracker + browser-extension excluded; include only if owner wants the full monorepo audit.
