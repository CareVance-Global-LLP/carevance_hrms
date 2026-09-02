# Master Verification Prompt — Tracker, Payroll, and the Chain Between Them

**For:** Claude Opus 5, working in the CareVance repo at `D:\Caretime`.
**Task:** prove whether the tracker works, whether payroll works, and — the part that matters most —
whether the two are genuinely one system or two systems with a hopeful join in the middle.
**Benchmarks:** **Time Doctor** for the tracker, **Keka** for payroll.
**Output:** a verdict per capability, backed by evidence. Not an opinion.

---

## 0. Rules of evidence — read these twice

This audit exists because a previous pass got things wrong in a specific, avoidable way. Do not
repeat it.

1. **One code path is not the product.** A previous audit reported "overtime is paid at double the
   hourly rate" because `SalaryCalculationService` hardcodes `2x`. That is true of that file and
   false of the product — `OvertimePolicy` and `OvertimePolicyScope` hold configurable rates per day
   type. **Before stating how anything behaves, find every path that computes it and say which one
   actually runs.** If two disagree, that is a finding, not a detail.
2. **Existing is not working.** A service class, a database column and a route are three different
   claims. For every capability, establish: does the code exist, is it reachable from a route or a
   screen, does anything call it, and does its result reach the user. `comp_off_balances` has a
   model, a controller and three routes — and no writer anywhere. It reads as built and is not.
3. **A comment is not evidence.** `ProcessPayrollRunEmployees` carries a comment stating that
   passing `working_days => 26` is safe because the value is re-derived when not overridden. Passing
   it *is* the override. The comment is why the bug survived. **Read what the code does, then read
   the comment, and report any disagreement between them as a finding.**
4. **Trace, do not sample.** Follow one employee's data end to end through real code — from a
   captured minute to a figure on a payslip — naming every file it passes through. A capability you
   have only read about is unverified.
5. **Say what you did not check.** An honest gap in coverage is useful. A confident summary of code
   you skimmed is not.
6. **No feature is confirmed by a name.** `MultiPayGroupService` exists and references models that do
   not. Nine such services are dead. Check the call sites.

**Verdict vocabulary — use exactly these:**

| Verdict | Meaning |
|---|---|
| `WORKS` | Traced end to end. Reachable, called, result reaches the user. |
| `WORKS-LIMITED` | Works, but narrower than the benchmark. State the limit precisely. |
| `BROKEN` | Reachable but produces a wrong or absent result. Give the failing input. |
| `DEAD` | Code exists, nothing calls it, or it references things that do not exist. |
| `ABSENT` | Not built at all. |
| `UNVERIFIED` | You could not establish it. Say why. |

---

## 1. Start here — re-verify these fifteen findings

An audit on **27 August 2026** confirmed the following by reading the files directly. Your first job
is to establish whether each is **still true today**, since the tree moves daily. Report each as
`STILL BROKEN`, `FIXED`, or `CHANGED — describe`.

### Confirmed broken

| # | Finding | Where |
|---|---|---|
| B1 | Razorpay verification catches **every** exception, calls `activateSubscription()`, returns "Payment verified successfully." Comment reads *"Fall back to mock payment success on error."* An unconfigured gateway grants a paid plan. | `BillingController.php:740-756` |
| B2 | `POST /billing/mock-pay` registered in **every** environment with no `environment()` guard; activates a paid subscription. | `routes/api/protected/billing.php:23`, `BillingController.php:36-62` |
| B3 | Bulk payroll job passes `working_days => 26`; controller then computes LOP as `26 - days_present`. **A fully-present employee in a 22-working-day month is docked 4 days.** | `Jobs/ProcessPayrollRunEmployees.php:140-151`, `PayrollDepartmentController.php:1053,1067` |
| B4 | **Comp-off has no writer.** Three read routes; nothing anywhere writes `comp_off_balances` or `comp_off_transactions`. `OvertimeAssessment::compOffMinutes()` computes a figure only consumed by `toArray()`. | `CompOffController.php`, `OvertimeAssessment.php:161-166` |
| B5 | `Http::withoutVerifying()` unconditionally, on the request carrying the API key. Two other TLS-disabling sites are correctly gated to local Windows; this one is not. | `AiChatService.php:204` |
| B6 | `$annualGross === 0` compares float to int, so the fallback is unreachable and tax advice is computed from zero. The dead branch references a non-existent model. | `EnhancedPayrollController.php:953-957` |

