# PRODUCT_TRUTH.md

**The source of truth for every claim on the CareVance marketing website.**

Re-audited **20 August 2026** against the working tree at `D:\Caretime`.

**Rule of use:** every sentence of website copy cites a claim ID from this file
(e.g. `[PAY-07]`). A sentence with no ID does not ship. If a claim cannot be
traced to a file path below, it is not a claim — it is a guess.

---

## 0. A correction to this file, and how it happened

An earlier version of this document, dated the same day, asserted that
recruitment, SSO/SAML, SCIM, legal entities, leave accrual, rostering, biometric
ingestion and accounting export **did not exist**, and it attributed to
`CLAUDE.md` a claim that MFA and SSO were absent.

All of that was wrong, and the website was built on it.

What happened: the repository was mid-merge, with three unresolved conflicts. The
audit read the working tree, found 153 models with none of those features, and
concluded `CLAUDE.md` had drifted. In fact `CLAUDE.md` was accurate — it
documents every one of those modules in a section headed *"Not gaps — these were
on this list and are built"*, immediately above a warning that a stale gap list
"cost real marks in a customer evaluation for features that already shipped."
The staged additions were visible in `git status` at the time and were not
reconciled against the audit.

`CLAUDE.md` never claimed there was no MFA, no recruitment, or 75 models. That
quotation was invented. Nothing in this file now contradicts `CLAUDE.md`.

**The lesson, recorded because it is cheap to repeat:** before auditing, check
that the working tree is in a settled state. `ls .git/MERGE_HEAD` and
`git diff --diff-filter=U` take one second between them.

> **Still open at the time of writing:** three merge conflicts —
> `.github/baselines/vitest.txt`, `backend/app/Services/Attendance/AttendanceService.php`,
> `frontend/src/components/Layout.test.tsx`. Nothing in this document is sourced
> from inside those three files. Everything else in the tree is settled.

---

## 1. Hard numbers — citable, defensible, checkable

| ID | Number | What it counts | How |
|---|---|---|---|
| `NUM-01` | **776** | registered API routes | `grep -rhoE 'Route::(get\|post\|put\|patch\|delete)' backend/routes/ \| wc -l` |
| `NUM-02` | **190** | Eloquent models | `ls backend/app/Models/*.php \| wc -l` |
| `NUM-03` | **151** | service classes | `find backend/app/Services -name '*.php' \| wc -l` |
| `NUM-04` | **133** | web page components | `find frontend/src/pages -name '*.tsx' \| wc -l` |
| `NUM-05` | **4** | client apps: React web · Expo mobile · Electron tracker · Chromium extension | directories |
| `NUM-06` | **18** | mobile screens | `mobile-app/app/**/*.tsx` |
| `NUM-07` | **37** | states and UTs with Professional Tax resolved (**20** levy it, **17** levy none) | `PTStateService::STATE_CONFIGS` |
| `NUM-08` | **23** | statutory filing generators, all producible | `Payroll/FilingGeneratorRegistry` + `resources/views/filings/` |
| `NUM-09` | **215** | payroll API routes alone | `routes/api/protected/payroll.php` |
| `NUM-10` | **33** | recruitment API routes | `routes/api/protected/recruitment.php` |
| `NUM-11` | **214** | backend test files | `find backend/tests -name '*Test.php'` |
| `NUM-12` | **132** | frontend test files | `find frontend/src -name '*.test.*'` |
| `NUM-13` | **143** | models under tenant scope | models carrying `BelongsToOrganization` |

> **On `NUM-08`.** All 23 generators now produce output — the ten blade templates
> that were previously missing are written. **But four are preparation sheets,
> not statutory returns:** `eshram_registration`, `shram_card_registration`,
> `se_registration` and `form_1`. e-SHRAM covers unorganised workers, so most of
> a PF-deducting payroll is ineligible; S&E registration is state legislation
> filed on each state's own form. The templates say so on their face. And
> **nothing submits anything** — every filing is a document a human uploads.
> Permitted phrasing: "23 statutory documents, 19 of them returns." Never
> "23 returns filed automatically."

---

## 2. The positioning claim — unchanged, and now stronger

**`POS-01`: the evidence of work and the payslip are the same system.**

| Stage | Where it lives |
|---|---|
| 1a. Desktop tracker: activity, screenshots, idle | `desktop/main.cjs` |
| 1b. Browser extension: URL context | `browser-extension/chromium/` |
| 1c. **Biometric terminals, via ADMS push** | `routes/api/biometric.php`, `Attendance/BiometricPunchProcessor` |
| 1d. Geofenced mobile punch + selfie | `Models/GeofenceZone`, `AttendanceSelfie` |
| 2. Activity classified | `Monitoring/ProductivityClassifier` |
| 3. Resolved against the roster | `Attendance/ShiftResolver`, `RosterService` |
| 4. Becomes attendance | `Models/AttendanceRecord` |
| 5. Syncs into the payroll run | `POST /payroll/runs/{runId}/sync-attendance` |
| 6. Statutory computed | `PayrollCalculatorService` |
| 7. Bank file, payslip, returns | `PayrollDisbursementService`, `PayrollFilingService` |
| 8. **Posted as double-entry** | `Payroll/PayrollJournalService` → `AccountingExportService` |

The chain is now longer at both ends than the earlier audit knew: **four capture
paths** feed it, and it terminates in a **balanced accounting journal** rather
than a payslip. State it as an architecture claim, never as a claim about
competitors (`DONT-06`).

---

## 3. Module inventory

### 3.1 Payroll engine — `PAY-*`

