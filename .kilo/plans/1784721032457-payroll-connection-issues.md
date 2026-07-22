# Payroll Module Deep Analysis — Architecture & Connection Issues

## Executive Summary

The Caretime payroll module is a large dual-era system: a **legacy** per-employee single-period model (`Payroll`, `PayrollProfile`, `PayrollAdjustment`) and a **modern** run-based model (`PayrollMonthlyRun`, `PayrollItem`, `EmployeePayrollTemplate`). Some services, controllers, and the burn-rate dashboard still read from the legacy tables, while all modern processing writes only to the new tables. This creates a fundamental data-divergence problem.

---

## 1. Database Layer

### Tables

| Table | Model | Era | Used By |
|---|---|---|---|
| `payrolls` | `App\Models\Payroll` | Legacy | `PayrollBurnRateService`, `OffCyclePayrollService` |
| `payroll_monthly_runs` | `App\Models\PayrollMonthlyRun` | Modern | `PayrollAutoProcessService`, `PayrollFilingService`, `PayrollRegisterService`, all filing/reporting endpoints |
| `payroll_items` | `App\Models\PayrollItem` | Modern | Core per-employee calculation carrier |
| `employee_payroll_templates` | `App\Models\EmployeePayrollTemplate` | Modern | `PayrollAutoProcessService`, `PayrollFilingService`, all controllers |
| `department_payroll_templates` | `App\Models\DepartmentPayrollTemplate` | Modern | `EmployeePayrollTemplate::getOrCreateForUser` default resolution |
| `payroll_profiles` | `App\Models\PayrollProfile` | Legacy | No modern code reads/writes this; only linked from `PayrollAdjustment` |
| `payroll_filings` | `App\Models\PayrollFiling` | Modern | `PayrollFilingService`, all filing endpoints |
| `payroll_run_checklists` | `App\Models\PayrollRunChecklist` | Modern | `PayrollChecklistService`, reconciliation endpoints |
| `payroll_checklist_items` | `App\Models\PayrollChecklistItem` | Modern | `PayrollChecklistService` |
| `reimbursement_payroll_links` | `App\Models\ReimbursementPayrollLink` | Modern | `PayrollAutoProcessService::autoSyncReimbursements` |
| `payroll_reconciliations` | `App\Models\PayrollReconciliation` | Modern | `autoSyncAttendance`, `PayrollAutoProcessController` |
| `stop_payment_flags` | `App\Models\StopPaymentFlag` | Modern | `PayrollAutoProcessService::autoApplyHolds` |

### Run Lifecycle (PayrollMonthlyRun.status)

```
draft → processing → locked → approved → released → disbursed (terminal)
                                            ↑           ↑
                                      can rollback   can rollback
                                      to locked      to approved
```

`isImmutable()` returns true at `disbursed`. Terminal state has no outgoing transitions.

---

## 2. Service Layer Map

### Core Calculation

- **`PayrollCalculatorService`** — Single source of truth for tax math. Computes:
  - Salary components (basic, HRA, conveyance, special allowance)
  - PF (capped ₹15,000, employee 12%, employer → EPS 8.33% + EPF 3.67%)
  - ESI (employee 0.75%, employer 3.25%, threshold ₹21,000)
  - PT via `PTStateService`
  - TDS (new regime: 115BAC slabs + ₹75,000 standard deduction; old regime: full exemptions)
  - Gratuity (4.81% of basic)
  - HRA exemption (old regime)
  - Handles both FY via `getCurrentFinancialYear()` (Apr–Mar)

- **`PayrollAutoProcessService`** — Orchestrates the full payroll run.
  - Process entry: `processForUsers()` (single source of truth for all scopes)
  - Creates/gets run, syncs employees, attendance, leaves, reimbursements, FBP, variable pay, perquisites
  - Applies stop-payment holds (deletes held items)
  - Calculates all items (writes to `payroll_items`)
  - Validates run, auto-generates filings

- **`PayrollFilingService`** — Generates statutory export files (PF ECR, ESI CSV, Form 24Q XML, Form 16 PDF, Form 12BA PDF, PT return, LWF return, Bonus Form C)

### Validation

- **`PayrollValidationService`** — Runs 6 checks on a finished run (items present, net pay > 0, deductions valid, no negative salaries, gross > 0, bank accounts present)
- **`PayrollChecklistService`** — Per-item checklist (missing bank, PAN, template, attendance, declarations) stored in `payroll_run_checklists`
- **`PayrollFilingValidatorService`** — Per-filing pre-flight validation (org config, UAN present, PF cap, etc.)

### Other Services

