# CareVance HRMS

Multi-tenant HR and payroll platform for the Indian market. One Laravel API serving four clients.

---

## Navigation map

```mermaid
graph TD
  W["frontend/<br/>React 18 · Vite · TS<br/>89 pages"]
  M["mobile-app/<br/>Expo · RN<br/>18 screens · employee only"]
  D["desktop/<br/>Electron tracker"]
  X["browser-extension/<br/>URL capture"]

  API["backend/<br/>Laravel · 629 routes"]
  DB[("PostgreSQL<br/>timetrackpro")]

  W --> API
  M --> API
  D --> API
  X --> D
  API --> DB

  API --- HR["Core HR<br/>people · onboarding<br/>attendance · leave<br/>performance · exit"]
  API --- PAY["Payroll<br/>structures · calculation<br/>filings · F&amp;F · disbursement"]
  API --- OPS["Work &amp; Ops<br/>projects · tasks · assets<br/>monitoring · chat"]

  classDef c fill:#0E7490,stroke:#0A5A70,color:#fff
  classDef s fill:#E4E8EC,stroke:#B9C1C8,color:#14181C
  class W,M,D,X c
  class API,DB,HR,PAY,OPS s
```

## Where things live

| Looking for | Go to |
|---|---|
| An API endpoint | `backend/routes/api/protected/*.php` — split by domain (`payroll.php`, `lifecycle.php`, `users.php`) |
| Business logic | `backend/app/Services/` — 82 services; controllers stay thin-ish |
| A web screen | `frontend/src/pages/` · shared UI in `components/` · domain UI in `features/` |
| API client calls | `frontend/src/services/api.ts` (large — one export per domain) |
| A mobile screen | `mobile-app/app/` (expo-router) · API in `mobile-app/src/api/endpoints.ts` |
| Tracker/screenshot logic | `desktop/main.cjs` |

### Commands

```bash
# backend  (cwd: backend/)
php artisan test                      # 762 tests, 36 known failures
php artisan test --filter=SomeTest
php artisan migrate

# frontend (cwd: frontend/)
npm run dev                           # :5173
npx vitest run                        # 610 tests, 49 known failures
npx tsc --noEmit                      # must stay at 0 errors
```

Backend runs on `:8000`, frontend on `:5173`. Tests use in-memory SQLite; the app uses PostgreSQL.

### Testing from a phone or a second machine

Both dev servers bind to loopback by default, so nothing else on the network can reach them. To hand the app to a tester:

```bash
# frontend — vite.config.ts now sets host: true, so this is enough
npm run dev                      # then open http://<your-LAN-IP>:5173

# backend — only needed for the NATIVE mobile app, which calls the API
# directly rather than through Vite's proxy
php artisan serve --host=0.0.0.0 --port=8000
```

The web app needs no backend change: `runtimeConfig.ts` resolves a relative
`/api` and Vite proxies it from the dev machine. **Do not set `VITE_API_URL`**
unless the API is somewhere the browser genuinely cannot infer — hardcoding
localhost there sends every request to the *tester's own device*.

The Expo app auto-detects the LAN host from Metro, so it finds the API by
itself once the backend is on `0.0.0.0`.

---

## Rules that are not obvious

### Multi-tenancy is structural — keep it that way

97 models use `App\Traits\BelongsToOrganization`, which adds a global scope and stamps `organization_id` on create. **Do not hand-write `where('organization_id', ...)` in new code** — it is already applied.

Cross-tenant access must be explicit and greppable:

```php
Model::withoutOrganizationScope()   // super admin, console commands
Model::forOrganization($id)         // pin to a known tenant
```

`tests/Feature/TenantIsolationTest.php` fails if a model owning a table with `organization_id` lacks the trait. If that test fails on a model you added, add the trait — do not add it to the exclusion list unless you can state why.

Excluded on purpose: `User` (the scope resolves the acting user through Auth), `Organization`, `OrganizationStats`, `Invitation` (written before a user exists).

### The test suites have known failures — gate on new ones

Both suites carry a tail of pre-existing failures (36 backend, 49 frontend). **Never judge a change by the failure count** — compare failing test *names* against the committed baseline:

