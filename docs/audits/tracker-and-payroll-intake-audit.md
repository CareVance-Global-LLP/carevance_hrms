# Audit prompt — desktop tracker lifecycle, and what payroll actually reads

Paste everything below the line into a fresh session at the repo root. It is written
to be executed, not skimmed: every section names the files to open, the contract the
code is supposed to honour, and the evidence that decides whether it does.

---

## Mission

Audit two chains end to end and report what is **actually true**, with evidence:

1. **The desktop tracker lifecycle** — the app opening itself at boot, the timer
   starting itself, and every path that can stop a running timer without the person
   pressing Stop.
2. **Payroll intake** — whether attendance genuinely reaches a payroll run on every
   path that can produce one, whether loans and other recurring deductions are applied
   on every one of those paths, and what is actually required before a run can be
   processed.

You are auditing, not renovating. Produce a findings report. Do not change behaviour
unless a finding is (a) confirmed by a failing test you wrote, and (b) small enough to
fix without redesigning anything — and say clearly which findings you fixed and which
you only recorded.

## Rules of engagement

- **Evidence before assertion.** Every finding carries a file:line, a query result, a
  log line, or a test that fails. A finding you cannot evidence is a hypothesis — label
  it as one and say what evidence would settle it.
- **Read the contract before judging the code.** Each section below states what the
  behaviour is *supposed* to be, taken from the code's own comments, config docblocks
  and `CLAUDE.md`. "Broken" means it contradicts its own stated contract, not that you
  would have written it differently.
- **Trace, don't guess.** When a value is wrong, follow it backwards to where it is
  produced. Fix-at-symptom findings are worthless here.
- **Report clean sections as clean.** A section where nothing is wrong is a result. Do
  not manufacture findings to fill a table, and do not soften a real one.
- **Distinguish "unwired" from "broken".** Dead code that never runs is a different
  defect from live code that runs wrong. Say which.
- Both suites must stay green: `php artisan test` (backend, cwd `backend/`) and
  `npx vitest run` + `npx tsc --noEmit` (frontend, cwd `frontend/`). Gate on failing
  test **names** against `.github/baselines/`, never on counts.

---

# Part A — The desktop app opening itself

**Contract.** One auto-start mechanism, registered correctly, that launches the real
app rather than Electron's welcome window, and that a person can turn off.

Files: [`desktop/auto-start.cjs`](../../desktop/auto-start.cjs),
[`desktop/main.cjs`](../../desktop/main.cjs) (`app.whenReady`, `createWindow`,
`showMainWindow`), [`desktop/package.json`](../../desktop/package.json) (`build.files`,
`build.nsis`).

Answer each with evidence:

- **A1.** `setupStrongAutoStart()` is called unconditionally on every launch. Is there
  any path — setting, IPC handler, UI control — by which a user or admin can disable
  it? Trace `isAutoStartEnabled` and `disableAutoStart` to their call sites. If they
  have none, that is a finding: the exports read as a feature that does not exist.
- **A2.** If a user disables the entry in Task Manager → Startup, what happens on the
  next launch? Read what `setLoginItemSettings` writes versus what Windows'
  `StartupApproved` state means, then say whether the app silently re-enables itself.
- **A3.** The login item carries no "start hidden" argument and `createWindow` shows the
  window on renderer-ready (or a 5s timeout). Confirm there is no minimised/tray-only
  boot. Is that intentional anywhere in the code or docs?
- **A4.** Uninstall is `deleteAppDataOnUninstall: true` NSIS, per-user. Does anything
  remove the `HKCU\...\Run` entry on uninstall? If not, a removed app leaves a startup
  entry pointing at a deleted executable — verify and report.
- **A5.** `cleanupLegacyAutoStart()` spawns `schtasks.exe` and `reg.exe` **synchronously**
  on every launch. Measure the cost on this machine (time the call) and confirm it is
  after the window is created, not in front of it.
- **A6.** Unpackaged, `resolveLoginItemArgs()` returns the app directory raw. Verify the
  double-quoting bug documented in that file's header cannot recur — read the entry back
  out of the registry on this machine and `Test-Path` the argument.

# Part B — The timer starting itself

**Contract.** On a desktop shell, for a tracked-timer user, at or after office start
time, with nothing already running and no deliberate suppression in force, the timer
starts once.