- **`PayrollPdfService`** — Dompdf-based payslip, Form 16, Form 12BA, Bonus Form C PDF rendering
- **`PayrollRegisterService`** — Payroll register + statutory registers (PF, ESI, PT, TDS) + bank reconciliation
- **`PayrollBurnRateService`** — Burn-rateWidget (⚠️ reads **legacy** `payrolls` table)
- **`OffCyclePayrollService`** — Bonus/incentive/lumpsum/FNF payouts (⚠️ uses `Payroll` model)
- **`ProductivityPayrollService`** — Productivity score → variable pay (⚠️ references non-existent `PayrollRun` model)
- **`PayrollApprovalService`** — N-level approval workflow (⚠️ references non-existent `PayrollRun` model)

---

## 3. Controller Layer

### Routes (`routes/api/protected/payroll.php` — 300+ lines)

| Controller | Key Endpoints |
|---|---|
| `PayrollController` | Time tracking (check-in/out), calculate payroll, process payment, payslip generation, PT states |
| `PayrollAutoProcessController` | Quick process, process with checklist, process scoped, detect changes, diff, auto-generate filings, validate run, sync attendance |
| `PayrollDepartmentController` | Dashboard stats, departments, employee payroll details, run lifecycle (lock/unlock/approve/release/disburse), process & pay, bank files, bulk payslips |
| `PayrollFilingController` | All statutory filings, FBP, perquisites, tax simulator, checklist, arrear detection, formula engine, pay groups, compensation bands |
| `PayrollSettingsController` | Get/update org payroll settings (statutory rates, compliance toggles, pay schedule, bank details) |
| `EmployeePayrollCardController` | Employee card CRUD, pay groups, salary structure |
| `EnhancedPayrollController` | CTC breakdown, leave encashment, arrears, F&F settlements |
| `PayrollOnboardingController` | Onboarding step tracking |

### Routes (`routes/api/protected/payroll_filings.php` — filings, FBP, reports)

---

## 4. Frontend Layer

### Shell & Navigation

- **`PayrollShell.tsx`** — 5-tab shell: Overview, Run Payroll (strict admin), Employee Pay, Tax & Compliance, Reports (strict admin)
- **`App.tsx`** — Lazy-loaded routes at `/payroll`, `/payroll/run`, `/payroll/reports`, `/my-payroll`

### Run Payroll Tab

- **`RunPayrollTab.tsx`** — Pay group picker → employee list → bulk process wizard
- **`BulkPayrollMatrix.tsx`** — Step-by-step per-employee payroll entry (6 steps)
- **`EmployeePayrollWizard.tsx`** — Single-employee payroll wizard

### Other Key Components

- `RunPayrollChecklist.tsx` — Run validation checklist display
- `PayrollRunLifecycleStepper.tsx` — Status stepper (draft → locked → approved → released → disbursed)
- `PayrollRunDetailModal.tsx` — Run detail view
- `PayrollDashboard.tsx` — Overview dashboard
- `PayrollModuleLauncher.tsx` — Onboarding launcher
- `PayrollToDoRail.tsx` — Action items
- `FilingsDashboard.tsx` — Statutory filings management
- `EmployeePayrollCards.tsx` — Employee card grid
- `PayrollReportsModal.tsx`, `PayrollRegisterReport.tsx`, `PayrollReportsPage.tsx` — Reporting

### Supporting Frontend Pages

- `MyPayroll.tsx` — Employee self-service (payslips)
- `PrePayrollChecklistPage.tsx` — Pre-run checklist
- `TaxSimulatorPage.tsx` — Tax what-if analysis
- `ArrearsPage.tsx`, `Loans.tsx`, `LeaveEncashmentPage.tsx`, `FnFSettlementsPage.tsx`, `PerquisitesPage.tsx`, `FBPPage.tsx`, `ReimbursementsPage.tsx` — Feature pages

---

## 5. Connection Issues Found

### Critical (Data Loss / Incorrect Calculations)