```bash
node scripts/ci/test-baseline.mjs --junit <report.xml> \
  --baseline .github/baselines/phpunit.txt --check --label phpunit
```

CI (`.github/workflows/tests.yml`) does exactly this and fails only on new names. If a change legitimately alters the set, regenerate with `--update` and commit the baseline.

### Money

- Amounts are `decimal`, never float. Round once, at the boundary.
- Statutory rules live in services, not inline: `PayrollCalculatorService`, `PTStateService`.
- Professional tax is **state-levied** — several states levy none. Never default a missing state to a real one; an unset state yields ₹0.
- Gratuity must go through `calculateGratuityForSettlement()` (five-year floor + statutory ceiling). The raw `calculateGratuityOnExit()` applies neither.
- Net pay is stored **signed**. Do not clamp a negative to zero — payroll validation is what should stop the run, and it can only do that if it can see the real number.

### Dates

Date-only columns cast as `'date:Y-m-d'`, not `'date'`. A plain `date` cast serializes as a UTC datetime, so a calendar date reaches the client a day early in any timezone ahead of UTC. This has bitten joining dates, checklist due dates and settlement dates.

In JSX, `·` in *text* renders as the literal characters — it is only an escape inside a JS string.

### Errors

No bare `catch {}`. Use `frontend/src/lib/reportSilentError.ts` where swallowing is genuinely right. Silent catches previously turned three separate failures into no-ops that looked like success.

---

## Domain notes

### Onboarding

Hiring opens a journey automatically (`UserController::openOnboardingJourney` → `OnboardingService::open`). An 18-step checklist spans day −14 to +90 across six owner roles (hr, employee, it, manager, finance, buddy) with blocking gates.

- Anchor due dates on a single resolved date; do not re-read `joining_date` off the model after save.
- Future joining dates are **valid** — pre-boarding is the normal path.
- A joiner reads their own journey via `GET /api/onboarding/my-journey`, and can complete only `owner_kind = 'employee'` items.

### Payroll

Run status: `draft → locked → approved → released → disbursed`.

Disbursement is `PayrollDisbursementService`: it creates a `BankTransferBatch`, writes a NEFT/RTGS CSV, and records every line. The bank's returned UTR is the only reference a statement reconciles against — never invent one locally. Unpayable people are **returned as exclusions, never silently dropped**.

Two payroll data models coexist. `payroll_monthly_runs` + `payroll_items` is correct. The legacy `payrolls` table (513 rows, all `gross_salary = 0`) is being retired — do not add to it.

### Filings

Generators produce real EPFO ECR and NSDL FVU formats. Statutory identifiers resolve through `User::statutoryId('pan'|'uan'|'esi')`, which reads the profile column *or* `employee_government_ids` — they live in both places. A filing must report `filing_ready: false` when the org has no PAN/TAN rather than emitting `PANINVALID` and claiming success.

---

### Rostering

The calendar on top of shift definitions. `ShiftResolver`'s precedence is now
**published roster day → effective-dated assignment → work info**.

- **An off day is a ROW, not a missing row.** `roster_days` with a null
  `shift_id` means "rostered, and off"; no row means "not rostered". Somebody
  given the day off has been told something; somebody nobody scheduled has not.
- **A rostered rest day does NOT fall through.** `resolve()` returns null rather
  than dropping to the standing assignment — falling through would quietly
  expect a full night shift from somebody told they had the day off.
- **Draft days are invisible to the resolver.** A manager builds next month
  without changing what attendance expects of anybody today, which is why
  publishing is a separate act rather than implied by saving.
- **Regenerating never destroys a decision.** `source` separates `generated`
  from `manual`/`swap`, and generation replaces only its own rows. Somebody who
  moved one person to nights on the 14th must not lose that to a rebuild.
- **A roster already worked is not rewritten.** Generation skips past dates: it
  is the record of what people were told, and every attendance record on that
  date was measured against it.
- **Cycle length is in DAYS, not weeks.** A four-on-four-off runs on eight days
  and a week-based model cannot express it. `start_offset` is what stops
  everybody on a rota resting on the same day.
