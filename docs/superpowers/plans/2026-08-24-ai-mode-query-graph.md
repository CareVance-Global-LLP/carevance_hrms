# AI Mode v3 — Query Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **A dead agent returns `null`, not a failure.** Two agents died mid-phase building
> the v2 foundations; each wrote its test and died before the implementation, and the
> run continued because `null` is not an error. After every task: `ls` the file AND run
> the test. A green phase with a missing file has already happened twice here.

**Goal:** An admin types any question, in any phrasing, about anything the software
holds, and gets a table they can check — including questions that span several entities
and compare two groups of people.

**Architecture:** Free-form English → retrieval narrows 160 entities to 8 → the model
compiles a **pipeline of pre-aggregated steps** (never SQL, never a new aggregate) → a
validator refuses anything not named in the semantic layer → an executor runs each step
to one row per key and joins them 1:1, through Eloquent so
`BelongsToOrganization`'s global scope applies structurally.

**Tech Stack:** Laravel 11 · PHPUnit 11 · React 18 + TypeScript · Vite · Vitest +
Testing Library · Tailwind (tokens via CSS variables)

**Spec:** `docs/superpowers/specs/2026-08-24-ai-mode-query-graph-design.md`

**Sub-project 1 of 3**, read-only. Sub-project 2 (one front door, plus navigation) and
sub-project 3 (write actions behind an admin review gate) are scoped in the spec's §13
and get their own plans.

---

## Global Constraints

- **Never hand-write `where('organization_id', ...)`.** 97 models use
  `BelongsToOrganization`, which applies a global scope already. Cross-tenant access is
  explicit and greppable: `withoutOrganizationScope()`, `forOrganization($id)`.
- **Everything executes through Eloquent.** No `DB::raw` over a whole query. The global
  scope is the only thing between AI mode and a cross-tenant answer, and it applies
  only through the query builder.
- **The model never authors an aggregation.** It picks named metrics. This is not a
  capability limit — it is why a number can be checked.
- **No hex literals in components.** Colours resolve through CSS variables in
  `frontend/src/styles/theme.css`. There are zero `dark:` classes in this codebase; do
  not add any.
- **`bg-blue-700` is the only brand fill that clears AA in both themes.** Not 600,
  never 800+. Text under ~14px uses `text-slate-600` or darker.
- **Money is `decimal`, never float. Round once, at the boundary.** Format as ₹ with
  Indian digit grouping.
- **No bare `catch {}`.** Use `frontend/src/lib/reportSilentError.ts` where swallowing
  is genuinely right.
- **Date-only columns cast as `'date:Y-m-d'`, never `'date'`.**
- **`payroll_items.month_year` is a `YYYY-MM` string**, not a date. Dimensions declare
  `date_format` and the executor compares in the column's own format.
- **Departments are the `groups` table.** People join via
  `employee_work_infos.report_group_id`; payroll via `payroll_items.department_id`.
  There is no `departments` table. `group_user` is a separate access grouping and must
  never answer "which department is X in".
- **Zero and negative both mean "use the default"** — for `output.limit` and for
  retrieval's `$top`. This bug has been fixed twice; do not reintroduce it.
- **Model config:** planner is `stealth/ox-alpha` with `reasoning: {effort: 'low'}`,
  `temperature: 0`. `max_tokens` is **raised to 1500** in Task 6 — a pipeline plan is
  several times a v2 plan, and a truncated plan parses as a refusal, which reads to the
  admin as "can't answer that" for a question the planner understood.
- **Gate on new failing test *names*** against `.github/baselines/`, never on failure
  counts. Backend carries 36 known failures, frontend 49.
- **Latency budget:** `plan` ~3s, `run` ~2–7s, `summary` ~6s non-blocking.

---

## Two spec corrections this plan makes

Both found by reading the schema rather than trusting the design.

### C1 — The spec's own example metric does not exist

Spec §1 and §3 use `{"entity": "activity_sessions", "metrics": ["avg_productivity_score"]}`.
There is **no `productivity_score` on `activity_sessions`**. That column lives on
**`payroll_items`, `decimal(5,2) default 0`** — the same table whose unprocessed rows sit
at zero, so a naive average understates it exactly the way `avg_net_pay` returned
₹76,313 instead of ₹91,575.

`activity_sessions` holds `classification` (`productive|unproductive|neutral`) and
`duration_seconds`, with per-org rules in `productivity_classifications`. So
productivity is a **ratio**, and it must be curated. Task 2 defines it, and the
acceptance-test plan becomes:

```jsonc
{ "as": "productivity", "entity": "activity", "per": "employee",
  "metrics": ["productive_ratio"],
  "filters": [{ "field": "started_at", "op": "period", "value": "last_30_days" }] }
```

### C2 — Retrieval cannot reach it

`EntityRetriever`'s synonym map covers payroll, attendance, leave, people, assets, work
and hiring. Nothing routes "productivity", "efficiency", "activity" or "utilisation"
anywhere. The acceptance-test question retrieves two of its three entities today. Task 2
fixes this alongside the metric, because a metric nothing can retrieve is a metric that
does not exist as far as an admin is concerned.

---

## A note on test-body density

Tasks 0–4 carry **complete test code**: they are the foundation and the validator, where
a wrong assumption propagates into every task after it, and where the assertions are
fully determined by the schema and the spec.

Tasks 5–9 carry **named tests with their contract stated, and bodies for the
load-bearing ones only**. That is deliberate, not an omission. Those bodies depend on
interfaces created in Tasks 3–4 that do not exist yet, and pre-writing them would
produce code that cannot run verbatim while reading as though it could. Each named test
states one specific fact to assert; write the body against the interface as it actually
lands.

**The exception is `test_joining_two_one_to_many_entities_does_not_inflate_a_metric` in
Task 5.** It is written out in full because it is the test this entire design exists to
pass, and it is the one an executor is most likely to weaken into something that passes
trivially.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `database/migrations/…_add_organization_id_to_tracker_tables.php` | structural tenancy for the tracker domain | 0 |
| `app/Models/{Activity,ActivitySession,Screenshot,TimeEntry}.php` | `BelongsToOrganization`, so derivation can see them | 0 |
| `app/Services/Ai/SemanticLayer.php` | derived + curated + cached catalogue; the only vocabulary | 1 |
| `app/Services/Ai/MetricOverrides.php` | every case where derivation is wrong | 2 |
| `app/Services/Ai/EntityRetriever.php` | narrow 160 entities to 8, locally | 2 |
| `app/Services/Ai/JoinResolver.php` | real-FK path between two tables; refuse ambiguity | 3 |
| `app/Services/Ai/StepValidator.php` | one step, plus cross-step references | 4 |
| `app/Services/Ai/PipelineExecutor.php` | DAG order, 1:1 joins, notes | 5 |
| `app/Services/Ai/QueryPlanner.php` | retrieval → prompt → plan or `{clarify}` | 6 |
| `app/Http/Controllers/Api/SearchAskController.php` | three-phase plan / run / summary | 7 |
| `frontend/src/services/api.ts` | `AskPlan` v3 type + the three calls | 8 |
| `frontend/src/components/search/AiAnswerTable.tsx` | cohort column, plan inspector | 8 |
| `tests/Fixtures/ai/golden-plans.json` | accepted and refused plans, pinned | 9 |

`PlanValidator.php` and `QueryPlanExecutor.php` are **replaced** by `StepValidator` and
`PipelineExecutor`. Delete them in Task 5's commit, once nothing references them —
leaving two validators in the tree is how a second, silent code path appears.

---

### Task 0: Structural tenancy for the tracker domain

