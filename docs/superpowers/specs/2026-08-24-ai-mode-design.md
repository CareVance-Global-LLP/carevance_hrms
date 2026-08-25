# AI mode in universal search — design

**Date:** 2026-08-24
**Status:** design, awaiting review
**Scope:** a natural-language data-question mode inside the ⌘K command bar that answers with a real data table.

---

## 1. What this is

An admin opens ⌘K, switches to **AI mode**, and asks a question in their own words —
*"compare average net pay by department"*, *"who was absent more than 3 days last month"*,
*"laptops assigned to Engineering"*. They get a **data table**, plus a one-line summary
above it.

This is a different job from the existing bubble assistant, and the two stay separate:

| | Bubble assistant (`AdminChatBubble`) | AI mode (this spec) |
|---|---|---|
| Question | "how do I run payroll?" | "what was payroll last month?" |
| Answer | prose + navigation links | a table |
| Backing | 7 fixed tools in `AiToolRegistry` | the semantic layer below |
| Lives in | floating bubble | the ⌘K bar |

The bubble assistant is **not modified by this work**.

---

## 2. The central decision: named metrics, not model-authored SQL

The model chooses **which** metric to compute. It never decides **how** a number is
computed. This is the load-bearing decision in the whole design, and it was settled
empirically rather than by preference.

### Evidence from this database

Question: *"average net pay by department"*, org 1, real rows, measured 2026-08-24.

| | Engineering |
|---|---|
| naive `AVG(net_pay)` | ₹76,313.27 |
| metric defined as `AVG(net_pay) WHERE net_pay > 0` | **₹91,575.93** |

The ₹15,262 gap is `payroll_items` #7 — `gross_salary` ₹120,795, `net_pay` 0.00, status
`pending`, belonging to run #6 which is still `draft`. That row is legitimate in-flight
work, not bad data. A model that invents `AVG(net_pay)` returns ₹76,313.27: precise,
plausible, wrong, and nobody re-checks it.

**Cleaning the data does not fix this.** On 2026-08-24 the `HR`/`Human Resources`
duplicate was merged and three zero-value payroll rows deleted. The naive average
afterwards was still ₹76,313.27. Only the metric definition moves it.

A related trap: back-filling `department_id` on zero-value rows makes the naive number
*worse*, because it moves zeros out of `(no department)` into real departments —
Marketing halved from ₹61,584 to ₹30,792 in simulation.

### Evidence from the industry

2026 benchmarks put unmodeled text-to-SQL at 64.5% on benchmark suites but **10–31% on
real production data**; grounded in a semantic layer, 85–95%. Snowflake's own figures:
GPT-4o pointed at the warehouse ≈51%, Databricks Genie ≈79%, Cortex Analyst with a
semantic model ≈90%.

The decisive difference is not the score, it is the **failure mode**: semantic-layer
failures are refusals ("I can't answer that"), text-to-SQL failures are confident wrong
numbers. For payroll, a refusal is recoverable and a wrong ₹ figure is not.

### The tenancy argument

Raw SQL bypasses `BelongsToOrganization`'s global scope entirely. A wrong generated query
is therefore not just a wrong answer, it is a **cross-tenant leak**. Plans execute through
Eloquent so the scope is applied structurally rather than remembered.

---

## 3. Architecture

```
⌘K → AI mode → "compare average net pay by department, July"
   │
   ├─ 1. PLAN        stealth/ox-alpha, reasoning:low, temperature 0        ~3s
   │                 input:  question + entity/metric/dimension NAMES only
   │                 output: {entity, metric, group_by, filters, sort, limit}
   │                 never sees a single row of employee data
   │
   ├─ 2. VALIDATE    PlanValidator — reject anything not in the whitelist
   │                 unknown entity / metric / dimension → refusal, not a guess
   │
   ├─ 3. EXECUTE     QueryPlanExecutor → Eloquent
   │                 org scope + hierarchy gate applied automatically
   │                 ══> TABLE RENDERS HERE  (~3.5s end to end)
   │
   └─ 4. SUMMARISE   primary provider (Gemini), rows as input               ~9s
                     ══> one line appears above the table when it arrives
```

Steps 3 and 4 are deliberately decoupled in the UI. The table is what was asked for; the
summary is an enrichment and must never delay it.

### Why the summary uses the primary provider, not ox-alpha

Step 4 is the only step that sees real employee data. `stealth/ox-alpha` is a **cloaked
pre-release model** — free because the originating lab receives the traffic. Salary, PAN,
UAN and names must not go there. The summary therefore runs on the configured primary
provider (`services.ai.base_url`, a paid Gemini key), and if no primary provider is
configured **the summary is skipped and the table still renders**.