| ID | Claim | Evidence |
|---|---|---|
| `PAY-01` | CTC → components → statutory → net, residual balances back to CTC | `PayrollCalculatorService::calculateSalaryComponents`, `residualAbsorptionFactor`, `maxBasicWithinCtc` |
| `PAY-02` | Lifecycle `draft → locked → approved → released → disbursed`, each with actor and timestamp | `Models/PayrollMonthlyRun` |
| `PAY-03` | Structures from formula, slab and lookup components, plus CTC bands and pay groups | `Models/SalaryFormula`, `SalarySlabComponent`, `SalaryLookupComponent`, `CtcRangeBand`, `PayGroup` |
| `PAY-04` | Every payroll item versioned | `Models/PayrollItemVersion` |
| `PAY-05` | Processing queued, pollable; a concurrent second start is refused with **409** | `POST /payroll/runs/{id}/process-remaining` |
| `PAY-06` | Off-cycle and on-demand runs | `OffCyclePayrollService`, `OnDemandSalaryService` |
| `PAY-07` | Arrears, LOP, pro-rating, notice recovery, encashment, gratuity are engine functions | `PayrollCalculatorService` |
| `PAY-08` | Net pay stored **signed** — a negative is surfaced, not clamped | `PayrollValidationService` |

**Screens:** `payroll/PayrollShell.tsx`, six tabs; ten-step guided setup;
`SalaryStructureTemplates`, `FormulaEnginePage`, `PayGroupSettings`.

### 3.2 Governed overrides — `OVR-*` — unchanged and still the strongest block

| ID | Claim | Evidence |
|---|---|---|
| `OVR-01` | An override that cannot balance is **refused at entry**, naming the maximum that would work | `OverrideBalancingService::assess()` → `permitted`, `max_permitted`, `message` |
| `OVR-02` | Raising a component costs **1.668×** its face value at the usual rates; shown before commit | `OverrideBalancingService` docblock; `POST /payroll/operations/overrides/preview` |
| `OVR-03` | The residual fallback only ever lands on a **taxable** component | `resolveResidual()` |
| `OVR-04` | Two components claiming the residual is a configuration error, not a coin flip | `hasAmbiguousResidual()` |
| `OVR-05` | Maker-checker: propose, then approve / reject / cancel | `/operations/overrides/{id}/approve` etc. |
| `OVR-06` | Append-only audit per override | `Payroll/OverrideAuditTrail` |
| `OVR-07` | CSV round-trip with validate-before-commit | `/import/validate`, `/import/commit` |

### 3.3 Statutory — `STA-*`

Constants from `PayrollCalculatorService.php:26-63`. Unchanged by the merge.

| ID | Head | Detail |
|---|---|---|
| `STA-01` | **PF** | ₹15,000 ceiling, 12%+12%, employer split EPS 8.33% / EPF 3.67%, above-ceiling, VPF |
| `STA-02` | **ESI** | ₹21,000 threshold, 0.75% / 3.25% |
| `STA-03` | **ESI contribution-period lock-in** | 1 Apr–30 Sep, 1 Oct–31 Mar; coverage fixed for the period — `Payroll/EsiContributionPeriodService` |
| `STA-04` | **Professional tax** | 37 states and UTs; **20 levy, 17 return ₹0**; month-aware (Maharashtra February ₹300, top band only) |
| `STA-05` | **TDS** | both regimes, FY-keyed slabs, surcharge, 4% cess, §87A on taxable income with marginal relief |
| `STA-06` | **TDS is cumulative** | `calculateCumulativeMonthlyTds()` |
| `STA-07` | **Gratuity** | 4.81% provision; settlement path enforces five-year floor and ₹20,00,000 ceiling |
| `STA-08` | **LWF** | `Payroll/LwfCalculator` |
| `STA-09` | **HRA** | least-of-three, metro / non-metro |
| `STA-10` | **NPS, perquisites, Code on Wages** | `PerquisiteCalculator`, `Payroll/CodeOnWagesService` |

### 3.4 Statutory working time — `SWT-*` — NEW

`Attendance/StatutoryWorkingTime`, `routes/api/protected/statutory_compliance.php`
(`role:payroll`). This is the Factories Act and the S&E Acts, written down once.

| ID | Claim | Evidence |
|---|---|---|
| `SWT-01` | Working-hour limits and the overtime rate are **properties of the premises**, held on `legal_entities`, not on a policy somebody configured | `StatutoryWorkingTime` docblock |
| `SWT-02` | Each number carries the provision it comes from; when a state amends a limit, one file changes | ditto |
| `SWT-03` | **An exemption is read from the entity, never inferred from an address.** s.55 allows six hours instead of five *by written order of the Chief Inspector*; a Gujarat factory without that order is still on five | ditto — "inferring it would hand a customer a compliance report that quietly says they are fine when they are not" |
| `SWT-04` | **S&E limits are deliberately thinner.** The Acts are state legislation and genuinely differ, so only limits common across major states are asserted; daily and spread-over ceilings are left **null rather than guessed** — "a compliance screen that cries wolf gets switched off" | ditto |
| `SWT-05` | `/statutory/limits`, `/statutory/overtime-register`, `/statutory/breaches` | route file |
| `SWT-06` | **`unregulated` means unassessed, not compliant** — an empty breach list must never render as a green tick | `CLAUDE.md` §Working-hour law |
| `SWT-07` | **The overtime floor is computed always, applied only on request.** A configured rate below the s.59 minimum of 2× is always flagged; it is only *paid* at the floor when the entity has `enforce_overtime_floor` on. Raising a live payroll's overtime rate because somebody deployed a release is not the engine's decision | ditto |
| `SWT-08` | **Statutory overtime ≠ policy overtime.** The register measures excess over nine hours a day / forty-eight a week (s.59), not over the rostered shift | ditto |
| `SWT-09` | **A rest interval is one qualifying break, not the sum of several.** Two fifteen-minute teas are not a half hour under s.55 | ditto |
| `SWT-10` | The register prices **assessed** hours, not approved ones; an employee with no `annual_ctc` yields `amount: null`, never `0.00`, and totals surface `rows_without_a_rate` | ditto |