### Confirmed partial

`P1` `employee_documents.review_status` — eight writers, **zero readers**, no route updates it ·
`P2` `expiry_date` on documents and government IDs — stored, cast, **never read**; nothing warns ·
`P3` Resignation notifications are `TODO`, they only `Log::info` — called from all four live routes ·
`P4` Pre-payroll checklist's override step hardcoded to *"not yet enabled"* while the override module works ·
`P5` `createRazorpayOrder` returns fabricated `mock_order_*` with `success: true` in any environment ·
`P6` One payslip endpoint returns `'tan' => null` and `'download_url' => null`, both marked TODO ·
`P7` Override validation accepts `adhoc|lop|hold`, only `component|statutory` are writable ·
`P8` A salary formula that throws during a run is silently dropped, warning-logged only, run continues ·
`P9` Loans carry no interest rate field anywhere.

### The structural finding — verify this first, it changes everything downstream

**There appear to be two payroll calculation engines that disagree about money.**

| | `PayrollCalculatorService` path | `SalaryCalculationService` path |
|---|---|---|
| Income tax | Full slabs, both regimes, surcharge, cess, 87A, cumulative | Flat 5% above ₹2.5L |
| Loan recovery | Ledger-backed, once per month | `return 0; // Placeholder` |
| Advance recovery | Handled | `return 0; // Placeholder` |
| Late penalty | Penalisation engine | `return 0; // Placeholder` |
| Overtime | Policy-driven per day type | Hardcoded 2× on basic, 208 divisor |

**Establish precisely: which path produces the payslip a real employee receives?** Trace
`PayslipController` and `PayrollAutoProcessService` and report which engine each uses, for which
operation. If both can produce a payslip for the same employee and month, **that is the single most
important finding in this audit** and everything else is secondary to it.

---

## 2. Part A — the tracker, against Time Doctor

Time Doctor's published behaviour, verified from its documentation. For each row: what does CareVance
do, and is it `WORKS` / `WORKS-LIMITED` / `BROKEN` / `ABSENT` against it?

### A1 · Idle detection — the most checkable numbers in the category

| Time Doctor | Check in CareVance |
|---|---|
| Setting called **"Time out after"**, default **15 minutes**, configurable **3 min – 6 hours**, per user and company-wide | What is the threshold, is it configurable, at what scope? Find the constant and the settings screen. |
| **60-second on-screen countdown** before the timeout fires | Does the desktop app warn before stopping? |
| **"Were you working?"** prompt afterwards, converting the gap to manual time — shown only if the user's *Can edit time* permission allows | CareVance has a three-way idle resolution policy (always count / never count / ask). Trace whether the "ask" path actually reaches the user, who may answer, and what is written. Confirm the claim that **only the person it belongs to** may resolve it. |
| A minute is idle only with **zero** keyboard/mouse activity across the **full 60 seconds**; partial minutes are never counted idle | What is CareVance's unit of idleness? Does it rewind to last activity, and is the tail stored separately? Find `IdleResolutionService` and `trailing_idle_seconds`. |
| Two separate metrics — **idle minutes %** and **idle seconds %** | Does CareVance expose one figure or two? |
| **Not a keylogger** — counts keystrokes, never records which keys | Verify CareVance records no key content. **If it does, that is a finding, not a feature.** |
| Known blind spot: joysticks, drawing tablets not detected → false idle | Does CareVance share it? |
| **Activity Level** benchmarked against all TD users for the same app, 5 tiers, recalculated monthly | CareVance has a productivity score. Is it absolute or relative? State the formula. |
| A server-side sweep is **absent** in TD — a dead app leaves a running timer | CareVance claims a per-minute server sweep. **Verify it exists in `routes/console.php`, is scheduled, and actually closes timers.** If real, this beats the benchmark. |