---

## 4. The semantic layer

A PHP definition file, `backend/app/Services/Ai/SemanticLayer.php`, holding entities,
their dimensions, and their metrics. Grounded in the real schema — verified 2026-08-24.

### 4.1 Schema facts that a model cannot guess

These were established by inspecting the live database and are the reason a curated layer
is mandatory rather than nice-to-have:

- **There is no `departments` table and no `employee_work_infos.department` column.**
  Departments are the **`groups`** table.
- People join departments via `employee_work_infos.report_group_id → groups.id`.
- Payroll joins departments via `payroll_items.department_id → groups.id`.
- `group_user` is a **separate many-to-many access grouping**, not the department. A user
  may belong to several. Never use it to answer "which department is X in".
- `payroll_items` carries roughly 100 columns. Exposing it raw guarantees failure.
- The leave ledger table is named **`leave_ledger`**, not `leave_ledger_entries`.

### 4.2 Entities

| Entity | Tables | Rows (2026-08-24) | Department via |
|---|---|---|---|
| `employees` | `users` + `employee_work_infos` (+ `groups`) | 90 | `report_group_id` |
| `attendance` | `attendance_records` | 2,095 | employee's group |
| `leave` | `leave_requests` + `leave_types` | 318 / 12 | employee's group |
| `leave_balance` | `leave_ledger` | **0** | employee's group |
| `payroll` | `payroll_items` + `payroll_monthly_runs` | 7 / 5 | `department_id` |
| `assets` | `assets` + `asset_assignments` | 18 / 7 | assignee's group |
| `work` | `tasks`, `projects`, `time_entries` | 54 / 13 / 2,140 | `group_id` |
| `hiring` | `job_openings`, `candidates`, `job_applications` | **0 / 0 / 0** | opening's group |

Every entity declares an explicit **column allow-list**. Excluded from every entity
regardless of role: password hashes, bank account numbers, and the statutory identifiers
PAN / UAN / ESI. A question that needs one of those is refused by name.

### 4.3 Metrics

Each metric is a named PHP closure with its definition written down. Illustrative set:

| Metric | Entity | Definition | Why it is not the obvious thing |
|---|---|---|---|
| `headcount` | employees | `COUNT(*)` where `employment_status = 'active'` | excludes exited staff |
| `avg_net_pay` | payroll | `AVG(net_pay)` where `net_pay > 0` | the ₹15,262 decision |
| `total_gross` | payroll | `SUM(gross_salary)` where `net_pay > 0` | same exclusion, for consistency |
| `absent_days` | attendance | `COUNT(*)` where `status = 'absent'` | 319 rows |
| `late_count` | attendance | `COUNT(*)` where `late_minutes > 0` | **not** `status = 'late'` — see below |
| `leave_days_taken` | leave | `SUM(end_date - start_date + 1)` where `status = 'approved'` | `auto_cancelled` is the second-largest bucket |

Two of these were verified against real column values on 2026-08-24 and are worth the
detail, because both are cases where the obvious definition is measurably wrong:

- **`late_count`.** 405 `attendance_records` have `late_minutes > 0`, but only 271 carry
  `status = 'late'` — the other 134 are `present` or `half_day` *and* late. Defining
  lateness by `status` undercounts by **33%**. `status` and `late_minutes` answer
  different questions and the metric uses the latter.
- **`leave_days_taken`.** `leave_requests.status` distributes as approved 117, rejected 97,
  **auto_cancelled 92**, pending 12. A naive count of all rows overstates leave taken by
  nearly 3×. Only `approved` counts.

One honest caveat: `employment_status` is currently `active` for all 90 rows, so the
`headcount` filter is a no-op today. It stays in the definition because `exit_date` exists
and leavers will appear; a metric that is accidentally correct is not correct.

Adding a metric is a one-file change and requires a test asserting its number against a
known fixture. Metrics are the product; they get the same care as payroll code.

### 4.4 Money and dates

- Amounts are `decimal`, formatted at the boundary only, in **₹ with Indian digit
  grouping**. The summary prompt states this explicitly — Gemini's default output was
  observed to format as `$84,200`.
- `payroll_items.month_year` is a `YYYY-MM` **string**, not a date. Range filters compare
  lexically, which is safe for that format but must be written down.
- Today's date is injected into the planning prompt. Without it ox-alpha resolved "this
  year" to 2025.

---

## 5. Request contract

