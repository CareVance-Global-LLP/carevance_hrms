# CareVance HRMS — QA Smoke Test Report

Date: 2026-07-16
Scope: Web app (frontend + Laravel backend), Desktop (Electron) unit tests, Mobile (Expo) static typecheck.
Environment: frontend http://127.0.0.1:5173, backend http://127.0.0.1:8000 (Laravel/PostgreSQL `timetrackpro`).

## Summary

| Suite | Result | Notes |
|-------|--------|-------|
| Route smoke (76 routes) | PASS (76/76) | 0 blank, 0 CLICK_FAILED. `consoleErrors=4` per route are benign unauthenticated 401/403 + GSI origin warnings, not render failures. |
| Role-gate flow (5 roles) | PASS (0/0 mismatches) | admin, manager, employee, super_admin, custom_limited |
| E2E flow (7 flows) | PASS (7/7) | attendance punch-in/out, leave apply, timer start/stop, approval-inbox, create-employee |
| Desktop unit tests | PASS (26/26) | `desktop/tests/*.test.cjs` |
| Mobile static typecheck | 1 real bug fixed; 1593 pre-existing style-type errors (Expo uses Babel, not tsc, to bundle) | see below |

## Bugs Found & Fixed

### 1. Cookie-consent banner overlapping in-app content (FIXED — frontend)
`CookieConsentBanner.tsx` gated visibility on `isPublicExperiencePath` (= `!isAuthenticatedAppPath`),
whose `authenticatedPrefixes` list was incomplete (missing `/leave`, etc.). The banner therefore
rendered INSIDE authenticated app routes, overlapping/blocking bottom action buttons.
Fix: gate on `isIndexableMarketingPath(location.pathname)` so the banner only appears on genuine
public/marketing pages (landing, pricing, contact-sales, support, privacy, terms, signup-owner,
start-trial, register).

### 2. Super-admin /payroll redirect (FIXED — frontend)
`usePlan.ts` `PLAN_FEATURES` had no `super_admin` plan entry, so super_admin was treated as
unsubscribed and redirected away from /payroll.
Fix: added `super_admin` plan features (includes payroll + everything).

### 3. Employee leave never routed to org admins for approval (FIXED — backend)
`ApprovalRoutingService::reviewerUserIds()` used `$requesterLevel < 100` to decide whether to attach
org-admin reviewers. A plain `employee` resolves to hierarchy_level 100, so admins were excluded from
the employee's reviewer list and the admin's approval-inbox could not see the employee's pending leave
(`GET /leave-requests?status=pending` returned 0 even though the leave existed).
Fix: changed the condition to `<= 100` so level-100 employees route to org admins, matching the
`reviewerHierarchyLevels()` contract (admin level 10 reviews levels 50/100/999).
Verified: after fix, admin `GET /leave-requests?status=pending` returns the employee's pending leave.

### 4. Mobile push-notification handler wrong API shape (FIXED — mobile-app)
`src/hooks/usePushNotifications.tsx` returned a deprecated `NotificationBehavior`
(`shouldShowAlert/shouldPlaySound/shouldSetBadge/shouldShowList`) that does not satisfy
`expo-notifications@0.32` `NotificationBehavior` (requires `shouldShowBanner` + `shouldShowList` +
`shouldPlaySound` + `shouldSetBadge`). Also `useRef<...>()` (React 19 requires an argument) and an
untyped `router.push(data.route)`.
Fix: return the current `NotificationBehavior` shape; `useRef<Subscription | null>(null)`; cast
`data.route` to the `router.push` parameter type. File now typechecks cleanly.

## E2E Flow Results (detail)
- employee / attendance-punch-in : API shows checked-in
- employee / attendance-punch-out : API shows checked-out
- employee / leave-apply : created leave id=32 (verified via API)
- employee / timer-start : running timer id=178 (verified via `GET /time-entries/active`)
- employee / timer-stop : no running timer after Pause (verified via `GET /time-entries/active`)
- admin / approval-inbox-shows-pending-leave : pending leave id=32 visible in API
- admin / create-employee : user created via /add-user wizard, confirmed in org directory

## Known / Non-Blocking Observations
- Mobile app has 1593 `tsc --noEmit` errors; ~237 are real type/API-usage notes (mostly the `string`
  vs literal-style typing pattern) and the rest are the same pervasive style-literal strictness issue.
  Expo builds with Metro/Babel and does NOT run `tsc`, so these do not block the app runtime. They are
  pre-existing and out of scope for this smoke pass.
- Desktop GUI (Electron) and Expo-native cannot launch headlessly in this environment (no display
  server / xvfb / Android SDK / Expo CLI), so they were validated via unit tests (desktop) and static
  typecheck (mobile) instead of live UI drives.

## Test Artifacts
- frontend/qa-smoke-test.js -> qa-report/SUMMARY.json (76 routes)
- frontend/qa-flow-test.mjs -> qa-report-flow/summary.json (5 roles)
- frontend/qa-e2e-test.mjs -> qa-report-e2e/summary.json (7 flows)
- desktop: `npm test` -> 26/26 unit tests
- mobile-app: `tsc --noEmit` (1 bug fixed in src/hooks/usePushNotifications.tsx)
