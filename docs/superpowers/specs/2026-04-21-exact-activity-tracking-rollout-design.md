# Exact Activity Tracking Rollout Design

## Summary

This design improves activity-tracking accuracy in four phases:

1. harden the current heuristic tracker so it stops over-attributing browser time
2. move desktop app tracking to exact start/end sessions
3. add browser-extension-based exact website tracking with desktop-app onboarding
4. add admin-facing browser-tracking status, disconnect alerts, and persistent health visibility

The rollout is intentionally incremental. Users should see accuracy improve early, while the product moves toward an exact session model for both desktop apps and websites.

## Product Decisions

- The main goal is improved accuracy, not preserving current guessed labels.
- The product must work for both managed company devices and normal unmanaged devices.
- Browser-extension setup should feel one-time for each browser profile on each device.
- The desktop app cannot silently install a browser extension on normal unmanaged browsers. Instead, it will provide guided browser connection and health checks.
- On managed devices, admin policy deployment remains supported later, but it is not required for the first rollout.
- If browser tracking is disconnected or removed:
  - the timer continues running
  - desktop app tracking continues normally
  - website tracking downgrades to `browser activity` or `unknown browser activity`
  - admins receive one disconnect alert
  - admins also see a persistent disconnected status until the browser reconnects

## Goals

- Reduce false inflation for website durations such as Instagram, YouTube, Gemini, and other browser activity.
- Eliminate stale desktop-app rows that continue growing after focus has moved away.
- Distinguish clearly between:
  - exact desktop application activity
  - exact website activity
  - browser-only fallback activity
  - idle time
- Keep the employee timer usable even when browser tracking is unavailable.
- Make degraded browser-tracking state visible to admins instead of silently pretending the data is exact.

## Non-Goals

- Silent browser-extension installation on normal unmanaged devices.
- Full Firefox support in the first browser-extension release.
- Rewriting unrelated reporting modules outside the activity-monitoring pipeline.
- Blocking the timer when website tracking is unavailable.

## Supported Tracking Modes

### Exact Desktop App Tracking

Used for apps such as VS Code, Word, Excel, Figma, Postman, terminal, and other non-browser foreground windows.

This mode is driven by desktop focus-change events, not periodic duration growth.

### Exact Browser Tracking

Used when a supported browser extension is connected and healthy.

This mode tracks exact browser events such as:

- tab focused
- URL changed
- tab closed
- window focus changed
- periodic extension heartbeat

### Browser Fallback Tracking

Used when a browser is active but exact browser tracking is unavailable.

This mode records only:

- `browser activity`
- `unknown browser activity`

It must not guess the exact site from a stale title or reused context once the system no longer has strong evidence.

### Idle Tracking

Idle remains a separate session type and must close any active desktop or browser session at the idle boundary.

## Rollout Phases

## Phase 1: Current-System Accuracy Hardening

### Objective

Improve accuracy immediately without requiring a browser extension or a full storage rewrite.

### Changes

- Tighten browser-context reuse in `frontend/src/hooks/useDesktopTracker.ts`.
- Reduce or remove carry-forward browser seconds when the browser reports an unclear state.
- Introduce strict unknown-browser behavior:
  - if the browser surface is generic
  - or the URL/title is not reliable
  - or the system only has weak evidence
  - then write `browser activity` or `unknown browser activity` instead of a guessed site
- Reduce backend merge inflation in `backend/config/usage_processing.php`.
- Keep unknown-browser intervals isolated from exact-site intervals.
- Update timeline rendering in `frontend/src/pages/ReportsWorkspace.tsx` so fallback browser rows display honestly.

### Expected Result

- Less false attribution
- More `unknown browser activity` rows
- Lower chance that a 10-second website visit becomes a 20-second row

### Files In Scope

- `frontend/src/hooks/useDesktopTracker.ts`
- `frontend/src/lib/activityProductivity.ts`
- `frontend/src/pages/ReportsWorkspace.tsx`
- `backend/app/Services/Reports/UsageProcessingService.php`
- `backend/config/usage_processing.php`
- related frontend and backend tests

## Phase 2: Exact Desktop App Session Tracking

### Objective