### A2 · Screenshots

TD: random within the interval (never fixed), all monitors, blur on all plans but **irreversible and
not applied to video**, deletion by users only when *Can edit time* is on, **no webcam**, retention
undisclosed, and a known defect returning **black screens on RDP sessions**.

Verify for CareVance: interval and whether capture is randomised or fixed; multi-monitor; blur;
who may delete; **whether deleting a screenshot deducts the tracked time it covered** (a documented
CareVance behaviour TD does not have — confirm it); the retention purge, that it is scheduled and
that it runs; and whether screenshot links are single-use or forwardable.

### A3 · App and URL capture

TD has **four detail levels** — Off / Basic (root domain only) / Extended (full URLs and window
titles) / Custom — set by Owners and Admins, **company-wide only**, applying to future data only.
Productivity ratings are **Productive / Unproductive / Neutral / Unrated** across a **four-level
scope hierarchy** (Global → Company → Group → Individual, lowest wins), applied **retroactively**.

Verify: does CareVance have a detail level at all, or is capture all-or-nothing? Can privacy be
scoped below the company? Confirm the claimed **credential redaction** — that query strings are
stripped **at display time** rather than at capture, which would also protect records taken before
the rule existed. Confirm reclassification is retroactive. State the scope levels CareVance supports
and how conflicts resolve.

### A4 · Attendance and schedules

TD: **6 statuses** (Present, Late, Absent, Partially Absent, On Leave, Shift Underway), a **5-minute
grace period**, shifts as `0900-1700-7:15` with multiple per day and overnight support, CSV bulk
load with DST handling, breaks **paid or unpaid** from **10 minutes to 4 hours** with **no daily
cap** — and breaks **unavailable on the silent app**.

**TD has no leave balances, accruals or policies at all** — only individual leave instances.

Verify CareVance's statuses, grace handling, overnight shifts, timezone resolution, break types, and
the leave ledger. Leave accrual is a place CareVance should clearly exceed the benchmark: confirm it,
including that a balance is a **sum over dated rows** rather than a stored counter, and that accrual
is idempotent under re-runs.

### A5 · The four capture paths

CareVance claims four ways in — desktop tracker, browser extension, biometric terminal (ADMS), and
geofenced mobile punch. **TD's mobile app tracks nothing about the phone**, and its Chrome extension
**cannot work without the desktop app**.

For each of CareVance's four: does it reach `attendance_records`? Trace it. For biometric,
confirm device registration is enforced, punch uniqueness makes a replay a no-op, and unclaimed
punches are retained and attach on claim. For mobile, confirm geofence enforcement and that a
missing location consent **degrades to a punch without location rather than blocking attendance**.

### A6 · Platform, roles and API

TD gates its **entire API behind the top tier**, has **no outbound webhooks at any price**, and
**cannot edit a time entry older than two months**. Its roles are Owner / Admin / Manager / Regular /
Client, with manager scoping by group only.

Verify CareVance's API availability, webhook delivery records, any edit window on time entries, and
the role model — specifically the claim that a manager must be **both senior to** and **share a
department with** someone to act on them, and that a manager with no department manages nobody.

---

## 3. Part B — payroll, against Keka

Keka is the Indian payroll benchmark. Verify CareVance against how Keka actually behaves.

### B1 · Salary structures and pay groups

Keka supports **multiple pay groups and multiple salary structures** per organisation — only the
legal entity is singular. Components are gated per pay group, and overrides are entered on an
**annual grid** with an **Import Component Overrides** action.