### 3.5 Working-time policies — `WTP-*` — NEW

`routes/api/protected/working_time.php`, 25 endpoints.

| ID | Claim | Evidence |
|---|---|---|
| `WTP-01` | Four policy families, each with org-level definitions and per-employee assignment: **weekly off, penalisation, overtime, shift allowance** | `Models/WeeklyOffPolicy`, `PenalisationPolicy`, `OvertimePolicy`, `ShiftAllowancePolicy` + four `Employee*Policy` |
| `WTP-02` | Penalisation supports half-day rules | `Models/PenalisationHalfDayRule` |
| `WTP-03` | Overtime policies are scopeable | `Models/OvertimePolicyScope` |
| `WTP-04` | An employee can read the policies that apply to them | `GET /working-time/my-policies` |

### 3.6 Filings — `FIL-*` — REVISED

| ID | Claim | Evidence |
|---|---|---|
| `FIL-01` | **23 statutory documents generate.** Text/CSV/aggregate: PF ECR, Full ECR, ESI Challan, Form 24Q, PT Return, LWF Return, Bonus C/D/E + combined. PDF: Form 12BA, Form 16, Form 16 Annual, Form 19, Form 31, Form 1, Form 2, Form 6, Form 124, e-SHRAM, UAN Activation, S&E Registration, Shram Card | `FilingGeneratorRegistry::GENERATORS`; 13 blade templates present |
| `FIL-02` | Availability resolved **against the filesystem**, so the product cannot advertise a return it cannot write | `isAvailable()` |
| `FIL-03` | Batch generation attempts each generator independently, returning `['filings', 'failures']` | `PayrollFilingService::generateAllFilings()` |
| `FIL-04` | A filing reports `filing_ready: false` when PAN/TAN is missing rather than emitting `PANINVALID` | `PayrollFilingValidatorService` |
| `FIL-05` | Identifiers resolve from the profile column **or** `employee_government_ids` | `User::statutoryId()` |
| `FIL-06` | **Four are preparation sheets, not returns** — see `NUM-08`. And nothing auto-submits. | template contents; `CLAUDE.md` §Known gaps |
| `FIL-07` | Filings generate **per legal entity** | `LegalEntityResolver` |

### 3.7 Legal entities — `ENT-*` — NEW

| ID | Claim | Evidence |
|---|---|---|
| `ENT-01` | `legal_entities` carries its own **PAN, TAN, PF and ESI codes** | `Models/LegalEntity` |
| `ENT-02` | `LegalEntityResolver` decides which entity an employee files under, defaulting to the organisation's primary | `Payroll/LegalEntityResolver` |
| `ENT-03` | Filings generate per entity | `FIL-07` |
| `ENT-04` | Also carries `establishment_type` and exemptions — the basis for `SWT-01` | `StatutoryWorkingTime` |
| `ENT-05` | `/legal-entities`, `/legal-entities/{id}/employees` (`role:payroll`); configured under **Settings → Legal entities** | route file, `Settings.tsx` |

### 3.8 Money movement — `BNK-*`

Unchanged: `BNK-01` bank batches and NEFT/RTGS files · `BNK-02` unpayable people
returned as **exclusions, never dropped** · `BNK-03` the bank's **UTR** is the only
trusted reference · `BNK-04` reversals · `BNK-05` stop-payment flags ·
`BNK-06` reconciliation · `BNK-07` the bank file is deliberately synchronous ·
`BNK-08` government-ID and bank-detail validation.

### 3.9 Accounting export — `ACC-*` — NEW

`Payroll/PayrollJournalService` + `Payroll/AccountingExportService`,
`routes/api/protected/accounting_export.php` (`role:payroll`).

| ID | Claim | Evidence |
|---|---|---|
| `ACC-01` | **The journal must balance exactly, or nothing is produced.** Debits equal credits to the paisa | `PayrollJournalService` docblock |
| `ACC-02` | **An unmapped component refuses the export and is named** — never a suspense account, never omitted. "Your salary journal is 40,000 light and nobody knows why" is what omitting one line produces | ditto |
| `ACC-03` | **Computed in bcmath, rounded once.** A float sum drifts by a paisa across a few hundred employees, and a paisa is the difference between balanced and rejected | ditto |
| `ACC-04` | **PF and ESI payable carry both halves in one credit line** — the organisation owes the total onward as one liability, reconciling against a single challan | journal shape in docblock |
| `ACC-05` | **Tally's sign convention is backwards.** A DEBIT is a NEGATIVE `<AMOUNT>` with `ISDEEMEDPOSITIVE = Yes`. Get it the intuitive way round and the voucher still imports — it just posts every salary as income | `AccountingExportService` docblock |
| `ACC-06` | Tally dates are `YYYYMMDD` with no separators — the other reason an import silently does nothing | `toTallyXml()` |
| `ACC-07` | Zoho Books gets a separate exporter, not a flag: "the two formats disagree about something fundamental, and a shared code path with an `if` in it is where that disagreement gets lost" | `AccountingExportService` docblock |
| `ACC-08` | **Neither exporter decides anything** — both take an already-balanced journal and refuse to invent, round or omit | ditto |
| `ACC-09` | Previewed and downloaded from Payroll → Reports → Accounting | `AccountingExportPicker` |
| `ACC-CAVEAT` | **No live API push.** It produces a file somebody imports; it does not post into Zoho or Tally. | `CLAUDE.md` §Known gaps |

### 3.10 Controls and detective reports — `CTL-*`

