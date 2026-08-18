# BUILD BRIEF — Payroll Override Module (backend completion + full UI)

You are working in `D:\Caretime` (CareVance HRMS: Laravel 12 backend, React 18 + Vite + TS frontend).
Read `CLAUDE.md` at repo root first and obey every rule in it. Work on a branch:
`git checkout -b payroll/override-module`. Do not touch `main` directly.

Your mission: **finish the payroll override module** — the write path, the audit trail, engine
wiring, and the complete UI. The read path and the arithmetic already exist in this repo from a
previous session. Do not rebuild what exists; extend it. Accuracy of money math and exactness of
UI conventions are the two grading criteria.

---

## 1. What ALREADY EXISTS — do not recreate, do not modify semantics

### Migrations (all under `backend/database/migrations/`)
- `2026_08_17_000040_add_residual_role_to_salary_components.php` — adds `is_residual`,
  `allow_employee_override` (and related) to `salary_components`
- `2026_08_17_000050_create_payroll_overrides_table.php` — the store. Columns:
  `organization_id, user_id, scope('component'|'statutory'|'adhoc'|'lop'|'hold'), target(64),
  mode('fixed'|'percentage'), value dec(14,2), computed_value dec(14,2) nullable,
  balance_mode('preserve_ctc'|'increase_gross') nullable, balancing_target_id nullable,
  cascade_snapshot json nullable, effective_from date, effective_to date nullable,
  reason text (required), status('pending'|'approved'|'rejected'|'cancelled'),
  created_by, approved_by, approved_at, timestamps` + indexes
- Also present: `000010` statutory_wage_base, `000020` statutory_slabs, `000030`
  payroll_item_versions, `000060` per-employee lock. Leave them alone.

### Models
- `backend/app/Models/PayrollOverride.php` — `STATUS_*` constants, casts (`decimal:2`,
  `date:Y-m-d`), `scopeInForceFor($monthYear)`, `delta()`, `isOpenEnded()`.
  **CHECK:** if it does not `use App\Traits\BelongsToOrganization`, add it —
  `tests/Feature/TenantIsolationTest.php` fails otherwise. Never hand-write
  `where('organization_id', ...)`.

### Services (`backend/app/Services/Payroll/`)
- `OverrideBalancingService.php` — THE arithmetic. Public surface:
  `resolveResidual(int $orgId, ?int $exclude)`, `hasAmbiguousResidual(int $orgId)`,
  `assess(float $monthlyCtc, array $config, float $requestedBasic, string $mode)` returning
  `{permitted, mode, requested, current, amplification, residual_before, residual_after,
  max_permitted, message}`. It refuses when the residual would go below −0.01 and names
  `max_permitted`. **Never re-derive this math anywhere else — frontend displays what the API
  returns, nothing more.**
- `OverrideApplicationService.php` — applies in-force overrides during a run.
- `ClosedRunWriteContext.php`, `PayrollComparisonService.php`, `StatutorySlabResolver.php`,
  `CodeOnWagesService.php` — present; do not modify except where §3.3 says.

### Controller + routes
- `backend/app/Http/Controllers/Api/PayrollOverrideController.php` has **only** `preview()` and
  `index()`.
- `backend/routes/api/protected/payroll.php` lines ~422–423:
  `GET /payroll/operations/overrides` → index, `POST /payroll/operations/overrides/preview` → preview.
  Both sit in the `role:admin,manager` + `plan.payroll` group.
- Detective reports live at `GET /payroll/reports/{differences,negative-cost,duplicates,reconciliation}`.

### Existing API contracts (keep exactly)
`POST /payroll/operations/overrides/preview` body `{user_id, target, value, balance_mode?}` →
`{success, preview: {...assess() fields, balancing_target, balancing_target_id}, employee_explanation}`.
Preview returns refusals as **200** (it answers "what would happen"); only store() may 422.
`GET /payroll/operations/overrides?month=YYYY-MM&user_id=` →
`{success, data: [{id, user_id, scope, target, value, computed_value, delta, effective_from,
effective_to, open_ended, status, reason}]}`.

---

## 2. The model — non-negotiable rules

1. **An override SHADOWS the structure; it never mutates it.** `employee_payroll_templates` and
   `salary_templates` are never written by this module. Remove the override → structure value
   simply applies again.
2. **Saving an override changes NOTHING.** It applies only when payroll is processed
   (Keka: "Perform Process Payroll to update the override information"). Status `pending` →
   `approved` → picked up by the next process of an open run. Never recompute payroll on save.