Verify: multiple pay groups; multiple structures; per-group statutory switches and whether they
**propagate to assigned employees**; per-group state registration details (PT establishment, LWF, PF,
ESI); that a person belongs to exactly one group at a time and moving them **closes the prior
membership with an end date** rather than overwriting; and the unassigned-employee report.

### B2 · Overrides — CareVance's strongest module, so test it hardest

Keka applies overrides **at process time only** — *"Perform Process Payroll to update the override
information in the system."* Keka carries **three different lifetimes** for the same concept.
Keka's PF proration falls back to **"the next available taxable component"**.

Verify in CareVance: refusal at entry with the maximum named; the impact preview and its
amplification figure; **that the figure shown matches what the engine later applies**; maker-checker
including that nobody approves their own pay; the single date-ranged lifetime; that `value` and
`computed_value` are both retained; the cascade snapshot; the append-only audit; and the CSV
round trip — specifically that **exporting and re-importing unchanged reports zero changes**.

Then test the boundary: what happens if the structure changes underneath an approved override before
it is applied?

### B3 · Statutory

Verify each figure against the Act, not against the code's own comments:

PF ₹15,000 ceiling, 12% + 12%, employer split EPS 8.33% / EPF 3.67%, above-ceiling option, VPF ·
ESI ₹21,000 threshold, 0.75% / 3.25%, **and the half-year contribution-period lock-in** ·
professional tax across **37 states and UTs, 20 levying and 17 returning zero**, month-aware
including Maharashtra's February band · TDS both regimes, FY-keyed slabs, surcharge, 4% cess, 87A
with marginal relief, **computed cumulatively** · gratuity 4.81% provision with the five-year floor
and ₹20,00,000 ceiling · LWF per state cycle · HRA least-of-three.

**Then the test that matters:** slabs are claimed to be stored **by period**. Recompute a closed
month and confirm it applies **that month's** rates, not today's.

### B4 · The payroll run

Verify the lifecycle `draft → locked → approved → released → disbursed`, each stamped with actor and
time; the concurrency refusal on a second process; maker-checker across lock / approve / release and
that it activates at three or more admins; the mandatory unlock reason; that a **disbursed month is
genuinely frozen** against re-processing, salary edits, arrear approval and employee reset; and the
**partial-run** behaviour, where locking with unprocessed employees is allowed and the reason
auto-recorded.

### B5 · Everything that reaches a payslip