Unchanged: `CTL-01` differences (item-wise, employee-wise, consolidated) ·
`CTL-02` negative cost · `CTL-03` duplicates · `CTL-04` reconciliation ·
`CTL-05` payroll audit log and run activity feed · `CTL-06` pre-run checklist ·
`CTL-07` approval routing · `CTL-08` closed-run write guard ·
`CTL-09` break-glass sessions.

### 3.11 Time, attendance & evidence of work — `TIM-*`

| ID | Claim | Evidence |
|---|---|---|
| `TIM-01` | Electron tracker: screenshots, OS-level idle, **offline disk queue** | `desktop/main.cjs` |
| `TIM-02` | Chromium extension supplies URL context | `browser-extension/chromium/` |
| `TIM-03` | Activity classified by configurable rules at org and global scope | `Monitoring/ProductivityClassifier` |
| `TIM-04` | Idle **rewinds to the last real activity**; the tail is recorded in `trailing_idle_seconds` and never billed | `Monitoring/IdleResolutionService` |
| `TIM-05` | A server-side sweep closes idle timers every minute — the desktop app cannot act once asleep | `routes/console.php` |
| `TIM-06` | Geofenced punch, attendance selfies, map view | `Models/GeofenceZone`, `AttendanceSelfie` |
| `TIM-07` | Shifts, timezone-aware resolution, OT rules, shift allowances, comp-off, break types | `Attendance/ShiftResolver`, `ResolvedShift`, `UserTimezoneResolver` |
| `TIM-08` | Regularisation requests approve, reject **and forward to another approver** | `/attendance-time-edit-requests/{id}/transfer` |
| `TIM-09` | **The handoff:** attendance syncs into the run through one endpoint, per run or per employee, with an inspectable status | `POST /payroll/runs/{runId}/sync-attendance` |
| `TIM-10` | Team presence | `Attendance/TeamPresenceService` |

### 3.12 Rostering — `ROS-*` — NEW

`Attendance/RosterService`, `Attendance/ShiftSwapService`,
`routes/api/protected/roster.php` (`role:manager`), screen `RosterPage.tsx`.

| ID | Claim | Evidence |
|---|---|---|
| `ROS-01` | `ShiftResolver` precedence is **published roster day → effective-dated assignment → work info** | `CLAUDE.md` §Rostering |
| `ROS-02` | **An off day is a ROW, not a missing row.** A null `shift_id` means "rostered, and off"; no row means "not rostered". Somebody given the day off has been told something; somebody nobody scheduled has not | `RosterService` docblock |
| `ROS-03` | **A rostered rest day does not fall through** to the standing assignment — that would quietly expect a full night shift from somebody told they had the day off | `ShiftResolver` |
| `ROS-04` | **Draft days are invisible to the resolver**, so a manager builds next month without changing what attendance expects today. Publishing is a separate act | `RosterService` docblock |
| `ROS-05` | **Regenerating never destroys a decision.** `source` separates `generated` from `manual`/`swap`; generation replaces only its own rows | ditto |
| `ROS-06` | **A past day is not rewritten** — the roster for last Tuesday is the record every attendance record on that date was measured against | ditto |
| `ROS-07` | **Cycle length is in DAYS, not weeks.** A four-on-four-off runs on eight days; `start_offset` stops everybody on a rota resting on the same day | `Models/ShiftRotation`, `ShiftRotationStep` |
| `ROS-08` | **A swap needs three parties** — the counterparty agrees AND a manager approves, and shifts are re-read at approval rather than trusted from request time | `ShiftSwapService`, `Models/ShiftSwapRequest` |
| `ROS-09` | `/roster`, `/coverage`, `/swaps`, `/rotations`, `/generate`, `/publish`, `/day`, `/rotations/{id}/assign` | route file |
| `ROS-CAVEAT` | **No drag-and-drop calendar.** A manager sets a one-off day through the UI/API, not by dragging a shift onto a cell. | `CLAUDE.md` §Known gaps |

### 3.13 Biometric ingestion — `BIO-*` — NEW

`routes/api/biometric.php`, `Attendance/BiometricPunchProcessor`,
`ProcessBiometricPunches` command.

| ID | Claim | Evidence |
|---|---|---|
| `BIO-01` | **ADMS push** — the protocol eSSL, ZKTeco, Biomax and Matrix terminals speak: `/cdata`, `/getrequest`, `/devicecmd` | route file |
| `BIO-02` | **A serial must be registered by an admin before anything is accepted** | `BiometricDeviceController` |
| `BIO-03` | Punches are unique on (device, device user, timestamp), so **a replayed request is a no-op** | `Models/BiometricPunch` |
| `BIO-04` | `BiometricPunchProcessor` pairs readings into attendance | service |
| `BIO-05` | **`isStale()` means "reported before and stopped", not "has never reported"** — conflating them made a terminal registered thirty seconds earlier announce that no attendance was arriving, which teaches an admin to ignore the warning | `Models/BiometricDevice`, `hasEverReported()` |
| `BIO-06` | **Unclaimed punches are kept, not dropped** — claiming the device user ID attaches the backlog | `/biometric-devices/claim` |
| `BIO-07` | Managed under **Settings → Biometric devices**, which surfaces both silent failures: a device that stopped reporting, and an unclaimed device user | `Settings.tsx` |
| `BIO-CAVEAT` | **Push only.** Devices that offer SDK pull, or sit on a LAN with no outbound route, cannot talk to this. | `CLAUDE.md` §Known gaps |

### 3.14 Monitoring consent & DPDP — `CON-*`

Unchanged: `CON-01` one gate every capture path passes · `CON-02` versioned
notices, never edited · `CON-03` per-capture-type consent, withdrawable ·
`CON-04` capture refused after the window closes · `CON-05` screenshot retention
purge · `CON-06` built because DPDP liability falls on the employer.

