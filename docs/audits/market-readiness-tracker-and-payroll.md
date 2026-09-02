# Market-readiness audit — the tracker against Time Doctor, payroll against Keka

Paste everything below the line into a fresh session at the repo root.

This is the **breadth** pass: is the product sellable, and where does it lose a deal.
Its companion, [`tracker-and-payroll-intake-audit.md`](./tracker-and-payroll-intake-audit.md),
is the **depth** pass on two specific chains (timer lifecycle, and what payroll actually
reads). Run this one first to find what is missing; run that one to find what is wrong.
Do not duplicate its findings here — cite them.

Competitor detail below was verified **31 Aug 2026** and is quoted with its source. Every
competitor claim you add must carry the same: a URL and the date you read it. This repo's
own marketing rule (`marketing/lib/facts.ts`) is that no sentence ships without a
citation, and a competitor claim is the easiest kind to get sued over and the easiest to
get wrong.

---

## Mission

Decide, with evidence, whether **(1)** the desktop tracker and **(2)** Indian payroll are
ready to sell against the category leaders — Time Doctor for tracking, Keka for payroll —
and produce the shortest credible list of work that would change a "no" to a "yes".

You are auditing a product, not reviewing code style. A capability that exists in the
codebase but that a customer cannot reach is **not a feature**. A capability that works
but that nobody can find is a **support cost**. Say so in those terms.

## Rules of engagement

- **Walk the product, don't read about it.** Every verdict on a user-facing capability
  must come from actually running it — sign in as an employee, sign in as an admin, click
  it. `run` the app if a project skill covers it. Grepping a route file proves an endpoint
  exists; it proves nothing about whether the feature is usable.
- **Two roles, always.** Every tracker and payroll capability gets tested from **both**
  the employee side and the admin/manager side. Most of the damaging gaps in this product
  class are asymmetric: the admin screen exists and the employee equivalent does not, or
  the employee can see something the admin cannot correct.
- **Dated citations for competitors.** URL + date read. Prefer the vendor's own site and
  help centre over review aggregators; where you use a review site, mark it *secondary*.
- **Rate honestly in both directions.** Overstating is how a demo dies; understating is
  how a real advantage goes unsold. `CLAUDE.md`'s known-gaps list was audited on 19 Aug
  2026 and three entries described work that had already shipped — that cost real marks in
  a customer evaluation. Do not repeat it in either direction.
- Both suites stay green: `php artisan test` (cwd `backend/`), `npx vitest run` and
  `npx tsc --noEmit` (cwd `frontend/`). Gate on failing test **names** against
  `.github/baselines/`, never counts.

## The rating scale — use these five words exactly

| Rating | Means |
|---|---|
| **Absent** | No implementation. |
| **Unwired** | Code exists; no route, no caller, or no UI reaches it. **Treat as Absent for selling, and flag separately** — unwired code is worse than absent because it reads as done in a code review and fails in a demo. |
| **Partial** | Reachable, but a named part of the capability is missing or wrong. Name the part. |
| **Parity** | A customer comparing feature-by-feature would not prefer the competitor. |
| **Ahead** | Genuinely better, and you can say why in one sentence a buyer would repeat. |

Add a **BLOCKER** flag where the gap alone loses the deal, independent of everything else.

---

# Part 1 — The tracker, against Time Doctor

## 1A. Walk it as an employee

Sign in as a `role: employee` user on the desktop app and do a full day. Record what
happens, what you are told, and what you can find out about yourself.

1. **First run.** Install/launch. Is monitoring disclosed before anything is captured?
   `GET /api/monitoring/consent` and `POST /monitoring/notice` exist
   ([`routes/api/protected/monitoring.php`](../../backend/routes/api/protected/monitoring.php)) —
   is the notice actually shown, and is consent actually gated on, or is it a screen
   nobody routes to? Can the employee **withdraw** consent, and what stops when they do?
2. **Auto-open and auto-start.** Does the app launch at boot; does the timer start itself;
   is either controllable by the employee? (Depth in the companion prompt, Parts A and B —
   here judge only whether the *experience* is acceptable to sell.)
3. **A working day.** Start the timer, work 20 minutes, go idle 20, lock the screen, come
   back, take a break, stop. Record every prompt, notification and state change you saw,
   and everything that happened that you were **not** told about.
4. **Self-service visibility.** From [`MyActivity.tsx`](../../frontend/src/pages/MyActivity.tsx),
   [`Timesheets.tsx`](../../frontend/src/pages/Timesheets.tsx),
   [`TimeReports.tsx`](../../frontend/src/pages/TimeReports.tsx),
   [`BreakTrackingPage.tsx`](../../frontend/src/pages/BreakTrackingPage.tsx): can the
   employee see their own hours, their own screenshots, their own app/URL history, their
   own idle decisions, their own productivity score? Check
   `can_view_own_activity` in `TrackerPolicyResolver` — who controls it and what is the
   default?
   > Time Doctor's stated position: *"give employees access to their own data… employees
   > can access their own dashboards to review tracked hours, task breakdowns, and daily
   > productivity"* (timedoctor.com blog / support KB, read 31 Aug 2026).