For each of these, trace whether it actually reaches the payslip **through the engine that produces
the real payslip** (see §1's structural finding): loss of pay and pro-rating · overtime ·
shift allowance · penalisation · arrears · reimbursements · loan instalments · FBP ·
variable pay · leave encashment · perquisites · **comp-off**.

Any one of these that computes correctly but does not reach the payslip is the same class of defect
as comp-off. **Expect to find more than one.**

### B6 · Output

Bank file with named exclusions rather than silent drops · UTR captured · reversals · stop-payment
flags · payslip generation, distribution and versioning · **23 filing generators** with pre-filing
validation and per-entity generation · the accounting journal that must balance to the paisa and
refuses on an unmapped component · F&F with notice recovery, encashment and gratuity.

For filings, resolve a live contradiction: `CLAUDE.md` states **nineteen** generators with **seven**
reference-only; `FilingGeneratorRegistry` has **23** keys and `reference_only` is assigned
**dynamically from validation** rather than from a fixed list. **Establish the true count and the
true reference-only set.**

---

## 4. Part C — the connection. This is the point of the audit.

CareVance's entire positioning is that the evidence of work and the payslip are one system. Part C
tests whether that is true. **A failure here matters more than any single feature gap in A or B.**

### C1 · Trace one employee end to end

Pick one employee with real data. Follow a single tracked minute through every stage, naming each
file and function:

`tracker capture → activity classification → idle resolution → attendance record → shift and roster
resolution → day outcome → overtime and penalisation assessment → payroll run sync → component
calculation → statutory → net pay → payslip line → bank file row → accounting journal line`

State every place the figure is transformed, rounded or re-derived. **Report the first place it
could silently change without anyone noticing.**

### C2 · The sync boundary

`POST /payroll/runs/{runId}/sync-attendance` is the single join between the two halves.

- Is it idempotent? Run it twice on the same run and compare.
- What happens if attendance changes **after** the sync but **before** the run locks? Is the payroll
  figure stale, and is anyone told?
- Does it sync all four capture paths, or only some?
- What does it do with an employee who has no attendance at all — zero, absent, or skipped?
- Does it respect the period lock, and does it refuse cleanly or fail silently?

### C3 · Do the attendance-side calculations actually reach pay?

The attendance side computes overtime, penalisation and shift allowance through
`OvertimeEngine`, `PenalisationEngine` and `ShiftAllowanceEngine`. **Confirm each result reaches the
payslip, and through which engine.** Comp-off is the known case where a computed figure reaches
nothing — establish whether the other three do better.

Specifically for overtime: the policy allows a **comp-off treatment** on weekly offs and holidays.
Since comp-off has no writer, **choosing that treatment appears to discard the entitlement.**
Confirm or refute this.

### C4 · Consistency across the join

- **Timezones.** Attendance resolves in the employee's zone. Payroll works in months. Establish what
  happens to a night shift crossing midnight at a month boundary, and to an employee in a different
  zone from the organisation.
- **Working days.** Attendance derives them from the calendar and roster; payroll accepts an override
  (see B3). Confirm which wins, per code path.
- **The unit.** Attendance is in seconds or minutes; payroll in days and hours. Find every conversion
  and check the rounding direction is consistent.
- **Two sources, one day.** If a biometric punch and a tracker session both cover one day, what is
  the attendance record? Is one authoritative, are they merged, or does the last write win?

### C5 · What breaks the chain

For each, state the actual behaviour: the tracker is offline for three days and syncs late, after
payroll ran · a biometric device stops reporting mid-month · an employee joins on the 20th ·
an employee exits mid-month with pending regularisation · approved leave is cancelled after payroll
locked · a manager approves a regularisation for a closed month.

---

## 5. How to report

Produce `VERIFICATION_REPORT.md` with:

1. **The verdict, in three lines.** Does the tracker work? Does payroll work? Are they one system?
2. **The structural finding** from §1 — which engine pays people — with the trace behind it.
3. **§1 re-verification table** — each of B1–B6 and P1–P9 as STILL BROKEN / FIXED / CHANGED.
4. **Part A table** — each Time Doctor capability, CareVance's verdict, evidence, and where CareVance
   is genuinely ahead. Be fair in both directions: the server-side idle sweep, screenshot-linked time
   deduction, leave accrual, per-scope monitoring consent and the four capture paths all appear to
   beat the benchmark. Say so where true.
5. **Part B table** — same, against Keka.
6. **Part C** — the end-to-end trace as a numbered list of files, then every break found.
7. **New findings** not in §1, ranked by money at risk.
8. **Coverage statement** — what you read, what you did not, and what remains UNVERIFIED.

For every `BROKEN`: the file and line, the input that fails, the wrong output, and the correct one.
For every `WORKS`: the trace that proves it. A verdict with no evidence beside it is not a verdict.

---

## 6. Order of work

1. §1 structural finding — which engine pays people. Everything else depends on it.
2. §1 re-verification of the fifteen known items.
3. **Part C** — the chain. Do this before A and B: a break here outranks any feature gap.
4. Part B — payroll against Keka.
5. Part A — tracker against Time Doctor.
6. Write the report.

## 7. Do not

Do not fix anything — this is an audit, and a fix mid-audit invalidates the baseline. Do not report a
documented deliberate decision as a defect; this codebase writes long docblocks explaining its
choices and most of them are sound. Do not soften a finding because the surrounding code is good.
Do not report a number you have not seen in a file. And do not describe a capability as working
because a class exists that would implement it.