**Files:**
- Create: `backend/database/migrations/2026_08_24_000001_add_organization_id_to_tracker_tables.php`
- Modify: `backend/app/Models/Activity.php`, `ActivitySession.php`, `Screenshot.php`, `TimeEntry.php`
- Modify: `backend/app/Console/Commands/CloseIdleTimers.php`, `CloseStaleTimers.php`, `backend/app/Jobs/ReclassifyProductivityJob.php`, `backend/app/Services/Attendance/AttendanceService.php` (the writer audit decides the final list — these are the ones known to need it)
- Modify: `backend/app/Services/Ai/SchemaIntrospector.php` (table-level exclusion, see below)
- Test: `backend/tests/Feature/TrackerTenancyTest.php`

**Interfaces:**
- Produces: four models using `BelongsToOrganization`, which is what
  `SchemaIntrospector::tenantScopedModels()` requires to derive an entity at all

**Why this is Task 0 and not a footnote.** Queried against the live database:

| Table | `organization_id` | `user_id` |
|---|---|---|
| `activity_sessions` | **no** | yes |
| `activities` | **no** | yes |
| `time_entries` | **no** | yes |
| `screenshots` | **no** | **no** (only `time_entry_id`) |

All four models exist; **none uses `BelongsToOrganization`**. Two consequences, and the
second matters more than this plan:

1. `tenantScopedModels()` iterates models using the trait, so the whole tracker domain
   is invisible to derivation. No productivity question is answerable — no synonym or
   metric fixes that.
2. **Four tables of employee monitoring data, `screenshots` among them, have no
   structural org scoping.** `TenantIsolationTest` cannot catch this: it fails when a
   model owning a table that *has* `organization_id` lacks the trait, and these have no
   such column, so they fell through the net entirely.

**The migration and the traits must land in the SAME commit.** The moment a table gains
`organization_id`, `TenantIsolationTest` starts requiring the trait on its model — split
them and the suite breaks between the two commits.

**`screenshots` gets tenancy but NOT a place in the AI catalogue, and that exclusion
lands in this same commit too.** Deriving entities from trait-using models means the
trait is also the switch that makes a table AI-queryable — so scoping `Screenshot`
would otherwise hand the assistant an entity whose columns are `filename`, `thumbnail`,
`captured_at` and `device_id`. The global exclusion list is column-level and covers
passwords, tokens, PAN, Aadhaar and bank details; nothing in it blocks a filename. An
admin could then ask the assistant to list employee screenshot records.

Screenshots are needed by no metric in this plan. They are in Task 0 solely because
employee monitoring images relying on a join for tenant isolation is a gap worth
closing. So `SchemaIntrospector` gains a **table-level** exclusion beside its
column-level one:

```php
/**
 * Tables that are scoped, but are not vocabulary. The trait is what makes a
 * table derivable, so a table that needs tenancy but must not be queryable
 * needs saying so here — otherwise fixing its isolation silently widens what
 * the assistant can see.
 */
private const EXCLUDED_TABLES = ['screenshots'];
```

Applied in `tenantScopedModels()`, and asserted: `derive()` must have no `screenshots`
key, and `SemanticLayer::entity('screenshots')` must be null. Excluding it wholesale is
correct rather than excluding `filename` — there is no question about screenshots this
tool should answer, so there is no column set worth curating.

- [ ] **Step 1: Write the failing test**

```php
<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\ActivitySession;
use App\Models\Organization;
use App\Models\Screenshot;
use App\Models\TimeEntry;
use App\Models\User;
use App\Traits\BelongsToOrganization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * The tracker domain was reachable only through user_id, which means tenancy
 * depended on every query remembering to join users. This asserts it is now a
 * property of the tables instead.
 */
class TrackerTenancyTest extends TestCase
{
    use RefreshDatabase;

    public function test_every_tracker_table_carries_an_organization_id(): void
    {
        foreach (['activity_sessions', 'activities', 'time_entries', 'screenshots'] as $table) {
            $this->assertTrue(
                Schema::hasColumn($table, 'organization_id'),
                "{$table} has no organization_id, so its tenancy is not structural"
            );
        }
    }

    public function test_every_tracker_model_is_organization_scoped(): void
    {
        foreach ([Activity::class, ActivitySession::class, Screenshot::class, TimeEntry::class] as $model) {
            $this->assertContains(
                BelongsToOrganization::class,
                class_uses_recursive($model),
                $model.' owns a table with organization_id but is not scoped'
            );
        }
    }

    public function test_a_query_cannot_see_another_organizations_sessions(): void
    {
        [$orgA, $adminA] = $this->orgWithAdmin('a');
        [$orgB, $adminB] = $this->orgWithAdmin('b');

        Auth::setUser($adminA);
        ActivitySession::create($this->sessionAttributes($adminA));

        Auth::setUser($adminB);
        $this->assertSame(0, ActivitySession::count(), 'org B saw org A activity');

        Auth::setUser($adminA);
        $this->assertSame(1, ActivitySession::count());
    }

    public function test_creating_a_session_stamps_the_acting_users_organization(): void
    {
        [$org, $admin] = $this->orgWithAdmin('c');
        Auth::setUser($admin);

        $session = ActivitySession::create($this->sessionAttributes($admin));

        $this->assertSame($org->id, $session->organization_id);
    }

    /**
     * The trait's global scope is deliberately a no-op with no authenticated
     * user, so console commands are not filtered to nothing. In a job that
     * default means querying across EVERY tenant — the same trap the payroll
     * jobs solve with Auth::setUser(), asserted by PayrollRunProcessingQueueTest.
     */
    public function test_the_reclassify_job_acts_as_a_user_rather_than_across_tenants(): void
    {
        $source = file_get_contents(app_path('Jobs/ReclassifyProductivityJob.php'));

        $this->assertStringContainsString('Auth::setUser', $source);
    }

    /** @return array{0: Organization, 1: User} */
    private function orgWithAdmin(string $slug): array
    {
        $org = Organization::create(['name' => 'Org '.$slug, 'slug' => 'org-'.$slug]);
        $admin = User::create([
            'name' => 'Admin '.$slug, 'email' => "admin-{$slug}@tracker.test",
            'password' => Hash::make('password123'), 'role' => 'admin',
            'organization_id' => $org->id,
        ]);

        return [$org, $admin];
    }

    /** @return array<string, mixed> */
    private function sessionAttributes(User $user): array
    {
        return [
            'user_id' => $user->id,
            'source' => 'desktop',
            'activity_kind' => 'app',
            'tool_type' => 'editor',
            'display_name' => 'VS Code',
            'classification' => 'productive',
            'started_at' => now()->subHour(),
            'ended_at' => now(),
            'duration_seconds' => 3600,
        ];
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && php artisan test --filter=TrackerTenancyTest`
Expected: FAIL — no `organization_id` column, no trait on any of the four models.

- [ ] **Step 3: Write minimal implementation**

The migration adds the column nullable, backfills, then indexes. Guarded with
`hasColumn`, because schema has drifted from migrations in this repo before
(`bank_transfer_batches`) and an unguarded add fails on a database that already has it.

```php
public function up(): void
{
    foreach (['activity_sessions', 'activities', 'time_entries', 'screenshots'] as $table) {
        if (! Schema::hasColumn($table, 'organization_id')) {
            Schema::table($table, function (Blueprint $t): void {
                $t->unsignedBigInteger('organization_id')->nullable()->after('id');
            });
        }
    }

    // Backfill from the owning user. Nullable and un-indexed until this has
    // run, so the index is built once over final values.
    foreach (['activity_sessions', 'activities', 'time_entries'] as $table) {
        DB::statement("
            UPDATE {$table} SET organization_id = users.organization_id
            FROM users WHERE users.id = {$table}.user_id
              AND {$table}.organization_id IS NULL
        ");
    }

    /*
     * screenshots has no user_id — only time_entry_id — so it backfills one hop
     * further. A screenshot with a null time_entry_id CANNOT be attributed and
     * is left null: it stays out of every scoped query, and nothing is deleted.
     * Destroying monitoring data to tidy a backfill is not a trade this
     * migration is entitled to make.
     */
    DB::statement('
        UPDATE screenshots SET organization_id = users.organization_id
        FROM time_entries
        JOIN users ON users.id = time_entries.user_id
        WHERE time_entries.id = screenshots.time_entry_id
          AND screenshots.organization_id IS NULL
    ');

    foreach (['activity_sessions', 'activities', 'time_entries', 'screenshots'] as $table) {
        Schema::table($table, function (Blueprint $t): void {
            $t->index('organization_id');
        });
    }
}
```

