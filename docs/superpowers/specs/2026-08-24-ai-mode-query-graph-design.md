# AI mode — query graph (v3 grammar)

**Date:** 2026-08-24
**Status:** approved. Implementation plan: `docs/superpowers/plans/2026-08-24-ai-mode-query-graph.md`
**Supersedes:** `2026-08-24-ai-mode-grammar-v2.md` §1–§8 (the plan shape and its
worked examples). Part 2 of that document — §9–§14, derivation, exclusions,
overrides, honesty and retrieval — stays in force unchanged.

**Sub-project 1 of 3.** Read-only. The other two are scoped at the end of this
document and get their own specs.

---

## 1. What this is for

An admin types anything, in any phrasing, about anything the software holds, and
gets an answer they can check.

> "make me a table with who's on leave with the productivity greater than these and
> compare with today's present employees"

That question is the acceptance test for this design. v2 refuses it — v2 allows one
entity per plan, and this needs three: leave, activity sessions, attendance. It also
needs a metric computed on one entity used as a *threshold* on another, and two cohorts
shown together.

**The admin never types syntax.** The grammar below is internal. The model compiles
free-form English into it; a validator refuses anything not named in the semantic
layer; an executor runs it through Eloquent. If an admin ever has to phrase a question
a particular way, this design has failed.

### Non-goals

- **The model never writes SQL, and never authors an aggregation.** Not to limit what
  can be asked — to stop the answer being confidently wrong. A naive `AVG(net_pay)`
  once returned ₹76,313 where the truth was ₹91,575; the fix was named definitions,
  and cleaning the data did not fix the number.
- **No mutation.** Read-only, entirely. Writes are sub-project 3.
- **No prose answers.** "Is my attrition bad?" is a conversation, not a table. That is
  sub-project 2.

---

## 2. The coverage contract

Derivation walks every org-scoped table: **160 tables, 2,612 columns** (80 hold data
today). That is the whole product surface, not a fixed report list. Composition across
it is what this grammar adds.

**"Org-scoped" means a model using `BelongsToOrganization`, and the tracker domain is
not one.** Queried against the live database, `activity_sessions`, `activities`,
`time_entries` and `screenshots` carry **no `organization_id`** — they hang off
`user_id`, and all four models lack the trait. So derivation cannot see them, and the
acceptance-test question in §1 is unanswerable until that changes. `TenantIsolationTest`
never caught it because it fails when a model owning a table that *has*
`organization_id` lacks the trait, and these have no such column.

Giving those four tables structural tenancy is therefore **Task 0** of the
implementation plan, not a footnote — and it is worth doing whether or not AI mode ever
ships, because employee monitoring data with no structural org scoping is a gap in its
own right.

**Scoping a table is also what makes it queryable, so the two decisions must be taken
separately.** Derivation reads trait-using models, which means the trait doubles as the
switch that admits a table to the vocabulary. `screenshots` needs the first and must not
get the second: no metric here touches it, and its columns (`filename`, `thumbnail`,
`captured_at`, `device_id`) would let an admin ask the assistant to list employee
monitoring records. The exclusion list in §10 is column-level and blocks none of those.

So §10 gains a **table-level** exclusion alongside its column-level one, and
`screenshots` is its first entry. Fixing an isolation gap must never widen what the
assistant can see as a side effect.

Exactly three things are not answerable, and each one says which it is:

| Refusal | Meaning | Example |
|---|---|---|
| `withheld` | The data exists; policy will not expose it, at any role | PAN, UAN, ESI, Aadhaar, bank details, password hashes (§10) |
| `not_recorded` | Nothing in the schema stores it | "headcount by nationality" |
| `not_a_data_question` | Needs judgment, not a number | "is my attrition bad?" → hand to sub-project 2 |

**Any other refusal is a bug in the layer, not a feature.** A fourth category appearing
in production means a definition is missing, and the fix is to add it — never to
loosen validation.

These three are the **user-facing** taxonomy: reasons a question cannot be answered,
each phrased for the admin who asked it. They are distinct from **plan rejections** —
`StepValidator` refusing an unknown metric, a forward reference, a fifth step, an
ambiguous join path. A plan rejection means the *model* produced something invalid, not
that the question was unanswerable, and the two must not share a message: telling an
admin "there is no metric called avg_productivity" when the real problem is that the
planner mis-named a metric that does exist teaches them the product is missing a
feature it has. A plan rejection retries the planning call once, then surfaces as
`not_a_data_question` with the original text preserved.

---

## 3. The grammar

A plan is a **pipeline of pre-aggregated steps** plus an **output block**.