5. **Screenshot dignity.** Can an employee see a screenshot of themselves, and can they
   delete or flag a sensitive one? Time Doctor allows employee deletion **if the admin
   permits it**, and offers screenshot blurring. Check
   `ScreenshotController::destroy`/`bulkDestroy` authorization: who is allowed, and is
   there any blur or privacy-level control (`TrackerPolicyResolver::privacy`, the
   `url_detail` levels `full|host|off`)?
6. **Corrections.** Idle wrongly deducted, a missed punch, a forgotten stop — what is the
   employee's path to fix it? Regularisation exists on mobile
   ([`mobile-app/app/regularization`](../../mobile-app/app/regularization)); is there a
   web equivalent, and does it reach attendance *and* the timesheet?
7. **Mobile.** 18 screens, employee-only. Time and attendance from a phone: what can an
   employee do there versus on desktop, and is anything only possible on one of them?

## 1B. Walk it as an admin / manager

1. **Live view.** Who is working right now — is there a real-time team view?
   `TeamPresenceService` and [`MyTeam.tsx`](../../frontend/src/pages/MyTeam.tsx) exist.
   Compare with Time Doctor's Team Dashboard: *"instantly spot who is active, who is idle,
   how time is distributed across projects"* (timedoctor.com, read 31 Aug 2026).
2. **Evidence review.** [`Monitoring.tsx`](../../frontend/src/pages/Monitoring.tsx) and
   [`MonitoringWorkspace.tsx`](../../frontend/src/pages/MonitoringWorkspace.tsx):
   screenshots, app usage, URL capture, productivity classification
   (`ProductivityClassifier`). Can an admin re-classify an app as productive/unproductive,
   and does the re-classification apply retroactively?
3. **Timesheet approval.** Time Doctor gates payroll on **Time Approvals**. Does an
   approval step exist here between tracked time and payroll, or does tracked time flow
   straight through? If it flows straight through, that is a finding with money attached.
4. **Alerts.** `MonitoringAlertRuleController` + `monitoring:evaluate-alerts` runs **daily
   at 07:00**. Time Doctor's equivalents are real-time. Judge whether daily is sellable and
   say what the rule set can actually detect.
5. **Policy configuration.** Everything `TrackerPolicyResolver` resolves — idle track, idle
   auto-stop, lock auto-stop, capture interval, idle resolution policy, retention, URL
   detail, employee visibility. For each: is there a UI, is it per-org or per-user, and
   what happens on a bad value? Note `lock_auto_stop_threshold_seconds` has **no key** in
   [`config/time_tracking.php`](../../backend/config/time_tracking.php) — find any others.
6. **Reports and export.** [`ReportsWorkspace.tsx`](../../frontend/src/pages/ReportsWorkspace.tsx),
   `OvertimeRegisterPage`. What can leave the system as CSV/PDF, and is there an API a
   customer's BI tool could read?
7. **Scale.** 200 employees × a screenshot every 5 minutes × 8 hours ≈ 19,200 images/day.
   Check `PurgeExpiredScreenshots`, the retention setting, storage sizing and the
   `throttle:screenshots.upload` limit. State the storage cost per 100 seats per month.

## 1C. Benchmark matrix — build this table

Rate every row **Absent / Unwired / Partial / Parity / Ahead**, with the file or screen
that justifies it. Time Doctor's plan structure is the yardstick because it is what a
buyer will hold up; tier names verified at timedoctor.com/pricing, 31 Aug 2026.

**Their Basic tier — table stakes. Anything less than Parity here is a BLOCKER.**
Automatic tracking · Projects & tasks · Timeline report · Screenshots · Online/offline
tracking · Groups & teams.

**Their Standard tier — the mainstream comparison.**
Work schedules · Attendance · **Time approvals** · Activity summary · Web & app usage ·
Productivity ratings · Leave tracking · Break tracking · **Payroll** · Work-life balance
metrics · Real-time notifications · 60+ integrations.

**Their Premium tier — where a deal is won or conceded.**
Benchmarks AI · Office-vs-remote report · Unusual-activity AI report · **Mouse jiggler &
clicker detection** · Irregular keyboard activity · Internet connectivity tracking · Video
screen recording · Executive dashboard · **Automatic user provisioning** · 2 years
historical data · **Open API** · **SSO** · Client login access · Meeting insights ·
Software cost insights.

Notes to resolve while filling it in:

- **Integrations are the widest gap by count.** They claim 60+ (Slack, Jira, Workday).
  Count this product's real ones ([`routes/api/protected/integrations.php`](../../backend/routes/api/protected/integrations.php))
  and say which five would close the most deals.
- **SSO and provisioning are a partial win to claim carefully.** SAML 2.0 and SCIM user
  provisioning are built (`CLAUDE.md`), but SCIM has **no group provisioning** — people
  sync, their roles do not. State it exactly that way.
- **Idle threshold posture.** Time Doctor prompts at 3–5 minutes by default (secondary
  sources, read 31 Aug 2026); this product defaults to **900s** with a documented argument
  for why five minutes was wrong. If that is a deliberate product position, it is a
  *selling point* — write the sentence a salesperson would say.
- **Fraud detection is absent here.** Mouse-jiggler and clicker detection, irregular
  keyboard activity: check for any equivalent. This is the single most-demoed premium
  feature in the category.
- **Video screen recording** — absent or present? Say so plainly; it carries legal weight
  in India and the EU that a buyer may actually want you to *not* have.
- **Employee wellness framing.** Time Doctor sells break reminders and work-life-balance
  metrics as employee-benefit features. Does anything here address the "this is
  surveillance" objection, beyond the consent endpoints?

---

# Part 2 — Payroll, against Keka

## 2A. Walk it as an employee

1. Payslip — reachable on web and mobile ([`mobile-app/app/payslip`](../../mobile-app/app/payslip))?
   Downloadable? Does it show earnings, deductions, LOP, loan EMI, and YTD?
2. Investment declarations and proof upload (12 declaration routes exist in
   `payroll.php`; `TaxProofUploadService`). Walk the full 80C/80D flow. Keka lists
   declarations and proofs as core ESS.
3. Loan self-service. Keka offers *"a self-serve loan portal where employees track
   outstanding balances and EMI schedules"* (keka.com, read 31 Aug 2026). Compare against
   [`LoanController`](../../backend/app/Http/Controllers/Api/LoanController.php) — can an
   employee apply, and can they see a balance and a schedule?
4. Reimbursements — 28 route hits. Can an employee raise, track and see one paid?
5. Tax projection: can an employee see what their take-home will be, and why?

## 2B. Walk it as a payroll admin — the full run

Process one month end to end for a small org with deliberately awkward data: a mid-month
joiner, a mid-month exit, an employee with LOP, one with an active loan, one with a
reimbursement, one with no bank account, one in a state with no professional tax.

Record the **actual stage list** (`draft → locked → approved → released → disbursed`) and
at each stage: what is pulled in, what is validated, what blocks, who approves.

Then compare against Keka's flow (keka.com + help.keka.com, read 31 Aug 2026):

| Keka capability (verified 31 Aug 2026) | Test here |
|---|---|
| Attendance, leave, bonuses and F&F **sync directly into the payroll engine** | The companion prompt, Part D — cite its verdict, do not redo it |
| Gross-to-net across arrears, retro adjustments, bonuses | Arrears exist (5 route hits). Retro/bonus? |
| **Mid-month joiners, exits and LOP without manual rework** | Process all three; count the manual steps |
| Multiple pay schedules incl. **off-cycle runs** | `OffCyclePayrollService` exists — **grep for a caller and a route before rating it** |
| **Loan EMIs and voluntary deductions** deducted with statutory checks intact | Companion prompt Part E; note `SalaryCalculationService` returns `0` for loan EMI, advance recovery and late penalty |
| Centralised loan policy: eligibility, limits, repayment rules; **multi-loan per employee** | `EmployeeLoan` — is there a policy layer at all, and does the run handle two concurrent loans? |
| PF, ESI, PT, TDS, **LWF and gratuity** automatic | `PTStateService` (37 states), `LwfCalculator`, `EsiContributionPeriodService`. Rate each |
| Slabs **update when the government changes ceilings** | Where do slabs live, who updates them, what is the release process? A hardcoded slab is a BLOCKER for a multi-year contract |
| **Maker-checker: preparation separated from approval** | `PayrollApprovalService` + `payroll-locks`. Verify it cannot be self-approved |
| Every login, export and config change **logged** | [`routes/api/protected/audit.php`](../../backend/routes/api/protected/audit.php) — coverage and retention |
| F&F pulling notice adjustments, leave encashment, gratuity, pending reimbursements, tax recoveries **into one computation** | Process a real exit. Gratuity must go through `calculateGratuityForSettlement()` |
| **Files returns electronically** | This product **generates** files but submits to no portal, and 7 of 19 generators are `reference_only`. This is the honest headline gap — write the sentence you would actually say to a buyer |
| Payslips via ESS without HR intervention | Part 2A |

## 2C. The two payroll questions a buyer will actually ask