New endpoint, in **`backend/routes/api/protected/search.php`** — protected, not the
public `/api/ai/chat` route.

```
POST /api/search/ask
{ "question": "compare average net pay by department" }
```

```jsonc
// 200
{
  "plan":    { "entity": "payroll", "metric": "avg_net_pay",
               "group_by": "department", "filters": {}, "limit": 20 },
  "columns": [ { "key": "department", "label": "Department", "type": "text" },
               { "key": "avg_net_pay", "label": "Avg net pay", "type": "money" },
               { "key": "n",           "label": "Employees",  "type": "number" } ],
  "rows":    [ { "department": "Engineering", "avg_net_pay": "91575.93", "n": 5 } ],
  "notes":   [ "Excludes 1 payroll item not yet processed (draft run, Aug 2026)." ],
  "summary": null,           // filled by a second call; null until then
  "truncated": false
}
```

```jsonc
// 422 — refused, and this is a first-class outcome
{ "error": "unsupported_question",
  "message": "I can't answer that from your HR data.",
  "detail":  "No metric matches 'headcount by nationality' — nationality is not a field this system stores." }
```

The `plan` is returned to the client **on purpose**: the user must be able to see what was
computed. Every serious NL-BI product shows the derived query, because an unverifiable
number in payroll is worse than no number.

The summary is a second call, `POST /api/search/ask/summary`, taking the plan and rows.
Split so the table can render before the summary exists.

---

## 6. Backend components

| Component | Responsibility |
|---|---|
| `SemanticLayer` | entity / dimension / metric definitions. Data only, no behaviour. |
| `QueryPlanner` | prompt assembly + model call + JSON extraction. Returns a plan or a refusal. |
| `PlanValidator` | rejects any entity, metric, dimension or filter not in `SemanticLayer`. |
| `QueryPlanExecutor` | plan → Eloquent builder → rows. The only place a query is built. |
| `AnswerSummariser` | rows → one sentence, on the primary provider. Failure is non-fatal. |
| `SearchAskController` | orchestrates, gates on hierarchy, logs to `ai_chat_logs`. |

Authorization reuses the existing gate: hierarchy level ≤ 10, mirroring
`AiChatController::ASSISTANT_MAX_HIERARCHY_LEVEL` and `hasStrictAdminAccess()` on the
frontend. Payroll entities carry an additional check so a non-payroll admin cannot reach
salary figures through this path when they cannot reach them through the UI.

Rate limiting: a new `search.ask` limiter, separate from `ai.chat`.

---

## 7. Frontend

### 7.1 Entering AI mode

`CommandBar` gains an `aiMode: boolean` state and a toggle in the input row (sparkle icon,
label "AI"). Entry points: clicking the toggle, or `Tab` from an empty query. `Esc` exits
AI mode first, and closes the palette on a second press.

The existing scopes (`@` people, `>` actions, `#` records) are unchanged and unavailable
while in AI mode — they are a different retrieval model.

### 7.2 Layout

The overlay widens `max-w-xl → max-w-4xl` with a transition, and the results region grows.
Regular mode is untouched.

### 7.3 The rainbow glow

A conic-gradient border on the search field, animated by rotating a registered custom
property.

- Colours come from **new tokens in `frontend/src/styles/theme.css`** (`--ai-glow-1` …
  `--ai-glow-5`), defined for both themes. **No hex literals in the component** — the
  project has zero `dark:` classes and colours resolve through CSS variables.
- Implemented with `@property --ai-glow-angle` + `@keyframes`, so the animation runs on
  the compositor rather than in JS.
- **`prefers-reduced-motion: reduce` renders a static gradient border, no rotation.**
  `theme.css` already carries two reduced-motion blocks; this follows them.
- The glow is decorative: `aria-hidden`, and it never becomes the only indicator that AI
  mode is active. The toggle's pressed state and the placeholder text carry that meaning
  for screen-reader and high-contrast users.

### 7.4 Results

A new `AiAnswerTable` component:

- column types drive alignment and formatting — `money` right-aligned in ₹, `number`
  right-aligned, `text` left
- the derived plan is shown as a collapsible "How this was calculated" line
- `notes[]` render as footnotes beneath the table
- actions: **Copy as CSV**, **Open full view** (deep-links to the relevant module with
  filters pre-applied where one exists)
- the table scrolls inside its own `overflow-x: auto` container; the overlay never scrolls
  horizontally

### 7.5 Loading and empty states

- 0 → 3.5s: skeleton table with the interpreted question echoed back
- table renders; summary slot shows a subtle shimmer until it arrives
- summary fails → the slot is **removed**, not filled with an apology. The table stands
  on its own.