3. **One lifetime.** `effective_from` + nullable `effective_to`. Open-ended = permanent.
   No other lifetime concept may be introduced.
4. **Both values kept.** `computed_value` (what the engine would have produced) is written by the
   ENGINE at apply time — not by the controller, not by the UI.
5. **Synchronous validation at store.** If `assess()` says `permitted: false` for a
   `preserve_ctc` component override → **422** including `max_permitted` and the balancer's
   message. Never clamp, never allow a negative residual, never silently drop components.
6. **Maker–checker.** `created_by !== approver`. Self-approval returns 422. Follow the existing
   precedent in `LoanController.php:144-149`.
7. **Append-only audit.** Every transition (created / approved / rejected / cancelled / applied)
   writes an audit row. No UPDATE, no DELETE on the audit table, ever.
8. **Money is `decimal:2`**, dates cast `'date:Y-m-d'` (a plain `'date'` cast ships a day early
   in IST — see CLAUDE.md). No bare `catch {}`.

---

## 3. BACKEND work

### 3.1 New migration: `payroll_override_audits`
`id, organization_id, payroll_override_id FK, action('created'|'approved'|'rejected'|'cancelled'|'applied'),
actor_id nullable, before_json nullable, after_json nullable, note nullable, created_at`.
Guard with `Schema::hasTable`. Model `PayrollOverrideAudit` with `BelongsToOrganization`,
`$timestamps = false` + explicit `created_at`, and **no** `updated_at`.

### 3.2 Controller methods (extend `PayrollOverrideController`)
- `store(Request)` — validate:
  `user_id required|integer` (must resolve inside the org via scoped `User` query),
  `scope required|in:component,statutory,adhoc,lop,hold` (phase 1 accepts `component` and
  `statutory`; return 422 "not yet supported" for the rest),
  `target required|string|max:64`,
  `mode in:fixed,percentage` default fixed,
  `value required|numeric|min:0|max:100000000`,
  `balance_mode nullable|in:preserve_ctc,increase_gross` (required when scope=component),
  `effective_from required|date_format:Y-m-d`,
  `effective_to nullable|date_format:Y-m-d|after_or_equal:effective_from`,
  `reason required|string|min:5`.
  Checks, in order: (a) component scope → target must be a `salary_components` row in this org
  with `allow_employee_override = true`, else 422 naming the gate; (b) `hasAmbiguousResidual`
  → 422; (c) component + preserve_ctc → run `assess()`; `permitted:false` → 422 with
  `max_permitted`; (d) overlap: an existing non-rejected/cancelled override for the same
  `(user_id, scope, target)` whose date range intersects → 422 "close the existing override
  first". Create with `status: pending`, `created_by: auth id`, snapshot `balancing_target_id`.
  Write audit `created`. Return 201 with the same row shape as index().
- `approve($id)` — 404 via scoped find; must be `pending`; `created_by === auth id` → 422
  self-approval; set approved/approved_by/approved_at; audit `approved`.
- `reject($id)` — same guards; requires `note` in body (min 5); audit `rejected` with note.
- `cancel($id)` — for `pending` or `approved`; sets `cancelled`; if it was approved and
  open-ended, set `effective_to = today` instead of cancelling history retroactively — past
  applied months are untouched; audit `cancelled`.

### 3.3 Routes (add below the two existing lines, same group)
```php
Route::post('/operations/overrides', [PayrollOverrideController::class, 'store']);
Route::post('/operations/overrides/{id}/approve', [PayrollOverrideController::class, 'approve']);
Route::post('/operations/overrides/{id}/reject', [PayrollOverrideController::class, 'reject']);
Route::post('/operations/overrides/{id}/cancel', [PayrollOverrideController::class, 'cancel']);
```

### 3.4 Engine wiring — BOTH engines, verify before assuming
Two live engines exist: `PayrollDepartmentController::processEmployeePayroll` (driven by the
queued job `ProcessPayrollRunEmployees`) and `PayrollAutoProcessService::calculateAllItems`
(driven by `/payroll/auto/quick-process`). Grep both for `OverrideApplicationService`. Wherever
it is not consulted, wire it so that: overrides resolve **after** structure resolution and
**before** statutory computation; component overrides cascade (HRA recomputes from new basic,
residual absorbs via the balancer, PF/ESI/PT/TDS recompute from new bases); statutory-scope
overrides are TERMINAL (the stated figure wins; nothing downstream recomputes from it). At apply
time write `computed_value` and `cascade_snapshot` onto the override row and audit `applied`
(once per override per run, idempotent — re-processing the same run must not duplicate audits).
The two engines must produce identical items for the same inputs — add a test asserting it for
one overridden employee.

