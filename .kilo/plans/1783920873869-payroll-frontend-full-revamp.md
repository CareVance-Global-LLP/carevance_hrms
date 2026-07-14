# Payroll Frontend Full Revamp — Admin Sidebar Modules

**Goal:** Bring every **admin Payroll sidebar module page** up to the same modern,
consistent design standard as the recently-revamped Payroll dashboard
(`PayrollDashboard.tsx` + `PayrollModuleLauncher` / `ComplianceStatusBoard` /
`PayrollToDoRail`). Standardize presentation + interactions; **do not change
backend or business logic / API calls.**

## Scope (locked with user)

- **IN:** the 14 admin Payroll sidebar module pages (see task list).
- **OUT:** ESS `MyPayroll.tsx` (already modern — reference only), the in-page
  router views reached from the dashboard launcher (`SalaryComponents`,
  `PayGroupSettings`, `EmployeePayrollCards`, `DepartmentTemplates`,
  `UnassignedEmployees`, `PayGroupEmployees`, `BulkPayrollMatrix`), Payroll
  Setup wizard pages, and all backend code.

## Decisions (resolved)

1. **Approach:** Build a small set of shared UI primitives first, then apply a
   standardization "recipe" per page. No page logic/API rewrites.
2. **Interactions:** Upgrade UX — replace `prompt()`/`window.confirm` with a
   reusable reject-reason modal + confirm dialog, and wire `useToast` into every
   create/approve/reject/generate/save mutation (`onSuccess` + `onError`).
   Underlying API calls stay identical.

## Reference implementations (match these patterns)

- `frontend/src/components/payroll/PayrollDashboard.tsx`,
  `PayrollModuleLauncher.tsx`, `ComplianceStatusBoard.tsx`, `PayrollToDoRail.tsx`
- `frontend/src/pages/MyPayroll.tsx` (already uses `MetricCard`, `StatusBadge`,
  `useToast`, `PageHeader`, teal accent)

## Confirmed reusable primitives (DO NOT reinvent)

- `@/components/dashboard/PageHeader` — `title`, `description`, `actions`
- `@/components/dashboard/SurfaceCard`
- `@/components/dashboard/MetricCard` — `label`, `value`, `hint`, `icon`,
  `accent: 'sky'|'emerald'|'violet'|'amber'|'rose'|'slate'` (fixed union)
- `@/components/ui/StatusBadge` — `tone: 'neutral'|'info'|'success'|'warning'|'danger'`
- `@/components/ui/PayrollStatusBadge` — for actual payroll-run statuses
- `@/components/ui/PayrollAmount` + `formatPayrollAmount(value, { compact })`
- `@/components/ui/PageState` — `PageLoadingState`, `PageErrorState`, `PageEmptyState`, `FeedbackBanner`
- `@/components/ui/Toast` — `useToast().show({ kind, message, durationMs })`
- `@/components/ui/FormField` — `TextInput`, `SelectInput`, `TextareaInput`, `FieldLabel`
- `@/components/ui/InfoTooltip`, `@/components/ui/MonthPicker`
- `@/components/payroll/HowItWorksCard` (keep on pages that already use it)

## Key findings from audit (drivers for this work)

- **Real bug — broken colors:** Multiple pages render stat cards with dynamic
  Tailwind classes `text-${s.color}-600` (Arrears, LeaveEncashment, FnF, FBP,
  SalaryRevision, TaxProofsReview, and report-type chips in PayrollReports).
  `tailwind.config.js` has **no `safelist`** and JIT only scans literal strings,
  so these classes are never generated → labels render with no/incorrect color.
  Replacing these with `MetricCard` (fixed `accent` union) fixes it.
- **Inconsistent status pills:** inline conditional `bg-*/text-*` ternaries
  instead of `StatusBadge`/`PayrollStatusBadge`.
- **Inconsistent currency:** inline `₹…toLocaleString('en-IN')` and even
  `"Rs "` (TaxDeclaration) instead of `formatPayrollAmount`.