```jsonc
{
  "steps": [
    { "as": "productivity",
      "entity": "activity",
      "per": "employee",
      "metrics": ["productive_ratio"],
      "filters": [{ "field": "started_at", "op": "period", "value": "last_30_days" }] },

    { "as": "on_leave",
      "entity": "leave",
      "per": "employee",
      "filters": [{ "field": "date", "op": "period", "value": "today" }],
      "having":  [{ "ref": "productivity.productive_ratio", "op": "gt", "value": 70 }] },

    { "as": "present_today",
      "entity": "attendance",
      "per": "employee",
      "filters": [{ "field": "date",   "op": "period", "value": "today" },
                  { "field": "status", "op": "in",     "value": ["present", "late"] }] }
  ],

  "output": {
    "compare": ["on_leave", "present_today"],
    "on": "employee",
    "columns": ["name", "department", "productivity.productive_ratio"],
    "sort": { "by": "productivity.productive_ratio", "dir": "desc" },
    "limit": 50
  }
}
```

A simple question is a **one-step pipeline with no `compare`** — so this grammar
subsumes v1 and v2 rather than sitting beside them. "Average net pay by department" is
one step, `per: department`, one metric.

### Step fields

| Field | Rules |
|---|---|
| `as` | unique identifier, referenced by later steps and by `output` |
| `entity` | one key from `SemanticLayer::entities()` |
| `per` | the dimension this step aggregates to — **one row per key, always** |
| `metrics` | 0–4 named metrics from the entity |
| `filters` | 0–8, operators per v2 §2, period tokens per v2 §3 |
| `having` | 0–4 thresholds on this step's own metrics, or on an earlier step's via `ref` |
| `limit` | not permitted on a step — only on `output` (see §5) |

**A step with no metrics is a membership step**, and that is deliberate, not an
oversight — `on_leave` above contributes *who is on leave today*, nothing more. Cohort
membership is half of most comparison questions, and forcing a meaningless metric onto
it just to satisfy the shape would put a number on the screen that nobody asked for.

### Output fields

`mode` is implied: `compare` present → comparison; `metrics` only → aggregate;
`columns` of raw fields → list. `on` names the key the compared steps are aligned by,
and must be a `per` that **every** compared step aggregates to.

**`from` names the step the output is drawn from when there is no `compare`.** A
two-step pipeline where the first step exists only to supply a `having.ref` has an
otherwise ambiguous output — `from` settles it. Required whenever `steps` has more than
one entry and `compare` is absent; ignored (and refused) when `compare` is present.

---

## 4. The fan-out guarantee

This is the load-bearing idea, and the reason for the shape.

An employee has many attendance rows and many leave rows. Join those two tables
directly and every row multiplies: a `SUM` over the join inflates, silently, with no
error anywhere. It is the same class of failure as the ₹76,313 average, but harder to
catch, because no individual definition is wrong.

> **Two steps may be joined only on a key both aggregate to. Because each step is
> already one row per key, every join is 1:1 and cannot fan out.**

That is a structural property, not a validation rule somebody has to remember. It is
also why `per` is mandatory on every step and why a step may not carry its own `limit`
— a step is a complete aggregate over its filtered rows, or it is a wrong number.

**Joins *inside* a step are a different problem** and belong to `JoinResolver`: a step
on `activity_sessions` grouped `per employee` needs the FK path to `users`, and a
filter on department needs the path to `groups`. Rules:

- the path is built only from **real foreign keys** derived by `SchemaIntrospector`;
- **at most 2 hops**;
- **an ambiguous path is refused by name**, never resolved by picking the shortest —
  "there are two ways to relate assets to departments; say which" is a better answer
  than a number computed down a path nobody chose.

---

## 5. Validation

`StepValidator` refuses, by name, anything not exactly in the layer. Everything from
v2 §5 still applies per step. New rules:

1. `steps` is 1–4. `as` values are unique.
2. `per` must be a dimension the entity actually exposes. **Every entity that carries a
   person exposes `employee`** (v2 §4) — that is what turns "how many" into "who".
3. A `having.ref` must name **a declared step and a named metric on that step**. Never
   a new expression, never a step declared later — references point backwards only, so
   the pipeline is a DAG by construction.
4. `output.on` must be a `per` shared by every step in `output.compare`. With no
   `compare` and more than one step, `output.from` is **required** and must name a
   declared step; supplying both `from` and `compare` is refused rather than one
   silently winning.
5. `output.columns` may reference `step.metric` for any declared step, or a list column
   of a compared step's entity. 1–10 columns.
6. An excluded column is refused as **`withheld`**, distinct from "unknown field" — the
   data exists and we will not show it, which is a different sentence to "there is no
   such column", and the difference matters to whoever reads it.
7. `output.limit`: `> 0 ? min(500, n) : 20`. **Zero and negative both mean the
   default.** This bug has been fixed twice; do not reintroduce it.