### 3.5 Backend tests (`backend/tests/Feature/`)
`PayrollOverrideStoreTest` — happy path; gate refusal; ambiguous residual; negative-residual 422
carries `max_permitted` equal to the balancer's figure; overlap refusal; reason required.
`PayrollOverrideApprovalTest` — self-approval blocked; reject requires note; cancel of approved
open-ended sets effective_to.
`PayrollOverrideApplicationTest` — approved override changes the processed item; pending does
not; expired (`effective_to` past) does not; `computed_value` and `cascade_snapshot` populated;
both engines agree; removing (cancelling) then reprocessing an OPEN run restores the structure
value.
`TenantIsolationTest` must keep passing.
Run `php artisan test` and compare failure **names** against `.github/baselines/phpunit.txt` —
never counts. Zero NEW failing names.

---

## 4. FRONTEND work — exact placement and conventions

Stack conventions (match precisely — read the named files first):
- Path alias `@/`; TanStack Query (`useQuery`, `useQueryClient`); API calls only through
  `payrollApi` in `frontend/src/services/api.ts`; auth via `useAuth()` +
  `hasStrictAdminAccess` from `@/lib/permissions`; `cn()` from `@/utils/cn`;
  `lucide-react` icons; Tailwind slate/blue palette exactly as `PayrollShell.tsx` uses
  (`border-blue-600 text-blue-600` active, `text-slate-500` inactive, `bg-slate-50` page,
  white cards `border-slate-200`); shared components `Button` (`@/components/ui/Button`) and
  `SurfaceCard` (`@/components/dashboard/SurfaceCard`).

### 4.1 Register the tab — `frontend/src/pages/payroll/PayrollShell.tsx`
- Extend the union: `export type PayrollTabId = 'overview' | 'run' | 'employee-pay' |
  'operations' | 'tax-compliance' | 'reports';`
- Insert into `PAYROLL_TABS` after `employee-pay`:
  `{ id: 'operations', label: 'Operations', path: '/payroll/operations', icon: SlidersHorizontal, strictAdminOnly: true }`
  (import `SlidersHorizontal` from lucide-react). `resolveActiveTab` needs no change.
- Register the route where the other five payroll tab routes are declared (find the router that
  mounts `PayrollShell` with an `<Outlet/>`; add `/payroll/operations` → `OperationsTab`).

### 4.2 `frontend/src/pages/payroll/tabs/OperationsTab.tsx` (new)
Layout: page intro line, then a segmented control with two sections —
**Override Register** (default) and **Statutory Overrides** (phase 2 placeholder: render the
register filtered to `scope === 'statutory'`).

Register section:
- Toolbar: month filter (`<input type="month">` styled like existing filters), employee search,
  and a primary `Button`: **New Override**.
- Table (inside `SurfaceCard`), columns exactly:
  Employee · Target · Value (annual, ₹ formatted `toLocaleString('en-IN')`) · Engine value
  (`computed_value` or an em-dash with title "known after next payroll process") · Δ ·
  Effective (from → to, or an `open-ended` slate badge) · Status badge · Reason (truncate,
  full text in `title`) · Actions.
- Status badges: pending `bg-amber-50 text-amber-700 border-amber-200`, approved
  `bg-emerald-50 text-emerald-700 border-emerald-200`, rejected `bg-red-50 text-red-700
  border-red-200`, cancelled `bg-slate-100 text-slate-500 border-slate-200`.
- Actions: Approve / Reject visible only when `status === 'pending'` AND the row's creator is
  not the current user (the API enforces it; the UI should not offer it). Cancel visible on
  pending + approved. Reject opens a small dialog requiring a note.
- Empty state: "No overrides in force. An override is a dated, per-employee exception to the
  salary structure — it applies at the next payroll process and never edits the structure."

