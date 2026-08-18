# BUILD BRIEF — Part 2: Basic/HRA-only overrides, amount mode in Custom breakdown, CSV bulk override

Extends `docs/OVERRIDE_MODULE_BRIEF.md` (Part 1). Read Part 1 first and finish its Definition of
Done before or alongside this — Part 2 depends on Part 1's `store()` pipeline. Same branch
(`payroll/override-module`), same rules: read `CLAUDE.md`, org scope via the trait, decimal money,
`date:Y-m-d` casts, failure NAMES vs baselines, `npx tsc --noEmit` at 0.

Three deliverables, in this order:

- **A.** Restrict overridable components to **Basic and HRA only** (Keka-style gating, phase 1)
- **B.** Salary Breakdown → Custom mode: enter Basic and HRA as **₹ amounts**, not only percentages
- **C.** **CSV bulk override**: export current Basic/HRA per employee → admin edits → upload →
  validate per-row → apply as pending overrides

Keka mechanics verified against help.keka.com (Aug 2026), reuse verbatim where quoted:
- Bulk button is literally **"Import Component Overrides"**: *"Use the Import Component Overrides
  (3) button to override the salary component amounts in bulk."*
- Values are ANNUAL: *"The override amount that you enter should be the Annual amount and not
  monthly amount for the salary component."*
- Errors are per-row, grouped by column, three-part pattern **Error Name / Error Details /
  Ways to Fix**, with a downloadable error report and re-upload after fixes. NOT whole-file
  rejection.
- UNVERIFIED in Keka's docs: whether their template is pre-filled with current values. We do the
  better thing regardless: our export IS the template, pre-filled (round trip).

---

## A. Gate overrides to Basic and HRA only

### A1. Amendment to Part 1 §3.2 check (a) — the salary_components gate is unreliable as sole gate
The audit established `salary_components` is sparsely populated (the dynamic component model is
orphaned; the run engine reads fixed columns). If store() requires a gated `salary_components`
row, orgs without rows for basic/hra can never override anything.

Replace check (a) with a two-layer gate:
```php
// PayrollOverrideController — phase-1 whitelist, single source of truth
public const PERMITTED_COMPONENT_TARGETS = ['basic', 'hra'];
```
1. `target` must be in `PERMITTED_COMPONENT_TARGETS`, else 422
   `"Only Basic and HRA can be overridden at employee level in this phase."`
2. IF a `salary_components` row exists in this org with matching `code`, additionally require
   `allow_employee_override = true` (admin can switch a permitted component OFF; cannot switch
   others ON — the whitelist caps it).

### A2. Seed migration (new, guarded)
`2026_08_18_0000xx_seed_override_gates_for_basic_and_hra.php`: for every organization that has
`salary_components` rows with codes `basic` / `hra`, set `allow_employee_override = true` on
those two and `false` on all others. Orgs with no rows: no-op (whitelist covers them).

### A3. UI consequence
The override dialog's component picker (Part 1 §4.3) lists exactly Basic and HRA. The
`PayGroupSettings` gate checkbox (Part 1 §4.4) renders for all components but is DISABLED with
tooltip "Not yet overridable" for components outside the whitelist.

---

## B. Amount mode in Salary Breakdown → Custom

### Current state (read these before editing)
- `frontend/src/pages/payroll/SalaryBreakdownCards.tsx` — `CustomState` (lines ~54-61) holds
  `basic_percentage`, `hra_percentage`, `da_percentage`, `conveyance_amount`, `nps_percentage`,
  `vpf_percentage` as STRINGS (comment explains why: half-typed "4" must not snap to 0).
  `CUSTOM_FIELDS` (~63-70) carries labels + hints ("% of CTC", "% of Basic"). 400ms debounce via
  `useDebouncedValue`. Params flow through `customParams` memo → `payrollApi.
  getEmployeeSalaryBreakdown(userId, { custom })`.