8. **Intermediate row cap: 5,000 per step, and exceeding it REFUSES.** The final output
   may be truncated and say so; an intermediate step may not. A silently truncated
   intermediate changes the final answer while looking complete — the one place where
   truncation is not a lesser evil but a wrong result.

---

## 6. Ambiguity is asked about, not guessed

"Productivity greater than these" does not say greater than what, or over what period.
Guessing a threshold produces a table that looks right and answers a different
question.

So the planner may return, instead of a plan:

```jsonc
{ "clarify": "Greater than what productivity score, and over which period?" }
```

The client renders it as a question and keeps the admin's original text so the answer
appends rather than replaces. **One clarifying question, then it commits** — an
interrogation is worse than a stated assumption. If the admin's reply still does not
resolve it, the planner picks the most likely reading and **states the assumption in
`notes[]`**.

---

## 7. Two-phase request

`~10s` was accepted for a complex question, **with visible progress**. This codebase
has no real-time transport (`BROADCAST_CONNECTION=log`; chat polls), and queueing an
interactive query would need a worker that local `.env` files do not run.

So the existing two-call split (`ask` then `summary`) extends to three, and progress
falls out for free:

| Call | Returns | Budget |
|---|---|---|
| `POST /search/ask/plan` | the validated plan, or `{clarify}`, or a refusal | ~3s |
| `POST /search/ask/run` | columns, rows, notes, truncated | ~2–7s |
| `POST /search/ask/summary` | one sentence (unchanged) | ~6s, non-blocking |

The client renders the step list from the plan and narrates it — "reading activity
sessions… matching against leave… comparing with today's attendance" — so the wait is
legible rather than a spinner. No queue, no SSE, no new transport.

This split has a second benefit worth naming: **the admin sees what is about to be
computed before it runs.** That is the verifiability story, and it is the same
propose-then-act shape sub-project 3 needs for writes.

---

## 8. Execution

`PipelineExecutor` runs steps in declaration order (references point backwards, so
that is topological), then performs the output join.

- **Everything stays in Eloquent.** `BelongsToOrganization`'s global scope is the only
  thing standing between AI mode and a cross-tenant answer, and it applies structurally
  only through the query builder. No `DB::raw` over a whole query.
- **Null `per` values get their own row**, labelled by the dimension's `null_label`. A
  hidden group is how a total stops adding up.
- **An empty result is `rows: []`, never a zero row.** "No records" and "zero" are
  different facts and only one of them is true.
- **A date filter compares in the column's own `date_format`.**
  `payroll_items.month_year` is a `YYYY-MM` string; a `Y-m-d` bound against it matches
  nothing, silently.
- **`having` applies to the aggregate expression**, not a re-derived one.

### `notes[]`

Assembled by the executor, which is the only place that can see what the query did:

- every curated metric's caveat;
- the resolved period in words ("1 Jul 2026 – 31 Jul 2026");
- **derived-metric honesty (v2 §12)**: `origin: derived` metrics state the definition
  used and how many zero or null inputs were included. Most metrics are derived now, so
  this is the main defence against the next ₹76,313;
- any assumption the planner stated under §6.

---

## 9. Response shape

What `POST /search/ask/run` returns. The envelope is v2 §7's, unchanged except that
`columns` may now carry a cohort:

```jsonc
{
  "plan":    { /* the pipeline, echoed for inspection */ },
  "columns": [ { "key": "cohort", "label": "Cohort", "type": "text" }, … ],
  "rows":    [ { "cohort": "On leave", "name": "…", "department": "…", … }, … ],
  "notes":   ["productive_ratio = productive seconds / classified seconds (neutral counted in the total)",
              "Period: 26 Jul 2026 – 24 Aug 2026"],
  "summary": null,
  "truncated": false
}
```

**A comparison is one table with a cohort column** — every person a row, tagged with
which cohort they fall in. Sorting, filtering and CSV export keep working unchanged,
and it reads correctly when the two cohorts contain different people, which is the
normal case.

The plan stays inspectable in the UI. A payroll figure nobody can check is worse than
no figure, and now that most metrics are derived, the plan is the only thing telling a
reader what was and was not excluded.

---

## 10. Retrieval

v2 §13 unchanged in principle, with two corrections found while checking this design
against the code:

- **`EntityRetriever` has no productivity vocabulary.** The map routes payroll,
  attendance, leave, people, assets, work and hiring; nothing routes "productivity",
  "efficiency", "activity" or "utilisation" to `activity_sessions`. The acceptance-test
  question would retrieve two of its three entities today. One-line addition, but this
  is the hole that reads as "the AI can't do it" when the grammar was fine.
- **Top-5 is too tight for a pipeline.** A three-step question needs three entities
  plus the grouping entity. Raise the default to **8**; `$top` already exists, so this
  is tuning, not a rewrite.