Then add `use BelongsToOrganization;` to all four models, and `organization_id` to each
`$fillable` **only if the model uses one** — the trait stamps the column on create, so
adding it to `$fillable` where the model does not need it invites a client to set it.

**Audit the 17 writers.** The trait resolves the organization from the authenticated
user, so anything running without one stamps nothing and queries every tenant:
`CloseIdleTimers`, `SanitizeCapturedUrls`, `ValidateIdleTimeData` and
`ReclassifyProductivityJob` all need `Auth::setUser($actor)` or an explicit
`forOrganization($id)`, exactly as `ProcessPayrollRunEmployees` does. The device-sync
paths (`IdempotentSync`, `ActivitySessionController`, `ScreenshotController`,
`TimeEntryController`) run authenticated and need no change — verify, do not assume.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && php artisan migrate          # tests use SQLite; the app uses Postgres — run it
php artisan test --filter="TrackerTenancy|TenantIsolation"
php artisan test                            # gate on NAMES vs .github/baselines/phpunit.txt
```
Expected: PASS, and **no new failing test names** — 17 writers touch these tables, so
this is the task most likely to move the baseline.

- [ ] **Step 5: Commit**

```bash
git add backend/database/migrations/2026_08_24_000001_add_organization_id_to_tracker_tables.php \
        backend/app/Models/Activity.php backend/app/Models/ActivitySession.php \
        backend/app/Models/Screenshot.php backend/app/Models/TimeEntry.php \
        backend/app/Console/Commands backend/app/Jobs/ReclassifyProductivityJob.php \
        backend/tests/Feature/TrackerTenancyTest.php
git commit -m "Give the tracker domain structural tenancy instead of relying on a user join"
```

---

### Task 1: SemanticLayer becomes derived, curated and cached

**Files:**
- Modify: `backend/app/Services/Ai/SemanticLayer.php`
- Test: `backend/tests/Unit/Ai/SemanticLayerDerivationTest.php`

**Interfaces:**
- Consumes: `SchemaIntrospector::derive()` (keyed by TABLE), `MetricOverrides::forEntity(string)` (keyed by CONCEPT)
- Produces:
  - `entities(): array<string, array>` — concept keys plus derived table keys
  - `entity(string $key): ?array`
  - `metric(string $entity, string $metric): ?array`
  - `dimension(string $entity, string $dimension): ?array`
  - `listColumn(string $entity, string $column): ?array`
  - `cached(): array`
  - `promptCatalogueFor(array $entityKeys): string`
  - `promptCatalogue(): string` — kept; `QueryPlannerTest` asserts the prompt contains `avg_net_pay` and no row data

**The keying decision, stated once so seven tasks do not each decide it.**
`derive()` keys by table (`payroll_items`); `MetricOverrides` keys by concept
(`payroll`). `entities()` returns **both**, concepts winning:

- the eight concept keys (`payroll`, `attendance`, `leave`, `employees`, `assets`,
  `work`, `hiring`, `activity`) keep their curated definitions, built as
  `derive()[table]` with `MetricOverrides::forEntity(concept)` merged over the top;
- every other org-scoped table appears under its own table-name key;
- **a table claimed by a concept does NOT also appear under its table name.** One table,
  one entity — otherwise the retriever offers the planner the same table twice and the
  prompt pays for the duplicate.

- [ ] **Step 1: Write the failing test**

```php
<?php

namespace Tests\Unit\Ai;

use App\Services\Ai\MetricOverrides;
use App\Services\Ai\SchemaIntrospector;
use App\Services\Ai\SemanticLayer;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Coverage is derived; correctness is curated. This test asserts the seam
 * between the two, because that seam is where a right number becomes a wrong
 * one — a merge that replaces a whole entity loses fifty derived metrics, and a
 * merge that ignores the override reintroduces the ₹76,313 average.
 */
class SemanticLayerDerivationTest extends TestCase
{
    public function test_a_curated_override_beats_derivation_without_deleting_its_siblings(): void
    {
        $metric = SemanticLayer::metric('payroll', 'avg_net_pay');

        $this->assertSame('curated', $metric['origin']);
        $this->assertContains(['payroll_items.net_pay', '>', 0], $metric['where']);

        // The override replaced ONE metric, not the table's whole metric set.
        $this->assertGreaterThan(5, count(SemanticLayer::entity('payroll')['metrics']));
    }

    public function test_a_derived_metric_declares_that_it_is_naive(): void
    {
        $metrics = SemanticLayer::entity('assets')['metrics'];
        $origins = array_column($metrics, 'origin');

        $this->assertContains('derived', $origins, 'derivation produced no derived metric at all');
        foreach ($metrics as $name => $metric) {
            $this->assertContains($metric['origin'], ['derived', 'curated'], "{$name} has no origin");
        }
    }

    public function test_the_concept_key_and_its_table_name_are_not_both_entities(): void
    {
        $this->assertNotNull(SemanticLayer::entity('payroll'));
        $this->assertNull(SemanticLayer::entity('payroll_items'));

        $this->assertNotNull(SemanticLayer::entity('activity'));
        $this->assertNull(SemanticLayer::entity('activity_sessions'));
    }

    public function test_an_excluded_column_is_not_reachable_by_any_route(): void
    {
        foreach (SemanticLayer::entities() as $key => $entity) {
            foreach (['dimensions', 'list_columns'] as $bucket) {
                foreach (array_keys($entity[$bucket]) as $name) {
                    $this->assertFalse(
                        SchemaIntrospector::isExcludedColumn($name),
                        "{$key}.{$bucket}.{$name} exposes an excluded column"
                    );
                }
            }
        }
    }

    public function test_every_person_bearing_entity_can_be_grouped_by_employee(): void
    {
        // Grouping by employee is what turns "how many" into "who", and "who" is
        // most of what an admin asks.
        foreach (['payroll', 'attendance', 'leave', 'activity'] as $key) {
            $this->assertNotNull(
                SemanticLayer::dimension($key, 'employee'),
                "{$key} cannot answer 'who' — it has no employee dimension"
            );
        }
    }

    public function test_coverage_is_the_schema_not_eight_tables(): void
    {
        $this->assertGreaterThan(70, count(SemanticLayer::entities()));
    }

    public function test_list_column_lookup_refuses_an_unknown_column(): void
    {
        $this->assertNotNull(SemanticLayer::listColumn('employees', 'name'));
        $this->assertNull(SemanticLayer::listColumn('employees', 'pan'));
        $this->assertNull(SemanticLayer::listColumn('employees', 'nationality'));
    }

    public function test_the_prompt_catalogue_carries_only_the_retrieved_entities(): void
    {
        $text = SemanticLayer::promptCatalogueFor(['payroll', 'attendance']);

        $this->assertStringContainsString('avg_net_pay', $text);
        $this->assertStringNotContainsString('asset_count', $text);
    }