### 4.3 `frontend/src/components/payroll/overrides/OverrideDialog.tsx` (new)
Two-step single dialog. **Step 1 (form):** employee picker (search against existing
employee-list API used elsewhere in payroll pages); component picker showing ONLY gated
components (`allow_employee_override`) — if none are gated, show an inline notice linking to
Pay Group Settings; annual value input labelled "Annual value (₹/year)"; balance mode radio —
"Hold CTC (residual absorbs)" default / "Increase gross (CTC rises — needs approval)";
effective-from month (required), effective-to month (optional, helper text "Leave empty = stays
until cancelled"); reason textarea (required, min 5 chars).
**Step 2 (preview):** on "Preview", call `payrollApi.overrides.preview(...)`; render a
before/after table from the response only — Current, Requested, Amplification (shown as
"each ₹1 of basic moves ₹{amplification} of allowance"), Residual before → after,
Max permitted. If `permitted === false`: red callout with the API `message`, a one-click
"Use max ₹{max_permitted}" button, and Save disabled. Below the table render
`employee_explanation` as a quoted block with a copy button. Save → `store` → toast → refresh
register via `queryClient.invalidateQueries`. **Never compute any of these numbers client-side.**

### 4.4 Gate — `frontend/src/pages/payroll/PayGroupSettings.tsx`
In the salary-components section, per recurring component add a checkbox:
"Allow this component to be overridden at employee level" bound to `allow_employee_override`,
persisted through the existing component-update call in that file. If the backend update
endpoint does not accept the field, extend its validation + `$fillable` accordingly.

### 4.5 `frontend/src/services/api.ts`
Add under the payroll section:
```ts
overrides: {
  list: (params?: { month?: string; user_id?: number }) => api.get('/payroll/operations/overrides', { params }),
  preview: (body: {...}) => api.post('/payroll/operations/overrides/preview', body),
  create: (body: {...}) => api.post('/payroll/operations/overrides', body),
  approve: (id: number) => api.post(`/payroll/operations/overrides/${id}/approve`),
  reject: (id: number, note: string) => api.post(`/payroll/operations/overrides/${id}/reject`, { note }),
  cancel: (id: number) => api.post(`/payroll/operations/overrides/${id}/cancel`),
},
```
Match the surrounding style exactly. While in the file, delete `getReviewQueue` (~line 2773) —
it calls `/payroll/filings/review/queue`, a route that does not exist.

### 4.6 What NOT to build now
No employees×components grid, no Excel import, no in-run panel in `RunPayrollTab`, no override
action on `SalaryBreakdownCards`. Phase 2. Do not leave half-built stubs for them.

---

## 5. Playwright spec — `tests/e2e/payroll-overrides.spec.ts`
Match house style (see `tests/e2e/tracker-remediation.spec.ts`): honest scope-limit header
comment, `test.describe.configure({ mode: 'serial' })`,
`test.use({ storageState: 'playwright/.auth/user.json' })`, BASE `http://localhost:5173`.
Cover: Operations tab visible for the admin fixture and reachable at `/payroll/operations`;
New Override → preview shows amplification and residual fields (assert the API response is
rendered, not recomputed — intercept the response and compare displayed numbers to it); a
value beyond `max_permitted` disables Save and shows the max; created row appears as
`pending`; self-approve attempt surfaces the API error; register month filter round-trips.
Skip gracefully (`test.skip`) when the seed org has no gated component.

---

## 6. Verification — run ALL before you claim done
```bash
cd backend  && php artisan test            # compare NAMES vs .github/baselines/phpunit.txt
cd frontend && npx tsc --noEmit            # must stay at 0 errors
cd frontend && npx vitest run              # names vs baseline, not counts
npx playwright test tests/e2e/payroll-overrides.spec.ts
```
A 405 in a payroll test = dead test (route removed): delete it. A 422 = a guard refusing your
fixture: read the response body, fix the fixture, not the guard.

## 7. Definition of done
- [ ] store/approve/reject/cancel live, guarded, org-scoped via the trait, audited append-only
- [ ] negative-residual store rejected 422 with `max_permitted` matching the balancer exactly
- [ ] both engines consult `OverrideApplicationService`; identical output test passes
- [ ] apply-time writes `computed_value` + `cascade_snapshot`; idempotent on reprocess
- [ ] Operations tab registered exactly as §4.1; UI matches §4.2–4.4; zero client-side math
- [ ] `tsc` 0 errors; no NEW failing test names in either suite; Playwright spec green
- [ ] structures, closed runs, and other employees provably untouched (covered by tests)

Anything ambiguous: prefer the narrower behaviour and leave a `// DECISION:` comment naming the
alternative. Do not widen scope beyond this brief.