- **Poor feedback:** `prompt()` for reject reasons; several mutations have no
  success/error feedback (silent) or ad-hoc inline banners.
- **Accent:** `tailwind.config.js` already remaps `blue-*` → teal `#5D969D`, so
  most existing "blue" already renders teal. Standardize **icon chips** to
  `bg-[rgba(93,150,157,0.1)] text-[#5D969D]` to match new components; avoid new
  brand colors.

---

## Phase 0 — Shared primitives (do first)

1. **`NEW frontend/src/components/ui/ConfirmDialog.tsx`**
   - Generic confirm modal: props `isOpen`, `title`, `message`, `confirmLabel`,
     `cancelLabel`, `tone?: 'danger'|'default'`, `onConfirm`, `onClose`,
     `isLoading?`. Fixed-inset overlay + `SurfaceCard`, model after existing
     `components/payroll/ProcessAndPayModal.tsx` / `PayGroupModal.tsx` structure.
2. **`NEW frontend/src/components/ui/RejectReasonModal.tsx`**
   - Modal with a required `TextareaInput` reason; props `isOpen`, `title`,
     `onSubmit(reason: string)`, `onClose`, `isLoading?`. Disable submit until
     reason non-empty. Replaces every `prompt('Rejection reason:')`.
3. **`NEW frontend/src/utils/payrollStatus.ts`**
   - `payrollStatusTone(status?: string): 'neutral'|'info'|'success'|'warning'|'danger'`
     mapping domain statuses (`draft/pending`→warning, `approved`→success,
     `rejected/error/failed`→danger, `paid/disbursed`→success, `closed`→neutral,
     etc.) and a `titleCase(status)` helper for labels. Single source of truth so
     all pages badge statuses identically.
4. (Optional, only if it reduces churn) **`NEW frontend/src/components/payroll/PayrollStatCards.tsx`**
   - Thin wrapper rendering a responsive grid of `MetricCard` from a
     `{ label, value, accent, icon? }[]` config, to DRY the repeated 4–5 stat
     rows. If skipped, use `MetricCard` directly on each page.

## Phase 1 — List-management pages (identical recipe)

Apply this **recipe** to each (they share one template):
- Container: `min-h-screen bg-slate-50` → `PageHeader` → `p-6 max-w-7xl mx-auto space-y-6`.
- Stat row: replace dynamic-color custom cards with `MetricCard` (map color →
  `accent` union) — **fixes the color bug**.
- Status pills: replace inline ternaries with `StatusBadge tone={payrollStatusTone(status)}`.
- Currency: replace inline `₹…toLocaleString` with `formatPayrollAmount(v, { compact: true })`.
- Reject flow: replace `prompt()` with `RejectReasonModal`; destructive
  confirms with `ConfirmDialog`.
- Feedback: add `useToast().show(...)` to every mutation `onSuccess`/`onError`.
- Loading/empty: use `PageLoadingState` / `PageEmptyState` (keep existing table
  skeletons where present).
- Icon chips → teal (`bg-[rgba(93,150,157,0.1)] text-[#5D969D]`). Keep `HowItWorksCard`.

Tasks:
5. `frontend/src/pages/ArrearsPage.tsx`
6. `frontend/src/pages/LeaveEncashmentPage.tsx`
7. `frontend/src/pages/FnFSettlementsPage.tsx` (also has process-payment mutation → toast + confirm)
8. `frontend/src/pages/FBPPage.tsx` (allocate/claim forms — keep FormField modals; add toasts)
9. `frontend/src/pages/PerquisitesPage.tsx`
10. `frontend/src/pages/SalaryRevisionPage.tsx`
11. `frontend/src/pages/TaxProofsReview.tsx` (bulk-approve/review → toast + confirm)

## Phase 2 — Form / wizard / report pages (page-specific polish)