- `frontend/src/services/api.ts` ~3179 — `getEmployeeSalaryBreakdown` `custom` object type.
- `backend/routes/api/protected/payroll.php:201` → `EmployeePayrollCardController::breakdown`.
- `backend/app/Services/SalaryBreakdownService::forEmployee()` — takes a possibly transient
  `SalaryTemplate` (its own comment: "The structure may be a transient, unsaved model carrying an
  admin's custom percentages"). Percentages stored 0–100 on the template; converted to fractions
  before `calculateSalaryComponents`. Getting 0–100 vs fraction wrong inflates basic 100× — the
  service comment warns about exactly this.

### B1. Frontend — unit toggle for Basic and HRA only
- Extend `CustomState`:
  `basic_unit: 'percent' | 'amount'`, `basic_amount: string`,
  `hra_unit: 'percent' | 'amount'`, `hra_amount: string`.
  Defaults `'percent'`; amounts default `''`.
- For the Basic and HRA rows only, render a small two-chip toggle (`%` | `₹`) right of the label,
  styled like the existing mode toggle (`structure`/`custom` chips, ~line 484). DA/NPS/VPF/
  Conveyance rows unchanged.
- When unit = `amount`: input placeholder "₹ / month", helper text below shows the annual
  equivalent `≈ ₹{x*12}/yr` (format `toLocaleString('en-IN')`). Keep the string-state pattern —
  do NOT convert on keystroke.
- `customParams` memo: send `basic_amount` (number, monthly ₹) INSTEAD of `basic_percentage`
  when unit is amount; likewise `hra_amount` instead of `hra_percentage`. Never send both for
  the same head — the backend treats amount as authoritative if both arrive, but the client must
  not rely on that.
- `api.ts` — extend the `custom` param type with `basic_amount?: number; hra_amount?: number;`
  keeping the existing comment style ("Every parameter is a what-if…").

### B2. Backend — convert amounts to the transient template's percentages
In `EmployeePayrollCardController::breakdown`, where the transient custom `SalaryTemplate` is
built:
- Validate `custom.basic_amount` / `custom.hra_amount` as `nullable|numeric|min:0|max:10000000`.
- Conversion (guarding every denominator):
  ```php
  // amounts are MONTHLY rupees; template percentages are 0–100
  if ($basicAmount !== null && $monthlyCtc > 0) {
      $template->basic_percentage = min(100, $basicAmount / $monthlyCtc * 100);
  }
  $basicMonthly = $monthlyCtc * $template->basic_percentage / 100;
  if ($hraAmount !== null && $basicMonthly > 0) {
      $template->hra_percentage = $hraAmount / $basicMonthly * 100;  // may exceed 100 — allowed
  }
  ```
  Order matters: resolve basic first (HRA's base). If `basic_amount` alone is sent, HRA keeps
  its percent-of-basic meaning and therefore MOVES — that is correct and matches the engine.
- No service changes needed: `SalaryBreakdownService` already handles over-allocation (residual
  < 0 becomes a warning, never a negative row — lines ~148-156). An amount that over-allocates
  surfaces through that existing warning. Do not add a second warning path.
- Rounding: ₹→%→₹ round-trip may drift by paise. Acceptable in a what-if panel; add one line to
  the panel's read-only note: figures are estimates to the nearest rupee.
- This panel stays READ-ONLY (api.ts's own comment: "this endpoint writes nothing, and the
  Salary Breakdown panel has no save path"). Do NOT add a save path here. Optional deferred
  (do not build now): a "Create override from this" button handing the typed amounts to the
  override dialog.

---

## C. CSV bulk override — export, edit, upload

### C1. Model amendment — unit and source
Pin what Part 1 left implicit, and add provenance:
- **`payroll_overrides.value` for scope `component` is ALWAYS the ANNUAL amount** (Keka parity;
  the dialog already says "Annual value (₹/year)"). `OverrideApplicationService` divides by 12
  at apply time. Add a `// UNIT:` comment on the column in a new migration and on the model.
- New guarded migration `2026_08_18_0000xx_add_source_to_payroll_overrides.php`:
  `source string(16) default 'ui'` (`'ui' | 'import'`), `import_batch_id string(40) nullable`,
  index on `(organization_id, import_batch_id)`. Add both to `$fillable`. Audit rows for
  imported overrides carry the batch id in `after_json`.

### C2. Export endpoint
`GET /payroll/operations/overrides/export` → CSV download (same admin group).
One row per active employee with a payroll template (`annual_ctc > 0`), org-scoped via the trait.

Columns, exactly, in this order:
```
employee_number,email,employee_name,annual_ctc,
basic_current_annual,basic_overridden,basic_new_annual,
hra_current_annual,hra_overridden,hra_new_annual,
balance_mode,effective_from,effective_to,reason
```
- `*_current_annual`: the EFFECTIVE annual value — engine-computed
  (`calculateSalaryComponents` on the employee's template, ×12) unless an approved override is
  in force for the export month, in which case the override's value. `*_overridden` = `yes|no`.
- `*_new_annual`, `balance_mode`, `effective_from`, `effective_to`, `reason` exported EMPTY —
  these are the write columns.
- CSV rules: UTF-8 with BOM (Excel-safe), all fields quoted, `employee_number` written as text.
  Use `fputcsv` on a temp stream; no new composer dependency.

### C3. Import — two-step: validate, then apply
**`POST /payroll/operations/overrides/import/validate`** (multipart `file`, ≤2 MB, ≤2000 data
rows, else 422). Parse with `str_getcsv` per line; tolerate BOM; header row must match C2's
names (order-insensitive; unknown columns 422 naming them).

Per-row semantics:
- Identify employee by `employee_number` (trimmed, as text — leading zeros preserved); if blank
  or unmatched, fall back to `email`; both failing → row error `Employee not found`.
- Blank `basic_new_annual` AND blank `hra_new_annual` → row is a no-op (counted as skipped,
  not an error).
- `*_current_annual`, `*_overridden`, `employee_name`, `annual_ctc` are IGNORED on import —
  current values are re-derived server-side. Never trust the file's "current".
- Defaults: `balance_mode` blank → `preserve_ctc`; `effective_from` blank → first day of NEXT
  month (the deliberate next-month default the retired `SalaryRevisionService` encoded);
  `reason` blank on a row that sets a value → row error `Reason is required`.
- Each row with values runs the SAME checks as single `store()` (Part 1 §3.2 b–d + whitelist A1),
  plus **joint residual assessment** when both basic and hra are set (C5).
- Response: `{batch_token, summary: {total, valid, errors, skipped}, rows: [{row, employee,
  status: 'valid'|'error'|'skipped', errors: [{name, details, fix}], residual_after?,
  max_permitted?}]}`. The three-part error shape is deliberate — it is Keka's
  **Error Name / Error Details / Ways to Fix** pattern. `batch_token` = random 40-char id;
  cache the validated payload under it for 30 minutes (`Cache::put`), keyed to org + user.

**`POST /payroll/operations/overrides/import`** body `{batch_token}` → applies VALID rows only
(partial import is the explicit decision, matching Keka's fix-and-reupload model): creates
`pending` overrides with `source='import'`, `import_batch_id=batch_token`, `created_by=auth`.
Overlap check re-runs inside a transaction at apply (the cache may be stale). Returns
`{created, skipped, errors}` plus, when errors remain, `error_csv` — the original rows that
failed with two appended columns `error_name,error_fix`, base64 in JSON for the client to
download. Maker-checker unchanged: imported rows are `pending`; a DIFFERENT admin approves from
the register (bulk-approve may select many; self-created rows stay unapprovable by creator).

### C4. Frontend — OperationsTab toolbar
Two secondary `Button`s beside "New Override": **Export CSV** (calls export, saves via blob
download `overrides-basic-hra-YYYY-MM.csv`) and **Import CSV** → new
`frontend/src/components/payroll/overrides/ImportOverridesDialog.tsx`:
- Step 1: file picker (accept `.csv`) + the two-line explanation: export first, fill only the
  `*_new_annual` columns, values are ANNUAL.
- Step 2 (after validate): summary chips (valid / errors / skipped) + row table reusing the
  register's badge styles; error rows show `name` with `details/fix` in a `title`. Primary
  action **Apply N valid rows** (disabled at 0); secondary **Download error rows** when errors
  exist. On apply: toast, `invalidateQueries` on the register, close.
- All numbers rendered from API responses. No client-side re-validation, no client-side math.

### C5. Balancer generalisation — HRA is not Basic
`OverrideBalancingService::assess()` currently reasons about basic only. Generalise WITHOUT
changing existing callers' behaviour:
- Basic override, HRA not overridden: current behaviour — HRA derives, factor ≈ 1+h+p+g.
- HRA override alone: HRA is PINNED; nothing derives from HRA and employer costs key off basic,
  so `Δresidual = −Δhra` exactly (factor 1.0).
- BOTH pinned (the joint CSV case): do not use factors at all — recompute directly:
  ```
  residual_after = monthlyCtc − employerPF(newBasic) − gratuity(newBasic)
                 − newBasic − newHra − conveyance
  ```
  Reject the row when `residual_after < −0.01`, reporting `max_permitted` for the field the row
  set (if both set, report against basic with HRA held at its new value).
- `OverrideApplicationService` must PIN an overridden HRA — skip the percent-of-basic
  derivation for that employee — and record the pin in `cascade_snapshot`.

### C6. Tests
Backend `tests/Feature/OverrideImportTest.php`:
export→edit→validate→apply round trip creates pending rows with annual values; blank new-cells
skip; unknown employee errors with the three-part shape; missing reason errors; joint basic+hra
row that over-allocates is rejected with `max_permitted`; valid rows apply while error rows do
not (partial); re-validate after fix succeeds; `*_current_annual` in the file is ignored;
employee_number leading zeros survive; batch token expiry → 422; imported rows carry
`source='import'` + batch id; creator cannot approve own imported rows.
Backend `tests/Feature/OverrideBalancerTargetsTest.php`: hra-alone factor is exactly 1.0;
joint recompute matches the closed formula above; basic-alone behaviour unchanged
(regression-pin existing assess outputs).
Amount-mode test in `tests/Feature/EmployeeSalaryBreakdownTest.php` (extend if exists, create
if not): `basic_amount` produces the same breakdown as the equivalent percentage ±₹1;
`hra_amount` with zero basic yields a warning, not a division error.
Playwright `tests/e2e/payroll-overrides.spec.ts` (extend): Custom mode ₹/% toggle renders and
the annual helper updates; Export CSV downloads with the exact C2 header; import of a crafted
2-row file (1 valid, 1 missing reason) shows 1 valid + 1 error and applies exactly 1.

### C7. Definition of done (Part 2)
- [ ] Whitelist gate live; only Basic and HRA offered anywhere in the UI
- [ ] Custom mode accepts ₹ amounts for Basic/HRA; backend converts with guarded denominators;
      panel remains read-only
- [ ] Export CSV pre-filled per C2; import validates per-row with Error Name/Details/Fix,
      applies partially, produces an error CSV for re-upload
- [ ] `value` unit pinned as ANNUAL end-to-end; apply divides by 12 in one place only
- [ ] HRA pinning + joint residual recompute in balancer and application service, tested
- [ ] No new composer/npm dependencies; `tsc` 0; no new failing test NAMES in either suite