    public function test_cached_does_not_re_derive(): void
    {
        SemanticLayer::cached();

        DB::enableQueryLog();
        SemanticLayer::cached();

        $this->assertSame([], DB::getQueryLog(), 'cached() went back to the database');
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && php artisan test --filter=SemanticLayerDerivationTest`
Expected: FAIL — `listColumn`, `cached` and `promptCatalogueFor` do not exist; `entity('activity')` is null.

- [ ] **Step 3: Write minimal implementation**

Keep the existing seven concept definitions **verbatim** as the curated half — they are
already verified against the live database, and re-deriving them is how a correct number
becomes a wrong one. Add `activity` (Task 2 fills its metrics).

```php
/** Concept key => the table it owns. A table here is NOT also its own entity. */
private const CONCEPT_TABLES = [
    'employees' => 'employee_work_infos',
    'payroll' => 'payroll_items',
    'attendance' => 'attendance_records',
    'leave' => 'leave_requests',
    'assets' => 'assets',
    'work' => 'tasks',
    'hiring' => 'candidates',
    'activity' => 'activity_sessions',
];

public static function entities(): array
{
    $derived = SchemaIntrospector::derive();
    $entities = [];

    foreach (self::CONCEPT_TABLES as $concept => $table) {
        $base = $derived[$table] ?? null;

        if ($base === null) {
            continue; // the table is absent in this deployment; say nothing about it
        }

        $entities[$concept] = self::curate($concept, $base);
        unset($derived[$table]);   // one table, one entity
    }

    foreach ($derived as $table => $entity) {
        $entities[$table] = self::stampOrigins($entity);
    }

    return $entities;
}

/**
 * Merge PER KEY, never per entity. Replacing $base['metrics'] wholesale would
 * delete every derived metric on the table beside the one being corrected.
 */
private static function curate(string $concept, array $base): array
{
    $overrides = MetricOverrides::forEntity($concept);
    $entity = self::stampOrigins($base);

    foreach (['metrics', 'dimensions'] as $bucket) {
        foreach ($overrides[$bucket] as $name => $definition) {
            $entity[$bucket][$name] = $definition + ['origin' => 'curated'];
        }
    }

    return $entity;
}

private static function stampOrigins(array $entity): array
{
    foreach ($entity['metrics'] as $name => $metric) {
        $entity['metrics'][$name] = $metric + ['origin' => 'derived'];
    }

    return $entity;
}

/**
 * Schema-level, not tenant-level: the catalogue holds table and column names
 * and no tenant data, so one cache serves every organization. Keying it on
 * organization_id would multiply one identical catalogue by the tenant count.
 */
public static function cached(): array
{
    static $memo = null;

    return $memo ??= Cache::remember(
        'ai.semantic-layer.'.self::schemaFingerprint(),
        now()->addDay(),
        fn () => self::entities(),
    );
}

public static function listColumn(string $entity, string $column): ?array
{
    return self::entity($entity)['list_columns'][$column] ?? null;
}

public static function promptCatalogueFor(array $entityKeys): string
{
    $lines = [];

    foreach ($entityKeys as $key) {
        $entity = self::entity($key);

        if ($entity === null) {
            continue;
        }

        $lines[] = sprintf(
            "- %s (%s): metrics = [%s]; per = [%s]; columns = [%s]",
            $key,
            $entity['label'],
            implode(', ', array_keys($entity['metrics'])),
            implode(', ', array_keys($entity['dimensions'])),
            implode(', ', array_keys($entity['list_columns'])),
        );
    }

    return implode("\n", $lines);
}

public static function promptCatalogue(): string
{
    return self::promptCatalogueFor(array_keys(self::cached()));
}
```

`schemaFingerprint()` is a hash of table plus column names — cheap, and it rebuilds the
cache on any migration without anyone remembering to clear it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && php artisan test --filter="SemanticLayer|GoldenPlan"`
Expected: PASS. **`GoldenPlanTest` is the regression gate** — 22 committed plans written
in concept keys must still validate, which is what proves the keying decision held.

- [ ] **Step 5: Commit**

```bash
git add backend/app/Services/Ai/SemanticLayer.php backend/tests/Unit/Ai/SemanticLayerDerivationTest.php
git commit -m "Derive the semantic layer from the schema and curate what derivation gets wrong"
```

---

### Task 2: Productivity as a curated metric, and vocabulary that can reach it

**Files:**
- Modify: `backend/app/Services/Ai/MetricOverrides.php`
- Modify: `backend/app/Services/Ai/EntityRetriever.php`
- Test: `backend/tests/Unit/Ai/MetricOverridesTest.php`
- Test: `backend/tests/Unit/Ai/EntityRetrieverTest.php`

**Interfaces:**
- Produces: `MetricOverrides::all()` gains `activity.productive_ratio`,
  `activity.productive_hours`, `payroll.avg_productivity_score`
- Produces: `EntityRetriever::forQuestion()` default `$top` becomes **8**

**Why this task exists at all.** The acceptance-test question asks for productivity.
There is no productivity column on `activity_sessions` — there is `classification`
(`productive|unproductive|neutral`) and `duration_seconds`. The one column actually
called `productivity_score` is on `payroll_items`, `decimal(5,2) default 0`, so
averaging it includes every unprocessed payroll row at zero.

So: `productive_ratio` = productive seconds ÷ classified seconds, as a percentage.
Neutral time counts in the denominator and not the numerator — it is time worked that
was neither productive nor wasted, and excluding it would flatter every ratio. `idle` is
**not** a classification on this table (it appears on `time_entries`), so it cannot be
silently folded in here.

- [ ] **Step 1: Write the failing test**

```php
// tests/Unit/Ai/MetricOverridesTest.php — append

public function test_productive_ratio_is_a_ratio_of_seconds_not_a_stored_score(): void
{
    $metric = MetricOverrides::all()['activity.productive_ratio'];

    $this->assertSame('activity', $metric['entity']);
    $this->assertSame('number', $metric['type']);
    $this->assertSame('ratio', $metric['aggregate']);
    $this->assertArrayHasKey('numerator', $metric);
    $this->assertArrayHasKey('denominator', $metric);
    $this->assertNotNull($metric['note'], 'a ratio must say what its denominator is');
    $this->assertStringContainsString('neutral', $metric['note']);

    // `origin` is deliberately NOT asserted here: an override carries no origin
    // of its own — SemanticLayer::curate() stamps 'curated' when it merges one.
    // Asserting it on the raw array would pass for the wrong reason.
}

public function test_the_stored_productivity_score_excludes_its_default_zeros(): void
{
    // payroll_items.productivity_score is decimal(5,2) DEFAULT 0 on the same
    // table whose unprocessed rows carry net_pay 0. Averaging the zeros is the
    // ₹76,313 bug in a different column.
    $metric = MetricOverrides::all()['payroll.avg_productivity_score'];

    $this->assertContains(['payroll_items.productivity_score', '>', 0], $metric['where']);
    $this->assertNotNull($metric['note']);
}

public function test_every_override_qualifies_its_where_columns(): void
{
    // Derivation builds joins from real foreign keys, so a bare `status` is
    // ambiguous the moment an entity is joined. Postgres refuses it; a dialect
    // that resolves it silently picks a column nobody chose.
    foreach (MetricOverrides::all() as $key => $override) {
        foreach ($override['where'] ?? [] as $clause) {
            $this->assertStringContainsString('.', $clause[0], "{$key} has an unqualified where column");
        }
    }
}
```

```php
// tests/Unit/Ai/EntityRetrieverTest.php — append

public function test_productivity_vocabulary_reaches_the_activity_entity(): void
{
    foreach (['productivity', 'productive', 'efficiency', 'utilisation', 'utilization'] as $word) {
        $result = EntityRetriever::forQuestion($word, $this->canonicalCatalogue());

        $this->assertSame('activity', array_key_first($result), "'{$word}' did not reach activity");
    }
}

public function test_the_default_top_leaves_room_for_a_three_step_question(): void
{
    // A three-entity question plus the grouping entity needs four slots; five
    // left one spare and the fourth entity fell off the prompt.
    $question = 'who is on leave with productivity above 70 compared with todays present employees';

    $this->assertGreaterThanOrEqual(4, count(EntityRetriever::forQuestion($question, $this->canonicalCatalogue())));
}
```

`canonicalCatalogue()` gains an `activity` entry: `['label' => 'Activity', 'table' =>
'activity_sessions', 'metrics' => ['productive_ratio' => ['label' => 'Productive
ratio']], 'dimensions' => ['employee' => [...], 'classification' => [...]],
'list_columns' => ['display_name' => [...], 'duration_seconds' => [...]]]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && php artisan test --filter="MetricOverridesTest|EntityRetrieverTest"`
Expected: FAIL — the overrides do not exist; `productivity` retrieves nothing.

- [ ] **Step 3: Write minimal implementation**

```php
// MetricOverrides::all() — new entries

/*
 * activity_sessions carries classification (productive|unproductive|neutral)
 * and duration_seconds. There is no score column here; the one named
 * productivity_score is on payroll_items and defaults to 0.
 *
 * Neutral time is in the DENOMINATOR and not the numerator: it is time worked
 * that was neither productive nor wasted, and dropping it would flatter every
 * ratio on the platform.
 */
'activity.productive_ratio' => [
    'kind' => 'metric',
    'entity' => 'activity',
    'name' => 'productive_ratio',
    'label' => 'Productive %',
    'type' => 'number',
    'aggregate' => 'ratio',
    'numerator' => [
        'column' => 'activity_sessions.duration_seconds',
        'where' => [['activity_sessions.classification', '=', 'productive']],
    ],
    'denominator' => [
        'column' => 'activity_sessions.duration_seconds',
        'where' => [['activity_sessions.classification', 'in', ['productive', 'unproductive', 'neutral']]],
    ],
    'scale' => 100,
    'note' => 'Productive seconds as a percentage of classified seconds. Neutral time counts in the total, not as productive. Unclassified sessions are excluded entirely.',
],

'activity.productive_hours' => [
    'kind' => 'metric',
    'entity' => 'activity',
    'name' => 'productive_hours',
    'label' => 'Productive hours',
    'type' => 'number',
    'aggregate' => 'sum',
    'column' => 'activity_sessions.duration_seconds',
    'where' => [['activity_sessions.classification', '=', 'productive']],
    'scale' => 1 / 3600,
    'note' => 'Sum of productive session time, in hours.',
],

'payroll.avg_productivity_score' => [
    'kind' => 'metric',
    'entity' => 'payroll',
    'name' => 'avg_productivity_score',
    'label' => 'Avg productivity score',
    'type' => 'number',
    'aggregate' => 'avg',
    'column' => 'payroll_items.productivity_score',
    'where' => [['payroll_items.productivity_score', '>', 0]],
    'note' => 'Excludes payroll items with no score recorded (stored as 0), the same exclusion avg_net_pay applies.',
],
```

`aggregate: 'ratio'` is a new kind the executor must support (Task 5). It is the
honest shape: a ratio is two aggregates and a division, and modelling it as one
`AVG` of anything would be wrong.

In `EntityRetriever`, add to `SYNONYMS` and change the default:

```php
// productivity|efficiency|activity|utilisation -> activity
'productivity' => ['activity', 'activity_sessions'],
'productive' => ['activity', 'activity_sessions'],
'efficiency' => ['activity', 'activity_sessions'],
'utilisation' => ['activity', 'activity_sessions'],
'utilization' => ['activity', 'activity_sessions'],
'activity' => ['activity', 'activity_sessions'],
'app' => ['activity', 'activity_sessions'],
'website' => ['activity', 'activity_sessions'],

private const DEFAULT_TOP = 8;   // was 5 — a three-step question needs four slots
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && php artisan test --filter="MetricOverrides|EntityRetriever"`
Expected: PASS — 47 EntityRetriever tests plus the two new ones.

- [ ] **Step 5: Commit**

```bash
git add backend/app/Services/Ai/MetricOverrides.php backend/app/Services/Ai/EntityRetriever.php backend/tests/Unit/Ai
git commit -m "Define productivity as a ratio of classified seconds, and let questions reach it"
```

---

### Task 3: JoinResolver

**Files:**
- Create: `backend/app/Services/Ai/JoinResolver.php`
- Test: `backend/tests/Unit/Ai/JoinResolverTest.php`

**Interfaces:**
- Consumes: `SchemaIntrospector::derive()` — each entity carries
  `'joins' => [[ '<table> as <alias>', '<alias>.<col>', '=', '<table>.<fk_col>' ], …]`
  built from real foreign keys
- Produces:
  - `pathsBetween(string $fromTable, string $toTable, int $maxHops = 2): array` — every distinct FK path
  - `resolve(string $fromTable, string $toTable): array` — the one path, or throws `UnsupportedQuestionException`

Depth 1 is already handled: derivation declares one join per foreign key on the entity
itself, applied before any dimension is read. **This task exists for depth 2** — a step
on `activity_sessions` needing department, which is `activity_sessions.user_id → users`
then `employee_work_infos.report_group_id → groups`.

- [ ] **Step 1: Write the failing test**

```php
<?php

namespace Tests\Unit\Ai;

use App\Services\Ai\JoinResolver;
use App\Services\Ai\UnsupportedQuestionException;
use Tests\TestCase;

/**
 * A join path nobody chose is the quietest way to a wrong number: the query
 * runs, the shape is right, and the rows came from a relationship the question
 * never meant. So two paths is a refusal, not a coin toss.
 */
class JoinResolverTest extends TestCase
{
    public function test_a_direct_foreign_key_is_one_hop(): void
    {
        $path = JoinResolver::resolve('payroll_items', 'users');

        $this->assertCount(1, $path);
        $this->assertSame('users', $path[0]['table']);
    }

    public function test_it_reaches_a_table_two_hops_away(): void
    {
        // activity_sessions -> users -> employee_work_infos is how an activity
        // question reaches a department at all.
        $path = JoinResolver::resolve('activity_sessions', 'employee_work_infos');

        $this->assertCount(2, $path);
        $this->assertSame(['users', 'employee_work_infos'], array_column($path, 'table'));
    }

    public function test_it_refuses_to_go_three_hops(): void
    {
        $this->assertSame([], JoinResolver::pathsBetween('activity_sessions', 'groups', 2));
    }

    public function test_two_paths_are_a_refusal_that_names_both(): void
    {
        // payroll_items reaches groups by department_id AND through the
        // employee's report_group_id. They answer different questions.
        $this->expectException(UnsupportedQuestionException::class);

        try {
            JoinResolver::resolve('payroll_items', 'groups');
        } catch (UnsupportedQuestionException $e) {
            $this->assertStringContainsString('department_id', $e->getDetail());
            $this->assertStringContainsString('report_group_id', $e->getDetail());
            throw $e;
        }
    }

    public function test_no_path_is_a_refusal_naming_both_tables(): void
    {
        $this->expectException(UnsupportedQuestionException::class);
        JoinResolver::resolve('assets', 'candidates');
    }

    public function test_a_path_is_deterministic(): void
    {
        $first = JoinResolver::resolve('activity_sessions', 'employee_work_infos');

        for ($i = 0; $i < 3; $i++) {
            $this->assertSame($first, JoinResolver::resolve('activity_sessions', 'employee_work_infos'));
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && php artisan test --filter=JoinResolverTest`
Expected: FAIL with "Class JoinResolver not found".

- [ ] **Step 3: Write minimal implementation**

Breadth-first over the FK graph, collecting **all** paths at the shallowest depth that
reaches the target, then refusing unless exactly one survives.

```php
public static function resolve(string $fromTable, string $toTable): array
{
    $paths = self::pathsBetween($fromTable, $toTable);

    if ($paths === []) {
        throw new UnsupportedQuestionException(sprintf(
            'There is no relationship between %s and %s that this tool can follow.',
            $fromTable, $toTable
        ));
    }

    if (count($paths) > 1) {
        // Naming the columns is the whole point: "say which" is actionable,
        // "ambiguous join" is not.
        throw new UnsupportedQuestionException(sprintf(
            'There are %d ways to relate %s to %s (%s) — that question needs to say which.',
            count($paths), $fromTable, $toTable,
            implode(', ', array_map(fn (array $p): string => self::describe($p), $paths))
        ));
    }

    return $paths[0];
}
```

`pathsBetween()` returns a list of paths; each path is a list of
`['table' => string, 'alias' => string, 'on' => [left, '=', right]]`. Cap the frontier
at `$maxHops` and never revisit a table within one path.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && php artisan test --filter=JoinResolverTest`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/Services/Ai/JoinResolver.php backend/tests/Unit/Ai/JoinResolverTest.php
git commit -m "Resolve join paths from real foreign keys, refusing ambiguity by name"
```

---

### Task 4: StepValidator

**Files:**
- Create: `backend/app/Services/Ai/StepValidator.php`
- Test: `backend/tests/Unit/Ai/StepValidatorTest.php`

**Interfaces:**
- Consumes: `SemanticLayer`, `PeriodResolver::resolve()`, `SchemaIntrospector::isExcludedColumn()`, `JoinResolver::resolve()`
- Produces: `validate(array $plan): array` — the normalised pipeline, or throws `UnsupportedQuestionException`

Normalised output, which the executor may assume without defensive code:

```php
[
  'steps' => [
     ['as' => string, 'entity' => string, 'per' => string,
      'metrics' => list<string>,
      'filters' => list<array{field: string, op: string, value: mixed,
                              period?: array{token: string, start: string, end: string}}>,
      'having'  => list<array{metric: ?string, ref: ?string, op: string, value: mixed}>],
     …
  ],
  'output' => ['compare' => list<string>, 'from' => ?string, 'on' => ?string,
               'columns' => list<string>, 'metrics' => list<string>,
               'sort' => ?array{by: string, dir: 'asc'|'desc'}, 'limit' => int],
]
```

**The rules.** Everything in v2 §5 per step, plus:

1. `steps` is 1–4; `as` values unique.
2. `per` must be a dimension the entity exposes.
3. A `having.ref` names **a declared, earlier step and a named metric on it**. Backwards
   only — that is what makes the pipeline a DAG by construction rather than by a
   cycle check.
4. `output.on` must be a `per` shared by every compared step. With no `compare` and more
   than one step, `output.from` is required. Both present is a refusal.
5. `output.columns` is 1–10.
6. An excluded column refuses as **`withheld`** — distinct from "unknown field". The
   data exists and we will not show it; that is a different sentence from "there is no
   such column", and the difference matters to whoever reads it.
7. `output.limit`: `> 0 ? min(500, n) : 20`.
8. `contains` escapes `%` and `_` **here**, not in the executor, so a second caller
   cannot forget. An unescaped `%` returns the whole table.

- [ ] **Step 1: Write the failing test**

```php
<?php

namespace Tests\Unit\Ai;

use App\Services\Ai\StepValidator;
use App\Services\Ai\UnsupportedQuestionException;
use Tests\TestCase;

class StepValidatorTest extends TestCase
{
    private StepValidator $validator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->validator = new StepValidator;
    }

    /** @return array<string, mixed> */
    private function acceptanceTestPlan(): array
    {
        return [
            'steps' => [
                ['as' => 'productivity', 'entity' => 'activity', 'per' => 'employee',
                 'metrics' => ['productive_ratio'],
                 'filters' => [['field' => 'started_at', 'op' => 'period', 'value' => 'last_30_days']]],
                ['as' => 'on_leave', 'entity' => 'leave', 'per' => 'employee',
                 'filters' => [['field' => 'start_date', 'op' => 'period', 'value' => 'today']],
                 'having' => [['ref' => 'productivity.productive_ratio', 'op' => 'gt', 'value' => 70]]],
                ['as' => 'present_today', 'entity' => 'attendance', 'per' => 'employee',
                 'filters' => [['field' => 'date', 'op' => 'period', 'value' => 'today'],
                               ['field' => 'status', 'op' => 'in', 'value' => ['present', 'late']]]],
            ],
            'output' => ['compare' => ['on_leave', 'present_today'], 'on' => 'employee',
                         'columns' => ['name', 'productivity.productive_ratio'],
                         'sort' => ['by' => 'productivity.productive_ratio', 'dir' => 'desc']],
        ];
    }

    public function test_the_acceptance_test_question_validates(): void
    {
        $plan = $this->validator->validate($this->acceptanceTestPlan());

        $this->assertCount(3, $plan['steps']);
        $this->assertSame(20, $plan['output']['limit'], 'an absent limit must default, not clamp to 1');
    }

    public function test_a_period_token_is_resolved_here_not_passed_on(): void
    {
        $plan = $this->validator->validate($this->acceptanceTestPlan());
        $filter = $plan['steps'][0]['filters'][0];

        $this->assertArrayHasKey('period', $filter);
        $this->assertSame('last_30_days', $filter['period']['token']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}$/', $filter['period']['start']);
    }

    public function test_an_unresolvable_period_is_refused_rather_than_defaulted(): void
    {
        $plan = $this->acceptanceTestPlan();
        $plan['steps'][0]['filters'][0]['value'] = 'since_the_merger';

        $this->expectException(UnsupportedQuestionException::class);
        $this->validator->validate($plan);
    }

    public function test_a_forward_reference_is_refused(): void
    {
        $plan = $this->acceptanceTestPlan();
        $plan['steps'][0]['having'] = [['ref' => 'present_today.late_count', 'op' => 'gt', 'value' => 1]];

        $this->expectException(UnsupportedQuestionException::class);
        $this->validator->validate($plan);
    }

    public function test_a_ref_to_an_unnamed_metric_is_refused(): void
    {
        $plan = $this->acceptanceTestPlan();
        $plan['steps'][1]['having'][0]['ref'] = 'productivity.vibes';

        $this->expectException(UnsupportedQuestionException::class);
        $this->validator->validate($plan);
    }

    public function test_compare_requires_a_per_every_step_shares(): void
    {
        $plan = $this->acceptanceTestPlan();
        $plan['steps'][2]['per'] = 'status';   // no longer per-employee

        $this->expectException(UnsupportedQuestionException::class);
        $this->validator->validate($plan);
    }

    public function test_multi_step_without_compare_requires_from(): void
    {
        $plan = $this->acceptanceTestPlan();
        unset($plan['output']['compare'], $plan['output']['on']);

        $this->expectException(UnsupportedQuestionException::class);
        $this->validator->validate($plan);
    }

    public function test_both_from_and_compare_is_refused_rather_than_one_winning(): void
    {
        $plan = $this->acceptanceTestPlan();
        $plan['output']['from'] = 'on_leave';

        $this->expectException(UnsupportedQuestionException::class);
        $this->validator->validate($plan);
    }

    public function test_a_fifth_step_is_refused(): void
    {
        $plan = $this->acceptanceTestPlan();
        $plan['steps'][] = ['as' => 'a', 'entity' => 'assets', 'per' => 'status'];
        $plan['steps'][] = ['as' => 'b', 'entity' => 'work', 'per' => 'status'];

        $this->expectException(UnsupportedQuestionException::class);
        $this->validator->validate($plan);
    }

    public function test_asking_for_pan_is_refused_as_withheld_not_as_unknown(): void
    {
        $plan = $this->acceptanceTestPlan();
        $plan['output']['columns'] = ['name', 'pan'];

        try {
            $this->validator->validate($plan);
            $this->fail('PAN was not refused');
        } catch (UnsupportedQuestionException $e) {
            $this->assertSame('withheld', $e->getCategory());
            $this->assertStringContainsString('PAN', $e->getDetail());
        }
    }

    public function test_a_missing_dimension_is_refused_as_not_recorded(): void
    {
        $plan = $this->acceptanceTestPlan();
        $plan['steps'][2]['per'] = 'nationality';

        try {
            $this->validator->validate($plan);
            $this->fail('nationality was not refused');
        } catch (UnsupportedQuestionException $e) {
            $this->assertSame('not_recorded', $e->getCategory());
        }
    }

    public function test_a_percent_in_a_contains_value_is_escaped_here(): void
    {
        $plan = $this->acceptanceTestPlan();
        $plan['steps'][1]['filters'][] = ['field' => 'reason', 'op' => 'contains', 'value' => '100%'];

        $validated = $this->validator->validate($plan);
        $escaped = end($validated['steps'][1]['filters'])['value'];

        $this->assertSame('100\%', $escaped);
    }

    public function test_contains_on_a_number_is_refused_by_name(): void
    {
        $plan = $this->acceptanceTestPlan();
        $plan['steps'][0]['filters'][] = ['field' => 'duration_seconds', 'op' => 'contains', 'value' => '5'];

        $this->expectException(UnsupportedQuestionException::class);
        $this->validator->validate($plan);
    }

    public function test_a_step_may_not_carry_its_own_limit(): void
    {
        // A step is a complete aggregate over its filtered rows, or it is a
        // wrong number feeding everything downstream.
        $plan = $this->acceptanceTestPlan();
        $plan['steps'][0]['limit'] = 10;

        $this->expectException(UnsupportedQuestionException::class);
        $this->validator->validate($plan);
    }

    public function test_zero_and_negative_limits_both_mean_the_default(): void
    {
        foreach ([0, -3] as $requested) {
            $plan = $this->acceptanceTestPlan();
            $plan['output']['limit'] = $requested;

            $this->assertSame(20, $this->validator->validate($plan)['output']['limit']);
        }
    }

    public function test_an_error_shape_passes_straight_through(): void
    {
        $this->expectException(UnsupportedQuestionException::class);
        $this->validator->validate(['error' => 'I cannot answer that from your HR data.']);
    }
}
```

`UnsupportedQuestionException` gains `getCategory(): string` returning
`withheld|not_recorded|not_a_data_question|invalid_plan`, defaulting to `invalid_plan`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && php artisan test --filter=StepValidatorTest`
Expected: FAIL with "Class StepValidator not found".

- [ ] **Step 3: Write minimal implementation**

Validate in this order, because a later rule reads what an earlier one normalised:
entity → `per` → metrics → filters (resolving periods, escaping `contains`) → `having`
(refs backwards only) → output (`compare`/`from` exclusivity, `on` shared, columns,
sort target, limit).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && php artisan test --filter=StepValidatorTest`
Expected: PASS — 16 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/Services/Ai/StepValidator.php backend/app/Services/Ai/UnsupportedQuestionException.php backend/tests/Unit/Ai/StepValidatorTest.php
git commit -m "Validate the pipeline grammar, refusing by name and by category"
```

---

### Task 5: PipelineExecutor

**Files:**
- Create: `backend/app/Services/Ai/PipelineExecutor.php`
- Delete: `backend/app/Services/Ai/PlanValidator.php`, `backend/app/Services/Ai/QueryPlanExecutor.php`
- Test: `backend/tests/Feature/Ai/PipelineExecutorTest.php`

**Interfaces:**
- Consumes: a normalised plan from Task 4, `SemanticLayer`, `JoinResolver`
- Produces: `execute(array $plan): array{columns: list<array{key,label,type}>, rows: list<array>, notes: list<string>, truncated: bool}`

**The fan-out guarantee is this class's whole job.** Each step aggregates to one row per
`per` key *before* anything is joined, so every join is 1:1 and cannot multiply. Write
it so that property is visible in the code, not just in this paragraph.

Other rules: `having` applies to the aggregate expression, never a re-derived one;
`aggregate: 'ratio'` is two aggregates and a division; a null `per` value gets its own
row labelled by `null_label`; an empty result is `rows: []` and never a zero row;
**intermediate cap 5,000 per step REFUSES** while `output` truncates and says so.

- [ ] **Step 1: Write the failing test**

Set up two organizations exactly as `QueryPlanExecutorTest` does (explicit
`Organization::create` / `User::create` / `Group::create`, `RefreshDatabase`,
`Auth::setUser`) — no factories, matching house style.

```php
/**
 * THE test for this design. Joining two one-to-many entities on employee must
 * not multiply rows: 3 attendance rows x 2 leave rows is 6 in SQL and 1 here.
 * A pipeline that fails this returns a number that is wrong and looks fine.
 */
public function test_joining_two_one_to_many_entities_does_not_inflate_a_metric(): void
{
    $employee = $this->employeeWith(attendanceDays: 3, leaveDays: 2);

    $alone = $this->executor->execute($this->onePlan('attendance', 'present_days'));
    $joined = $this->executor->execute($this->comparePlan('attendance', 'leave'));

    $this->assertSame(
        $alone['rows'][0]['present_days'],
        collect($joined['rows'])->firstWhere('cohort', 'Attendance')['present_days'],
        'the join inflated the metric'
    );
}

public function test_a_having_ref_thresholds_on_an_earlier_steps_aggregate(): void;
public function test_a_ratio_metric_divides_two_aggregates_not_one(): void;
public function test_a_comparison_returns_one_table_with_a_cohort_column(): void;
public function test_an_intermediate_step_over_the_cap_refuses_rather_than_truncating(): void;
public function test_the_output_truncates_and_says_so(): void;
public function test_a_null_per_value_gets_its_own_row(): void;
public function test_an_empty_result_is_no_rows_not_a_zero_row(): void;
public function test_a_month_period_compares_in_the_columns_own_format(): void;
public function test_a_derived_metric_notes_how_many_zero_inputs_it_included(): void;
public function test_it_never_returns_another_organizations_rows(): void;
```

Each of the stubbed names above gets a full body following the same pattern as the
first: build fixture rows, execute, assert one specific fact.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && php artisan test --filter=PipelineExecutorTest`
Expected: FAIL with "Class PipelineExecutor not found".

- [ ] **Step 3: Write minimal implementation**

Shape:

```php
public function execute(array $plan): array
{
    $results = [];   // step alias => [ perKey => ['metric' => value, …] ]
    $notes = [];

    foreach ($plan['steps'] as $step) {
        $results[$step['as']] = $this->runStep($step, $results, $notes);
    }

    return $this->assemble($plan['output'], $results, $notes);
}
```

`runStep()` builds ONE Eloquent query: entity joins, then dimension joins via
`JoinResolver` where needed, filters, `GROUP BY` the `per` select, metric aggregates,
`HAVING` (own metrics inline, `ref` thresholds applied as a whitelist against the
earlier step's keys). It returns a map keyed by the `per` value — **one entry per key,
always**, which is where fan-out dies.

`assemble()` joins the step maps on `output.on` (a 1:1 array intersect, not a query),
tags each row with its cohort when `compare` is present, sorts, then takes
`limit + 1` to set `truncated`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && php artisan test --filter="PipelineExecutor|TenantIsolation"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git rm backend/app/Services/Ai/PlanValidator.php backend/app/Services/Ai/QueryPlanExecutor.php
git add backend/app/Services/Ai/PipelineExecutor.php backend/tests/Feature/Ai/PipelineExecutorTest.php
git commit -m "Execute the pipeline: one row per key before any join, so nothing fans out"
```

---

### Task 6: QueryPlanner — retrieval, the pipeline prompt, and asking back

**Files:**
- Modify: `backend/app/Services/Ai/QueryPlanner.php`
- Modify: `backend/tests/Feature/Ai/QueryPlannerTest.php`

**Interfaces:**
- Consumes: `EntityRetriever::forQuestion()`, `EntityRetriever::scoreAll()`, `SemanticLayer::cached()`, `SemanticLayer::promptCatalogueFor()`
- Produces: `plan(string $question): array` — a pipeline, `['clarify' => string]`, or `['error' => string]`

- **Retrieval returning nothing refuses and names what it considered**, read off
  `scoreAll()`. That is why `scoreAll` returns zero-scored entities instead of dropping
  them.
- **Ambiguity asks back, once.** "Productivity greater than these" does not say greater
  than what, or over what period; guessing a threshold produces a table that looks right
  and answers a different question. One clarifying question, then it commits — an
  interrogation is worse than a stated assumption. If the reply still does not resolve
  it, pick the likeliest reading and **state the assumption**, which Task 5 surfaces in
  `notes[]`.
- `max_tokens` → **1500**. `temperature: 0` and `reasoning: {effort: 'low'}` unchanged.
- The prompt still carries **no employee data** — `QueryPlannerTest` asserts it.

- [ ] **Step 1: Write the failing test**

```php
public function test_the_prompt_carries_the_retrieved_entities_and_no_others(): void;
public function test_retrieval_finding_nothing_refuses_and_names_what_it_considered(): void;
public function test_an_ambiguous_threshold_asks_back_instead_of_guessing(): void;
public function test_the_prompt_teaches_steps_per_having_and_compare(): void;
public function test_the_prompt_stays_under_two_thousand_tokens_on_the_full_schema(): void;
public function test_a_truncated_reply_is_a_refusal_not_a_half_plan(): void;
public function test_the_prompt_never_contains_employee_data(): void;   // keep
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && php artisan test --filter=QueryPlannerTest`

- [ ] **Step 3: Write minimal implementation**

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && php artisan test --filter="QueryPlanner|EntityRetriever"`

- [ ] **Step 5: Commit**

```bash
git add backend/app/Services/Ai/QueryPlanner.php backend/tests/Feature/Ai/QueryPlannerTest.php
git commit -m "Retrieve before planning, teach the pipeline grammar, and ask back when ambiguous"
```

---

### Task 7: Three-phase endpoint

**Files:**
- Modify: `backend/app/Http/Controllers/Api/SearchAskController.php`
- Modify: `backend/routes/api/protected/search.php`
- Modify: `backend/tests/Feature/Ai/SearchAskTest.php`

**Interfaces:**
- `POST /search/ask/plan` → `{plan}` | `{clarify}` | 422 `{error, category, message, detail}`
- `POST /search/ask/run` → `{plan, columns, rows, notes, summary: null, truncated}`
- `POST /search/ask/summary` → `{summary}` (unchanged)

Split this way because there is **no real-time transport** here
(`BROADCAST_CONNECTION=log`; chat polls) and queueing an interactive query needs a
worker local `.env` files do not run. The client renders the step list from the plan and
narrates it, so a ~10s wait is legible rather than a spinner. It also means the admin
sees what is about to be computed before it runs — the same propose-then-act shape
sub-project 3 needs.

`/run` **re-validates the plan it is given.** It is a client-supplied payload; trusting
it because `/plan` produced one earlier is how the validator gets bypassed.

`tool_calls_used` currently reads `$plan['metric']`, which no longer exists:

```php
'tool_calls_used' => collect($plan['steps'])
    ->flatMap(fn (array $step): array => array_map(
        fn (string $metric): string => $step['entity'].'.'.$metric,
        $step['metrics'],
    ))
    ->values()
    ->all(),
```

Both new routes keep `throttle:search.ask` (20/min).

**A plan rejection retries planning once, then surfaces as `not_a_data_question`** with
the admin's original text preserved. A `StepValidator` refusal with category
`invalid_plan` means the *model* emitted something invalid — a mis-named metric that
does exist — not that the question was unanswerable. Showing "there is no metric called
avg_productivity" for a metric the product has teaches the admin a feature is missing
when it is not. `withheld` and `not_recorded` are never retried: they are true the
second time.

- [ ] **Step 1: Write the failing test** — plan/run/summary each return their shape; a
      non-admin is refused on all three; `/run` refuses a tampered plan; the ask is logged;
      **an `invalid_plan` refusal re-plans exactly once and a `withheld` refusal does not
      retry at all**.
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Write minimal implementation**
- [ ] **Step 4: Run test to verify it passes** — `php artisan test tests/Feature/Ai`
- [ ] **Step 5: Commit**

```bash
git add backend/app/Http/Controllers/Api/SearchAskController.php backend/routes/api/protected/search.php backend/tests/Feature/Ai/SearchAskTest.php
git commit -m "Split ask into plan and run so a complex question can show its progress"
```

---

### Task 8: Frontend — v3 type, cohort column, step narration

**Files:**
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/components/search/AiAnswerTable.tsx`
- Modify: `frontend/src/components/search/GlobalCommandBar.tsx`
- Test: `frontend/src/components/search/AiAnswerTable.test.tsx`
- Test: `frontend/src/components/search/GlobalCommandBar.aiMode.test.tsx`

```ts
export type AskStep = {
  as: string;
  entity: string;
  per: string;
  metrics: string[];
  filters: { field: string; op: string; value?: unknown }[];
  having: { metric?: string; ref?: string; op: string; value: unknown }[];
};

export type AskPlan = {
  steps: AskStep[];
  output: {
    compare: string[];
    from: string | null;
    on: string | null;
    columns: string[];
    metrics: string[];
    sort: { by: string; dir: 'asc' | 'desc' } | null;
    limit: number;
  };
};
```

- **A comparison is one table with a cohort column** — every person a row, tagged with
  their cohort. Sorting, filtering and CSV export keep working unchanged, and it reads
  correctly when the two cohorts hold different people, which is the normal case.
- **Narrate the steps while `/run` is in flight**, derived from the plan: "reading
  activity sessions… matching against leave… comparing with today's attendance". A
  silent 10s reads as broken; a narrated one does not.
- **A `clarify` response renders as a question** and keeps the admin's original text so
  the answer appends rather than replaces.
- **The plan stays inspectable**, and a `derived`-origin note must be visible without
  opening it — most metrics are derived now, so that note is the main defence against
  the next ₹76,313.
- No hex literals, no `dark:` classes.

- [ ] **Step 1: Write the failing test** — cohort column renders; a clarify prompt
      renders as a question; step narration appears during load; a derived note is visible.
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Write minimal implementation**
- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/search && npx tsc --noEmit`
Expected: `tsc` at **0 errors** — the only thing that catches every other `AskPlan`
reader breaking on the shape change.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/api.ts frontend/src/components/search
git commit -m "Render cohort comparisons, narrate the steps, and keep the plan inspectable"
```

---

### Task 9: Golden set, acceptance test, fan-out regression

**Files:**
- Modify: `backend/tests/Fixtures/ai/golden-plans.json`
- Modify: `backend/tests/Feature/Ai/GoldenPlanTest.php`

- **The acceptance-test question is a committed fixture** — the three-step plan from C1
  validates, executes, and returns a cohort-tagged table.
- **Refusal fixtures for all three user-facing categories**, each asserted to refuse
  *for the stated reason*. A plan refused by the wrong rule is a test that passes
  through the bug it exists to catch.
- **Every curated override in `MetricOverrides::all()` appears in at least one fixture**,
  so a correction nobody exercises cannot rot.
- Keep the 22 v2 fixtures: each is a one-step pipeline now, which is exactly the proof
  that v3 subsumes v2 rather than replacing it.

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Write minimal implementation** (fixture rows)
- [ ] **Step 4: Run test to verify it passes** — `php artisan test --filter=Ai`
- [ ] **Step 5: Commit**

```bash
git add backend/tests/Fixtures/ai/golden-plans.json backend/tests/Feature/Ai/GoldenPlanTest.php
git commit -m "Pin the v3 worked examples, refusals and their reasons included"
```

---

## Verification for the whole plan

```bash
cd backend  && php artisan test --filter=Ai      # 434 passing today; must not fall
cd backend  && php artisan test                  # gate on NAMES vs .github/baselines/phpunit.txt
cd frontend && npx tsc --noEmit                  # must stay 0
cd frontend && npx vitest run                    # gate on NAMES vs the committed baseline
```

**Never judge these suites by failure count** — backend carries 36 known failures,
frontend 49:

```bash
node scripts/ci/test-baseline.mjs --junit <report.xml> \
  --baseline .github/baselines/phpunit.txt --check --label phpunit
```

**Task 0 adds one migration — run it.** `tsc`, `vitest` and the build cannot catch a
pending migration, and tests use SQLite while the app uses Postgres, so a backfill that
works in the suite can still be wrong against the real database:

```bash
cd backend && php artisan migrate
```

Task 0 is also the task most likely to move the test baseline — 17 files write to those
four tables. Check failing **names**, not counts, before and after it.