- **A swap needs three parties.** The counterparty agrees AND a manager
  approves; nothing moves on the roster until approval, and the shifts are
  re-read at that moment rather than trusted from when the request was made.
  One person cannot give away a shift, and two cannot rewrite the site's cover
  between them.

### Working-hour law is not configuration

Limits and the overtime rate are properties of the **premises**, so they live on
`legal_entities` (`establishment_type`, plus any exemption), not on a policy
somebody configured. `StatutoryWorkingTime` is the single place the statute is
written down, with the provision each number comes from.

Five rules that are not obvious from the code:

- **The floor is computed always, applied only on request.** A configured rate
  below the s.59 minimum of 2× is *always* flagged (`isBelowStatutoryFloor()`),
  and only *paid* at the floor when the entity has `enforce_overtime_floor` on.
  Raising a live payroll's overtime rate because somebody deployed a release is
  not a decision the engine is entitled to make. The assessment carries both
  `multiplier` (applied) and `configuredMultiplier`, because "we paid 2× because
  the law says so, and your policy says 1.5×" is a sentence a report has to be
  able to say.
- **Statutory overtime ≠ policy overtime.** `OvertimeEngine` measures the excess
  over the *rostered shift* — that is what an employer agreed to pay for.
  `StatutoryComplianceService::overtimeMinutesBetween()` measures the excess over
  *nine hours a day or forty-eight a week*, because that is what s.59 defines and
  what the s.64(4) quarterly cap counts. Using the engine's number for the cap
  over-counts an 8h roster and under-counts a 10h one, and it also cannot work at
  all for an establishment with no roster configured.
- **`unregulated` means unassessed, not compliant.** The breach list returns
  `is_regulated: false` and an empty array; the controller counts those people
  separately as `employees_not_assessed`. Never let an empty breach list render
  as a green tick — nobody re-checks a clean compliance report.
- **A rest interval is one qualifying break, not the sum of several.** Two
  fifteen-minute teas are not a half hour under s.55. The check finds the longest
  *continuous* stretch, and only a break of at least `minimumRestMinutes` resets
  the clock.
- **The register prices assessed hours, not approved ones.** An approval workflow
  is internal; s.59(4) records what was worked and what it is worth. Pricing the
  unapproved assessment returns `0.00` for every pending row, which reads as
  "overtime worked, nothing owed". Approval state lives in the payable/pending
  columns. And an employee with no `annual_ctc` yields `amount: null`, **never
  `0.00`** — the totals surface `rows_without_a_rate` so nobody hands over a
  register that could not price half its people.

Exemptions are read from the entity, never inferred from its state. s.55 allows
six hours instead of five *by written order of the Chief Inspector*; a Gujarat
factory without that order is still on five. An exemption may only relax a limit —
a recorded value stricter than the Act is treated as a typo and ignored.

## Known gaps

Real, and deliberately not yet built:

> **Keep this list honest in both directions.** It was audited on 19 Aug 2026
> and three entries were found to be describing work that had since been built
> — effective-dated compensation, shift definitions and mobile approvals. A
> stale gap list is not harmless: technical buyers read it and believe it, and
> it cost real marks in a customer evaluation for features that already
> shipped. When you close a gap, delete the line in the same commit.