### 3.15 Recruitment — `REC-*` — NEW

`routes/api/protected/recruitment.php` (33 routes, `role:manager`; BGV on
`role:payroll`), `Services/Recruitment/*`, screen `RecruitmentPage.tsx`.

| ID | Claim | Evidence |
|---|---|---|
| `REC-01` | `job_openings` — **not** `jobs`, which Laravel's queue owns; a collision there surfaces in a worker rather than a test | `Models/JobOpening` |
| `REC-02` | **A candidate is a PERSON, an application is one candidacy.** Collapsing them breaks the moment somebody good applies for a second role | `Models/Candidate`, `JobApplication` |
| `REC-03` | **`candidates.email` is unique per ORGANISATION**, deliberately unlike `users.email` which is globally unique — the same person legitimately applies to two customers | migration |
| `REC-04` | **A stage move is an event, not a column.** `hiring_stage_id` says where somebody is; `application_stage_events` says how they got there — both written in one transaction through `HiringPipelineService` | `HiringPipelineService::moveTo` |
| `REC-05` | **`status` and `hiring_stage_id` answer different questions.** A rejection keeps the stage it happened at: "rejected after the tech round" and "rejected on the CV" are different facts | `reject()` |
| `REC-06` | Moving backwards is allowed and recorded as `moved_back` — a forward-only pipeline gets worked around by deleting and recreating the application, destroying the history | `moveTo()` |
| `REC-07` | Funnel reporting per opening | `funnelFor()` |
| `REC-08` | **Panel feedback is per interviewer and never averaged.** Three people going two-to-one and three people all lukewarm produce the same mean and call for completely different conversations — `summaryFor()` returns the split and an explicit `is_split` | `InterviewService`, `Models/InterviewFeedback` |
| `REC-09` | **Invited and submitted are different states** — `panelProgress()` answers "two of three have responded" | `InterviewService` |
| `REC-10` | **Somebody who has already given feedback cannot be dropped from a panel** — their verdict informed a decision that may already be taken | `Models/InterviewPanellist` |
| `REC-11` | Offer state machine: `draft → pending_approval → approved → sent → accepted/declined`; **any rejection returns it to draft immediately** rather than collecting the rest of a chain for something already refused | `OfferService` docblock |
| `REC-12` | **Approval rows are written up front** — they record who was *asked*, not just who answered. "Nobody ever asked finance" is exactly what an audit looks for | ditto |
| `REC-13` | **An empty approver list is refused**, never treated as "no approval needed" | `OfferService` |
| `REC-14` | **Once a candidate has seen an offer the money cannot be edited in place.** A revision is a new offer superseding the old one | `OfferService` docblock |
| `REC-15` | Re-sending does not move `sent_at` — the candidate has been counting down | `OfferService` |
| `REC-16` | Accepting moves the candidacy to hired **through the pipeline**, so headcount and the offer cannot disagree | `OfferService` → `HiringPipelineService` |
| `REC-CAVEAT` | **No public careers page.** A candidate cannot browse and apply; somebody records them. No engagement surveys, no HR helpdesk. | `CLAUDE.md` §Known gaps |

### 3.16 Offer signing — `SGN-*` — NEW

Public and unauthenticated: `GET/POST /offers/sign/{token}`,
`/offers/sign/{token}/document`. Frontend route `/offer/:token`
(`OfferSigningPage.tsx`).

| ID | Claim | Evidence |
|---|---|---|
| `SGN-01` | **The signing token IS the authentication.** A candidate is not a user and never will be — making somebody create an account to accept a job loses offers. 32 random bytes, stored only as a SHA-256 hash, compared with `hash_equals`, `$hidden` on the model, and **cleared in the same transaction** as the signature is written | `OfferSigningController`, `routes/api/public.php:128-143` |
| `SGN-02` | **Every failure returns the same 404** — wrong token, expired, already used, withdrawn. Distinguishing them tells an unauthenticated caller which tokens exist | ditto |
| `SGN-03` | **`document_hash` is the load-bearing column**, not the drawing. It fingerprints the letter as the candidate actually read it, taken from the **unsigned** render | `OfferLetterService` |
| `SGN-04` | **Typing a name is a signature.** The canvas is optional; requiring it excludes keyboard and assistive-technology users. An untouched canvas is never stored | `OfferSigningPage.tsx` |
| `SGN-05` | Declining is offered on the same page — "no reply" is a worse outcome for a recruiter than a reason | ditto |
| `SGN-06` | Routed **without** `PublicRoute`, which would bounce a signed-in recruiter checking their own link | `App.tsx:645` |

### 3.17 Background verification — `BGV-*` — NEW

`Services/Recruitment/BackgroundCheckService`, gated on **`role:payroll`**, not
the `role:manager` gate the rest of recruitment uses.

| ID | Claim | Evidence |
|---|---|---|
| `BGV-01` | **Consent gates everything, structurally.** `background_checks.consent_id` is a foreign key, not a boolean somebody could set from a console. Every method checks before it will move | `BackgroundCheckService` docblock |
| `BGV-02` | **Consent is to a SCOPE, not to "background checks".** Somebody who agreed to employment verification has not agreed to a credit check; items outside the recorded scope are refused by name, and a package that gains a check next year cannot retroactively widen last year's consent | ditto |
| `BGV-03` | IP and user agent are recorded as **evidence, not decoration** — a consent that cannot be produced later did not happen as far as a regulator is concerned | `recordConsent()` |
| `BGV-04` | **Withdrawal stops outstanding work but does NOT erase findings** — they were lawfully obtained, and deleting them would delete the record that the check happened. Unstarted items become `skipped` | `withdraw()` |
| `BGV-05` | **A discrepancy is not a failure.** The vocabulary is `clear\|discrepancy\|insufficient`, never pass/fail. A discrepancy requires BOTH `claimed` and `verified` — an accusation with no comparison behind it is one nobody can answer | `Models/BackgroundCheckItem` |
| `BGV-06` | **Nothing here rejects anybody.** The service will not touch the candidacy, move a pipeline stage, or set a status that reads as a verdict | docblock |
| `BGV-07` | Adverse action has to reach the person: `needsAdverseActionNotice()` is on the API, a notice on a clear check is refused, and a candidate response before a notice is refused | `/background-checks/{id}/notify`, `/respond` |
| `BGV-08` | Gated on `role:payroll` because a completed check can carry a criminal record and a previous salary; a hiring manager decides whether to hire without needing either | route file |
| `BGV-CAVEAT` | **No vendor integration.** No AuthBridge or IDfy connection — a human records the findings. | `CLAUDE.md` §Known gaps |

