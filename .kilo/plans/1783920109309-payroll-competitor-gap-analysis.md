# Frontend-Only Payroll Representation Overhaul — CareVance HRMS

**Scope (explicit):** Improve ONLY the frontend — how payroll components/modules are
organised, maintained, and presented. Backend is unchanged. Refactoring/improving
existing React components is permitted (user-approved). Plan is implementation-ready
for a frontend-capable agent.

---

## 1. Research: how top Indian products represent payroll on the frontend

- **Zoho Payroll dashboard:** a single screen with **"To Do Tasks"** (pending items
  needing attention), **"Current and Ongoing Pay Runs"** snapshot (net pay, pay date,
  headcount, incl. F&F runs), **Employee Summary**, plus a left-nav module list +
  Employee Portal (ESS). Emphasis on *one screen, obvious next action*.
- **greytHR:** exhaustive **module grid** ("if it's part of payroll, we have it"),
  left-nav, ESS portal, help desk. (Self-critique in reviews: "some UI/UX improvements
  welcome", "utilitarian/traditional UI" vs Keka/Darwinbox.)
- **Keka:** polished, modern, employee-friendly; **Pre-Payroll Validation & Preview**
  (changes/anomalies before finalise); real-time dashboards.
- **PagarAI / INDpayroll / SalaryBox:** **Compliance dashboards** — color-coded
  status, pending vs completed, alerts for missing deductions, download centre.
- **Common pattern:** (1) a dashboard that is the single source of truth, (2) a
  categorised + searchable module launcher, (3) a live compliance/filings status
  board, (4) ESS parity.

## 2. Current frontend representation (the maintenance problem)

`frontend/src/pages/Payroll.tsx` renders sub-views by URL param
(`dashboard | pay-group | bulk-payroll | employee | filings | employee-cards |
dept-templates | unassigned-employees | salary-components | pay-group-settings`).

`PayrollDashboard.tsx` (the home) composes, in fixed order:
`NextStepsCard` (currently `return null` — setup wizard disabled) → `MonthTimeline`
→ Process&Pay CTA → 4 `MetricCard`s → `CompensationAnalytics` → **6 hardcoded
`QuickActionCard`s** (Create Pay Group, Salary Components, Employee Payroll Cards,
Statutory Filings, Salary Templates, Unassigned Employees) → Needs Attention → Pay
Groups grid → Recent Runs → help text.

Separately, **two** other places enumerate the same modules:
- `frontend/src/navigation/dashboardNavigation.ts:158` — categorised sidebar
  (Overview / Tax / Compensation / Compliance / Reports & Advanced). This is the
  real, well-structured source of truth.
- `frontend/src/pages/PayrollFeaturesPage.tsx` — a *separate* `/payroll/all-features`
  page with search, **redundant** with the sidebar.

**Problem:** module discoverability is split (fixed 6 on dashboard + sidebar + hidden
all-features page). No live compliance board. The dashboard does not read like the
"single source of truth" leaders ship.

## 3. Target representation (frontend-only)

A single, modern **Payroll Workspace** dashboard composed of reusable widgets, each
fed by **existing** endpoints (`getPayrollRuns`, `listPayGroups`, `getDepartments`,
`getDashboardData`, `listFilings`, `generateAllFilings`, `getFbpComponents` — all in
`frontend/src/services/api.ts`). No new backend.

### New / changed components

1. **`PayrollModuleLauncher.tsx`** (NEW) — the module "app grid".
   - Source the module list from `dashboardNavigation.ts` Payroll section (already
     categorised + carries `planFeature` / `strictAdminOnly` / `section`).
   - Search box (like `PayrollFeaturesPage`) + category filter chips
     (Overview / Tax / Compensation / Compliance / Reports).
   - Per-module icon, label, description, and an optional "needs attention" badge
     (e.g. pending filings, unprocessed run) computed from dashboard data.
   - Replaces the 6 hardcoded `QuickActionCard`s on the dashboard AND retires the
     redundant `PayrollFeaturesPage`. Single source of truth for module access.

2. **`ComplianceStatusBoard.tsx`** (NEW) — live statutory readiness board (PagarAI-style).
   - For the selected month, show a row per statutory item: **PF ECR, ESI Challan,
     PT Return, Form 24Q (quarterly), Form 12BA (annual), LWF, Form 16 (annual)**.
   - Status per item derived from `getPayrollRuns()` (does a run exist/locked for the
     month?) + `listFilings()` history (type → status: generated / filed / missing).
   - Color-coded via existing `PayrollStatusBadge` semantics; show due-date hint
     (e.g. "PF ECR due 15th"); "Generate" / "Generate All" / "Download" actions reuse
     `generateAllFilings` / per-type mutations already in `FilingsDashboard.tsx`.
   - Frontend-only: no new API. Reuse the filing-type metadata already in
     `FilingsDashboard.tsx` (`FILING_TYPES`).

3. **`PayrollToDoRail.tsx`** (NEW, or fold into dashboard) — Zoho-style "To Do".
   - Derived items: N employees pending processing, run not yet locked/approved,
     filings not generated for the month, employees without bank details / unapproved
     tax declarations (where cheaply available from existing stats). Each item links
     to the relevant module/launcher entry.

4. **`PayrollDashboard.tsx`** (REFACTOR) — recompose using the widgets above:
   - `MonthTimeline` (keep) → To-Do rail → **Current Pay Run snapshot** (reuse
     `PayrollRunCard` for the selected month's run, with Process&Pay / lifecycle
     actions) → 4 `MetricCard`s (keep) → `ComplianceStatusBoard` →
     `PayrollModuleLauncher` → `CompensationAnalytics` (keep) → Pay Groups grid
     (keep) → Recent Runs (keep).
   - Remove the 6 hardcoded `QuickActionCard`s (now in launcher).
   - Keep all existing handler props/callbacks (`onOpenProcessAndPay`, `onOpenFilings`,
     `onSelectPayGroup`, etc.) so `Payroll.tsx` is unaffected.

5. **`PayrollFeaturesPage.tsx`** (RETIRE) — delete file + remove its route in
   `App.tsx` (`path="payroll/all-features"`); the launcher is the replacement.
   (If preferred, keep the route but render the launcher — see Open Decisions.)

6. **Polish pass** (Keka-style) — consistent spacing/tokens (existing `#5D969D` teal
   accent, `SurfaceCard`/`StatusBadge`/`Button` primitives), responsive grids, hover
   states, skeleton loaders (pattern already used in `FilingsDashboard`). Reuse
   `PayrollRunCard`, `PayrollStatusBadge`, `PayrollAmount` — do NOT reinvent.

### Files
- NEW: `frontend/src/components/payroll/PayrollModuleLauncher.tsx`
- NEW: `frontend/src/components/payroll/ComplianceStatusBoard.tsx`
- NEW: `frontend/src/components/payroll/PayrollToDoRail.tsx`
- EDIT: `frontend/src/components/payroll/PayrollDashboard.tsx` (recompose)
- DELETE: `frontend/src/pages/PayrollFeaturesPage.tsx`; remove route in
  `frontend/src/App.tsx`; remove `PayrollFeaturesPage` import.
- REUSE (no change): `dashboardNavigation.ts`, `MonthTimeline.tsx`,
  `PayrollRunCard.tsx`, `PayrollStatusBadge.tsx`, `PayrollAmount.tsx`,
  `FilingsDashboard.tsx` (filing logic source), `services/api.ts` (endpoints).

## 4. Data flow (frontend-only)
- Module list: static import from `dashboardNavigation.ts` (no fetch).
- Compliance board: `getPayrollRuns()` + `listFilings()` → compute per-type status
  for selected `monthYear`; actions call `generateAllFilings(runId)` / per-type
  generators already in `api.ts`.
- To-Do: `getPayrollRuns`, `listPayGroups`, `getDashboardData` (existing stats).
- ESS separation preserved: launcher entries carry `strictAdminOnly`/plan gating from
  nav config; employee-facing modules (`My Payroll`, tax declarations) stay in ESS.

## 5. Risks / constraints
- Honor `PlanFeatureRoute` / `strictAdminOnly` gating from nav config in the launcher.
- `listFilings` history shape must be parsed exactly as `FilingsDashboard.tsx` already
  does (reuse that parsing).
- Do not break the URL view-mode router in `Payroll.tsx` (keep all handler props).
- Confirm with design: keep `PayrollFeaturesPage` route or delete (see Open Decisions).

## 6. Validation
- `npm run build` (or `tsc`) passes; lint passes; no backend edits.
- Dashboard shows the module launcher with working **search + category filter**.
- Compliance board reflects real run/filing state for the selected month and allows
  generate/download via existing endpoints.
- To-Do rail surfaces pending processing / ungenerated filings with working links.
- All existing payroll flows (process, lock, approve, release, disburse, payslips,
  filings) remain functional and unchanged in behaviour.

## 7. Open decisions (recommendations)
- **Retire `PayrollFeaturesPage`** (recommended) vs keep route rendering the launcher.
- **Launcher placement:** on the main dashboard (recommended, Zoho/greytHR style) vs a
  dedicated tab.
- **Compliance board vs `FilingsDashboard`:** embed board on dashboard AND keep
  detailed `FilingsDashboard` behind an "Advanced / All Filings" launcher entry
  (recommended), vs replace it.