12. `frontend/src/pages/TaxDeclaration.tsx`
    - Replace `formatCurrency` `"Rs "` → `formatPayrollAmount`. Replace inline
      `successMessage` banner with `useToast`. Add a `StatusBadge` for
      declaration status; optional `MetricCard` summary of declared totals.
13. `frontend/src/pages/Loans.tsx`
    - Custom `formatCurrency` → `formatPayrollAmount`. Success banner → toast.
      Admin/employee stat cards → `MetricCard`. Reject `prompt()` →
      `RejectReasonModal`; close-loan confirm → `ConfirmDialog`. Status pills →
      `StatusBadge`.
14. `frontend/src/pages/PrePayrollChecklistPage.tsx`
    - Check-status pills → `StatusBadge` (`payrollStatusTone`). Stats →
      `MetricCard`. Toasts on validate/resolve. Empty/loading via `PageState`.
15. `frontend/src/pages/PayrollReportsPage.tsx`
    - Fix report-type card icon chips (dynamic color strings) → fixed teal/accent
      classes. Toasts on generate success/error. Standardize container + result
      rendering with `formatPayrollAmount`.
16. `frontend/src/pages/TaxSimulatorPage.tsx`
    - Replace all inline `₹…toLocaleString` → `formatPayrollAmount`. Add `onError`
      toasts (currently no error handling). Regime pills → `StatusBadge`. Keep
      3-tab layout; polish spacing/teal.
17. `frontend/src/pages/ReimbursementsPage.tsx` (large, ~1410 lines — highest care)
    - Apply currency helper, `StatusBadge` via `payrollStatusTone`, `MetricCard`
      for any stat tiles, toasts on submit/approve/reject, `RejectReasonModal`
      where `prompt()` is used. **Preserve all existing flows** (month filter
      persistence, file upload, admin/employee split). Do not restructure logic.
18. `frontend/src/pages/Filings.tsx` (thin tab wrapper)
    - Light polish only: tab underline already `blue-600` (renders teal) — leave
      or align to teal token. Inner dashboards (`FilingsDashboard`,
      `BankPayoutDashboard`, `ProofDocumentsCenter`) already use shared
      primitives; **only touch them if they exhibit the color-bug / silent
      mutation issues** (verify during implementation).

## Phase 3 — Validation

19. `npx tsc --noEmit -p tsconfig.json` passes (run in `frontend/`).
20. `npx eslint <changed files> --ext ts,tsx --max-warnings 0` clean for all
    changed/new files. (Note: a **pre-existing** unused-var lint error for
    `EmployeeOrManagerRoute` in `App.tsx` is unrelated and out of scope.)
21. Manual smoke per page: loads, stats show correct colors, status badges
    render, currency formatted, reject modal works, toasts fire on success/error,
    empty/loading states show. No console errors.

## Risks / constraints

- **No backend changes.** Only presentation + client-side interaction wiring.
- **Preserve data parsing:** several list queries use
  `res.data?.data ?? res.data ?? []` — keep exactly.
- **Preserve `MetricCard` accent union** — map arbitrary color strings onto the
  allowed set (`sky|emerald|violet|amber|rose|slate`); never pass raw colors.
- **Do not break admin/employee role splits** (Loans, Reimbursements use
  `useAuth()` role checks).
- **ReimbursementsPage is large** — change incrementally; keep flows intact.
- Keep `HowItWorksCard`, `MonthPicker`, and existing form validation as-is.

## Out of scope

- Backend/API, ESS `MyPayroll`, dashboard launcher in-page views, Payroll Setup
  wizard, sidebar nav config (`dashboardNavigation.ts`), and the pre-existing
  `App.tsx` `EmployeeOrManagerRoute` lint warning.

## Open questions

- None blocking. During Phase 2/Filings, confirm whether `FilingsDashboard` /
  `BankPayoutDashboard` / `ProofDocumentsCenter` need the same recipe (only if
  they show the color-bug or silent mutations); otherwise leave untouched.
