# Verification Report — Tracker, Payroll, and the Chain Between Them

**Date:** 31 August 2026 · **Repo:** `D:\Caretime` · **Benchmarks:** Time Doctor, Keka
**Suites at time of writing:** backend 2,805 passed / 1 skipped / 0 failed · frontend 1,406 passed / 142 files · `tsc --noEmit` clean

> **Baseline disclosure.** §7 says do not fix anything. Three changes were already made to this
> tree earlier today, *before* this audit began, and they are mine: a `MonthYear` sweep across 17
> month-parsing call sites, a fix to `CloseStaleTimers`, and one date-coupled test fixture. Nothing
> was changed during this audit. Every finding below that touches those areas is marked. The
> backend suite was **13 failing** before those changes and is zero now — so the "green suite"
> above is not evidence about the code this audit examines.

---

## 1. The verdict, in three lines

**Does the tracker work?** Largely yes, and in four places it beats Time Doctor. Its defects are in
what it *fails to tell the user* and in one entitlement it silently discards.

**Does payroll work?** The engine is good. The **inputs reaching it are not**. A queued job
hardcodes a working-day count that the LOP calculation subtracts from (§4), and **four separate
attendance-side computations — overtime, penalisation, shift allowance and comp-off — reach no
payslip at all** (§5.B5).

**Are they one system?** **No.** Traced with real data: a live payroll item pays a full month to an
employee whose attendance ledger holds nothing at all (§5.C1). Attendance reaches payroll through a
single sync endpoint whose own docblock states it *"rewrites the attendance columns on every item
but never recomputes the money."* The days on a payslip and the money on the same payslip are
computed at different moments from different numbers, and nothing reconciles them.

---

## 2. The structural finding — which engine pays people

**Resolved. Two engines exist. Only one pays anybody. The other is `DEAD` — but it is loaded.**

| | `PayrollCalculatorService` path | `SalaryCalculationService` path |
|---|---|---|
| Reached by | `PayrollDepartmentController::processEmployeePayroll` | `PayslipController::generate` |
| Writes to | `payroll_items` | `payslips` |
| Employee sees it via | `GET /payroll/my/payslips` → `PayrollController::myPayslips` | `GET /payroll/payslips/{id}` → `PayslipViewer.tsx` |
| Verdict | **`WORKS`** | **`DEAD`** |