- **Ten filing generators have no blade view** — `form1`, `form2`, `form6`, `form19`, `form31`, `form124`, `eshram_registration`, `se_registration`, `shram_card_registration`, `uan_activation`. Only `form12ba`, `form16` and `form16_annual` exist under `resources/views/filings/`. `FilingGeneratorRegistry` resolves availability from the filesystem, so these are now reported as *unavailable* rather than attempted and failed — writing a template is the whole act of shipping its filing. This is real statutory work, not a stub.
- **No SCIM.** SAML 2.0 now exists (see below), so people can *sign in* through Entra, Okta or Google — but nothing provisions or, more importantly, deprovisions them automatically. Somebody disabled in the IdP keeps their CareVance account until an admin deactivates it by hand; SAML refuses their login, but their data access via an existing token is not revoked by the IdP. This is the remaining half of the enterprise identity story.
- **No offer letter, e-signature or background verification.**
- **Recruitment has no careers page, and BGV has no vendor integration.** Openings, candidates, applications, a configurable pipeline, interviews with panel feedback, offers with an approval chain, a signed offer letter with an audit trail, and consent-gated background verification all exist (see below). What is missing is a public careers page or job board a candidate can browse and apply from, and an actual connection to AuthBridge, IDfy or similar — the BGV schema is vendor-agnostic and today a human records the findings. No engagement surveys or HR helpdesk either.
- **Rostering has no UI yet.** Rotation patterns, published rosters by date, coverage and swap requests all exist (see below) and `ShiftResolver` reads them. What is missing is a screen: today a rota is built through the service, not by a manager dragging shifts around a calendar.
- **No biometric device ingestion beyond ADMS push.** The push protocol is implemented (see below), which covers eSSL, ZKTeco, Biomax and Matrix terminals configured to post to a cloud server. Devices that only offer SDK pull, or that sit on a LAN with no outbound route, still cannot talk to this.
- **No accounting export.** `GlMappingConfig` exists with nothing to export to — no Tally, no Zoho Books.
- **English only.** No i18n layer of any kind, which caps self-service adoption on a shop floor.
- **0 Laravel policies.** Authorization is inline in controllers, though the `Role`/`Permission` schema and `hasPermission()` are real and maker-checker now covers the full payroll chain.
- **No real-time transport.** `BROADCAST_CONNECTION=log`; chat polls every 10s.
- **One error boundary for the whole app.** See `frontend/src/main.tsx`.

### Not gaps — these were on this list and are built

Kept visible rather than deleted, for two different reasons. The first three
were never missing and were wrongly believed to be. The rest were genuinely
missing and were built in Aug 2026 — they stay here because a buyer who read
the old list needs to be told what changed, and because each one carries a rule
that is not obvious from the code:

- **Effective-dated compensation is implemented.** `Services/Payroll/CompensationTimeline` resolves what somebody earned on any given day from accepted revision letters, and `PayrollAutoProcessService` calls `blendedAnnualCtcForMonth()`. A mid-month revision blends correctly and a back-dated one diffs against a real prior rate — arrears are not "approximate".
- **Mobile has manager approvals.** `mobile-app/app/approval-inbox/`, plus team, notification publishing, comp-off, regularisation and selfie attendance across 18 screens.
- **Shift definitions exist** — see the rostering entry above for what actually remains.
- **Leave accrues on a schedule, and a balance is a ledger.** `leave_types` replaces the JSON quota in `organizations.settings` — per-type annual quota, `annual|half_yearly|quarterly|monthly` accrual, pro-rating for mid-year joiners against a `joining_cutoff_day`, a separate probation rate, and per-type carry-forward caps. `LeaveAccrualService` writes signed rows into `leave_ledger_entries`, and a balance is `SUM(units)` over them, never a stored counter — so "why is my balance 8.5" expands into the dated rows that produced it. Accrual timing (`period_start`|`period_end`), year-end action (`carry_forward`|`reset`|`encash`) and a separate notice-period rate are all per type. `LeaveYearEndService` closes a year as **ledger rows, never edits** — carry-and-expire is two rows so "10 carried, 5 expired" is sayable, the carry lands on **both sides** of the boundary so each year's ledger adds up to its own balance, and an overdrawn balance is left alone rather than zeroed. `annualQuotaFor()`: notice outranks probation, and NULL means the normal rate in both cases, never zero. Configured under Settings → Leave — **the only editor**. The old quota editor under Settings → Organization → Leave policy was a second one writing to the JSON, and for a day the two answered different questions: request options came from the JSON while balances came from `leave_types`, so a type could be requestable with no balance, and `normalizeRequestedCategory()` silently rewrote an unrecognised code to `paid` — you asked for sick leave and paid leave was deducted. `resolvePolicyCategories()` now resolves from `leave_types` and reads the JSON only when a tenant has no rows. Do not add a second editor.
- **Legal entities exist.** `legal_entities` carries its own PAN, TAN, PF and ESI codes; `LegalEntityResolver` decides which one an employee files under, defaulting to the organization's primary entity. Filings generate per entity. Configured under Settings → Legal entities.
- **Biometric punch ingestion is implemented.** ADMS push (`routes/api/biometric.php`, `/iclock/*`), which is what eSSL, ZKTeco, Biomax and Matrix terminals speak. A serial must be registered by an admin before anything is accepted; punches are unique on (device, device user, timestamp) so a replayed request is a no-op; `BiometricPunchProcessor` pairs readings into attendance. Managed under Settings → Biometric devices, which also surfaces the two silent failures: a device that has stopped reporting, and a device user ID nobody has claimed. **`isStale()` means "reported before and stopped", not "has never reported"** — `hasEverReported()` is the separate question. Conflating them made a terminal registered thirty seconds earlier announce "no attendance is arriving from this device", which teaches an admin to ignore the warning by the time it means something. **Unclaimed punches are kept, not dropped** — claiming the ID attaches the backlog.
- **SAML 2.0 single sign-on is implemented.** `SamlAuthService` over `onelogin/php-saml`; signature verification is delegated to the library on purpose, and this codebase owns only connection resolution (by Issuer, across tenants, without trusting it), replay refusal via `saml_used_assertions`, and whether an authenticated stranger becomes a user at all. Configured under Settings → Single sign-on. A new connection is created **switched off** — turning one on redirects every sign-in in the organization, so it is a deliberate second act.