### 3.18 SSO — SAML 2.0 — `SSO-*` — NEW

`Auth/SamlAuthService` over `onelogin/php-saml`.

| ID | Claim | Evidence |
|---|---|---|
| `SSO-01` | SP entity ID, ACS URL, IdP metadata, login redirect, assertion consumption | `SamlAuthService` |
| `SSO-02` | **Signature verification is delegated to the library on purpose.** This codebase owns connection resolution, replay refusal and whether an authenticated stranger becomes a user | `CLAUDE.md` §SAML |
| `SSO-03` | Connection resolved by Issuer **across tenants, without trusting it** | ditto |
| `SSO-04` | **Replay refused** via `saml_used_assertions` | ditto |
| `SSO-05` | **A new connection is created switched off.** Turning one on redirects every sign-in in the organisation, so it is a deliberate second act | ditto |
| `SSO-06` | Public: `/auth/saml/discover`, `/{connectionId}/redirect`, `/callback`, `/metadata`. Configured under **Settings → Single sign-on** | `routes/api/public.php:121-124` |

### 3.19 SCIM provisioning — `SCM-*` — NEW

`Auth/ScimProvisioningService`, public `scim/v2` prefix throttled 300/min.

| ID | Claim | Evidence |
|---|---|---|
| `SCM-01` | **The bearer token IS the authentication.** An IdP cannot hold a session or do OAuth against us; RFC 7644 specifies bearer auth and that is what Entra and Okta send. CSPRNG-generated, stored **only** as a SHA-256 hash, `$hidden`, revocable, shown exactly once | `issueToken()` docblock |
| `SCM-02` | **Deactivating REVOKES personal access tokens**, not just a flag. A flag alone leaves a leaver's existing token reading payroll on Monday — the precise failure SCIM is bought to prevent | `deactivate()`, service docblock |
| `SCM-03` | **DELETE means deactivate, never erase.** SCIM's DELETE says "no longer in the directory"; payslips, attendance and the leave ledger are records the organisation must keep, and an IdP admin ticking a box must not destroy them | docblock |
| `SCM-04` | **People are matched by `externalId`, never by email.** People change their surname; matching on email silently creates a second account and deprovisions neither. An email match **adopts** the existing account and stamps the externalId | `upsertUser()` |
| `SCM-05` | A created account gets an unusable random password — it authenticates through the IdP and nowhere else | `upsertUser()` |
| `SCM-06` | **Both PATCH shapes are handled.** Okta sends `{"op":"replace","path":"active","value":false}`; Entra sends `{"op":"replace","value":{"active":false}}`. Supporting one is how half your customers find leavers keep access | `ScimController` |
| `SCM-07` | **An unsupported filter is refused, not ignored.** Returning the whole directory for an unparsed filter is how an IdP concludes everybody exists and provisions nobody | `ScimController` |
| `SCM-08` | Response envelopes (`schemas`, `totalResults`, `Resources`, `scimType`) are the RFC's — IdPs parse them strictly | `toScimUser()` |
| `SCM-CAVEAT` | **No group provisioning.** `/Groups` is unimplemented, so people sync but the roles they should get do not. | `CLAUDE.md` §Known gaps |

### 3.20 Leave — `LVE-*` and accrual `LVA-*` — REVISED

The earlier audit's "flat annual quota, no accrual" was **wrong**.

| ID | Claim | Evidence |
|---|---|---|
| `LVE-01` | Requests approve / reject / revoke, **and transfer to another approver** with a forward-target lookup | `routes/.../attendance.php` |
| `LVE-02` | Holiday calendars per organisation | `Models/AttendanceHoliday` |
| `LVE-03` | Encashment flows into payroll with approval | `Models/LeaveEncashment` |
| `LVA-01` | `leave_types` **replaces** the JSON quota: per-type annual quota, `annual\|half_yearly\|quarterly\|monthly` accrual, pro-rating for mid-year joiners against a `joining_cutoff_day`, a separate probation rate, per-type carry-forward caps | `Models/LeaveType` |
| `LVA-02` | **A balance is a ledger, never a stored counter.** Balance is `SUM(units)` over `leave_ledger_entries`, so "why is my balance 8.5" expands into the dated rows that produced it | `Models/LeaveLedgerEntry`, `balanceFor()` |
| `LVA-03` | Accrual rules apply **in order**, and the order matters: which periods the year contains → whether the person was employed for it → what a partial first period is worth → what the per-period rate is. "Get that order wrong and you hand a full year's entitlement to somebody who joined in November" | `LeaveAccrualService` docblock |
| `LVA-04` | **Idempotent by construction** — unique on (user, type, effective_on), enforced by the database. The job *will* be re-run, and a double accrual is invisible until somebody takes leave they never earned | ditto |
| `LVA-05` | Year end is three genuinely different obligations: `carry_forward` (up to the cap, the rest expires), `reset`, `encash` (creates a **payroll liability** the settlement run can find) | `LeaveYearEndService` docblock |
| `LVA-06` | **Every outcome is a ledger ROW; nothing is edited or deleted.** Carry-and-expire is two rows so "10 carried, 5 expired" is sayable; the carry lands on **both sides** of the boundary so each year's ledger adds up to its own balance; an overdrawn balance is left alone rather than zeroed | ditto |
| `LVA-07` | `annualQuotaFor()`: **notice outranks probation**, and NULL means the normal rate in both cases, never zero | `CLAUDE.md` §Leave |
| `LVA-08` | `AccrueLeave` console command; `/leave-types`, `/leave-ledger/{userId}` (`role:admin`); configured under **Settings → Leave — the only editor** | route file, `Settings.tsx` |

