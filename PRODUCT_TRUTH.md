# PRODUCT_TRUTH.md

**The source of truth for every claim on the CareVance marketing website.**

Audited 20 August 2026 against the `main` working tree at `D:\Caretime`.
Method: route files, model directory, service directory, page directory and the
named services read directly. Nothing here is inferred from `CLAUDE.md` — several
of its statements are now stale and are corrected in §0.

**Rule of use:** every sentence of website copy cites a claim ID from this file
(e.g. `[PAY-07]`). A sentence with no ID does not ship. If a claim cannot be
traced to a file path below, it is not a claim — it is a guess.

---

## 0. Corrections to `CLAUDE.md`

`CLAUDE.md` is the engineering onboarding doc and has drifted. Several of its
"known gaps" are no longer gaps. **Do not write website copy from `CLAUDE.md`.**

| `CLAUDE.md` says | Actually true today | Evidence |
|---|---|---|
| "No MFA and no SSO/SAML… a grep for `two_factor`/`totp`/`mfa` returns nothing" | **TOTP MFA ships**, with recovery codes, per-org policy (`off`/`grace`/`enforced`), grace deadlines and forced enrolment for privileged roles. SSO/SAML still absent. | `app/Services/Security/MfaService.php`, `Models/UserMfaSecret.php`, `Models/UserRecoveryCode.php`, `routes/api/protected/auth.php:18-22`, `routes/api/public.php:32` |
| "Mobile is employee-only… no manager approvals" | Mobile **has** a manager approval inbox covering leave, time-edit and reimbursement, plus a team tab, comp-off and regularisation. | `mobile-app/app/approval-inbox/index.tsx`, `(tabs)/team.tsx`, `comp-off/index.tsx`, `regularization/` |
| "75+ models", "82 services", "89 pages", "629 routes" | **153 models · 116 services · 123 page components · 660 routes** | directory counts, `routes/` |
| "0 policies. Authorization is inline in controllers." | Still literally true (no Laravel Policy classes), but there is a real authorization layer: `Authorization/RoleService`, `OrganizationRoleService`, `GroupAccessService`, with route-level role gating asserted by `PayrollRouteAuthorizationTest`. | `app/Services/Authorization/` |

**Still true and still not to be claimed:** no SSO/SAML, no ATS/recruitment, no
offer letters or e-signature, no background verification, no legal-entity layer,
no effective-dated compensation, flat annual leave quota (no accrual/pro-rating),
no real-time transport (chat polls).

---

## 1. Hard numbers — citable, defensible, checkable

These are the only numbers permitted in the "proof strip" (homepage §2) and
beside screenshots (§8.3). Every one was counted, not estimated.

| ID | Number | What it counts | Evidence |
|---|---|---|---|
| `NUM-01` | **660** | registered API routes | `grep -rhoE "Route::(get\|post\|put\|patch\|delete)" backend/routes/ \| wc -l` |
| `NUM-02` | **153** | Eloquent models | `ls backend/app/Models/*.php \| wc -l` |
| `NUM-03` | **116** | service classes | `find backend/app/Services -name '*.php' \| wc -l` |
| `NUM-04` | **123** | web page components | `find frontend/src/pages -name '*.tsx' \| wc -l` |
| `NUM-05` | **4** | client apps: React web · Expo mobile · Electron tracker · Chromium extension | `frontend/`, `mobile-app/`, `desktop/`, `browser-extension/` |
| `NUM-06` | **18** | mobile screens | `mobile-app/app/**/*.tsx` |
| `NUM-07` | **37** | states and union territories with Professional Tax slabs resolved | `PTStateService::STATE_CONFIGS` |
| `NUM-08` | **23 / 13** | statutory filing generators registered / producible today | `Payroll/FilingGeneratorRegistry.php` |
| `NUM-09` | **6** | payroll module tabs | `frontend/src/pages/payroll/PayrollShell.tsx:33-39` |
| `NUM-10` | **215** | payroll API routes alone | `routes/api/protected/payroll.php` |

> **`NUM-08` is the honest one and must be stated honestly.** 23 generator types are
> registered; **13 can be produced today**. Ten reference blade templates that were
> never written (`form_19`, `form_31`, `form_1`, `form_2`, `form_6`, `form_124`,
> `eshram_registration`, `uan_activation`, `se_registration`, `shram_card_registration`)
> and the registry reports them unavailable with a reason rather than failing.
> The website may say "13 statutory returns generated today" — it may **not** say 23.
> See `DONT-04`.

---

## 2. The positioning claim, and what backs it

**Claim (`POS-01`): the evidence of work and the payslip are the same system.**

The chain is real and every link is a file in this repo:

| Stage | Where it lives |
|---|---|
| 1. Desktop tracker captures activity, screenshots, idle | `desktop/main.cjs` (2,539 lines) — `desktop:capture-screenshot`, `desktop:get-system-idle-seconds`, idle popup, offline queue |
| 2. Browser extension captures URL context | `browser-extension/chromium/` → feeds the tracker |
| 3. Activity classified productive / unproductive | `Monitoring/ProductivityClassifier.php`, `Models/ProductivityClassification.php` |
| 4. Sessions become attendance | `Models/ActivitySession`, `AttendanceRecord`, `Attendance/AttendanceService.php` |
| 5. Attendance syncs into the payroll run | `POST /payroll/runs/{runId}/sync-attendance`, `GET /payroll/runs/{runId}/attendance/status`, `Models/PayrollTimeEntry` |
| 6. The run computes statutory and net | `PayrollCalculatorService`, `Payroll/SalaryCalculationService` |
| 7. Bank file and payslip | `Payroll/PayrollDisbursementService`, `GET /payroll/runs/{runId}/bank-file`, `PayrollPdfService` |