- **"Will my payroll be right?"** Answer with the validation layer: `PayrollValidationService`,
  `PayrollChecklistService`, `PayrollComparisonService` (month-over-month diff),
  `PayrollJournalService` (refuses to export an unbalanced journal or an unmapped
  component). Which of these does a customer see? A correctness argument nobody is shown
  is not a correctness argument.
- **"What happens when it's wrong?"** Off-cycle correction, reversal, re-run, arrears in
  the next cycle. Establish the actual recovery path. If the answer is "restore a backup",
  that is a BLOCKER and should be the top line of your report.

---

# Part 3 — Cross-cutting readiness

Not features; the things that stop a signed deal from going live.

1. **Unwired-code inventory. Do this first — it is the highest-value hour in the audit.**
   Confirmed so far: `GarnishmentService` (no caller anywhere), `OffCyclePayrollService`
   (no route), `SalaryCalculationService::getLoanEmi/getAdvanceRecovery/calculateLatePenalty`
   (all `return 0; // Placeholder`), `employee_documents.review_status` (a live column
   nothing surfaces — `CLAUDE.md`). **Find the rest**, systematically:
   ```bash
   # services with no caller outside themselves
   for f in backend/app/Services/**/*.php; do n=$(basename "$f" .php); \
     c=$(grep -rl "\b$n\b" backend/app backend/routes | grep -v "$f" | wc -l); \
     [ "$c" -eq 0 ] && echo "UNWIRED: $f"; done
   grep -rn "Placeholder\|would fetch\|TODO\|not implemented" backend/app/Services | grep -v test
   ```
   Then diff every model against its routes: a model with no endpoint is a table nobody
   fills.
2. **Operational fragility.** Three daemons must run — queue worker, `schedule:work`,
   `reverb:start` (`CLAUDE.md`). Forgetting the first means payroll silently queues
   forever; the second means timers never close; the third degrades gracefully. Is any of
   this checked at deploy, surfaced in `/api/health`, or documented in the runbook? A
   customer's ops team will get this wrong — decide whether the product tells them.
3. **Authorization.** `CLAUDE.md`: **0 Laravel policies**; authorization is inline in
   controllers. With payroll, screenshots and salary data in one system, sample 20
   sensitive endpoints and verify each gate. One missing check on a payroll route is a
   BLOCKER.
4. **Tenancy.** 97 models carry `BelongsToOrganization`; `TenantIsolationTest` enforces it.
   Confirm it still passes and that no new model is on the exclusion list without a reason.
5. **Privacy law, as a sales asset.** Monitoring notice + consent + withdrawal already
   exist here; Time Doctor *"doesn't offer consent-gathering tools such as employee
   e-signatures"* (secondary source, read 31 Aug 2026). Under India's DPDP Act this is a
   real differentiator — verify it works end to end, then write the two sentences that
   sell it. Also confirm the Aadhaar position (`CLAUDE.md`: identity is *"proof of identity
   and address"*, never "Aadhaar") holds everywhere in the UI.
6. **English only.** No i18n layer of any kind. For a shop-floor Indian deployment this is
   a real ceiling on self-service adoption — size it, do not just note it.
7. **Failure blast radius.** Error boundaries are per-route, not per-widget: one failing
   card takes its page. On a payroll screen, decide whether that is acceptable.
8. **Performance under real data.** Time the payroll run, the monitoring workspace and the
   screenshot gallery at 200 and 1,000 employees. Name anything above 3 seconds.

---

# Deliverable

One report, in this order. Write it for someone deciding whether to take this to a
customer next week.

1. **Two verdicts, one line each.** "The tracker is / is not ready to sell against Time
   Doctor because ___." Same for payroll against Keka. Commit to a position.
2. **BLOCKERS**, ordered. For each: what a buyer sees, the evidence, and the smallest work
   that clears it. If there are none, say that explicitly — it is a strong claim and it
   needs to be made deliberately.
3. **The two benchmark matrices** (1C and 2B), complete, every row rated with a citation.
4. **The unwired inventory** from Part 3.1. Flag anything that would appear in a demo.
5. **Where this product is genuinely Ahead**, with the sentence a salesperson should say.
   Candidates to test: one system from desktop tracker to payslip to statutory filing;
   attendance→payroll with no export/import step; consent and withdrawal built in;
   state-accurate professional tax across 37 states and UTs including the 17 that levy
   none; statutory working-time limits sourced to the provision. Verify each before
   claiming it — this repo has been burned by unverified claims in both directions.
6. **The shortest credible roadmap to "yes"**, in effort order, with what each item
   unlocks commercially.
7. **What you could not determine**, and what access would settle it.

Keep every competitor claim dated and sourced. If you cannot verify one, cut it — an
audit that overstates a rival is as useless as one that overstates the product.