### Recruitment

`job_openings` — **not** `jobs`, which Laravel's queue owns; a collision there
surfaces in a worker rather than in a test.

- **A candidate is a PERSON, an application is one candidacy.** Collapsing them
  breaks the moment somebody good applies for a second role — you either lose
  their history or duplicate the human.
- **`candidates.email` is unique per ORGANIZATION**, deliberately unlike
  `users.email` which is globally unique. The same person legitimately applies
  to two customers on this platform.
- **A stage move is an event, not a column.** `hiring_stage_id` says where
  somebody is; `application_stage_events` says how they got there. Every
  transition writes both, in one transaction, through `HiringPipelineService` —
  a controller touching `hiring_stage_id` directly would be a second, silent
  pipeline.
- **`status` and `hiring_stage_id` answer different questions.** A rejection
  keeps the stage it happened at: "rejected after the tech round" and "rejected
  on the CV" are different facts.
- **Requisitions soft-delete.** `REQ-2` gets quoted in approval emails, so the
  reference must never be reused — `nextCode()` reads the highest number ever
  issued, `withTrashed()`, which only works if the row survives.
- Moving backwards is allowed and recorded as `moved_back`. A pipeline that only
  goes forwards gets worked around by deleting and recreating the application,
  which destroys the history.
- Gated on `role:manager`, not admin: hiring is line-management work, but
  candidate records carry personal data and current salary so it stops there.

**Interviews and offers:**

- **Panel feedback is per interviewer and never averaged.** Three people going
  two-to-one and three people all lukewarm produce the same mean, and they call
  for completely different conversations — `summaryFor()` returns the split and
  an explicit `is_split`, never a score.
- **Invited and submitted are different states.** `panelProgress()` answers "two
  of three have responded", which a table of only-submitted rows cannot.
- **Somebody who has already given feedback cannot be dropped from a panel.**
  Their verdict informed a decision that may already be taken; cascading the
  delete rewrites how it was reached.
- **An empty approver list is refused, never treated as "no approval needed".**
  That is how an offer goes out with nobody having agreed to it.
- **One rejection sends the whole offer back to draft immediately**, rather than
  collecting the rest of a chain for something already refused.
- **`sent` and `accepted` are separate states.** An offer with a candidate is a
  commitment already made; editing one in place is refused — withdraw and draft
  a revision, so the change is visible.
- **Re-sending does not move `sent_at`.** The candidate has been counting down.
- Accepting an offer moves the candidacy to hired **through the pipeline**, so
  the opening's headcount and the offer cannot disagree.

**Signing the offer letter** (`/offer/{token}`, unauthenticated):