- **empty result → "No records match" — never a table of zeros.** Where the underlying
  table itself is empty (`leave_ledger`, all three `hiring` tables today) the message
  says so explicitly: *"No leave ledger entries have been recorded yet."* "Your balance
  is 0 days" and "no ledger exists" are different facts and only one is true.

---

## 8. Model configuration

```
Planning     stealth/ox-alpha   reasoning: {effort: 'low'}, temperature: 0, max_tokens: 700
Summary      services.ai.model (Gemini)  temperature: 0.2, max_tokens: 800
```

Measured characteristics that the implementation depends on (2026-08-23):

- ox-alpha has `reasoning.mandatory: true` and `default_effort: "max"`. **Unpinned it is
  5.2s TTFT / 6.6s total.** Pinned to `low` with a short output: 1.5–2.2s TTFT, ~3s total.
- 5/5 raw parseable JSON with an explicit "RAW JSON only" instruction at temperature 0;
  correctly refused an out-of-domain question with a structured error.
- **`response_format: json_schema` strict is advertised but not honoured** — a strict run
  returned fenced markdown with keys absent from the schema. The planner therefore
  prompt-and-parses, with a fenced-block fallback extractor.
- 8/8 concurrent requests succeeded at ~2s each with no 429s.
- **Gemini `gemini-flash-latest` is a thinking model**: at `max_tokens: 120` it returned
  HTTP 200 with `finish_reason: "length"`, 0 completion tokens and empty content. The
  summary needs ≥ ~400.

`stealth/ox-alpha` is configured through `AI_SECONDARY_MODELS` with a fallback behind it.
Cloaked slugs are temporary and the ID changes when the cloak lifts; **the planner must
degrade to the next model rather than fail** when it disappears.

---

## 9. Refusals, and why they are a feature

The system refuses when the question maps to no entity, no metric, an excluded column, or
a filter it cannot express. A refusal names what was missing.

This is the property that makes the whole thing trustworthy. It is also the property most
likely to be filed as a bug. It is not one: the alternative to a refusal is a confident
wrong number, and the 10–31% production accuracy figure for unmodeled text-to-SQL is what
that alternative looks like in practice.

**Coverage grows by adding metrics, never by loosening validation.**

---

## 10. Testing

- **Golden plan set** — ~40 question → expected-plan pairs in `tests/Feature/Ai/`, run in
  CI. Catches silent regression when the model changes or disappears. The model call is
  faked; this tests the layer, not the vendor.
- **Metric correctness** — each metric asserted against a seeded fixture with a
  hand-computed expected number. `avg_net_pay` specifically asserts that an unprocessed
  row is excluded.
- **Tenancy** — a plan executed as org A never returns an org B row, asserted per entity.
- **Authorization** — a non-admin gets 403; a non-payroll admin cannot reach payroll
  metrics.
- **Refusals** — out-of-domain, excluded-column and unknown-metric questions each return
  422 with a named reason.
- **Frontend** — AI mode toggle, expanded layout, table rendering, empty vs zero states,
  reduced-motion glow, and summary-failure removing the slot.

Per project convention, gate on **new failing test names** against the committed
baselines, never on failure counts.

---

## 11. Out of scope

- Writes of any kind. AI mode reads. It cannot approve leave, run payroll or edit a record.
- Charts. Tables only; visualisation is a later question.
- Multi-turn conversation. Each question is independent; follow-ups are a later question.
- Employee-facing access. Admin-tier only for v1.
- Changes to `AdminChatBubble` or `AiToolRegistry`.

---

## 12. Known data conditions at time of writing

Recorded so the first demo is not mistaken for a bug:

- `payroll_items` holds 7 rows across 2 departments. Payroll answers will be thin and
  correct rather than rich.
- `leave_ledger` is empty — balance questions answer "no data recorded".
- All three hiring tables are empty — hiring answers answer "no data recorded".
- One employee (u74, a test account) has no department and appears as `(unassigned)`.
- **Run #3 (2026-04) is a `locked` run containing 0 items**, left over from the 2026-08-24
  cleanup. It is not deleted; removing a payroll run was not authorised. It will show as a
  run with no payroll data.

---

## 13. Open questions

1. Should `(unassigned)` employees appear as their own row in grouped results, or be
   excluded with a note? Current lean: **own row** — a hidden 1 is how headcount drifts.
2. Row cap for v1 — proposed 500, with `truncated: true` surfaced in the UI rather than a
   silent cut.
3. Should the empty locked run #3 be removed? Requires a separate decision.
