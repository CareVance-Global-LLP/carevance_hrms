# AI mode — query grammar v2 (capability expansion)

**Date:** 2026-08-24
**Supersedes:** the v1 plan shape in `2026-08-24-ai-mode-design.md` §5
**Status:** contract — every component implements exactly this

v1 answered: one entity, one metric, one `group_by`, equality filters. That could
not express *"who was absent more than 3 days last month"* — the user's own first
example. v2 is the grammar that can.

**Unchanged and non-negotiable:** the model still picks from named definitions and
never authors an aggregation. Expanding the vocabulary is not the same as letting it
write SQL. Everything still executes through Eloquent so `BelongsToOrganization`'s
global scope applies structurally.

---

## 1. The plan shape

```jsonc
{
  "entity":   "payroll",              // required, one of SemanticLayer::entities()
  "mode":     "aggregate",            // "aggregate" | "list"   (default "aggregate")

  // aggregate mode — 1..4 metrics, rendered as columns
  "metrics":  ["avg_net_pay", "total_gross"],

  // list mode — 1..8 columns from the entity's list_columns allow-list
  "columns":  ["name", "department", "joining_date"],

  "group_by": ["department", "month"], // 0..2 dimensions (aggregate mode only)

  "filters": [
    { "field": "month",        "op": "eq",       "value": "2026-07" },
    { "field": "joining_date", "op": "period",   "value": "this_year" },
    { "field": "pan",          "op": "is_null" },
    { "field": "net_pay",      "op": "between",  "value": [50000, 90000] },
    { "field": "name",         "op": "contains", "value": "sharma" },
    { "field": "status",       "op": "in",       "value": ["absent", "half_day"] }
  ],

  // threshold on an AGGREGATE — becomes HAVING. This is what makes
  // "more than 3 days" expressible.
  "having": [
    { "metric": "absent_days", "op": "gt", "value": 3 }
  ],

  "sort":  { "by": "absent_days", "dir": "desc" },  // by = a metric, dimension or column
  "limit": 20
}
```

Refusal shape is unchanged: `{"error": "<one sentence>"}`.

## 2. Operators

| op | value | Applies to |
|---|---|---|
| `eq` / `neq` | scalar | dimension, column, metric (having) |
| `gt` / `gte` / `lt` / `lte` | number or date | numeric/date dimension, column, metric |
| `between` | `[low, high]` | numeric/date |
| `contains` | string | text only — `LIKE %v%`, with `%` and `_` escaped |
| `in` / `not_in` | array (max 50) | any |
| `is_null` / `is_not_null` | — | any |
| `period` | period token (§3) | date dimension/column only |

**Escaping is mandatory on `contains`.** An unescaped `%` returns the whole table —
the same bug `SearchController` already guards against.

## 3. Period tokens

Resolved **server-side** against `now()`, never by the model. The model emits the
token; `PeriodResolver` turns it into a concrete range.

```
today · yesterday
this_week · last_week
this_month · last_month
this_quarter · last_quarter
this_year · last_year
last_7_days · last_30_days · last_90_days · last_12_months
```

Plus explicit forms: `"2026-07"` (a month), `"2026"` (a year),
`"2026-07-01..2026-07-31"` (an inclusive range).

`PeriodResolver::resolve(string $token): ?array{start: string, end: string}` returns
`Y-m-d` bounds, or **null** for an unrecognised token — which is a refusal, never a
guess. A wrong date range silently answers a different question than the one asked.

**`payroll_items.month_year` is a `YYYY-MM` string**, not a date. Dimensions declare
`date_format: 'Y-m'` or `'Y-m-d'` and the executor compares in the column's own
format. Comparing a `Y-m-d` bound against a `Y-m` column matches nothing.

## 4. Semantic layer shape (extended)

```php
'payroll' => [
    'label' => 'Payroll',
    'model' => PayrollItem::class,
    'joins' => [                       // applied before any dimension join
        ['users', 'users.id', '=', 'payroll_items.user_id'],
    ],
    'metrics'    => [ /* as v1, plus `format` */ ],
    'dimensions' => [ /* as v1, plus `type` and `date_format` */ ],
    'list_columns' => [                // row mode allow-list
        'name'       => ['label' => 'Employee',  'select' => 'users.name',            'type' => 'text'],
        'net_pay'    => ['label' => 'Net pay',   'select' => 'payroll_items.net_pay',  'type' => 'money'],
        'month'      => ['label' => 'Month',     'select' => 'payroll_items.month_year','type' => 'text'],
    ],
],
```