- **The signing token IS the authentication.** A candidate is not a user and
  never will be — making somebody create an account to accept a job loses
  offers. So it is 32 random bytes, stored only as a SHA-256 hash, compared with
  `hash_equals`, `$hidden` on the model, and **cleared in the same transaction**
  as the signature is written. A link that still works after use can be accepted
  twice.
- **Every failure returns the same 404** — wrong token, expired, already used,
  withdrawn. Distinguishing them tells an unauthenticated caller which tokens
  exist, and the candidate's next step is the same either way.
- **`document_hash` is the load-bearing column**, not the drawing. It
  fingerprints the letter as the candidate actually read it, so "I never agreed
  to that salary" has an answer even if the letter is regenerated later. Taken
  from the UNSIGNED render — that is the document they saw.
- **Typing a name is a signature.** The canvas is optional; requiring it
  excludes keyboard and assistive-technology users. An untouched canvas is never
  stored, so a typed signature is not dressed up as a drawn one.
- Declining is offered on the same page. "No reply" is a worse outcome for a
  recruiter than a reason.
- The page is routed WITHOUT `PublicRoute` — that redirects signed-in users to
  the dashboard, which would bounce a recruiter checking their own link.

**Background verification** — three rules here are legal, not product:

- **Consent gates everything, structurally.** `background_checks.consent_id` is
  a foreign key, not a boolean somebody could set from a console. No consent, no
  check; withdrawn consent, no further checking.
- **Consent is to a SCOPE, not to "background checks".** Somebody who agreed to
  employment verification has not agreed to a credit check, so `scope` is stored
  verbatim and items outside it are refused by name. A package that gains a
  check next year cannot retroactively widen a consent given last year.
- **Withdrawal stops outstanding work but does NOT erase findings.** They were
  lawfully obtained at the time, and deleting them would also delete the record
  that the check happened. Unstarted items become `skipped`, so the record shows
  what was going to be checked and was not.
- **A discrepancy is not a failure.** The vocabulary is
  `clear|discrepancy|insufficient`, never pass/fail — a name spelled differently
  on a certificate and a fabricated employer are both discrepancies. **Nothing
  in the service touches a candidacy or moves a pipeline stage.** A discrepancy
  also requires BOTH `claimed` and `verified`: an accusation with no comparison
  behind it is one nobody can answer.
- **Adverse action has to reach the person.** `needsAdverseActionNotice()` is
  surfaced on the API, a notice on a clear check is refused, and a candidate
  response before a notice is refused — that would record a conversation that
  did not happen.
- Gated on `role:payroll`, **not** the `role:manager` gate the rest of
  recruitment uses. A completed check can carry a criminal record and a previous
  salary; a hiring manager decides whether to hire without needing either.

### The queue, and the worker you must actually run

`POST /payroll/runs/{id}/process-remaining` no longer processes employees inline. It marks the run `queued`, dispatches `ProcessPayrollRunEmployees`, and returns **202** with a progress handle; the client polls `GET /payroll/runs/{id}/processing-status` until `processing.is_finished`.

**`.env.example` sets `QUEUE_CONNECTION=database`, so a deployment that follows it needs a worker running or payroll processing will queue and never happen:**

```bash
php artisan queue:work --queue=default --tries=1 --timeout=3600
```

Local `.env` files currently carry `QUEUE_CONNECTION=sync`, where the job runs inline on dispatch — same behaviour as before, and no worker needed. That is why the endpoint re-reads progress off the run before responding rather than assuming the work is still pending: the client polls the same fields under either driver and never needs to know which is configured.

### The scheduler, and the timers that never close without it

Same trap, different process. `routes/console.php` schedules `timers:close-idle` **every minute** as the server-side backstop for desktop idle detection, plus `timers:close-stale`, the screenshot purge and the lifecycle sweep. None of it runs unless something drives the schedule:

```bash
php artisan schedule:work          # dev
# production: a cron / Scheduled Task calling `schedule:run` every minute
```

Without it the only thing that can stop an idle timer is the desktop app itself, which cannot act once it is closed, asleep or crashed. Measured 17 Aug 2026 with no scheduler running: `time_entries` #2114 started 17:59 and was still open at midday the next day.