| # | Issue | Severity | Location |
|---|---|---|---|
| 1 | **`PayrollBurnRateService` reads from legacy `Payroll` table while all modern processing writes to `PayrollMonthlyRun` + `PayrollItem`**. Burn-rate dashboard is blind to current payroll. | **Critical** | `Backend/app/Services/PayrollBurnRateService.php:38-76` |
| 2 | **`custom_earnings` type_cast is `array` in `PayrollItem`** (cast at line 158 of model), but `PayrollAutoProcessService` writes a float via `autoSyncFbp`, `autoSyncLeaves`, `autoSyncReimbursements`, `autoSyncPerquisites` — each call overwrites (not appends to) the previous value. Only the last sync's value is preserved. | **Critical** | `PayrollItem.php:158`, `PayrollAutoProcessService.php:258,289,313,365` |
| 3 | **ESI calculated on `payableGross` (after LOP deduction)** at line 448 of `PayrollAutoProcessService`. Under the ESI Act, eligibility is based on gross wages exceeding ₹21,000 — applying LOP first incorrectly zeroes out ESI for employees with just-above-threshold wages. | **High** | `PayrollAutoProcessService.php:448` |
| 4 | **TDS is computed on `$gross` (before LOP)** at line 456. If an employee takes LOP days, the projected annual income is inflated, resulting in over-deducted TDS. | **High** | `PayrollAutoProcessService.php:456-470` |
| 5 | **`EmployeePayrollTemplate::getOrCreateForUser` uses `Organization::find($organizationId)` without scoping** — in a multi-tenant setup, this reads the first org record if the passed ID doesn't match any (returns null, not irrelevant records, but the missing fallback order for department template can silently produce wrong defaults). | **Medium-High** | `EmployeePayrollTemplate.php:207-208` |
| 6 | **`EmployeePayrollTemplate::firstOrCreate(['user_id' => ...], ...)` in `update()` does not include `organization_id` in the lookup key**. If `user_id` exists under a *different* org, the update hits the wrong template. | **High** | `EmployeePayrollCardController.php:208-223` |

### High (Runtime Failures)

| # | Issue | Severity | Location |
|---|---|---|---|
| 7 | **`PayrollApprovalService::createWorkflow` type-hints `PayrollRun` which does not exist**. Any code calling this service will get a `ReflectionException` at runtime. | **High** | `PayrollApprovalService.php:25` — `class PayrollRun` not found anywhere |
| 8 | **`ProductivityPayrollService::computeAdjustments` type-hints `PayrollRun $run`** (non-existent model) and references `$run->payrolls()` relation. Similarly, `$run->payroll_period` column doesn't exist on `PayrollMonthlyRun` either. | **High** | `ProductivityPayrollService.php:90-95` |
| 9 | **`productivityPayrollService.php:61` queries `DB::table('performance_reviews')` without importing/defining the `PerformanceReview` model** — works but bypasses Eloquent; no model guardrails. | Medium | `ProductivityPayrollService.php:61` |
| 10 | **`PayrollAutoProcessService::autoGenerateFilings` uses `distinct('pt_state')`** — Laravel's `distinct` with a column argument generates invalid SQL (`SELECT DISTINCT(column)` is not valid in all DB engines). | **High** | `PayrollAutoProcessService.php:553,812` |
| 11 | **`StopPaymentFlag` model reference** — `PayrollAutoProcessService` imports and uses `StopPaymentFlag`, but the model file was not confirmed to exist in the read. If it uses a different column name for `month_year` or `is_active`, the hold logic silently fails. | Medium | `PayrollAutoProcessService.php:149-152` |

### Medium (Incorrect / Non-compliant Calculations)

| # | Issue | Severity | Location |
|---|---|---|---|
| 12 | **EDLI charges computed as 0.5% in `PayrollRegisterService::buildPfRegister`** (line 127-128). Statutory EDLI is 0.17% of EPF wages, not 0.5%. | **Medium** | `PayrollRegisterService.php:127-128` |
| 13 | **Two separate financial-year boundaries**: `generateForm24Q` and `generateForm12BA` compute FY from `month_year` field. `generateForm16` takes `financialYear` parameter but then re-derives it from FY range. `generateBonusFormC` computes FY inline with the same logic. If a run's `month_year` is `"2026-03"`, all three should agree on `"2025-2026"` — they do, but the logic is duplicated in 4 places. | Medium | `PayrollFilingService.php:235-236,716-717,901-910` |
| 14 | **TDS on Arrear uses hardcoded 10% flat rate** (`$tdsRate = 0.10`) rather than calling `PayrollCalculatorService`. Arrears are real income and marginal tax rates should apply. | Medium | `EnhancedPayrollController.php:356` |
| 15 | **`PayrollChecklistService::runPreValidations` marks `missing_attendance` passed if `days_present === 0` AND `total_working_days === 0`** (line 46) — a newly-created payroll item with zeroed attendance but non-zero working days is marked as "passed" when it should be "failed" | Low-Medium | `PayrollChecklistService.php:46` |
| 16 | **`EnhancePayrollController::approveLeaveEncashment` checks `$run->status` against `['paid','released']`** but not against `['approved','locked','disbursed']` — encashment can be approved against a run that's already locked/approved/disbursed, which should be immutable. | Medium | `EnhancedPayrollController.php:288` |
| 17 | **`PayrollAutoProcessService::autoSyncAttendance` calls `User::find($item->user_id)`** in a loop — N queries for N payroll items. Should use `User::whereIn()` or eager-load through the existing template relation. | Performance | `PayrollAutoProcessService.php:192` |