Retrieval finding nothing is still a refusal that names what it considered, read off
`EntityRetriever::scoreAll()`.

---

## 11. Components

Reusable unchanged — all four green (434 passing on `--filter=Ai`):
`PeriodResolver`, `SchemaIntrospector`, `MetricOverrides`, `EntityRetriever`
(plus the two §10 tweaks).

| Component | Job | State |
|---|---|---|
| `SemanticLayer` | derived + curated + cached | v2 Task 13, unchanged |
| `JoinResolver` | real-FK path within a step; refuses ambiguity by name | new |
| `StepValidator` | per-step + cross-step reference validation | replaces `PlanValidator`'s target |
| `PipelineExecutor` | DAG order, 1:1 joins, notes assembly | replaces `QueryPlanExecutor`'s target |
| `QueryPlanner` | retrieval → prompt → plan or `{clarify}` | v2 Task 16, retargeted |
| `SearchAskController` | three-phase plan / run / summary | extended |
| `AiAnswerTable` | cohort column rendering, plan inspector | v2 Task 18, extended |

### Effect on the v2 implementation plan

`docs/superpowers/plans/2026-08-24-ai-mode-v2.md` is partly superseded:

- **survive as written:** Task 13 (derivation), 16 (retrieval + prompt), 18 (frontend
  types), 19 (golden plans);
- **retargeted:** Tasks 14 and 15 build against this grammar, not v2's. Building v2's
  single-entity validator and executor first would be throwaway work;
- **corrected:** v2 §8's row "headcount and average net pay by department → *refuse,
  two entities*" is now a two-step pipeline that **must work**. A spec that refuses what
  the product promises is worse than no spec.

---

## 12. Testing

- **The acceptance-test question is a committed fixture.** The three-step example in §1
  validates, executes, and returns a cohort-tagged table.
- **A fan-out regression test.** Two one-to-many entities joined on employee, asserting
  the summed metric equals the single-entity aggregate. This is the test that would have
  caught the whole class of bug this design exists to prevent.
- **Refusal fixtures for all three categories** in §2, each asserted to refuse *for the
  stated reason*. A plan refused by the wrong rule is a test that passes through the bug
  it exists to catch.
- **An ambiguous question returns `{clarify}`**, not a plan and not a guess.
- **An intermediate cap breach refuses**; only `output` truncates.
- **Tenant isolation**: every step, in a pipeline, under a second organisation's user.
- Gate on failing test **names** against `.github/baselines/`, never counts — backend
  carries 36 known failures, frontend 49.

---

## 13. The other two sub-projects

Scoped here so the shape is agreed, specced separately.

### Sub-project 2 — one front door

`/api/ai/chat` (`AiChatService` + `AiToolRegistry`, function-calling, prose +
`sources` linking each number to its screen) and `/api/search/ask` are two assistants
today. ⌘K should be one: free-form in, and the right *kind* of answer out — prose for a
judgment question, a table for a data question, a clarifying question when genuinely
ambiguous.

The rule that matters: **a refusal falls back to prose, never to a made-up number.**
Today a non-data question gets a bare 422 and a dead end.

**Navigation lands here too, not in sub-project 3.** "Take me to the leave settings",
"where do I configure biometric devices" — these mutate nothing, and `AiToolRegistry`
already returns `sources` carrying a `route` per tool, which is how the chatbot links
each number back to its screen. Answering "which screen" is the same capability pointed
at a question instead of a number. It must **offer** the jump rather than navigate
under the admin, and it must never invent a route: an unknown screen says so, because a
confident link to a 404 reads as a broken product.

### Sub-project 3 — write actions, reviewed before they happen

"Change the org setting to this" — proposed by the assistant, **reviewed by the admin,
applied only on approval.** Requirements captured from the conversation:

1. **Propose → admin reviews → apply.** Nothing mutates without an explicit approval.
2. **The proposal states what changes AND how the system behaves afterwards** — a
   consequence preview, not a field diff. "This raises casual leave from 6 to 8 for 12
   people; balances recalculate from the accrual ledger, and 3 are mid-notice-period so
   their rate is unaffected."
3. **Mutations go through the existing real endpoints**, never straight to models.
   There are 0 Laravel policies in this codebase — authorization, validation and
   maker-checker all live inline in controllers, so bypassing them loses every guard at
   once.
4. **Payroll stays read-and-prepare only.** Never a state transition.
5. **Scope is any admin action the product already exposes** — org settings, leave
   types, roles, shift definitions, biometric device registration — reached through the
   endpoint the screen itself posts to. If a change has no existing endpoint, it is not
   in scope: the assistant does not become a second, unguarded write path into the
   database.

It is deliberately last: a write proposal is *built from a read*, and its diff is
computed by the query layer. Building it on an untrusted read layer means approving a
change calculated from a wrong number.