Money stays correct either way — every auto-stop path rewinds `end_time` to the last real activity and records the idle tail in `trailing_idle_seconds`, so a late stop never bills the idle. What breaks is the timer appearing to run all night.

`POST /payroll/filings/generate/all` works the same way through `GenerateRunFilings`, and its progress appears under `filings` on the same status endpoint. **The bank file is deliberately still synchronous** — one eager-loaded query plus string formatting, returning content the user is waiting to download. Queueing it would turn a one-click download into prepare-poll-download for no gain.

`PayrollFilingService::generateAllFilings()` returns `['filings' => [...], 'failures' => [...]]` and attempts each generator independently. It used to be an unguarded sequence, so the first throw ended the batch — and because ten declaration-form generators reference missing views, `generateForm19()` reliably killed the run *after* PF ECR, ESI, 24Q and 12BA had already been written, leaving a 500 and no report. An `InvalidArgumentException` from a generator means "not due this period" and is a skip, not a failure.

Two things about these jobs are load-bearing:

- **It authenticates as the user who started it.** `BelongsToOrganization`'s global scope reads the organization from the authenticated user, and with *no* user it is deliberately a no-op so console commands are not filtered to nothing. In a queued job that default means querying **across every tenant**. Any new job touching scoped models must do the same — `Auth::setUser($actor)` — and `PayrollRunProcessingQueueTest` asserts it.
- **`tries = 1`.** A retry would re-enter a partially processed run and race the first attempt. Failures are recorded on the run for a human, not retried silently.

A second start while one is in flight is refused with **409** rather than queued — two workers walking the same missing list would race to create the same payroll item.

### Reading a failing payroll test

**Check the status code before you read the test.** The two failure modes mean opposite things:

- **405/404 — the test is dead.** `SimplePayrollFlowTest` targets the retired `PayRun` API (`POST /api/payroll/runs/generate` no longer exists). Delete it rather than debug it.
- **422 — a guard is refusing an incomplete fixture.** Every one of these in `PayrollIntegrationTest` turned out to be correct business logic, not a defect. Capture the response body first; the messages name exactly what is missing.

The four guards worth knowing, because new payroll tests keep tripping them:

| Operation | Requires first |
|---|---|
| F&F settlement, leave encashment | `annual_ctc` on the employee's payroll template — both compute every figure from it |
| Arrear **approval** | A run *and* a `payroll_item` for the arrear's `calculation_month` |
| Bank file | The run to have cleared `draft → locked → approved` |

`payroll/employees/{id}` is an HR/admin view. Employees reach their own figures through `payroll/my/*` — see the allow-list in `PayrollRouteAuthorizationTest`.

Covered and passing: `PayrollIntegrationTest` (15), plus `PayrollDisbursementTest`, `PayrollReadinessTest` and `PayrollRouteAuthorizationTest` (17) over disbursement idempotency, RTGS routing, exclusions-not-drops, UTR recording, PAN/IFSC validation and role-gating on every payroll route.

## Watch out for

- `desktop/release-*/` holds ~5 GB of build output; `.git` is ~2.9 GB from artifacts committed before the ignore rule existed.
- **There is one invite system now: `invitations`.** The legacy `invites` table and its routes were removed in Aug 2026 — the accept path resolved the invited address with an unscoped `User::query()` and overwrote the password of any account already holding it, in any organization. Do not reintroduce it. All four Add User tabs route through `invitations`, except **Create User**, which posts to `/users` with an admin-set password and is verified on create.
- **Create User depends on its Temporary Password field.** `POST /users` mints `Str::random(12)` when no password is supplied and sends no verification mail, so an admin-created user with neither a password nor `email_verified_at` cannot sign in at all. `UserController::store` sets `email_verified_at` only when a password was explicitly supplied — keep those two facts together if you touch either.
- Departments include both "HR" and "Human Resources" — duplicates that split every department-scoped report.
- Schema has drifted from migrations before (`bank_transfer_batches`). If tests fail on a missing column that exists in Postgres, suspect drift and write a guarded reconcile migration rather than editing an old one.