### Low (Observability / Consistency)

| # | Issue | Severity | Location |
|---|---|---|---|
| 18 | **`approveArrear` recomputes run totals, but `autoSyncLeaves`, `autoSyncFbp`, `autoSyncPerquisites` do not** — after those syncs run, `PayrollMonthlyRun` aggregate totals are stale until the next full recalculation. | Low | `EnhancedPayrollController.php:491` |
| 19 | **`ProcessPayment` in `PayrollController` has no run-status guard** — payment can be recorded against a payroll item even if the run is already `disbursed`. | Low | `PayrollController.php:339-358` |
| 20 | **`MyPayroll.tsx`** route exists (`/my-payroll`) but no corresponding API endpoint routes to `PayrollController::myPayslips` from the protected payroll route group — may return 403/404. | Low | `frontend/src/pages/MyPayroll.tsx` |

---

## 6. Cross-System Data Flow (End-to-End)

```
Organization settings (payroll block)
        ↓
DepartmentPayrollTemplate → EmployeePayrollTemplate defaults
        ↓                    (getOrCreateForUser: org settings → dept template → built-in defaults)
PayrollMonthlyRun created (draft → processing)
        ↓
autoSyncEmployees  →  PayrollItem rows created (template_snapshot)
autoSyncAttendance →  Populates leg+simplified attendance
autoSyncLeaves     →  custom_earnings += encashments
autoSyncReimbursements → custom_earnings += approved reimbursements (via ReimbursementPayrollLink)
autoSyncFbp        →  custom_earnings += FBP claims
autoSyncVariablePay →  overtime_pay += variable pay
autoSyncPerquisites →  custom_earnings += perquisite values
autoApplyHolds     →  Deletes PayrollItems for held employees
        ↓
calculateAllItems  →  basic, HRA, conveyance, PF, ESI, PT, TDS, LOP, net_pay
        ↓ (run locked)
PayrollValidationService + PayrollChecklistService
        ↓ (passed)
autoGenerateFilings → PF ECR, ESI, Form 24Q, Form 12BA, PT, LWF, Bonus Form C
        ↓
Lock → Approve → Release → Disburse (run lifecycle)
        ↓
BankFile generated → Batch processed → Payment marked paid
```

---

## 7. Integration Touchpoints

| External System | Integration Point | Issue |
|---|---|---|
| **Attendance** | `AttendanceService::monthlyAttendanceSummary()` feeds `autoSyncAttendance` | Attendance sync needs AttendanceService contract to return `legacy_present_days`, `legacy_lop_days` — missing from any explicit interface docs |
| **Reimbursements** | `Reimbursement` + `ReimbursementPayrollLink` | Link de-duplication by `status='linked'` — a re-process after reversal may create duplicate links |
| **FBP** | `FbpService::getFbpTaxExclusion()` called during TDS calc | FbpService exists; tax exclusion logic is additive to taxable income reduction |
| **Loans** | `EmployeeLoan` read during F&F settlement | Loan recovery takes full remaining amount — no pro-rating if settlement amount is insufficient |
| **Tax Declarations** | `EmployeeTaxDeclaration` + items (approved only) | Fetched in `getApprovedTaxDeductions`/`getApprovedTaxDeductionMap`; dependency is clean |
| **Performance** | `performance_reviews` table (raw DB, no model) | ProductivityPayrollService bypasses model; breaks if table is renamed |
| **Salary Components / Formulas** | `SalaryComponent` + `SalaryFormula` + `SalaryFormulaEngine` | Formula engine exists and is used in `resolveSalaryFormula`; not wired into the auto-process call chain |
| **Bank File / Payout** | Bank file generated → batch processed | Bank integration endpoints exist in `PayrollFilingController`; separate from core run flow |

---

## 8. Key Risks Summary

1. **Burn-rate dashboard is dead data** — reads from `payrolls` (legacy), no one writes there anymore
2. **`custom_earnings` type-mismatch + overwrite** — float writes against an array-cast column
3. **ESI threshold applied post-LOP** — may incorrectly exempt borderline employees
4. **TDS over-deduction on LOP** — tax calculated on income not actually earned
5. **`PayrollRun` model does not exist** — `PayrollApprovalService` and `ProductivityPayrollService` will throw `ReflectionException`
6. **`PayrollProfile` table is orphaned** — no read/write paths from modern controllers
7. **`organization_id` missing from `EmployeePayrollTemplate::firstOrCreate` lookup key** — cross-org template collision possible
8. **Arrear TDS uses hardcoded 10% flat** — not using actual marginal tax function
9. **EDLI rate is wrong (0.5% vs 0.17%)** in register builder
10. **Attendance sync N+1 query** — `User::find()` in loop during `autoSyncAttendance`