Files: [`frontend/src/pages/DesktopTimerDashboard.tsx`](../../frontend/src/pages/DesktopTimerDashboard.tsx)
(the arming effect and the auto-start effect), [`frontend/src/lib/desktopTimerSession.ts`](../../frontend/src/lib/desktopTimerSession.ts),
[`frontend/src/contexts/AuthContext.tsx`](../../frontend/src/contexts/AuthContext.tsx)
(`storeAuthState`), [`frontend/src/lib/permissions.ts`](../../frontend/src/lib/permissions.ts)
(`isTrackedTimerUser`).

- **B1. The sticky global suppression.** `suppressAutoStartGlobally()` writes
  `desktop_timer_auto_start_suppressed_global:<userId>` to **localStorage**.
  `clearDesktopTimerSession()` sweeps every other key on logout but not that one — read
  its localStorage filter and confirm. Then establish: after one idle auto-stop, does
  auto-start ever fire again on that machine without a manual Start? Check every writer
  of that key and every clearer. Write a test asserting logout clears it, or asserting
  the current behaviour deliberately, and say which is right.
- **B2. The office-start-time gate never retries.** The effect returns early when the
  clock is before `settings.attendance.office_start_time`, and its dependency array
  contains nothing time-based. Confirm by listing the deps. Then answer: a machine
  booted at 08:00 with a 09:30 office start — what starts the timer at 09:30? If the
  answer is "nothing", that is a finding.
- **B3. Mount dependency.** Auto-start lives on the timer dashboard, which on desktop is
  `/dashboard` ([`App.tsx`](../../frontend/src/App.tsx)). If the app restores onto any
  other route, does anything arm or fire? Test it.
- **B4. Session survival.** [`frontend/src/lib/authStorage.ts`](../../frontend/src/lib/authStorage.ts)
  writes the token to `sessionStorage` only, while `getPreferredAuthStorage()` claims
  localStorage is primary on desktop, and `migrateStoredAuth()` copies one to the other
  at bootstrap. Electron clears sessionStorage when the window is destroyed. Determine
  empirically what actually keeps a desktop user signed in across a relaunch — the
  migration, the httpOnly `carevance_api_token` cookie, or the offline auth store — and
  whether a user who never reloads the page stays signed in. This decides whether
  auto-start can fire at all on boot.
- **B5. No calendar guard.** Auto-start calls `POST /time-entries/start`, whose only
  refusal is approved full-day leave (`ensureAttendanceCheckedIn`,
  [`TimeEntryController.php`](../../backend/app/Http/Controllers/Api/TimeEntryController.php)).
  It then creates an `AttendanceRecord` with `status = 'present'`, opens an
  `AttendancePunch` and computes `late_minutes`. Verify there is no weekly-off, holiday
  or rostered-rest-day check on this path — `WeeklyOffResolver`, `AttendanceHoliday` and
  `ShiftResolver` all exist; are any of them consulted? Report the attendance
  consequence of booting a laptop on a Sunday.
- **B6. Unallocated entries.** Auto-start deliberately omits `project_id` and `task_id`.
  Quantify: what share of `time_entries` have neither? Does anything downstream (reports,
  productivity, billing) treat a null project as a defect?

# Part C — Every path that stops a running timer

**Contract** (`CLAUDE.md`, "The scheduler…"): *every auto-stop path rewinds `end_time`
to the last real activity and records the idle tail in `trailing_idle_seconds`, so a
late stop never bills the idle.* Corollary the code relies on: if the server stops a
timer, the person is told.

Build a **complete inventory** of stop paths. For each, record: the trigger, the
threshold and where it is configured, the `stop_reason` written, whether
`auto_stopped_for_idle` is set, whether `end_time` rewinds to last activity, and
**whether the user is told**. Start from these and prove the list is exhaustive
(`grep -rn "end_time.*=>" backend/app | grep -i update`):

| Path | Where |
|---|---|
| Client idle auto-stop | [`useDesktopTracker.ts`](../../frontend/src/hooks/useDesktopTracker.ts) `attemptIdleAutoStop` |
| Client lock-screen auto-stop | same file, `LOCK_SCREEN_AUTO_STOP_THRESHOLD_SECONDS` |
| In-request server idle close | `TimeEntryController::closeIdleRunningEntry` |
| Daily boundary close | `TimeEntryController::closeStalePrimaryRunningEntries` |
| Cron idle sweep | `timers:close-idle` |
| Cron stale sweep | `timers:close-stale` |
| Payroll processing | `PayrollDepartmentController::closeStaleRunningTimers` |
| Break start | `BreakTrackingPage.tsx` |
| Session revoked / 401 | `AuthContext`, `SessionRevoked` broadcast |