**The trace that settles it** — `myPayslips` ([`PayrollController.php:571-601`](backend/app/Http/Controllers/Api/PayrollController.php#L571-L601)) reads `PayrollItem`, not `Payslip`. Every figure an
employee sees — `tds`, `pf_employee`, `net_pay`, `lOP_days` — comes from the run. The placeholder
engine never touches it.

**Why the other path is dead, established four ways:**

1. `PayslipController::generate` builds `Payslip` rows *entirely* from
   `calculateSalary()` ([`PayslipController.php:99-115`](backend/app/Http/Controllers/Api/PayslipController.php#L99-L115)) and never reads `payroll_items`.
2. `generatePayslips` in `frontend/src/services/api.ts` has **no UI caller** anywhere.
3. `PayslipViewer.tsx` — the only component that reads that table — is **imported by nothing**.
4. The `payslips` table holds **0 rows**; `payroll_items` holds live data.

**This corrects an error made earlier in this session.** Rule 1 is exactly the trap I fell into: I
previously reported that "the payslip computes loan EMI as zero," having found the placeholders
without establishing which path serves employees. It does not. The employee-facing payslip is
correct on loans.

**It is still a finding, at `DEAD` severity, because the routes are live.** `POST /payroll/payslips/generate` is registered and admin-reachable. Any API client that calls it populates a
second payslip table with flat-5% tax, zero loan recovery, zero advance recovery and zero
penalties — numbers that will not match what was paid, in a table with `version` handling that
implies authority. The gun is loaded and pointed; only the UI declines to pull the trigger.

---

## 3. §1 re-verification — all fifteen

### Confirmed broken — six of six STILL BROKEN

| # | Verdict | Evidence |
|---|---|---|
| **B1** | `STILL BROKEN` | [`BillingController.php:741-756`](backend/app/Http/Controllers/Api/BillingController.php#L741-L756). `catch (\Exception $e)` logs, then calls `$this->activateSubscription($organization)` and returns `'Payment verified successfully.'` with `'payment_id' => 'mock_payment_' . time()`. Comment verbatim: *"Fall back to mock payment success on error."* An unconfigured gateway grants a paid plan. |
| **B2** | `STILL BROKEN` | Route at [`billing.php:23`](backend/routes/api/protected/billing.php#L23) inside `role:admin` — **no `environment()` guard**. `mockPay` ([`BillingController.php:36-62`](backend/app/Http/Controllers/Api/BillingController.php#L36-L62)) has no environment check either; it calls `$this->cycles->markRenewed()` and returns active. Any admin, in production, activates a paid subscription. |
| **B3** | `STILL BROKEN — and worse than described` | See §4 below. This is the highest-value finding in the audit. |
| **B4** | `STILL BROKEN` | [`compoff.php`](backend/routes/api/protected/compoff.php) is three `GET` routes and nothing else. `grep -rn "CompOff" app/ database/` excluding the controller, the models and `EmployeeHistoryProbe` returns **nothing**. No `create`, `insert`, `updateOrCreate` or `increment` against either table exists anywhere. |
| **B5** | `STILL BROKEN` | [`AiChatService.php:204`](backend/app/Services/AiChatService.php#L204): `Http::withoutVerifying()->withToken($apiKey)`. Unconditional — no `app()->isLocal()`, no platform check. TLS verification is disabled on the request that carries the credential. |
| **B6** | `STILL BROKEN — both halves` | [`EnhancedPayrollController.php:953-957`](backend/app/Http/Controllers/Api/EnhancedPayrollController.php#L953-L957). `$annualGross` is cast `(float)`, then compared `=== 0`. Verified in PHP: `(float)0 === 0` is **`false`**. The branch is unreachable, so tax advice is computed from `0`. And the branch references `\App\Models\Employee`, which **does not exist** — so were it reachable it would fatal. |

### Confirmed partial — nine of nine STILL PRESENT

| # | Verdict | Evidence |
|---|---|---|
| `P1` | `STILL BROKEN` | `review_status` appears only as a fillable and one write of `'pending'` ([`MyEmployeeRecordController.php:382`](backend/app/Http/Controllers/Api/MyEmployeeRecordController.php#L382)). No reader, no route sets it. Dead column. |
| `P2` | `STILL BROKEN` | `expiry_date` appears only in `$fillable`/`$casts` on `EmployeeGovernmentId` and `CompOffBalance`. Nothing reads it; nothing warns. |
| `P3` | `STILL BROKEN` | `// TODO: Implement actual notification logic` at [`ResignationController.php:410`](backend/app/Http/Controllers/Api/ResignationController.php#L410) and `:427`. |
| `P4` | `STILL PRESENT` | `'Manual override tracking is not yet enabled'` hardcoded at [`PayrollDepartmentController.php:2660`](backend/app/Http/Controllers/Api/PayrollDepartmentController.php#L2660) while the override module is live. |
| `P5` | `STILL PRESENT` | `'order_id' => 'mock_order_' . time()` at `BillingController.php:620`, `:658`, `:674` — three sites, no environment guard. |
| `P6` | `STILL PRESENT` | `'tan' => null, // TODO` at [`PayrollController.php:452`](backend/app/Http/Controllers/Api/PayrollController.php#L452); `'download_url' => null, // TODO` at `:462`. |
| `P7` | `STILL BROKEN` | Validation accepts `in:component,statutory,adhoc,lop,hold` ([`PayrollOverrideController.php:163`](backend/app/Http/Controllers/Api/PayrollOverrideController.php#L163)). Every downstream branch tests only `=== 'component'` or `=== 'statutory'`. `adhoc`, `lop` and `hold` are accepted and then silently do nothing. |
| `P8` | `UNVERIFIED` | I did not locate the swallowing catch in `PayrollCalculatorService`. Not disproved — not checked properly. |
| `P9` | `STILL PRESENT` | No `interest` field on `EmployeeLoan` or its migration. Loans are principal-and-EMI only. |

---

## 4. B3 in full — the most expensive defect found

**`BROKEN`. Every bulk payroll run docks fully-present employees.**

The chain, in three files:

1. [`ProcessPayrollRunEmployees.php:142-151`](backend/app/Jobs/ProcessPayrollRunEmployees.php#L142-L151) builds a sub-request per employee with `'working_days' => 26`, **unconditionally**. The comment above it reads:
   > *"working_days is re-derived from attendance inside processEmployeePayroll when not overridden, so 26 is a safe placeholder rather than a figure anyone is paid against."*

   **The comment is false, and it is why this survived.** Passing the key *is* the override —
   `$request->filled('working_days')` is true for `26`.

2. [`PayrollDepartmentController.php:1053`](backend/app/Http/Controllers/Api/PayrollDepartmentController.php#L1053): `$workingDays = $request->filled('working_days') ? 26 : summary`. Takes 26.

3. `:1066-1070`: `days_present` was **not** passed, so it comes from the summary. The LOP branch
   `elseif ($request->filled('working_days') || $request->filled('days_present'))` therefore fires
   and computes `LOP = max(0, 26 − present_days)`.

**Two independent errors compound here.** `present_days` is defined in
[`AttendanceService.php:1570-1590`](backend/app/Services/Attendance/AttendanceService.php#L1570-L1590) as
`total_payable_days = present_days + paid_leave_days + half_day_present` — so `present_days`
**excludes paid leave and half days by design**. Subtracting it from a working-day count therefore
charges approved paid leave as loss of pay as well.

**Failing input:** a 22-working-day month; employee present all 22 days.
**Wrong output:** `lOP_days = 4`. Four days of gross deducted.
**Correct output:** `lOP_days = 0` — the summary's own `total_lop_days`.
**Worse input:** 22 working days, 18 present, 4 approved paid leave → `lOP_days = 8`. Double-charged.

This is not the operator-triggered edge case I described earlier today. **The queued bulk job — the
primary path — always sets it.**

---

## 5. Part C — the chain

### C2 · The sync boundary — `WORKS-LIMITED`, and the limitation is the whole problem

`POST /payroll/runs/{runId}/sync-attendance` → [`PayrollAutoProcessController::syncAttendanceForRun`](backend/app/Http/Controllers/PayrollAutoProcessController.php#L251-L300).

| Question | Answer |
|---|---|
| Idempotent? | **Yes.** It overwrites every attendance column from the summary; running twice is identical. |
| Respects the period lock? | **Yes, cleanly.** `PayrollPeriodGuard::closedRunFor` → `422` with the month and status named. No silent failure. |
| Attendance changes after sync, before lock? | **The figure goes stale and nobody is told.** No dirty flag, no re-sync prompt, no warning at lock. |
| Employee with no attendance? | **Not skipped** — `attendance_source: 'no_records'`, `present_days: 0`, full LOP. |
| All four capture paths? | Whatever reaches `attendance_records` is included; the sync reads only the summary. |

**The finding is in its own docblock**, lines 256-261:
> *"This rewrites the attendance columns on every item but never recomputes the money, so running
> it against a locked or disbursed run left the days on the payslip contradicting the amount that
> was actually paid."*

The guard added for *locked* runs does not address the same contradiction on an **open** run. Sync
an open run after B3 has already written a wrong `lOP_days`, and the days column is corrected while
`net_pay` keeps the deduction computed from 26. **The payslip then shows 22 working days, 0 LOP,
and a net pay that is four days short.** Both numbers are on the same row. Nothing reconciles them.

### C1 · One employee, traced end to end — **the chain does not hold**

Traced `payroll_items.id = 3001`, the real row in this database. Run `2001`, month **2026-08**,
status `draft`, user **343**.

**What payroll recorded, and what attendance actually holds:**

| | working days | present | LOP | worked seconds | net pay |
|---|---|---|---|---|---|
| `payroll_items` #3001 | **26** | **26** | **0** | 0 | **₹37,500** |
| `AttendanceService::monthlyAttendanceSummary(343, '2026-08')` | **21** | **0** | **21** | — | — |

The employee has **zero** `time_entries`, **zero** `attendance_records` and **zero** `activities`
for August. The summary returns `attendance_source: 'no_records'` — it explicitly reports that it
knows nothing — and payroll paid a full month anyway.

**`working_days = 26` is fictional.** August 2026 has 21 working days. The 26 is an input default,
not a derived figure.

**The first place the figure silently changes** is therefore the *entry* to payroll, not any later
transformation: `days_present` and `total_working_days` arrive as literals and are never reconciled
against the ledger. Nothing downstream re-derives them, and nothing compares them. The
`attendance_source: 'no_records'` signal exists and is discarded.

**Which path wrote it.** `days_present = 26` means the value was supplied — the bulk job sends only
`working_days`, which would have produced `LOP = 26 − 0 = 26`. It came from the wizard, whose state
initialises to `useState('26')` for both fields
([`EmployeePayrollWizard.tsx:198-200`](frontend/src/components/payroll/EmployeePayrollWizard.tsx#L198-L200))
and whose draft restore takes `working_days ?? 26` / `days_present ?? 0` in preference to the
server summary (`:547-576`).

**This is B3's mirror image.** B3 shows the hardcoded 26 *docking* a present employee. This shows
the same literal *paying* an absent one. Both are the same defect: payroll accepts attendance as an
argument rather than reading it.

### C4 · Consistency across the join

| Question | Finding | Verdict |
|---|---|---|
| **Two sources, one day** | `BiometricPunchProcessor` deliberately routes through `AttendanceService::checkIn/checkOut` rather than writing rows itself; `AttendanceService:233` uses `firstOrNew(['user_id','attendance_date'])`. One record per person per day, punches accumulate. **Merged, not last-write-wins.** The docblock explains why a second path would produce "subtly different attendance for the same person on the same day, and only one of them being right." | `WORKS` — deliberate |
| **Working days: which wins** | The **request** wins, unconditionally, on every path that supplies it. See B3 and C1. | `BROKEN` |
| **Units** | `PayrollItem::getWorkedHoursAttribute()` is `round($seconds / 3600, 2)` — an accessor for display. It does not feed money. | `WORKS` |
| **Timezones at a month boundary** | Not tested. | `UNVERIFIED` |

### C3 · Do the attendance-side calculations reach pay?

**Comp-off: confirmed, not refuted. The entitlement is discarded.**

[`OvertimeAssessment.php:150-166`](backend/app/Services/Attendance/OvertimeAssessment.php#L150-L166):

```php
payableMinutes()  => treatment === TREATMENT_PAY       ? countedMinutes() : 0;
compOffMinutes()  => treatment === TREATMENT_COMP_OFF  ? countedMinutes() : 0;
```

Choosing comp-off treatment on a weekly off or holiday sets `payableMinutes()` to **0**, so no money
is paid. `compOffMinutes()` returns the real figure — and `grep -rn "compOffMinutes\|comp_off_minutes" app/` outside that one file returns **nothing**. Its only consumer is
`toArray()` at `:219`, a display key. With no writer for `comp_off_balances` (B4), the minutes are
credited nowhere.

**An employee who works a public holiday under a comp-off policy is paid nothing and credited
nothing.** The policy option that looks like generosity is the one that pays least.

Overtime (pay treatment), penalisation and shift allowance were **not traced to the payslip**. See
coverage.

---

## 6. Part B — spot findings

**B6 · The filing contradiction is resolved.** `FilingGeneratorRegistry::GENERATORS` has exactly
**23** keys, counted by reflection. `CLAUDE.md`'s "nineteen" is **stale documentation**.

The "seven reference-only" claim is also wrong, in a more interesting way: `reference_only` is
assigned in `PayrollFilingService` both **dynamically** — `$filingReady ? 'ready' : 'reference_only'`
(`:356`), `empty($validationErrors) ? 'ready' : 'reference_only'` (`:662`) — and **hardcoded** at
`:972`, `:1100`, `:1222` and others. **There is no fixed reference-only set.** The same generator can
be `ready` for one organisation and `reference_only` for another depending on whether its PAN/TAN
validates. Any document stating a count is describing one tenant's data, not the product.

---

### B5 · Does each attendance-side calculation reach the payslip? — **four do not**

Comp-off was not the exception. Applying the same two-hop test — find the producer, then find any
consumer that is a payroll service or controller — to the other three engines:

| Engine | Referenced by | Reaches payroll? |
|---|---|---|
| `OvertimeEngine` | `DayOutcomeService`, `OvertimeRegisterService`, `StatutoryComplianceService` | **No** |
| `PenalisationEngine` | `DayOutcomeService` only | **No** |
| `ShiftAllowanceEngine` | `MyWorkingTimePolicyController`, `ShiftAllowancePolicyController` — the two screens where the policy is *configured* | **No** |
| `OvertimeAssessment::compOffMinutes` | its own `toArray()` | **No** (B4/C3) |

**The second hop closes it.** `DayOutcomeService` — the only route the first two could take — is
consumed by `AttendanceDayOutcomeController` (a display endpoint) and `WorkedTimeService`
(reports). It appears in `AttendanceService` **only inside a comment at line 304**; it is never
called there. So nothing in that chain reaches `calculateSimplifiedAttendance`, which is the one
method payroll reads.

**Payroll's own overtime path is dead too, and this is the sharper finding.**
`processEmployeePayroll` derives overtime as
`round(($attendance['overtime_seconds'] ?? 0) / 3600, 2)`, and `autoSyncAttendance` /
`syncAttendanceForRun` write `'overtime_seconds' => (int) ($summary['overtime_seconds'] ?? 0)` and
`'total_worked_seconds' => (int) ($summary['total_worked_seconds'] ?? 0)`.

**Neither key exists.** Executed against user 343 for 2026-08, the summary returns exactly:

```
month_year, days_in_month, working_days, holidays, weekend_days, present_days,
paid_leave_days, unpaid_leave_days, half_day_present, half_day_absent, absent_days,
total_payable_days, total_lop_days, legacy_present_days, legacy_lop_days,
late_count, attendance_source, calculation_mode
```

No `overtime_seconds`. No `total_worked_seconds`. Every consumer coalesces `?? 0`, so both columns
are **always zero on every payroll item** — which is exactly what row #3001 holds, and why the
`worked_hours` accessor on a payslip can only ever render `0.00`.

**A docblock states otherwise.** Immediately above `calculateSimplifiedAttendance`
([`AttendanceService.php:1436-1437`](backend/app/Services/Attendance/AttendanceService.php#L1436-L1437))
the documented return shape lists:

```
'overtime_seconds'     => int (worked - target, only on present days),
'total_worked_seconds' => int,
```

The method returns neither. This is rule 3 exactly: the comment is why nobody noticed, and the
`?? 0` at every call site turned a missing key into a silent zero instead of an error.

**Consequence.** Overtime reaches a payslip **only if a human types `overtime_hours` into the
wizard by hand**. The overtime the tracker measured, the penalty the attendance policy assessed,
the shift allowance the policy priced, and the comp-off the employee earned all compute correctly
and are paid to nobody. Four of the twelve items in B5's list are the same defect.

### B2 · Overrides — tested hardest, and it holds

The strongest module in the codebase, and the audit did not dent it.

| Claim | Finding | Verdict |
|---|---|---|
| Nobody approves their own pay | `created_by === auth()->id()` guarded at four sites (`PayrollOverrideController.php:390, 394, 477, 1197`), with an explicit `$soleAdmin` exception so a one-admin org is not locked out. | `WORKS` |
| `value` and `computed_value` both retained | Both on the model, `computed_value` cast `decimal:2`, nullable while unknown (`PayrollOverride.php:44, 65, 123-129`). | `WORKS` |
| Append-only audit | `OverrideAuditTrail` exposes `created`, `approved`, `rejected`, `cancelled`, `applied`, `snapshot`, and a private `record()`. **No `update`, no `delete`.** | `WORKS` |
| Refusal at entry with the maximum named; impact preview matching what the engine applies; CSV round trip reporting zero changes; structure changing under an approved override | Not executed. | `UNVERIFIED` |

**P7 remains the one hole in it** — validation accepts `adhoc`, `lop` and `hold`, and no branch
handles them.

### B4 · Run lifecycle

Actor stamping confirmed: `locked_by`, `approved_by`, `released_by` all written from `auth()->id()`
(`PayrollDepartmentController.php:2802, 2814, 3197, 3203, 3371`). Maker-checker on approve and
release verified earlier; `processAndPay` correctly stops at `locked` and returns
`awaiting_second_approver` rather than self-approving. Freeze behaviour, concurrency refusal and
partial-run recording remain `UNVERIFIED`.

## 7. Part A — verified rows only

| Time Doctor | CareVance | Verdict |
|---|---|---|
| "Time out after", default **15 min**, range **3 min – 6 h**, per user and company | Default **900 s = 15 min** — same. Resolves user → org → config (`TrackerPolicyResolver`). Range is **300 s – 3600 s** (`MIN_IDLE_AUTO_STOP_SECONDS`, `MAX_IDLE_SECONDS`). | `WORKS-LIMITED` — same default, **narrower range**: floor 5 min vs 3 min, ceiling 1 h vs 6 h. |
| **60-second countdown** before timeout | `emitIdleStopWarning` fires **every second** with `secondsRemaining`, and once with `null` on return (`useDesktopTracker.ts:1891`). | `WORKS` |
| **No server-side sweep** — a dead app leaves a running timer | `timers:close-idle` scheduled `everyMinute`, `timers:close-stale` `everyFifteenMinutes` (`routes/console.php:295-315`). | **Ahead of benchmark** — with the caveat that `close-stale` closed *working* timers until fixed earlier today. |
| Idle threshold config scope | Per-user override, then per-organisation, then config. TD is per-user and company-wide. | `WORKS` |

### A2 · Screenshots

| Time Doctor | CareVance | Verdict |
|---|---|---|
| Capture **random within the interval**, never fixed | **Fixed grid.** `nextCaptureDelayMs` returns `anchorMs + nextSlot * intervalMs` (`useDesktopTracker.ts:184-200`). No jitter, no `Math.random` anywhere in the capture path. | `WORKS-LIMITED` — **behind the benchmark.** A predictable schedule can be timed and gamed; randomisation is the whole point of the feature. |
| Deleting a screenshot does **not** adjust tracked time | `ScreenshotController::destroy` calls `deductFromTimeEntry($screenshot)` **before** removing the row, with the comment *"The time goes with the image."* | **Ahead of benchmark** |
| Retention undisclosed | `screenshots:purge` scheduled in `routes/console.php:356`; retention days resolved per organisation by `TrackerPolicyResolver`. | `WORKS` |
| Multi-monitor, blur, who may delete, link forwardability | Not checked. | `UNVERIFIED` |

Everything else in Part A (A3–A6) is **UNVERIFIED**.

---

## 8. New findings not in §1, ranked by money at risk

1. **B3 + C2 together** (§4, §5). Bulk runs dock present employees; sync then corrects the *days* and
   not the *money*, so the payslip contradicts itself and reads as correct. Highest money at risk.
2. **Four attendance computations reach no payslip** (§5.B5). Overtime, penalisation, shift
   allowance and comp-off all compute correctly and are paid to nobody. `overtime_seconds` and
   `total_worked_seconds` are structurally always zero on every payroll item, because the summary
   does not return those keys and every consumer coalesces `?? 0`. Overtime reaches pay only if
   someone types it in by hand.
3. **`PayslipController` is a live route onto a dead engine** (§2). Not currently reachable from the
   UI; one API call away from producing a contradictory second payslip table.
4. **`DATE-01`** — *fixed earlier today, before this audit.* `Carbon::createFromFormat('Y-m', …)`
   inherited today's day-of-month across 17 call sites, so on the 29th–31st every one resolved to
   the **following month**. `PayrollDayBasisResolver` priced a LOP day at 1/31 in a 30-day month.
   Payroll is run at month end. It caused 12 of the 13 backend failures. Recorded here because it
   was **live in production** and the damage is historical: any run computed on those three days
   used the wrong divisor.
5. **`CLAUDE.md` is stale in at least two places** — "nineteen generators" (really 23) and "2496
   passed, 0 failed" (really 13 failing before today). The file's own gap-list warns that stale
   documentation costs marks in customer evaluations.

---

## 9. Coverage statement

**This report is two passes.** The first covered §1, the structural finding and C2/C3. The second
(below the line in each section) added C1 with real data, C4, B2, B4 and A2. What follows is the
state after both.

**Read and traced:** the two payroll engines and both payslip surfaces; `myPayslips`;
`PayslipController::generate`; the frontend callers of both; `ProcessPayrollRunEmployees`;
`processEmployeePayroll`'s attendance and LOP branches; `AttendanceService`'s summary shape;
`syncAttendanceForRun`; `OvertimeAssessment`; the comp-off surface end to end; all six B-findings
and eight of nine P-findings at their cited lines; `FilingGeneratorRegistry` by reflection;
`TrackerPolicyResolver` bounds; the idle-warning emitter; `routes/console.php`.

**Not checked — `UNVERIFIED`, and I am not implying these are sound:**

- **Part A: A3–A6 entirely.** URL detail levels and credential redaction, retroactive
  reclassification, attendance statuses and grace, overnight shifts, break types, the leave
  ledger's idempotency, three of the four capture paths' writes to `attendance_records`, biometric
  replay behaviour, geofence degradation, the role model, webhooks, edit windows. Within A2:
  multi-monitor, blur, deletion permissions and link forwardability.
- **Part B: B1, B3, B5 entirely; B2 and B4 in part.** Pay groups and salary structures; every
  statutory figure against its Act and the period-keyed slab test; the override module's entry
  refusal, impact-preview fidelity, CSV round trip and structure-change boundary; the run's freeze
  behaviour, concurrency refusal and partial-run recording. **B5 is now four of twelve done** —
  overtime, penalisation, shift allowance and comp-off all verified as reaching nothing. The eight
  untested are: LOP and pro-rating, arrears, reimbursements, loan instalments, FBP, variable pay,
  leave encashment and perquisites.
- **Part C: C5 entirely.** None of the six break-the-chain scenarios were executed. Within C4,
  timezone behaviour at a month boundary is untested.
- **P8** — I looked for the swallowed formula exception and did not find it. Unconfirmed either way.

**What would change these verdicts:** C5 needs the six scenarios run against seeded data; B5's
remaining ten need one employee with each component attached, processed, and the payslip read back;
B3's statutory figures need a fixture per Act provision. All three are execution against data this
database does not yet hold — it has one payroll run and two items.