**Dimension gains `type`** — `text | number | date | money` — which decides
which operators are legal on it. `contains` on a number is refused.

**Every entity MUST expose an `employee` dimension** where the row belongs to a
person. Grouping by employee is what turns "how many" into **"who"**, and "who"
is most of what an admin asks.

**`list_columns` is the row-mode allow-list.** Never `SELECT *`. Statutory
identifiers (PAN/UAN/ESI), bank details and password hashes appear in no entity's
list_columns, at any role.

## 5. Validation rules

`PlanValidator` refuses, by name, anything that is not exactly in the layer:

1. unknown entity / metric / dimension / list column
2. `mode: list` with `group_by`, or `mode: aggregate` with `columns`
3. more than 4 metrics, 8 columns, or 2 `group_by` dimensions
4. an operator illegal for the field's `type` (`contains` on a number)
5. `between` whose value is not a 2-element array; `in` with more than 50 values
6. a `having` naming a metric not in `metrics`
7. a `sort.by` naming nothing in metrics/group_by/columns
8. an unresolvable period token

`limit`: `> 0 ? min(500, n) : 20`. **Zero and negative both mean default** — an
explicit `0` clamped to 1 is what made "headcount by department" return one row.

## 6. Execution rules

- `mode: aggregate` → `SELECT <dims>, <metric aggregates> … GROUP BY <dims>`
- `mode: list` → `SELECT <list columns> …`, no grouping
- `having` applies to the aggregate expression, not a re-derived one
- **Row cap**: fetch `limit + 1`, report `truncated`, never cut silently
- **Null dimension values** render as the dimension's `null_label`, as their own
  row. A hidden group is how a total stops adding up.
- An empty result is `rows: []`. **Never a zero row** — "no records" and "zero" are
  different facts and only one of them is true.
- Every applied metric `note`, and every applied period ("July 2026"), is returned
  in `notes[]` so the reader can see what was actually computed.

## 7. Response shape

Unchanged from v1 except `columns` may now be many:

```jsonc
{
  "plan":    { /* the normalised plan, echoed for inspection */ },
  "columns": [ {"key","label","type"}, … ],
  "rows":    [ { … }, … ],
  "notes":   ["Excludes payroll items not yet processed (net pay 0).",
              "Period: 1 Jul 2026 – 31 Jul 2026"],
  "summary": null,
  "truncated": false
}
```

## 8. Worked examples that MUST work

| Question | Plan |
|---|---|
| who was absent more than 3 days last month | `{entity:attendance, metrics:[absent_days], group_by:[employee], filters:[{field:date,op:period,value:last_month}], having:[{metric:absent_days,op:gt,value:3}], sort:{by:absent_days,dir:desc}}` |
| compare avg net pay by department and month | `{entity:payroll, metrics:[avg_net_pay], group_by:[department,month]}` |
| headcount and average net pay by department | *two entities — refuse, and say so* |
| list employees who joined this year | `{entity:employees, mode:list, columns:[name,department,joining_date], filters:[{field:joining_date,op:period,value:this_year}]}` |
| employees with no bank account | `{entity:employees, mode:list, columns:[name,department], filters:[{field:bank_account,op:is_null}]}` |
| top 5 departments by total gross in July 2026 | `{entity:payroll, metrics:[total_gross], group_by:[department], filters:[{field:month,op:period,value:"2026-07"}], sort:{by:total_gross,dir:desc}, limit:5}` |
| late arrivals by employee last 30 days | `{entity:attendance, metrics:[late_count], group_by:[employee], filters:[{field:date,op:period,value:last_30_days}], sort:{by:late_count,dir:desc}}` |
| leave taken by type this year | `{entity:leave, metrics:[leave_days_taken], group_by:[leave_type], filters:[{field:start_date,op:period,value:this_year}]}` |
| everyone's PAN number | *refuse — not an exposed column* |
| headcount by nationality | *refuse — no such dimension* |

The last two matter as much as the first eight. Coverage grows by adding
definitions that can be tested; it never grows by loosening validation.

---

# Part 2 — Total coverage (v3)