Then:

- **C1. Already found and fixed — verify the fix and look for siblings.**
  `timers:close-stale` matched on `start_time` alone, with no activity condition, and
  ran every 15 minutes. Any timer running past `stale_timer_max_minutes` (default 120)
  was closed whether or not the person was working, and because that path does not set
  `auto_stopped_for_idle`, the client's reconcile
  ([`DesktopTimerDashboard.tsx`](../../frontend/src/pages/DesktopTimerDashboard.tsx),
  `wasStoppedForIdle`) showed **no notice at all**. Covered now by
  [`StaleSweepRespectsActivityTest`](../../backend/tests/Feature/StaleSweepRespectsActivityTest.php).
  Re-run it, then hunt the same shape elsewhere: **any sweep that decides staleness from
  `start_time` rather than from the activity ledgers.**
- **C2. The notice gap.** `wasStoppedForIdle()` reads only `auto_stopped_for_idle`, so
  every non-idle server-side stop is silent. Enumerate which `stop_reason` values reach
  a user as a visible message and which do not. Propose the smallest change that makes a
  server-side stop always explain itself.
- **C3. Two ledgers, consistently?** `activities` (non-idle) and `activity_sessions` are
  both written, and the Electron foreground-window bridge writes only the latter. Find
  every consumer that asks "when was this person last active" and confirm each reads
  **both**. One that reads only `activities` will treat a live desktop tracker as silent.
- **C4. The lock threshold has no config key.** `TrackerPolicyResolver` resolves
  `lock_auto_stop_threshold_seconds` via
  `config('time_tracking.lock_auto_stop_threshold_seconds', 300)`, but that key does not
  exist in [`config/time_tracking.php`](../../backend/config/time_tracking.php). Confirm,
  and state the consequence: Windows auto-lock at 5 idle minutes stops the timer, and no
  environment variable can change it.
- **C5. No restart after a server stop.** After the reconcile clears the timer, the
  auto-start effect re-runs but `hasAttemptedAutoStartRef` is already true. Verify that
  the rest of the day is untracked unless a human notices, and say whether that is the
  intended behaviour.
- **C6. Production evidence.** Run these and paste the output:

  ```sql
  -- Which mechanism is stopping timers, and how long they had run
  SELECT stop_reason, count(*), round(avg(duration)/60) AS avg_minutes,
         round(avg(trailing_idle_seconds)) AS avg_tail
  FROM time_entries
  WHERE end_time >= now() - interval '30 days'
  GROUP BY stop_reason ORDER BY 2 DESC;

  -- Entries closed with zero or near-zero duration: work that was thrown away
  SELECT stop_reason, count(*) FROM time_entries
  WHERE end_time >= now() - interval '30 days' AND duration < 60
  GROUP BY stop_reason ORDER BY 2 DESC;

  -- Is the scheduler even alive? (compare with cache key scheduler:last-run-at)
  SELECT max(end_time) FROM time_entries WHERE stop_reason LIKE '%cron%';
  ```

  Also `grep -c "Stale timer auto-closed\|auto-stopped by idle check" storage/logs/laravel.log`.
- **C7. The three daemons.** `CLAUDE.md` states the queue worker, `schedule:work` and
  `reverb:start` must all run. Establish which are actually running in the target
  environment. A dead scheduler and an over-eager one produce opposite bugs; say which
  one you are looking at before diagnosing anything.

---

# Part D — Does attendance actually reach payroll?

**Contract.** `AttendanceService::monthlyAttendanceSummary()` is the single source of
truth for payroll attendance, and payroll is a **consumer** that never writes back
([`PayrollAutoProcessService.php`](../../backend/app/Services/PayrollAutoProcessService.php),
`autoSyncAttendance` docblock).

There is more than one way to produce payroll numbers in this codebase. **Find them all**
before judging any of them. Start here and prove the list complete:

| Path | Entry point | Reaches attendance how |
|---|---|---|
| Per-employee wizard / queued run | `PayrollDepartmentController::processEmployeePayroll` (line ~982), driven by `ProcessPayrollRunEmployees` | `monthlyAttendanceSummary`, **but only as a fallback** |
| Auto-process | `PayrollAutoProcessController` → `PayrollAutoProcessService::autoSyncAttendance` | `monthlyAttendanceSummary` directly |
| Payslip render | `PayslipController` → `Payroll\SalaryCalculationService` | `monthlyAttendanceSummary` via `getAttendance()` |
| Filings | `PayrollFilingController` (line ~1280) | `monthlyAttendanceSummary` |