Make non-browser application timing exact by moving from cumulative duration snapshots to true start/end sessions.

### Architecture

The desktop runtime becomes the source of truth for active desktop-application focus changes.

When a foreground window changes:

- close the previously active desktop-app session immediately
- open a new desktop-app session immediately
- send explicit session transition events to the backend

### Data Model

Add a new `activity_sessions` table rather than overloading the current `activities` rows.

Recommended columns:

- `id`
- `user_id`
- `time_entry_id`
- `source` with values such as `desktop`, `browser_extension`, `idle`
- `activity_kind` with values such as `desktop_app`, `website`, `browser_fallback`, `idle`
- `tool_type` with values such as `software`, `website`, `browser`, `idle`
- `display_name`
- `app_name`
- `window_title`
- `url`
- `normalized_label`
- `normalized_domain`
- `software_name`
- `classification`
- `classification_reason`
- `started_at`
- `ended_at`
- `duration_seconds`
- `confidence`
- `metadata`
- `created_at`
- `updated_at`

The current `activities` table may remain temporarily for backward compatibility and for Phase 1 hardening, but reports should progressively migrate toward session-first reads.

### Desktop Runtime Behavior

In `desktop/main.cjs`, add a foreground-window watcher for Windows that emits focus-change events to the frontend or directly to the backend-facing telemetry path.

Rules:

- desktop apps must open one active session at a time
- moving from one app to another closes the first session before opening the second
- idle closes the current session at the idle boundary
- self-shell windows such as CareVance must not overwrite the last real external app when the evidence is ambiguous

### Expected Result

- Exact desktop-app timing
- No stale Codex or VS Code rows growing after focus changes
- Cleaner foundation for browser-extension website sessions

### Files In Scope

- `desktop/main.cjs`
- `frontend/src/hooks/useDesktopTracker.ts`
- `frontend/src/services/api.ts`
- new backend migration, model, controller, and service code for `activity_sessions`
- reporting pipeline updates and tests

## Phase 3: Exact Browser Tracking With Extension + Desktop App

### Objective

Track websites from real browser events instead of inferring them from changing window titles.

### Browser Support Strategy

First release:

- Chromium-family support first: Chrome, Edge, Brave, Opera, Vivaldi
- Firefox later

If an unsupported browser is active:

- track only `browser activity`
- do not claim exact site identity

### Extension Deployment Model

The extension lives in the codebase, but runs as a separate browser artifact.

Recommended structure:

- `browser-extension/chromium/`
- `browser-extension/shared/`

The desktop app provides guided install and connection verification.

Normal unmanaged devices:

- user installs desktop app
- desktop app detects installed browsers
- desktop app offers `Connect browser tracking`
- user is taken to the relevant extension install flow
- extension completes a local handshake with the desktop app

Managed devices:

- future support for admin policy or MDM-based forced install

### Browser Event Flow

The extension sends exact browser events to the desktop app through a secure local bridge.

The desktop app:

- verifies the extension session
- associates events with the signed-in employee
- forwards normalized telemetry to the backend

The backend stores browser activity as exact `activity_sessions` rows with:

- `activity_kind = website`
- `tool_type = website`
- exact `started_at`
- exact `ended_at`
- trusted URL and normalized domain

### Local Bridge Requirements

The desktop app bridge must:

- listen only on loopback
- require a signed handshake token
- bind extension connections to the active desktop-app session or user identity
- reject untrusted callers

### Expected Result

- Exact website durations when the extension is connected
- Exact domain identity from true browser events
- Elimination of most search-title and browser-title misclassification

## Phase 4: Browser Health, Fallback, And Admin Visibility

### Objective

Handle extension disconnects honestly without breaking the timer or hiding the degraded state.

### Browser Tracking Health Model

Add a new `browser_tracking_connections` table.

Recommended columns:

- `id`
- `user_id`
- `device_id`
- `browser_name`
- `browser_profile_key`
- `extension_version`
- `status`
- `last_seen_at`
- `connected_at`
- `disconnected_at`
- `disconnect_reason`
- `created_at`
- `updated_at`

Recommended statuses:

- `connected`
- `missing`
- `disconnected`
- `disabled`
- `out_of_date`

### Disconnect Behavior

If extension heartbeat stops:

- mark the browser connection as disconnected
- keep the employee timer running
- continue exact desktop-app tracking
- downgrade website tracking to `browser activity` or `unknown browser activity`
- send one admin notification for that disconnect event
- keep showing persistent disconnected status until the extension reconnects

### Admin Experience

Admins should be able to see:

- employee is currently active or idle
- desktop tracking health
- browser tracking health
- whether website data is exact or degraded
- last time the browser extension was seen

The admin notification should be non-spammy:

- one alert when the browser disconnects
- no repeated alerts while it remains disconnected
- persistent status badge in monitoring and reporting views until it reconnects

### Employee Experience

Employees should see a clear reconnect path:

- browser tracking disconnected warning
- reconnect button from desktop app
- status clears automatically after a healthy handshake

## Canonical Rules

### When To Claim A Website

Claim an exact website only when the system has strong evidence from:

- extension URL
- extension tab state
- extension focus events

Do not claim a website from:

- a stale browser title
- a generic new-tab surface
- a browser shell window
- the CareVance shell
- buffered carry-over without current evidence

### When To Claim A Desktop App

Claim a desktop app from:

- real foreground-window transitions
- stable app identity from the desktop watcher

Do not keep growing an app row after the app has lost focus.

### When To Fall Back

Use fallback labels only when exact identity is unavailable.

Fallback labels should be explicit:

- `browser activity`
- `unknown browser activity`

They are preferable to wrong exact-site claims.

## Reporting Changes

`backend/app/Services/Reports/UsageProcessingService.php` should migrate toward session-first aggregation.

Priority order for reports:

1. exact `activity_sessions`
2. legacy `activities` rows only where session data is unavailable

Timeline rows should display:

- exact website label when available
- exact software label when available
- explicit browser fallback label when exact website data is unavailable
- idle for idle rows

App, web, and idle counters must align with the same canonical session categories used by row rendering.

## Testing Strategy

### Phase 1 Tests

- generic browser states become `browser activity` or `unknown browser activity`
- shortened reuse windows no longer inflate website duration across browser transitions
- backend merge rules do not combine exact-site rows with unknown-browser fallback rows

### Phase 2 Tests

- desktop foreground change closes one session and opens the next
- app sessions do not continue after focus loss
- idle closes active desktop session and opens idle session

### Phase 3 Tests

- Chromium extension handshake succeeds through desktop bridge
- exact URL change updates active browser session
- tab close ends website session promptly
- unsupported browsers never claim exact site identity

### Phase 4 Tests

- extension disconnect produces one admin alert
- persistent health status remains visible while disconnected
- timer continues running during browser-tracking degradation
- desktop app tracking remains exact while browser tracking is degraded

## Risks And Mitigations

### Risk: More Unknown Rows In Phase 1

Mitigation:

- treat this as a correctness win
- improve UI copy so admins understand unknown rows are intentional fallback

### Risk: Bridge Security

Mitigation:

- loopback-only local server
- signed handshake tokens
- per-user or per-session authentication
- reject anonymous extension traffic

### Risk: Migration Complexity

Mitigation:

- keep legacy `activities` reads as fallback during rollout
- move reports to session-first incrementally
- gate new session pipeline with targeted tests

### Risk: Browser Profile Fragmentation

Mitigation:

- treat connection as one-time per browser profile per device
- store browser profile key in connection state
- provide reconnect flow from the desktop app

## Success Criteria

The rollout is successful when:

- exact desktop-app timing matches real focus transitions closely
- exact browser timing comes from extension events instead of title inference
- inaccurate rows shrink substantially in Phase 1 even before the extension is live
- admins can always tell whether browser data is exact or degraded
- removing the extension no longer produces fake exact-site claims

## Recommended Implementation Order

1. Phase 1 current-system accuracy hardening
2. Phase 2 exact desktop-app session tracking
3. Phase 3 Chromium extension + desktop bridge + exact website sessions
4. Phase 4 admin notification and persistent browser health status

This order gives the product immediate accuracy improvements while building toward the exact long-term model.