v2's grammar is right. v2's *layer* was not: seven hand-written entities against a
schema of **221 tables, 160 org-scoped, 80 with data, 2,612 columns**. Under 10% of
what an admin can ask about. Hand-writing the rest is not a plan.

The layer is therefore **derived from the schema**, with hand-written overrides where
the naive definition is wrong.

## 9. Derivation

`SchemaIntrospector` walks every org-scoped table and produces, per table:

- **entity** — key from the table name, label humanised (`payroll_items` → "Payroll items")
- **dimensions** — one per non-excluded column; `type` from the SQL type
  (`varchar|text` → text, `int|numeric|decimal` → number, `date|timestamp` → date,
  a `*_id` with a FK → a joined label dimension)
- **metrics** — `count` always; `sum_X` / `avg_X` / `min_X` / `max_X` for every
  numeric column; `money` format when the column is `decimal` and named like an amount
- **joins** — from real foreign keys, so cross-entity questions resolve
- **list_columns** — every non-excluded column

Derivation is cached (`SemanticLayer::cached()`), rebuilt on migration, never computed
per request.

## 10. The exclusion list is global and structural

Applied to EVERY table, at every role, by pattern — not remembered per entity:

```
password · remember_token · *_token · *_secret · api_key
pan · uan · esi · aadhaar · pf_number
account_number · ifsc · bank_account*
google_id · google_token · google_refresh_token
```

An excluded column is not a dimension, not a list column, not filterable. The refusal
names it: "PAN is not available through this tool." This replaces per-entity vigilance
with one rule that cannot be forgotten on entity 81.

## 11. Overrides beat derivation

`MetricOverrides` holds every case where the derived definition is WRONG. A derived
`avg_net_pay` is a plain `AVG(net_pay)` — which returns ₹76,313.27 where the truth is
₹91,575.93.

Known overrides, all verified against the live database on 24 Aug 2026:

| Entity.metric | Derived (wrong) | Override |
|---|---|---|
| `payroll.avg_net_pay` | `AVG(net_pay)` | `… WHERE net_pay > 0` — excludes unprocessed items |
| `payroll.total_gross` | `SUM(gross_salary)` | same exclusion, for consistency |
| `attendance.late_count` | `COUNT WHERE status='late'` | `WHERE late_minutes > 0` — status misses 134 of 405 |
| `leave.leave_days_taken` | `COUNT(*)` | `WHERE status='approved'` — auto_cancelled is 92 of 318 |
| `employees.department` | `report_group_id` raw | join `groups` — there is no departments table |
| `payroll.department` | `department_id` raw | join `groups` |

**An override is added whenever a wrong answer is found.** That is the maintenance
model: coverage is derived, correctness is curated, and the curated set only grows.

## 12. Honesty about derived metrics

A derived metric is naive by construction, so the answer must say so:

- every metric carries `origin: 'derived' | 'curated'`
- `notes[]` states the definition actually used, e.g. `"avg_net_pay = AVG(net_pay), no exclusions"`
- when a derived aggregate's input contains zeros or nulls, a note says how many were
  included — that is the ₹76,313 failure caught at read time rather than shipped
- the returned `plan` remains inspectable in the UI

The user can then say "exclude the zeros", and that becomes a curated override.

## 13. Retrieval — why the whole catalogue is never sent

80 entities and 2,612 columns will not fit a prompt usefully. Planning is therefore
two-stage:

1. **`EntityRetriever::forQuestion(string $q): array`** — LOCAL, no model call.
   Scores every entity by keyword overlap against its table name, column names,
   labels and a synonym map (`salary|pay|ctc → payroll`, `absent|present|late →
   attendance`, `who|people|staff|employee → employees`). Returns the top 5.
2. Only those entities' catalogues go into the planner prompt.

This keeps the prompt at roughly 1-2k tokens regardless of schema size, which is what
holds planning near the measured ~3s.

If retrieval returns nothing above a floor score, the question is refused — with the
entities it *did* consider, so the user can rephrase.

## 14. What still gets refused, and why that is not narrowness

Only two categories:

1. **Excluded by policy** — §10. The data exists; we will not expose it.
2. **Not in the schema at all** — "headcount by nationality" when nothing stores
   nationality.

Anything else that exists in an org-scoped table is answerable. A refusal for any
other reason is a bug in the layer, not a feature.