- **D1. The override that is always taken.** In `processEmployeePayroll`, `working_days`,
  `days_present` and `lOP_days` are read from the **request** when present, and the
  attendance summary is only the fallback. The frontend type
  [`ProcessPayrollRequest`](../../frontend/src/types/index.ts) marks `working_days` and
  `days_present` as **required**, and
  [`EmployeePayrollWizard.tsx`](../../frontend/src/components/payroll/EmployeePayrollWizard.tsx)
  sends `parseInt(workingDays) || 26` and `parseInt(daysPresent) || 0`.
  Establish, with a real request captured from the UI: **does the server's attendance
  summary ever get used on the path the product actually uses?** Then answer:
  - Where do `workingDays` / `daysPresent` in the wizard come from — are they seeded from
    `GET` monthly attendance summary, or typed?
  - What is sent when those fields are blank? Trace `|| 26` and `|| 0` and state the
    payroll consequence of each.
  - Note Laravel's `filled()` returns **true** for `0`. Work out what `lOP_days: 0` on a
    blank form does to an employee who was absent all month.
- **D2. Do the paths agree?** Pick 5 real employees across a month with genuine LOP, half
  days and paid leave. For each, compute attendance through **every** path in the table
  and diff the results. Any disagreement between what the run paid and what the payslip
  renders is a finding, and the payslip is the document the employee trusts.
- **D3. `PayrollReconciliation` is already recording disagreement.** `autoSyncAttendance`
  writes a reconciliation row whenever legacy and simplified present-days differ by more
  than 0.01. Query that table: how many rows, how large are the differences, and is
  anything surfacing them to a human?

  ```sql
  SELECT month_year, count(*), round(avg(abs(difference))::numeric, 2) AS avg_diff,
         max(abs(difference)) AS worst
  FROM payroll_reconciliations GROUP BY month_year ORDER BY 1 DESC;
  ```
- **D4. Legacy versus simplified.** `autoSyncAttendance` writes **both** field sets
  (`days_present`/`lOP_days` and `present_days`/`total_lop_days`) and stamps
  `attendance_calculation_mode`. Find which fields the calculator, the payslip, the
  register and the filings each read. Two field sets with one calculator reading a mix is
  how a month gets paid twice-differently; prove it does not happen here.
- **D5. Upstream of the summary.** `monthlyAttendanceSummary` reads attendance records,
  punches, leave and holidays. Verify each upstream writer is live: biometric ingestion
  (`BiometricPunchProcessor`), the timer path (`ensureAttendanceCheckedIn`), the hourly
  `attendance:close-open-punches`, and leave approval. **A punch that never closed makes a
  present day look absent** — count open punches older than a day:

  ```sql
  SELECT count(*) FROM attendance_punches
  WHERE punch_out_at IS NULL AND punch_in_at < now() - interval '1 day';
  ```
- **D6. Closing back into the past.** `processEmployeePayroll` calls
  `closeStaleRunningTimers($userId, $month_year)` before computing. Read it. Does
  processing payroll mutate attendance or time data for a month already being paid?
  Cross-check against the contract that payroll never writes back.

# Part E — Loans, and everything else deducted at run time

**Contract.** A recurring recovery — loan EMI, advance, garnishment — is deducted once
per run, reduces the outstanding balance exactly once, and appears identically on the
run and on the payslip.

- **E1. The idempotency ledger.** `PayrollDepartmentController::processEmployeePayroll`
  (line ~1290) recovers a loan through `PayrollLoanRecovery::firstOrCreate` keyed on
  `(payroll_run_id, employee_loan_id)`, and only decrements the balance when the row was
  newly created. Test all of it:
  - Reprocessing the same employee in the same run twice — is the EMI deducted twice? Is
    the balance decremented twice?
  - Concurrent processing of the same run. The migration does carry
    `unique(['payroll_run_id','employee_loan_id'])`, so the race ends in a constraint
    violation rather than a double deduction — confirm the code *survives* that
    violation instead of failing the run with a 500.
  - A run that is deleted or rolled back — is the recovery row and the balance reversed?
    If not, the loan is permanently short-recovered.
  - The final EMI: does `remaining_amount <= 0` close the loan, and does the last
    instalment deduct the **remaining balance** or a full EMI that overshoots it?