### 3.21 Core HR & lifecycle — `HR-*`

Unchanged: `HR-01` records, work info, government IDs, bank accounts, documents,
education · `HR-02` onboarding opens automatically, 18 steps, day −14 to +90, six
owner roles, blocking gates · `HR-03` a joiner completes only their own items ·
`HR-04` future joining dates are valid · `HR-05` exit lifecycle ·
`HR-06` full & final settlement · `HR-07` salary revision letters accepted or
rejected by the employee · `HR-08` org structure · `HR-09` payroll readiness
checked in lifecycle. Plus:

| ID | Claim | Evidence |
|---|---|---|
| `HR-10` | **Effective-dated compensation is implemented.** `CompensationTimeline` resolves what somebody earned on any given day from accepted revision letters; `PayrollAutoProcessService` calls `blendedAnnualCtcForMonth()`. A mid-month revision blends correctly and a back-dated one diffs against a real prior rate — arrears are not approximate | `Services/Payroll/CompensationTimeline` |

### 3.22 Expenses, FBP, loans, variable pay — `EXP-*`

Unchanged: `EXP-01` reimbursements with two-stage approval · `EXP-02` FBP ·
`EXP-03` loans with payroll recovery · `EXP-04` arrears · `EXP-05` variable pay ·
`EXP-06` perquisites and garnishments.

### 3.23 Employee tax self-service — `TAX-*`

Unchanged: `TAX-01` declarations reviewed by payroll · `TAX-02` proof upload,
bulk approve, Form 12BB · `TAX-03` regime comparison and simulator ·
`TAX-04` tax-saving recommendations · `TAX-05` employees reach only their own
figures, via a tested allow-list.

### 3.24 Reports & finance — `RPT-*`

Unchanged: `RPT-01` daily/weekly/monthly/productivity/attendance/project/team
reports with CSV export · `RPT-02` payroll and statutory registers ·
`RPT-03` GL mapping and cost centres · `RPT-04` burn rate and CTC planning ·
`RPT-05` custom report definitions.

### 3.25 Work management — `WRK-*`

Projects; tasks with dependencies, recurrence, checklists, labels, watchers;
groups; 1:1 and group chat; polls; assets; performance cycles, goals, check-ins,
competencies, 360 aggregation.

> **`WRK-CAVEAT`:** chat has **no real-time transport** — `BROADCAST_CONNECTION=log`
> and the client polls every 10s. Do not write "real-time chat".

### 3.26 Platform, security & tenancy — `SEC-*`

| ID | Claim | Evidence |
|---|---|---|
| `SEC-01` | **Tenant isolation is structural**: **143 models** apply an organisation scope at the ORM layer and stamp the tenant on create. Cross-tenant reads must be written explicitly and are therefore greppable | `app/Traits/BelongsToOrganization.php` |
| `SEC-02` | **A test fails the build if a tenant-owned model forgets the trait** | `tests/Feature/TenantIsolationTest.php` |
| `SEC-03` | **TOTP MFA** with recovery codes; per-org policy `off`/`grace`/`enforced`; grace deadlines; forced enrolment for privileged roles | `Security/MfaService` |
| `SEC-04` | Role-based access, org roles, group access; payroll route gating asserted by test | `Authorization/*`, `PayrollRouteAuthorizationTest` |
| `SEC-05` | Break-glass elevation is a recorded session | `Security/BreakGlassService` |
| `SEC-06` | Platform-wide audit log | `Audit/AuditLogService` |
| `SEC-07` | HTML sanitisation on user content | `Security/HtmlSanitizerService` |
| `SEC-08` | Auth throttling on login, MFA verify, and SCIM | `routes/api/public.php` |
| `SEC-09` | API clients, scoped tokens, webhook endpoints with delivery records | `Models/ApiClient`, `WebhookDelivery` |
| `SEC-10` | One invite system (`invitations`); the legacy `invites` path was removed in Aug 2026 | `Invitations/InvitationService` |
| `SEC-11` | **SAML SSO and SCIM provisioning** — see `SSO-*` and `SCM-*` | |

> **`SEC-CAVEAT`:** there is **no SOC 2 report and no ISO 27001 certificate**, and
> no published uptime or SLA. SSO now exists; certification does not.

---

## 4. What the website must NOT claim — `DONT-*`

Most of the earlier `DONT` list was wrong. This is the corrected set.