`POS-01` is safe to state as an **architecture** claim ("one system, no export
step") because step 5 is a real API endpoint, not an integration. It is **not**
safe to state as a **market** claim ("the only vendor who…") — that is an
assertion about competitors this repo cannot evidence. See `DONT-06`.

---

## 3. Module inventory

### 3.1 Payroll engine — `PAY-*`

**What it does:** takes an annual CTC, derives components through a configurable
structure, computes statutory deductions and employer contributions, and balances
the remainder into a designated residual component so the total returns to CTC.

| ID | Claim | Evidence |
|---|---|---|
| `PAY-01` | CTC → components → statutory → net, with a residual that balances back to CTC | `PayrollCalculatorService::calculateSalaryComponents()`, `residualAbsorptionFactor()`, `maxBasicWithinCtc()` |
| `PAY-02` | Run lifecycle `draft → locked → approved → released → disbursed`, each stage with an actor and timestamp column | `Models/PayrollMonthlyRun.php` — `locked_by/at`, `approved_by/at`, `released_by/at`, `disbursed_by/at`; `CLOSED_STATUSES` |
| `PAY-03` | Salary structures are composable: formula, slab and lookup component types, plus CTC range bands and pay groups | `Models/SalaryFormula`, `SalarySlabComponent`, `SalaryLookupComponent`, `CtcRangeBand`, `PayGroup`; `SalaryFormulaEngine.php`; `POST /payroll/salary-components/{id}/formula/validate` |
| `PAY-04` | Every payroll item is versioned | `Models/PayrollItemVersion.php` |
| `PAY-05` | Processing is queued with a pollable progress handle; a second start while one is in flight is refused with **409** | `POST /payroll/runs/{id}/process-remaining` → 202, `GET /payroll/runs/{id}/processing-status` |
| `PAY-06` | Off-cycle and on-demand pay runs exist | `OffCyclePayrollService.php`, `OnDemandSalaryService.php` |
| `PAY-07` | Arrears, LOP, pro-rating, notice-pay recovery, leave encashment and gratuity are engine functions, not spreadsheet steps | `PayrollCalculatorService::calculateArrears / calculateLOP / calculateProRatedSalary / calculateNoticePayRecovery / calculateLeaveEncashment / calculateGratuityForSettlement` |
| `PAY-08` | Net pay is stored **signed** — a negative net is surfaced for validation to stop the run, never clamped to zero | `CLAUDE.md` §Money, `PayrollValidationService` |

**Screens:** `payroll/PayrollShell.tsx` with six tabs — Overview · Run Payroll ·
Employee Pay · Operations · Tax & Compliance · Reports (`PayrollShell.tsx:33-39`),
plus a ten-step guided setup (`payroll/setup/SetupWelcome` → `SetupTestRun`),
`SalaryStructureTemplates`, `FormulaEnginePage`, `EmployeePayrollCards`,
`SalaryBreakdownCards`, `PayGroupSettings`, `UnassignedEmployeesPage`.

**Buyer sentence:** *Run payroll for a company on one screen, and get a number you
can take apart component by component.*

---

### 3.2 Governed overrides — `OVR-*` — **the second differentiator**

The strongest single block of copy in the product, and it writes itself from the
docblock at `app/Services/Payroll/OverrideBalancingService.php:8-42`.

| ID | Claim | Evidence |
|---|---|---|
| `OVR-01` | An override that cannot balance is **refused at entry**, and the refusal **names the maximum value that would work** | `OverrideBalancingService::assess()` returns `permitted`, `max_permitted`, `message` |
| `OVR-02` | Raising a component costs more than its face value — HRA is derived from basic, and employer PF and the gratuity provision sit inside the CTC envelope, so four quantities move together: **an amplification factor of 1.668** at the usual rates. The product shows this **before** you commit. | `OverrideBalancingService` docblock ¶1; `assess()` returns `amplification`, `residual_before`, `residual_after`; `POST /payroll/operations/overrides/preview` |
| `OVR-03` | The residual is a **role**, and the fallback chain only ever lands on a **taxable** component — falling back to HRA would change the employee's tax position to satisfy an arithmetic identity | `resolveResidual()` |
| `OVR-04` | Two components claiming the residual role is reported as a **configuration error**, not resolved by silently picking one | `hasAmbiguousResidual()` |
| `OVR-05` | Maker-checker: overrides are proposed, then approved, rejected or cancelled | `POST /payroll/operations/overrides/{id}/approve` · `/reject` · `/cancel` |
| `OVR-06` | Append-only audit per override | `Models/PayrollOverrideAudit`, `Payroll/OverrideAuditTrail.php`, `GET /payroll/operations/overrides/{id}/audit` |
| `OVR-07` | Full CSV round-trip with a **validate-before-commit** step | `/operations/overrides/export`, `/template`, `/import/validate`, `/import/commit` |
| `OVR-08` | Grid view of overrides across the run | `/operations/overrides/grid`, `Payroll/OverrideGridService.php` |

**Buyer sentence:** *Change a salary component and see what it actually costs
before you commit it — and be told no, with a number, when it cannot work.*

> The docblock also contains sourced statements about how Keka and Razorpay behave.
> **Those are engineering notes, not cleared marketing copy.** Website copy states
> what CareVance does; it does not narrate a competitor's failure mode. See `DONT-06`.

---

### 3.3 Statutory — `STA-*`

Every constant below is read from `PayrollCalculatorService.php:26-63`.

| ID | Head | Implemented as | Evidence |
|---|---|---|---|
| `STA-01` | **Provident Fund** | ₹15,000 wage ceiling, 12% employee + 12% employer, employer split **EPS 8.33% / EPF 3.67%**, above-ceiling handling, VPF | `PF_WAGE_CAP`, `EPS_RATE`, `EPF_RATE`, `calculateEmployeePF`, `calculateEmployerPF`, `pfWages`, `calculateVPF` |
| `STA-02` | **ESI** | ₹21,000 gross threshold, 0.75% employee / 3.25% employer | `ESI_GROSS_THRESHOLD`, `calculateEmployeeESI`, `calculateEmployerESI` |
| `STA-03` | **ESI contribution-period lock-in** | coverage is fixed for a whole period (1 Apr–30 Sep, 1 Oct–31 Mar); someone covered at the start stays covered to the end even if a raise takes them past ₹21,000 mid-period | `Payroll/EsiContributionPeriodService.php` — `periodFor()`, `isCovered()`, `contributedEarlierInPeriod()` |
| `STA-04` | **Professional Tax** | state-levied, **37 states and UTs**, month-aware (Maharashtra's February ₹300 is modelled), annual limits, and states that levy none return **₹0** | `PTStateService::calculate/hasPT/getStatesWithoutPT/getAnnualLimit` |
| `STA-05` | **TDS** | old **and** new regime, FY-keyed slabs, surcharge slabs, 4% health & education cess, standard deduction ₹75,000 new / ₹50,000 old, §87A rebate to ₹12,00,000 new / ₹5,00,000 old, §80C ₹1,50,000, §80CCD(1B) ₹50,000 | `calculateNewRegimeTax`, `calculateOldRegimeTax`, `calculateSurcharge`, `TAX_SLABS_BY_FY`, `SURCHARGE_SLABS` |
| `STA-06` | **TDS is cumulative** | not a flat twelfth of an annual estimate | `calculateCumulativeMonthlyTds()` |
| `STA-07` | **Gratuity** | 4.81% monthly provision; the settlement path enforces the **five-year floor** and the **₹20,00,000 statutory ceiling** | `GRATUITY_RATE`, `GRATUITY_MIN_YEARS`, `GRATUITY_MAX_PAYOUT`, `calculateGratuityForSettlement()` |
| `STA-08` | **LWF** | state Labour Welfare Fund | `Payroll/LwfCalculator.php`, `/payroll/filings/generate/lwf-return` |
| `STA-09` | **HRA exemption** | least-of-three rule, metro / non-metro | `calculateHraExemption()`, `GET /payroll/hra-optimization` |
| `STA-10` | **NPS, perquisites, Code on Wages** | | `calculateNPS()`, `PerquisiteCalculator.php`, `Payroll/CodeOnWagesService.php` |
| `STA-11` | Slab resolution is a service, not inline constants | | `Payroll/StatutorySlabResolver.php` |

**Permitted phrasing:** "Professional tax resolved across 37 states and union
territories." **Forbidden:** "compliant in all 28 states" — PT is not levied
everywhere and the product deliberately returns ₹0 where it is not (`STA-04`).

**Buyer sentence:** *The rules that make Indian payroll hard are in the engine —
including the ESI half-year lock-in that most tools get wrong.*

---

### 3.4 Filings — `FIL-*`

| ID | Claim | Evidence |
|---|---|---|
| `FIL-01` | **13 statutory outputs generate today**: PF ECR, Full ECR, ESI Challan, Form 24Q, PT Return, LWF Return, Bonus Forms C / D / E (plus combined), Form 12BA, Form 16, Form 16 (Annual) | `FilingGeneratorRegistry::GENERATORS`; templates present: `resources/views/filings/{form12ba,form16,form16_annual}.blade.php` |
| `FIL-02` | Availability is resolved **against the filesystem**, so the product cannot advertise a return it is unable to produce | `FilingGeneratorRegistry::isAvailable()` + docblock |
| `FIL-03` | Batch generation attempts each generator independently and returns `['filings' => …, 'failures' => …]` — one broken form does not kill the batch | `PayrollFilingService::generateAllFilings()` |
| `FIL-04` | A filing reports `filing_ready: false` when the org has no PAN/TAN, rather than emitting `PANINVALID` and claiming success | `PayrollFilingValidatorService`, `GET /payroll/filings/validate-run` |
| `FIL-05` | Statutory identifiers resolve from the profile column **or** `employee_government_ids` | `User::statutoryId('pan'\|'uan'\|'esi')` |
| `FIL-06` | Ten further declaration forms are registered and reported **unavailable with a stated reason** | `MISSING_TEMPLATE_REASON` |

**Screen:** `Filings.tsx`.
**Buyer sentence:** *Real EPFO ECR and NSDL formats — and an honest list of what
this installation can and cannot file.*

---

### 3.5 Money movement — `BNK-*`

| ID | Claim | Evidence |
|---|---|---|
| `BNK-01` | Disbursement writes a `BankTransferBatch` and a NEFT/RTGS file, recording every line | `Payroll/PayrollDisbursementService.php`, `BankFileFormatService.php`, `Models/BankTransferItem` |
| `BNK-02` | Unpayable people are **returned as exclusions, never silently dropped** | `PayrollDisbursementService`; `GET /payroll/runs/{runId}/missing-bank-details` |
| `BNK-03` | The bank's returned **UTR** is the only reference reconciliation trusts — none is invented locally | `Models/PaymentTransaction` |
| `BNK-04` | Reversals are first-class | `Models/PaymentReversal`, `POST /payroll/runs/{runId}/reverse`, `/payroll/filings/payment-reversal` |
| `BNK-05` | Stop-payment flags block an individual before disbursement | `Models/StopPaymentFlag`, `/payroll/stop-payment-flags` |
| `BNK-06` | Bank reconciliation report | `GET /payroll/filings/bank-reconciliation`, `Models/PayrollReconciliation` |
| `BNK-07` | The bank file is deliberately **synchronous** — one eager-loaded query plus string formatting, returning a download the user is waiting for | `CLAUDE.md` §queue; `GET /payroll/runs/{runId}/bank-file` |
| `BNK-08` | Government-ID and bank-detail validation before it matters | `Validation/IndianIdValidationService.php`; `POST /users/validate/government-id`, `/validate/bank-details`, `/validate/bulk` |

---

### 3.6 Controls, audit, detective reports — `CTL-*`

| ID | Claim | Evidence |
|---|---|---|
| `CTL-01` | **Differences report** — what moved between two runs, by item and by employee | `PayrollComparisonService::compare/itemWise/employeeWise/consolidated`; `GET /payroll/reports/differences` |
| `CTL-02` | **Negative-cost report** | `::negativeCost()`; `/payroll/reports/negative-cost` |
| `CTL-03` | **Duplicates report** | `::duplicates()`; `/payroll/reports/duplicates` |
| `CTL-04` | **Reconciliation report** | `::reconciliation()`; `/payroll/reports/reconciliation` |
| `CTL-05` | Payroll audit log and a per-run activity feed | `Models/PayrollAuditLog`; `GET /payroll/runs/{runId}/activity`; `Audit/AuditLogService.php` |
| `CTL-06` | Pre-run checklist and a completeness gate | `Models/PayrollRunChecklist`, `PayrollChecklistService`; `/runs/{runId}/completeness`; `PrePayrollChecklistPage.tsx` |
| `CTL-07` | Approval routing with rejection reasons | `PayrollApprovalService`, `Approvals/ApprovalRoutingService`, `Models/PayRunApproval` |
| `CTL-08` | Closed runs cannot be written to casually | `Payroll/ClosedRunWriteContext.php`, `Payroll/PayrollPeriodGuard.php` |
| `CTL-09` | Break-glass access is a recorded session, not a flag | `Models/BreakGlassSession`, `Security/BreakGlassService.php` |

**Buyer sentence:** *Every rupee on the payslip can name the rule that put it
there, and every change names the person who made it.*

---

### 3.7 Time, attendance & evidence of work — `TIM-*` — **the wedge**

| ID | Claim | Evidence |
|---|---|---|
| `TIM-01` | Electron desktop tracker: screenshots, OS-level idle detection, an idle prompt, and an **offline queue that persists captures to disk** when the network drops | `desktop/main.cjs` — `desktop:capture-screenshot`, `desktop:get-system-idle-seconds`, `desktop:show-idle-popup`, `desktop:offline-save-screenshot`, `desktop:offline-save-activity` |
| `TIM-02` | Chromium extension supplies URL context to activity classification | `browser-extension/chromium/`; `main.cjs:886` |
| `TIM-03` | Activity is classified productive / unproductive by configurable rules at org and global scope | `Monitoring/ProductivityClassifier.php`, `Models/ProductivityClassification` |
| `TIM-04` | Idle time never bills: auto-stop rewinds `end_time` to the last real activity and records the tail in `trailing_idle_seconds` | `Monitoring/IdleResolutionService.php`, `Reports/IdleValidationService.php`; `POST /activities/{activity}/resolve-idle` |
| `TIM-05` | A server-side backstop closes idle timers every minute — the desktop app cannot be trusted to be awake | `routes/console.php` → `timers:close-idle`, `timers:close-stale` |
| `TIM-06` | Geofenced punch and attendance selfies, with a map view | `Models/GeofenceZone`, `GeofenceLog`, `AttendanceSelfie`; `POST /attendance/selfie`, `GET /attendance/selfies/map`; `SelfieMapView.tsx`, `GeofenceSettings.tsx` |
| `TIM-07` | Shifts, shift resolution across timezones, OT rules, shift-allowance rules, comp-off balances and transactions, break types and tracking | `Attendance/ShiftResolver`, `ResolvedShift`, `UserTimezoneResolver`; `Models/OtRule`, `ShiftAllowanceRule`, `CompOffBalance`, `CompOffTransaction`, `BreakType` |
| `TIM-08` | Time-edit (regularisation) requests with approve / reject **and forwarding to another approver** | `/attendance-time-edit-requests`, `/{id}/transfer`, `/{id}/forward-targets` |
| `TIM-09` | **The handoff:** attendance syncs into the payroll run as an explicit, inspectable step — no export | `POST /payroll/runs/{runId}/sync-attendance`, `POST /payroll/runs/{runId}/employees/{userId}/sync-attendance`, `GET /payroll/runs/{runId}/attendance/status`; `Models/PayrollTimeEntry`; `ProductivityPayrollService.php` |
| `TIM-10` | Team presence view | `Attendance/TeamPresenceService.php`; `GET /attendance/team-presence` |

**Screens:** `Attendance.tsx`, `Timesheets.tsx`, `TimeReports.tsx`,
`DesktopTimerDashboard.tsx`, `MonitoringWorkspace.tsx`, `Monitoring.tsx`,
`MyActivity.tsx`, `BreakTrackingPage.tsx`, `SelfieMapView.tsx`, `GeofenceSettings.tsx`.

**Buyer sentence:** *The tracker's records are the attendance basis for the
payroll run. There is no export step, because there is no second system.*

---

### 3.8 Monitoring consent & DPDP — `CON-*` — **a trust asset, use it**

| ID | Claim | Evidence |
|---|---|---|
| `CON-01` | Monitoring runs on **notice-and-consent**, enforced at a single choke point every capture path must pass — screenshots, activity, geofenced punches and selfies alike | `Monitoring/MonitoringConsentService.php` docblock + capture gate |
| `CON-02` | Notices are **versioned and never edited** — publishing writes a new version | `publishNotice()`, `Models/MonitoringNotice` |
| `CON-03` | Consent is per capture type, recorded with request context, and can be **withdrawn** | `grant()`, `withdraw()`, `Models/MonitoringConsent`; `DELETE /monitoring/consent` |
| `CON-04` | Capture is **refused** once the collection window closes without consent | `MonitoringConsentService` day-window constant |
| `CON-05` | Screenshots have a scheduled retention purge | `Monitoring/ScreenshotDeletionService.php`; purge in `routes/console.php` |
| `CON-06` | Built because DPDP liability falls on the **employer** running the software, not the vendor | `MonitoringConsentService` docblock ¶2 |

**Why this matters for the site:** the tracker is the wedge and also the biggest
objection. `CON-01`–`CON-06` are the answer, and they are real. The
time-and-attendance page must carry them; omitting them makes the wedge read as
surveillance.

---

### 3.9 Core HR & lifecycle — `HR-*`

| ID | Claim | Evidence |
|---|---|---|
| `HR-01` | Employee record: profile, work info, government IDs, bank accounts, documents, education, 360 profile | `/users/employees/{id}/…`; `Models/EmployeeProfile`, `EmployeeWorkInfo`, `EmployeeGovernmentId`, `EmployeeBankAccount`, `EmployeeDocument`, `EmployeeEducation`; `EmployeeDetailWorkspace.tsx` |
| `HR-02` | Onboarding opens automatically on hire — an 18-step checklist spanning day −14 to +90 across six owner roles, with blocking gates | `Lifecycle/OnboardingService::open()`, `UserController::openOnboardingJourney`; `Models/OnboardingJourney`, `ChecklistTemplate` |
| `HR-03` | A joiner sees and completes **only their own** items | `GET /onboarding/my-journey`; `owner_kind = 'employee'` |
| `HR-04` | Pre-boarding is the normal path: a future joining date is valid | `Lifecycle/OnboardingService` |
| `HR-05` | Exit: resignation → notice-period computation → exit checklist → access revocation → exit interview → attrition reporting | `Models/Resignation`, `EmployeeExit`, `ExitInterview`; `Lifecycle/ExitService`, `NoticePeriodService`; `/exits/{id}/advance`, `/revoke-access`, `/interview`, `/attrition` |
| `HR-06` | Full & final settlement as an approved, payable object | `Models/FullAndFinalSettlement`; `/payroll/fnf-settlements/{id}/approve`, `/process-payment` |
| `HR-07` | Salary revision letters, accepted or rejected by the employee | `Models/SalaryRevisionLetter`, `SalaryRevisionService`; `POST /payroll/filings/revision-letters/{id}/accept` |
| `HR-08` | Org structure: departments, teams, team managers, groups, report groups, reporting-manager resolution | `Models/DepartmentTeam`, `Group`, `ReportGroup`; `Organization/ReportingManagerResolver`; `OrgHierarchy.tsx`, `OrganizationTree.tsx` |
| `HR-09` | Payroll readiness is checked as part of lifecycle, not discovered on run day | `Lifecycle/PayrollReadinessService.php` |

**Screens:** `EmployeeManagementWorkspace.tsx`, `EmployeeDetailWorkspace.tsx`,
`NewHiresPage.tsx`, `AddUserPage.tsx`, `ExitsPage.tsx`, `ResignationPage.tsx`,
`FnFSettlementsPage.tsx`, `SalaryRevisionPage.tsx`, `ProfileOnboardingPage.tsx`.

---

### 3.10 Leave — `LVE-*`

| ID | Claim | Evidence |
|---|---|---|
| `LVE-01` | Leave requests with approve / reject / revoke-approve / revoke-reject, plus **transfer to another approver** with a forward-target lookup | `/leave-requests/…` in `routes/api/protected/attendance.php` |
| `LVE-02` | Balances endpoint; holiday calendar per organisation | `GET /leave-requests/balances`, `/attendance/holidays`; `Models/AttendanceHoliday` |
| `LVE-03` | Leave encashment flows into payroll with approval | `Models/LeaveEncashment`; `/payroll/leave-encashments/{id}/approve`; `LeaveEncashmentPage.tsx` |

> **`LVE-CAVEAT` — do not overclaim.** Leave policy is a **flat annual quota** held
> as JSON in `organizations.settings` (`Leave/LeavePolicyService.php`). There is
> **no** accrual schedule, **no** pro-rating for mid-year joiners, **no**
> configurable leave year and **no** per-type carry-forward cap. `/product/leave`
> must not imply otherwise.

---

### 3.11 Expenses, FBP, loans, variable pay — `EXP-*`

| ID | Claim | Evidence |
|---|---|---|
| `EXP-01` | Reimbursements with receipt upload, a **two-stage** manager-then-admin approval, bulk actions and a paid state | `/payroll/reimbursements/…` — `/inbox/manager`, `/inbox/admin`, `/bulk/manager-approve`, `/{id}/mark-paid` |
| `EXP-02` | Flexible Benefit Plan: components, per-employee allocation, claims with approval | `Models/FbpComponent`, `FbpAllocation`, `FbpClaim`; `FbpService`; `/payroll/filings/fbp/…`; `FBPPage.tsx` |
| `EXP-03` | Employee loans: request → approve / reject → close, with **recovery scheduled into payroll** | `Models/EmployeeLoan`, `PayrollLoanRecovery`; `/payroll/loans/…`; `Loans.tsx` |
| `EXP-04` | Arrears with approval, gated on a run and a payroll item existing for the arrear's calculation month | `Models/ArrearPayment`, `ArrearCalculatorService`; `/payroll/arrears/{id}/approve`; `ArrearsPage.tsx` |
| `EXP-05` | Variable pay rules and assignments | `Models/VariablePayRule`, `VariablePayAssignment`; `VariablePayEngine.php` |
| `EXP-06` | Perquisites and garnishments | `Models/EmployeePerquisite`, `PerquisiteRecord`; `PerquisiteCalculator`, `GarnishmentService.php`; `PerquisitesPage.tsx` |

---

### 3.12 Employee tax self-service — `TAX-*`

| ID | Claim | Evidence |
|---|---|---|
| `TAX-01` | Employees declare investments; items are reviewed by payroll | `Models/EmployeeTaxDeclaration`, `EmployeeTaxDeclarationItem`; `/payroll/declarations/{id}/review`; `TaxDeclaration.tsx`, `TaxDeclarationsPage.tsx` |
| `TAX-02` | Proof upload, review, bulk approve, and a **Form 12BB** view | `Models/TaxProofSubmission`, `TaxProofUploadService`; `/payroll/tax-proofs/bulk-approve`, `/my-12bb/{financialYear}`; `TaxProofsReview.tsx` |
| `TAX-03` | Old vs new regime comparison, a tax simulator and a bulk regime switch | `TaxRegimeComparator.php`; `/payroll/tax-simulator/compare`, `/tax-regime/bulk-update`; `TaxSimulatorPage.tsx` |
| `TAX-04` | Tax-saving recommendations and a tax-optimised structure suggestion | `TaxSavingRecommender.php`, `TaxOptimisedStructureService.php`; `GET /payroll/tax-savings/recommendation` |
| `TAX-05` | Employees reach **only** their own figures, through `payroll/my/*` | allow-list asserted by `PayrollRouteAuthorizationTest` |

---

### 3.13 Reports & finance — `RPT-*`

| ID | Claim | Evidence |
|---|---|---|
| `RPT-01` | Daily / weekly / monthly / productivity / attendance / project / team / employee-insight reports, with CSV export | `routes/api/protected/reports.php`; `ReportsWorkspace.tsx`, `TimeReports.tsx` |
| `RPT-02` | Payroll register and statutory register | `PayrollRegisterService`; `/payroll/filings/payroll-register`, `/statutory-register`; `PayrollReportsPage.tsx` |
| `RPT-03` | GL mapping and cost centres for finance hand-off | `Models/GlMappingConfig`; `CostCentreService.php`, `DepartmentBudgetService.php` |
| `RPT-04` | Burn rate and CTC planning | `PayrollBurnRateService.php`, `CtcPlannerService.php`; `CompensationBandsPage.tsx` |
| `RPT-05` | Custom report definitions | `Models/CustomReportDefinition` |

---

### 3.14 Work management — `WRK-*`

Projects; tasks with dependencies, recurrence, checklists, labels, watchers,
comments, attachments and an activity feed; groups; 1:1 and group chat with
reactions and typing status; polls; assets with assignment; performance cycles,
goals, check-ins, competencies and 360 aggregation.

Evidence: `Models/Project`, `Task*` (11 models), `ChatGroup*`, `Poll*`, `Asset*`,
`ReviewCycle`, `PerformanceGoal`, `GoalCheckIn`, `Competency`;
`routes/api/protected/{projects,tasks,chat,assets,performance}.php`;
`Projects.tsx`, `Tasks.tsx`, `Chat.tsx`, `Assets.tsx`, `PerformancePage.tsx`,
`PerformanceGoalsPage.tsx`.

> **`WRK-CAVEAT`:** chat has **no real-time transport** — `BROADCAST_CONNECTION=log`
> and the client polls every 10s. Do not write "real-time chat".

---

### 3.15 Platform, security & tenancy — `SEC-*`

| ID | Claim | Evidence |
|---|---|---|
| `SEC-01` | **Multi-tenancy is structural**: 97 models carry `BelongsToOrganization`, which applies a global scope and stamps `organization_id` on create. Cross-tenant reads must be written explicitly (`withoutOrganizationScope()`, `forOrganization()`) and are therefore greppable. | `app/Traits/BelongsToOrganization.php` |
| `SEC-02` | **A test fails the build if a tenant-owned model forgets the trait** — isolation is enforced by CI, not by reviewer memory | `tests/Feature/TenantIsolationTest.php::test_every_tenant_owned_model_carries_the_trait` |
| `SEC-03` | **TOTP MFA** with recovery codes; per-organisation policy `off` / `grace` / `enforced`; grace deadlines; **forced enrolment for privileged roles** | `Security/MfaService.php` — `beginEnrolment`, `confirmEnrolment`, `regenerateRecoveryCodes`, `policyFor`, `graceEndsAt`, `isPrivileged`, `mustEnrolNow` |
| `SEC-04` | Role-based access, organisation roles, group access; payroll route gating asserted by test | `Authorization/RoleService`, `OrganizationRoleService`, `GroupAccessService`; `PayrollRouteAuthorizationTest`; `RoleManagement.tsx` |
| `SEC-05` | Break-glass elevation is a recorded session | `Models/BreakGlassSession`, `Security/BreakGlassService` |
| `SEC-06` | Platform-wide audit log | `Models/AuditLog`, `Audit/AuditLogService`; `AuditLogs.tsx` |
| `SEC-07` | HTML sanitisation on user-supplied rich content | `Security/HtmlSanitizerService.php` |
| `SEC-08` | Auth throttling on login and MFA verify | `throttle:auth.mfa.verify`; `routes/api/public.php` |
| `SEC-09` | API clients, scoped tokens, webhook endpoints with delivery records | `Models/ApiClient`, `WebhookEndpoint`, `WebhookDelivery`; `Auth/ApiTokenService`, `Integrations/WebhookDispatcher` |
| `SEC-10` | One invite system (`invitations`); the legacy `invites` path was removed in Aug 2026 because it could overwrite an existing account's password across organisations | `Invitations/InvitationService`; `CLAUDE.md` §Watch out for |

> **`SEC-CAVEAT`:** there is **no SOC 2 and no ISO 27001 certification**, and no
> SSO/SAML. The security page states what is implemented and what is not, and
> carries **no badge**. See `DONT-02`.

---

## 4. What the website must NOT claim — `DONT-*`

| ID | Prohibition | Why |
|---|---|---|
| `DONT-01` | **No customer counts, logo walls, testimonials, review scores, or "trusted by N businesses".** | None exist. Brief §0.2. |
| `DONT-02` | **No SOC 2 / ISO 27001 / any compliance badge.** | Not certified. A fabricated badge on a payroll site is a lie about the thing being bought. |
| `DONT-03` | **Do not reuse the product's own `PricingPage.tsx` trust metrics.** It currently ships `10,000+ active users`, `500+ workspaces onboarded`, `32% avg productivity lift`, `4.8/5 avg rating` — all fabricated. | `frontend/src/pages/PricingPage.tsx:9-14`. **This is a live liability in the shipped product and should be removed there too — flagged separately.** |
| `DONT-04` | Do not say "23 statutory filings". Say **13 produced today**. | `FIL-01`, `NUM-08` |
| `DONT-05` | Do not say "compliant in all 28 states". Say **PT resolved across 37 states and UTs**, and note several levy none. | `STA-04` |
| `DONT-06` | Do not name a competitor's defect. The override docblock's Keka/Razorpay notes are engineering research, not cleared copy. Comparison pages describe **CareVance's** behaviour and cite competitors only for publicly published, dated facts. | Legal exposure; brief §0.6 |
| `DONT-07` | Do not claim real-time chat, leave accrual or pro-rating, SSO/SAML, ATS/recruitment, offer letters, e-signature, background verification, a multi-entity legal layer, or effective-dated compensation. | `WRK-CAVEAT`, `LVE-CAVEAT`, `SEC-CAVEAT`, §0 |
| `DONT-08` | Do not present the legacy `payrolls` table or the retired `PayRun` API as capability. | Being retired; `CLAUDE.md` |
| `DONT-09` | Do not imply the tracker runs without employee consent. Consent is enforced (`CON-01`) — say so, it is an asset. | DPDP; honesty |
| `DONT-10` | Do not claim uptime, SLA, response times or support hours. | No evidence in repo; these are commercial commitments only the founder can set. |

---

## 5. Pricing — `PRC-*` — the real, shipped model

**Resolved 20 Aug 2026: the website uses the pricing already shipped in the
product**, not the ₹49/₹99/₹179 per-employee model in the brief. Source of truth
is `frontend/src/constants/pricing.ts`, which is wired to real checkout
(`buildCheckoutPath` → `/checkout`), so it is what a buyer can actually sign up for.

| ID | Plan | Code | Price | Seats |
|---|---|---|---|---|
| `PRC-01` | **Basic** (Tracking) | `basic_tracking` | **₹399** /user/mo · ₹359 annual | per-seat, min 10 |
| `PRC-02` | **Advance** (Tracking) — *Most Popular* | `advance_tracking` | **₹599** /user/mo · ₹539 annual | per-seat, min 10 |
| `PRC-03` | **Basic** (Payroll + Tracking) | `basic_payroll` | **₹3,999** /mo base | 50 seats included, then ₹79/seat |
| `PRC-04` | **Professional** (Payroll + Tracking) — *Full Suite* | `professional_payroll` | **₹5,999** /mo base | 50 seats included, then ₹119/seat |
| `PRC-05` | **Enterprise** | `enterprise` | Contact sales | — |
| `PRC-06` | Trial: **14 days, Basic Tracking, 5 seats, no credit card** | | | `pricingUi.trialBadge`, `TRIAL_SEATS` |
| `PRC-07` | Annual discount is **10%**, on the per-seat tracking plans only | | | `getYearlySavingsPercent()` |

**Consequences for the website — read before writing `/pricing`:**

- **The brief's central pricing argument is not available.** §9.2 tells the site to
  attack base-fee pricing and the 50-employee floor as the market's weak point.
  CareVance's own payroll plans **are** base-fee with a 50-seat floor
  (`PRC-03`, `PRC-04`). At 20 employees Basic Payroll is ₹3,999 — ₹200 real PEPM.
  **Do not write "no base fee", do not build the "vs base-fee pricing" comparison,
  and do not claim a 15-employee minimum.** See `DONT-11`.
- The honest calculator is a **seat slider that shows the real total** under both
  models: per-seat for tracking plans, base + overage for payroll plans. That is
  still the best pricing UX in the category and it is truthful. Use
  `calculateTotal()`'s exact logic.
- The **two-axis structure** (Tracking-only vs Payroll+Tracking) is a genuine
  strength the brief did not anticipate: it lets a buyer start on evidence-of-work
  and grow into payroll — which is `POS-01` expressed as a price list.
- GST is **not** in these figures. Disclose 18% under the cards.

### 5.1 Features sold in `pricing.ts` that do not exist — `DONT-11`..`DONT-14`

Verified 20 Aug 2026. These appear in `featureCategories` and in plan `modules`,
including in **paid** tiers. They must not appear anywhere on the website, and
they are a live liability in the product.

| ID | Sold as | Tier | Reality |
|---|---|---|---|
| `DONT-12` | **Recruitment Management (ATS)** | Professional | No `Job`, `Candidate`, `Applicant`, `Interview` or `Offer` model; no recruitment routes. The only "interview" in the codebase is `ExitInterview`, which is the opposite end of the lifecycle. |
| `DONT-13` | **Travel & Expense Tracking** | Professional | No travel model of any kind. `Reimbursement` / `FbpClaim` cover expenses; travel is not built. |
| `DONT-14` | **Public Press / Company News** | Basic Payroll + | No announcement or news model. `Poll` exists, so "Announcements & Polls" is **half** true — polls are real, announcements are not. |
| `DONT-15` | **White Label Options**, **SLA Support**, **Dedicated Account Manager** | Enterprise | Strings in plan config only (`PlanService`, `PlanController`). No implementation, and per `DONT-10` an SLA is a commercial commitment not evidenced anywhere. |

> **`DONT-11`:** do not build the brief's §9.3 "no base fee" wedge or the
> "vs base-fee pricing" comparison block. CareVance charges a base fee with a
> 50-seat floor on its payroll plans. Writing that argument would be marketing
> against our own price list.

---

## 6. Open questions — cannot be resolved from the repo

These block specific website sections and need a human answer:

1. **Legal entity name, registered address, grievance officer** — required for real
   Privacy / Terms / DPA documents. Until answered, those pages ship with clearly
   marked `[TO BE COMPLETED]` fields rather than invented details.
2. **Support hours, SLA, data-residency region** — required for `/security` and the
   DPA. Not claimed until answered (`DONT-10`).
3. **The four phantom features above** — remove from the product's `pricing.ts`, or
   build them? Either way the website omits them.
4. **The fabricated trust metrics** in `PricingPage.tsx:9-14` (`DONT-03`) — left in
   the product untouched for now, by decision; never carried to the website.

---

*Generated 20 Aug 2026. Re-verify before publishing; the repo moves.*