- **E2. The other two paths deduct nothing.** `Payroll\SalaryCalculationService` —
  which backs `PayslipController` — has `getLoanEmi()`, `getAdvanceRecovery()` and
  `calculateLatePenalty()` all `return 0; // Placeholder`. And
  `PayrollAutoProcessService` has no loan handling at all (`grep -i loan` it).
  Establish the consequence precisely: **can an employee's payslip show a loan EMI of
  zero while the run deducted one, or vice versa?** Reproduce it with a real loan.
  This is the single highest-value question in Part E.
- **E3. Garnishments are unreferenced.** `app/Services/GarnishmentService.php` has no
  caller anywhere in `app/`, `routes/` or `tests/`. Confirm, then classify: dead code, or
  a court-ordered deduction silently not being taken? Check whether any UI offers to
  create one.
- **E4. Full and final.** `FullAndFinalSettlement` references loans. On exit, is the
  outstanding balance recovered, and does it use the same ledger as a monthly run — or a
  second path that can double-recover? Note `CLAUDE.md`: gratuity must go through
  `calculateGratuityForSettlement()`.
- **E5. Every deduction, enumerated.** Produce one table of every deduction a run can
  apply — statutory (PF, ESI, PT, LWF, TDS), loan, advance, garnishment, custom, LOP —
  with, for each: where it is computed, which of the payroll paths apply it, and whether
  the payslip and the accounting journal agree. `PayrollJournalService` refuses to export
  an unmapped component; use that refusal as a cross-check on your list.

# Part F — What is genuinely required before a run

- **F1. Two validators, one question.** `PayrollValidationService::preRunChecks()` and
  `PayrollChecklistService::runPreValidations()` both gate a run. List every check in
  each, mark overlaps and contradictions, and say which one the UI actually calls.
- **F2. The four guards that already exist** (`CLAUDE.md`, "Reading a failing payroll
  test") — `annual_ctc` for F&F and encashment, a run plus a `payroll_item` for arrear
  approval, and `draft → locked → approved` before a bank file. Confirm each still
  fires, and that each returns **422 with a message naming what is missing**, not a 500.
- **F3. Blocking versus advisory.** For each check, determine whether failing it stops the
  run or merely warns. A check that cannot stop anything is documentation, not a control
  — say so.
- **F4. Honest refusals.** `PayrollDisbursementService` returns unpayable people as
  **exclusions, never silent drops**, and a filing must report `filing_ready: false`
  rather than emit `PANINVALID`. Verify both still hold. Then check net pay is stored
  **signed** and never clamped to zero.
- **F5. The gaps a run cannot see.** Which of these silently produce a wrong run rather
  than a refusal: no professional-tax state, no legal entity, no bank account, no PAN, a
  mid-month compensation revision, an employee hired mid-month, an employee on notice?

---

## Instrumentation you are expected to add

Where a boundary is unclear, do not reason about it — instrument it once, run it, read
it, then remove the instrumentation:

- The desktop renderer already logs `[Timer Auto-Start] BLOCKED: …` on every evaluation.
  Capture a real boot's console and quote the line that fired.
- Log at each payroll boundary for one employee: what the wizard **sent**, what
  `monthlyAttendanceSummary` **returned**, what was **stored** on the `payroll_item`, and
  what the payslip **rendered**. Four numbers; if any two disagree you have found the
  layer.
- For a stop-path finding, capture the `time_entries` row before and after, plus the
  `laravel.log` line the sweep wrote.

## What to hand back

A single report, in this order:

1. **Verdict per part** (A–F): sound / defective / unwired, one line each.
2. **Findings table**, ordered by money-and-trust impact — a wrong payslip outranks a
   cosmetic gap. Columns: what breaks · who notices and when · evidence (file:line, query
   output, failing test) · confirmed or hypothesis · smallest correct fix.
3. **The stop-path inventory** from Part C and **the deduction table** from Part E5, in
   full. These are reference material beyond this audit; write them to last.
4. **What you changed**, if anything, with the test that proves each change.
5. **What you could not determine**, and the specific access or data that would settle it.
   Say this plainly. An unanswered question recorded honestly is worth more than a
   confident guess, and in payroll it is worth considerably more.