| ID | Prohibition | Why |
|---|---|---|
| `DONT-01` | **No customer counts, logo walls, testimonials, review scores or "trusted by N".** | None exist. |
| `DONT-02` | **No SOC 2 / ISO 27001 / any certification badge.** | Not certified. `SEC-CAVEAT` |
| `DONT-03` | Do not reuse the product's own `PricingPage.tsx` trust metrics — `10,000+ active users`, `500+ workspaces`, `32% productivity lift`, `4.8/5`. All fabricated. | `frontend/src/pages/PricingPage.tsx:9-14`. **Still a live liability in the product.** |
| `DONT-04` | Do not say "23 returns filed automatically". Say **23 statutory documents, 19 of them returns**, and note that nothing auto-submits. | `NUM-08`, `FIL-06` |
| `DONT-05` | Do not say "compliant in all 28 states". Say **PT resolved across 37 states and UTs, 17 of which levy none**. | `STA-04` |
| `DONT-06` | Do not name a competitor's defect. Engineering docblocks contain sourced notes about rival behaviour; those are research, not cleared copy. | Legal exposure |
| `DONT-07` | Do not claim **real-time chat** (`WRK-CAVEAT`), **SCIM group provisioning** (`SCM-CAVEAT`), a **public careers page** or **BGV vendor integration** (`REC-CAVEAT`, `BGV-CAVEAT`), a **drag-and-drop roster** (`ROS-CAVEAT`), **biometric SDK pull** (`BIO-CAVEAT`), or a **live accounting API push** (`ACC-CAVEAT`). | Each is a real, named gap |
| `DONT-08` | Do not present the legacy `payrolls` table or the retired `PayRun` API as capability. | Being retired |
| `DONT-09` | Do not imply the tracker runs without employee consent. Consent is enforced — say so, it is an asset. | `CON-01` |
| `DONT-10` | Do not claim uptime, SLA, response times or support hours. | No evidence; commercial commitments only the founder can set |
| `DONT-11` | Do not build the brief's "no base fee" wedge. CareVance's payroll plans **are** base-fee with a 50-seat floor. | `PRC-03`, `PRC-04` |
| `DONT-12` | Do not claim **i18n**. English only, no localisation layer — which caps self-service adoption on a shop floor. | `CLAUDE.md` §Known gaps |
| `DONT-13` | Do not claim **Laravel policies**. Authorization is inline in controllers; the `Role`/`Permission` schema and `hasPermission()` are real, and maker-checker covers the payroll chain, but there are 0 policy classes. | ditto |
| `DONT-14` | Do not claim **per-widget error boundaries**. `RouteErrorBoundary` wraps the routed area; one failing card still takes its page. | ditto |
| `DONT-15` | Do not describe the four preparation sheets as returns. | `FIL-06` |

### Withdrawn prohibitions

These were in the earlier list and were **wrong**. The features exist:

- ~~ATS / recruitment~~ → `REC-*`
- ~~Offer letters and e-signature~~ → `SGN-*`
- ~~Background verification~~ → `BGV-*`
- ~~SSO / SAML~~ → `SSO-*`
- ~~SCIM~~ → `SCM-*`
- ~~Multi-entity legal structure~~ → `ENT-*`
- ~~Leave accrual and pro-rating~~ → `LVA-*`
- ~~Effective-dated compensation~~ → `HR-10`
- ~~Rostering~~ → `ROS-*`
- ~~Biometric ingestion~~ → `BIO-*`
- ~~Accounting export~~ → `ACC-*`

**Travel expense management** remains absent — there is no travel model. So does
**announcements** (polls are real; announcements are not).

---

## 5. Pricing — `PRC-*`

Source of truth is `frontend/src/constants/pricing.ts`, which is wired to real
checkout.

| ID | Plan | Code | Price | Seats |
|---|---|---|---|---|
| `PRC-01` | **Basic** (Tracking) | `basic_tracking` | ₹399 /user/mo · ₹359 annual | per-seat, min 10 |
| `PRC-02` | **Advance** (Tracking) — *Most popular* | `advance_tracking` | ₹599 /user/mo · ₹539 annual | per-seat, min 10 |
| `PRC-03` | **Basic** (Payroll + Tracking) | `basic_payroll` | ₹3,999 /mo base | 50 included, then ₹79/seat |
| `PRC-04` | **Professional** (Payroll + Tracking) | `professional_payroll` | ₹5,999 /mo base | 50 included, then ₹119/seat |
| `PRC-05` | **Enterprise** | `enterprise` | Contact sales | — |
| `PRC-06` | Trial: 14 days, Basic Tracking, 5 seats, no card | | | |
| `PRC-07` | Annual discount **10%**, per-seat plans only | | | |
| `PRC-08` | GST **18%**, excluded from all listed prices | | | |

**Consequences:** payroll plans are base-fee with a 50-seat floor, so below 50
employees the effective per-employee cost is far above the extra-seat rate
(₹200/employee at 20 on Basic Payroll). The pricing page shows that rather than
hiding it. See `DONT-11`.

### 5.1 Features in `pricing.ts` that still do not exist

| ID | Sold as | Tier | Reality |
|---|---|---|---|
| `DONT-16` | **Travel & Expense Tracking** | Professional | No travel model. `Reimbursement`/`FbpClaim` cover expenses; travel is not built. |
| `DONT-17` | **Public Press / Company News** | Basic Payroll+ | No announcement model. `Poll` exists, so "Announcements & Polls" is **half** true. |
| `DONT-18` | **White Label Options**, **SLA Support**, **Dedicated Account Manager** | Enterprise | Plan-config strings only. `DONT-10` |

**Recruitment Management (ATS) is no longer on this list — it exists.** It may be
sold, and `/product/recruitment` documents it.

---

## 6. Open questions — cannot be resolved from the repo

1. **Legal entity name, registered address, grievance officer** — for
   `/legal/*` and `/contact`. Marked `[pending]` rather than invented.
2. **Support hours, SLA, data-residency region** — for `/security` and the DPA.
3. **Hosting provider and sub-processor names** — for the DPA.
4. The three phantom features in `pricing.ts` (§5.1) — remove or build?
5. The fabricated trust metrics in `PricingPage.tsx` (`DONT-03`) — still live.

---

*Re-audited 20 Aug 2026 against a tree with three unresolved merge conflicts, none
of which touch the modules above. Re-verify after the merge lands.*
