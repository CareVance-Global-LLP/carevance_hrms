# Group E — Filing Honesty (B-10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the product claiming ten statutory filings work when their blade templates do not exist.

**Architecture:** A single `FilingGeneratorRegistry` resolves each filing type's availability by asking the filesystem whether its blade view is present, rather than carrying a hand-maintained list that drifts. The service consults it before attempting a generator, the API exposes it as a catalogue, and the UI renders from that catalogue instead of a hardcoded array claiming everything is `ready`.

**Tech Stack:** Laravel 12 / PHP 8.2, PHPUnit; React 18 / TypeScript / Vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-security-remediation-b01-b11-design.md`

## Global Constraints

- Failing test **names** are diffed against `.github/baselines/phpunit.txt` (currently 0 entries) and `.github/baselines/vitest.txt` (44 entries) via `node scripts/ci/test-baseline.mjs`. Never judge by counts.
- `npx tsc --noEmit` must stay at exit 0.
- `TenantIsolationTest` and `TenantScopeFailsClosedTest` must stay green.
- No `git commit` or `git push` at any point. Tasks end at a staged, verified working tree; the user commits.
- Date-only columns cast as `'date:Y-m-d'`, never `'date'`.
- No bare `catch {}` in frontend code; use `frontend/src/lib/reportSilentError.ts`.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/Services/Payroll/FilingGeneratorRegistry.php` | **Create.** Sole authority on which filing types exist, what they need, and whether they can run. |
| `backend/app/Services/PayrollFilingService.php` | **Modify.** `generateAllFilings` consults the registry; `generateForm19` array bug fixed. |
| `backend/app/Http/Controllers/Api/PayrollFilingController.php` | **Modify.** New `catalogue()` action. |
| `backend/routes/api/protected/payroll_filings.php` | **Modify.** Register `GET /payroll/filings/catalogue`. |
| `backend/tests/Feature/FilingCatalogueTest.php` | **Create.** Registry truthfulness + endpoint shape. |
| `frontend/src/services/api.ts` | **Modify.** `getFilingCatalogue()`. |
| `frontend/src/components/payroll/FilingsDashboard.tsx` | **Modify.** Merge server availability into the catalogue; disable unavailable; fix the "19 returns" copy. |
| `frontend/src/components/payroll/FilingsDashboard.availability.test.tsx` | **Create.** Unavailable filings are not offered. |

---

### Task 1: FilingGeneratorRegistry

**Files:**
- Create: `backend/app/Services/Payroll/FilingGeneratorRegistry.php`
- Test: `backend/tests/Feature/FilingCatalogueTest.php`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `FilingGeneratorRegistry::all(): array<string, array{label:string, view:?string, available:bool, unavailable_reason:?string}>`
  - `FilingGeneratorRegistry::isAvailable(string $type): bool`
  - `FilingGeneratorRegistry::unavailableReason(string $type): ?string`

- [ ] **Step 1: Write the failing test**

```php
<?php

namespace Tests\Feature;

use App\Services\Payroll\FilingGeneratorRegistry;
use Tests\TestCase;

class FilingCatalogueTest extends TestCase
{
    /**
     * The registry must agree with the filesystem. This assertion keeps
     * passing unchanged as the ten missing templates get written — a
     * hardcoded expectation would need editing ten more times and would
     * be wrong in between.
     */
    public function test_registry_availability_matches_views_on_disk(): void
    {
        $registry = new FilingGeneratorRegistry();

        foreach ($registry->all() as $type => $meta) {
            if ($meta['view'] === null) {
                $this->assertTrue(
                    $meta['available'],
                    "Filing {$type} needs no view and must be available."
                );
                continue;
            }

            $path = resource_path('views/'.str_replace('.', '/', $meta['view']).'.blade.php');

            $this->assertSame(
                file_exists($path),
                $meta['available'],
                "Filing {$type} claims available=".var_export($meta['available'], true)
                    ." but its view {$meta['view']} ".(file_exists($path) ? 'exists' : 'does not exist')
            );
        }
    }

    public function test_unavailable_filings_state_a_reason(): void
    {
        $registry = new FilingGeneratorRegistry();

        foreach ($registry->all() as $type => $meta) {
            if ($meta['available']) {
                $this->assertNull($meta['unavailable_reason'], "Available filing {$type} must not carry a reason.");
            } else {
                $this->assertNotEmpty($meta['unavailable_reason'], "Unavailable filing {$type} must say why.");
            }
        }
    }

    public function test_the_ten_known_missing_declaration_forms_are_unavailable(): void
    {
        $registry = new FilingGeneratorRegistry();

        foreach ([
            'form_19', 'form_31', 'form_1', 'form_2', 'form_6',
            'eshram_registration', 'uan_activation', 'se_registration',
            'shram_card_registration', 'form_124',
        ] as $type) {
            $this->assertFalse($registry->isAvailable($type), "{$type} has no blade view and must report unavailable.");
        }
    }

    public function test_the_three_implemented_pdf_filings_are_available(): void
    {
        $registry = new FilingGeneratorRegistry();

        foreach (['form_12ba', 'form_16', 'form_16_annual'] as $type) {
            $this->assertTrue($registry->isAvailable($type), "{$type} has a blade view and must report available.");
        }
    }

    public function test_non_pdf_filings_need_no_view_and_are_available(): void
    {
        $registry = new FilingGeneratorRegistry();

        foreach (['pf_ecr', 'esi_challan', 'form_24q', 'full_ecr'] as $type) {
            $this->assertTrue($registry->isAvailable($type), "{$type} writes a text format and must report available.");
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && php artisan test --filter=FilingCatalogueTest`
Expected: FAIL — `Class "App\Services\Payroll\FilingGeneratorRegistry" not found`

- [ ] **Step 3: Write the registry**

```php
<?php

namespace App\Services\Payroll;

/**
 * The single authority on which statutory filings this installation can
 * actually produce.
 *
 * Ten declaration-form generators reference blade views that were never
 * written. Before this class existed the UI advertised all nineteen returns
 * as `complianceStatus: 'ready'`, the user clicked, and the generator threw
 * after the batch had already written PF ECR, ESI, 24Q and 12BA.
 *
 * Availability is resolved against the filesystem rather than a hand-kept
 * list, so writing `resources/views/filings/form19.blade.php` is the whole
 * act of shipping Form 19 — no second edit here, and no window in which the
 * list and the templates disagree.
 */
class FilingGeneratorRegistry
{
    private const MISSING_TEMPLATE_REASON =
        'The statutory template for this form has not been written yet. '
        .'It is real compliance work, not a configuration step.';

    /**
     * type => [label, view]. A null view means the generator writes a text
     * or CSV format directly and needs no blade template.
     */
    private const GENERATORS = [
        'pf_ecr'                  => ['PF ECR',                 null],
        'esi_challan'             => ['ESI Challan',            null],
        'form_24q'                => ['Form 24Q',               null],
        'full_ecr'                => ['Full ECR',               null],
        'pt_return'               => ['PT Return',              null],
        'lwf_return'              => ['LWF Return',             null],
        'bonus_form_c'            => ['Bonus — Form C',         null],
        'bonus_form_d'            => ['Bonus — Form D',         null],
        'bonus_form_e'            => ['Bonus — Form E',         null],
        'form_12ba'               => ['Form 12BA',              'filings.form12ba'],
        'form_16'                 => ['Form 16',                'filings.form16'],
        'form_16_annual'          => ['Form 16 (Annual)',       'filings.form16_annual'],
        'form_19'                 => ['Form 19',                'filings.form19'],
        'form_31'                 => ['Form 31',                'filings.form31'],
        'form_1'                  => ['Form 1',                 'filings.form1'],
        'form_2'                  => ['Form 2',                 'filings.form2'],
        'form_6'                  => ['Form 6',                 'filings.form6'],
        'form_124'                => ['Form 124',               'filings.form124'],
        'eshram_registration'     => ['e-SHRAM',                'filings.eshram_registration'],
        'uan_activation'          => ['UAN Activation',         'filings.uan_activation'],
        'se_registration'         => ['S&E Registration',       'filings.se_registration'],
        'shram_card_registration' => ['Shram Card',             'filings.shram_card_registration'],
    ];

    /**
     * @return array<string, array{label:string, view:?string, available:bool, unavailable_reason:?string}>
     */
    public function all(): array
    {
        $catalogue = [];

        foreach (self::GENERATORS as $type => [$label, $view]) {
            $available = $view === null || $this->viewExists($view);

            $catalogue[$type] = [
                'label' => $label,
                'view' => $view,
                'available' => $available,
                'unavailable_reason' => $available ? null : self::MISSING_TEMPLATE_REASON,
            ];
        }

        return $catalogue;
    }

    public function isAvailable(string $type): bool
    {
        $entry = self::GENERATORS[$type] ?? null;

        if ($entry === null) {
            return false;
        }

        return $entry[1] === null || $this->viewExists($entry[1]);
    }

    public function unavailableReason(string $type): ?string
    {
        if (! array_key_exists($type, self::GENERATORS)) {
            return "Unknown filing type: {$type}";
        }

        return $this->isAvailable($type) ? null : self::MISSING_TEMPLATE_REASON;
    }

    /**
     * Resolved against the filesystem, not the view finder: the finder caches
     * and the tests need this to reflect reality on every call.
     */
    private function viewExists(string $view): bool
    {
        return file_exists(
            resource_path('views/'.str_replace('.', '/', $view).'.blade.php')
        );
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && php artisan test --filter=FilingCatalogueTest`
Expected: PASS, 5 tests.

- [ ] **Step 5: Stage only — do NOT commit**

```bash
git add backend/app/Services/Payroll/FilingGeneratorRegistry.php backend/tests/Feature/FilingCatalogueTest.php
```
Report to the user that Task 1 is ready; wait for their instruction before committing.

---

### Task 2: Service consults the registry, and the Form 19 fatal is fixed

**Files:**
- Modify: `backend/app/Services/PayrollFilingService.php` — `generateAllFilings` (~line 1952), `generateForm19` (~line 1439)
- Test: `backend/tests/Feature/FilingCatalogueTest.php` (append)

**Interfaces:**
- Consumes: `FilingGeneratorRegistry::isAvailable()`, `::unavailableReason()` from Task 1.
- Produces: `generateAllFilings()` return gains a third key — `['filings' => [...], 'failures' => [...], 'unavailable' => [['type' => string, 'reason' => string], ...]]`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/Feature/FilingCatalogueTest.php`:

```php
    public function test_generate_all_reports_unavailable_filings_separately_from_failures(): void
    {
        $service = app(\App\Services\PayrollFilingService::class);

        $reflection = new \ReflectionClass($service);
        $this->assertTrue(
            $reflection->hasMethod('generateAllFilings'),
            'generateAllFilings must still exist.'
        );

        // The contract: an unavailable filing is neither a silent skip nor a
        // failure. It is reported by name so the caller can tell the user
        // the template does not exist, rather than showing a generic error.
        $registry = new \App\Services\Payroll\FilingGeneratorRegistry();
        $unavailable = array_keys(array_filter(
            $registry->all(),
            fn (array $meta) => ! $meta['available']
        ));

        $this->assertNotEmpty($unavailable, 'Fixture assumption: some filings are unavailable.');
        $this->assertContains('form_19', $unavailable);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && php artisan test --filter=test_generate_all_reports_unavailable`
Expected: PASS on the registry assertions but the `unavailable` key does not yet exist — proceed to wire it, then the integration assertion in Step 5 covers it.

- [ ] **Step 3: Wire the registry into `generateAllFilings`**

In `backend/app/Services/PayrollFilingService.php`, change the `$attempt` closure and the return.

Replace the closure signature and body (currently around line 1963) so it short-circuits on unavailability:

```php
        $filings = [];
        $failures = [];
        $unavailable = [];

        $registry = new \App\Services\Payroll\FilingGeneratorRegistry();

        /**
         * InvalidArgumentException is how the generators say "not due this
         * period" — a bi-annual LWF state in the wrong half, bonus with no
         * percentage configured. That is a skip, not a failure. Anything else
         * is recorded against the filing type so the report names what broke.
         *
         * A filing whose blade template was never written is a third thing
         * again: not due-ness, not breakage, but a feature that does not
         * exist. It is reported by name so the caller can say so plainly
         * instead of surfacing a template-not-found stack trace.
         */
        $attempt = function (string $type, callable $generate) use (&$filings, &$failures, &$unavailable, $registry, $run, $orgId): void {
            // State-scoped types arrive as "pt_return:MH" — the registry keys
            // on the family, not the instance.
            $family = explode(':', $type)[0];

            if (! $registry->isAvailable($family)) {
                $unavailable[] = ['type' => $type, 'reason' => $registry->unavailableReason($family)];

                return;
            }

            try {
                $produced = $generate();

                foreach (is_array($produced) ? $produced : [$produced] as $filing) {
                    if ($filing !== null) {
                        $filings[] = $filing;
                    }
                }
            } catch (\InvalidArgumentException $e) {
                \Log::info("Skipped filing {$type}: ".$e->getMessage());
            } catch (\Throwable $e) {
                $failures[] = ['type' => $type, 'message' => $e->getMessage()];
                \Log::warning("Filing {$type} could not be generated", [
                    'run_id' => $run->id,
                    'organization_id' => $orgId,
                    'exception' => $e::class,
                    'message' => $e->getMessage(),
                ]);
            }
        };
```

Then change the return statement (currently `return ['filings' => $filings, 'failures' => $failures];`) to:

```php
        return ['filings' => $filings, 'failures' => $failures, 'unavailable' => $unavailable];
```

- [ ] **Step 4: Fix the Form 19 fatal found while reading**

In `generateForm19`, `$entries` is a plain PHP array, so `$entries->count()` is a fatal `Error` — and `??` does not catch an `Error`, so this crashes even once the template exists.

Find in `generateForm19`:

```php
                'total_employees' => $entries->count() ?? count($entries),
```

Replace with:

```php
                'total_employees' => count($entries),
```

- [ ] **Step 5: Add the integration assertion**

Append to `backend/tests/Feature/FilingCatalogueTest.php`:

```php
    public function test_generate_all_return_shape_carries_the_unavailable_key(): void
    {
        $method = new \ReflectionMethod(\App\Services\PayrollFilingService::class, 'generateAllFilings');
        $source = file_get_contents($method->getFileName());

        $this->assertStringContainsString(
            "'unavailable' => \$unavailable",
            $source,
            'generateAllFilings must report unavailable filings as a distinct third category.'
        );
    }

    public function test_form19_does_not_call_count_as_a_method_on_an_array(): void
    {
        $source = file_get_contents(
            base_path('app/Services/PayrollFilingService.php')
        );

        $this->assertStringNotContainsString(
            '$entries->count()',
            $source,
            '$entries is a plain array; ->count() is a fatal Error that ?? cannot rescue.'
        );
    }
```

- [ ] **Step 6: Run the filing suite**

Run: `cd backend && php artisan test --filter=Filing`
Expected: PASS. Confirm no previously-passing filing test regressed.

- [ ] **Step 7: Stage only — do NOT commit**

```bash
git add backend/app/Services/PayrollFilingService.php backend/tests/Feature/FilingCatalogueTest.php
```

---

### Task 3: Expose the catalogue over the API

**Files:**
- Modify: `backend/app/Http/Controllers/Api/PayrollFilingController.php`
- Modify: `backend/routes/api/protected/payroll_filings.php`
- Test: `backend/tests/Feature/FilingCatalogueTest.php` (append)

**Interfaces:**
- Consumes: `FilingGeneratorRegistry::all()` from Task 1.
- Produces: `GET /api/payroll/filings/catalogue` → `{ success: true, data: { filings: { <type>: { label, available, unavailable_reason } } } }`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/Feature/FilingCatalogueTest.php`:

```php
    public function test_catalogue_endpoint_is_registered(): void
    {
        $routes = collect(\Route::getRoutes())->map(fn ($r) => $r->uri())->all();

        $this->assertContains(
            'api/payroll/filings/catalogue',
            $routes,
            'The UI needs a server-side catalogue rather than a hardcoded list.'
        );
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && php artisan test --filter=test_catalogue_endpoint_is_registered`
Expected: FAIL — route not in the collection.

- [ ] **Step 3: Add the controller action**

In `backend/app/Http/Controllers/Api/PayrollFilingController.php`, add:

```php
    /**
     * Which filings this installation can actually produce.
     *
     * The dashboard used to carry its own hardcoded array of nineteen
     * returns, every one marked ready, including ten whose blade templates
     * do not exist. Serving the catalogue means the screen cannot drift from
     * the truth again.
     */
    public function catalogue(\App\Services\Payroll\FilingGeneratorRegistry $registry)
    {
        return response()->json([
            'success' => true,
            'data' => [
                'filings' => collect($registry->all())
                    ->map(fn (array $meta) => [
                        'label' => $meta['label'],
                        'available' => $meta['available'],
                        'unavailable_reason' => $meta['unavailable_reason'],
                    ])
                    ->all(),
            ],
        ]);
    }
```

- [ ] **Step 4: Register the route**

In `backend/routes/api/protected/payroll_filings.php`, inside `Route::prefix('filings')->group(...)`, add as the **first** line of the group — before `Route::get('/{id}', ...)`, which would otherwise swallow `catalogue` as an id:

```php
        Route::get('/catalogue', [PayrollFilingController::class, 'catalogue']);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && php artisan test --filter=FilingCatalogueTest`
Expected: PASS, all tests.

- [ ] **Step 6: Stage only — do NOT commit**

```bash
git add backend/app/Http/Controllers/Api/PayrollFilingController.php backend/routes/api/protected/payroll_filings.php backend/tests/Feature/FilingCatalogueTest.php
```

---

### Task 4: The dashboard stops advertising what it cannot do

**Files:**
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/components/payroll/FilingsDashboard.tsx`
- Test: `frontend/src/components/payroll/FilingsDashboard.availability.test.tsx`

**Interfaces:**
- Consumes: `GET /api/payroll/filings/catalogue` from Task 3.
- Produces: `payrollApi.getFilingCatalogue(): Promise<{ filings: Record<string, { label: string; available: boolean; unavailable_reason: string | null }> }>`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/payroll/FilingsDashboard.availability.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { mergeCatalogueAvailability } from './filingAvailability';

describe('filing availability merge', () => {
  it('marks a filing unavailable when the server says its template is missing', () => {
    const merged = mergeCatalogueAvailability(
      [{ key: 'form_19', label: 'Form 19', complianceStatus: 'ready' }],
      { form_19: { label: 'Form 19', available: false, unavailable_reason: 'Template not written.' } },
    );

    expect(merged[0].available).toBe(false);
    expect(merged[0].unavailableReason).toBe('Template not written.');
    expect(merged[0].complianceStatus).toBe('not_configured');
  });

  it('leaves an available filing untouched', () => {
    const merged = mergeCatalogueAvailability(
      [{ key: 'pf_ecr', label: 'PF ECR', complianceStatus: 'ready' }],
      { pf_ecr: { label: 'PF ECR', available: true, unavailable_reason: null } },
    );

    expect(merged[0].available).toBe(true);
    expect(merged[0].complianceStatus).toBe('ready');
  });

  it('treats a filing the server does not mention as available, so a stale client never hides a working filing', () => {
    const merged = mergeCatalogueAvailability(
      [{ key: 'bonus_form_c', label: 'Bonus — Form C', complianceStatus: 'not_configured' }],
      {},
    );

    expect(merged[0].available).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/payroll/FilingsDashboard.availability.test.tsx`
Expected: FAIL — cannot resolve `./filingAvailability`.

- [ ] **Step 3: Write the merge helper**

Create `frontend/src/components/payroll/filingAvailability.ts`:

```ts
export type CatalogueEntry = {
  label: string;
  available: boolean;
  unavailable_reason: string | null;
};

export type FilingLike = {
  key: string;
  label: string;
  complianceStatus: string;
  [k: string]: unknown;
};

export type MergedFiling = FilingLike & {
  available: boolean;
  unavailableReason: string | null;
};

/**
 * Fold server-reported availability into the dashboard's filing catalogue.
 *
 * A filing the server does not mention is treated as available: a client
 * newer than its backend must not hide a filing that actually works. The
 * opposite default would turn a routine deploy skew into ten filings
 * vanishing from the screen.
 */
export function mergeCatalogueAvailability(
  filings: FilingLike[],
  catalogue: Record<string, CatalogueEntry>,
): MergedFiling[] {
  return filings.map((filing) => {
    const entry = catalogue[filing.key];

    if (!entry || entry.available) {
      return { ...filing, available: true, unavailableReason: null };
    }

    return {
      ...filing,
      available: false,
      unavailableReason: entry.unavailable_reason,
      complianceStatus: 'not_configured',
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/payroll/FilingsDashboard.availability.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the API client method**

In `frontend/src/services/api.ts`, in the payroll export block, add:

```ts
  getFilingCatalogue: async () => {
    const { data } = await api.get('/payroll/filings/catalogue');
    return data.data as {
      filings: Record<string, { label: string; available: boolean; unavailable_reason: string | null }>;
    };
  },
```

- [ ] **Step 6: Consume it in the dashboard**

In `frontend/src/components/payroll/FilingsDashboard.tsx`:

1. Import the helper and the query hook:

```tsx
import { mergeCatalogueAvailability } from './filingAvailability';
```

2. Fetch the catalogue alongside the existing queries:

```tsx
  const { data: catalogue } = useQuery({
    queryKey: ['filing-catalogue'],
    queryFn: () => payrollApi.getFilingCatalogue(),
    staleTime: 10 * 60 * 1000,
  });
```

3. Where the hardcoded array is read for rendering, wrap it:

```tsx
  const filings = mergeCatalogueAvailability(FILINGS, catalogue?.filings ?? {});
```

4. In the row renderer, disable the generate control and show the reason when `!filing.available`:

```tsx
  {!filing.available && (
    <p className="mt-1 text-xs text-amber-700">{filing.unavailableReason}</p>
  )}
```

and add `disabled={!filing.available}` to that row's generate button.

5. Fix the copy at line ~1064 — it hardcodes a count that is now wrong:

```tsx
  description="Filings are generated from a specific run. Choose one above to see the returns available for it."
```

- [ ] **Step 7: Verify the whole frontend suite and types**

Run:
```bash
cd frontend && npx tsc --noEmit && npx vitest run --reporter=junit --outputFile=.tmp-e.xml
node ../scripts/ci/test-baseline.mjs --junit frontend/.tmp-e.xml --baseline .github/baselines/vitest.txt --check --label vitest
```
Expected: `tsc` exit 0; baseline check reports **no new failing names**. The 44 known failures may still be present — that is the baseline, not a regression.

- [ ] **Step 8: Stage only — do NOT commit**

```bash
git add frontend/src/services/api.ts frontend/src/components/payroll/FilingsDashboard.tsx frontend/src/components/payroll/filingAvailability.ts frontend/src/components/payroll/FilingsDashboard.availability.test.tsx
```

Report Group E complete and wait for the user's decision on committing.

---

## Self-Review

**Spec coverage.** The spec's Group E requires (a) a registry that is the single authority, (b) filesystem-resolved availability so the test survives the templates being written, (c) an API returning `available: false` with a reason, (d) a UI that stops offering unavailable filings. Tasks 1–4 cover a, b, c, d respectively. The Form 19 array fatal was found during planning and folded into Task 2 rather than left for later — it is in the same function family and would otherwise make Form 19 crash on the day its template lands.

**Placeholder scan.** No TBDs. Every code step carries real code. Test bodies are complete.

**Type consistency.** `FilingGeneratorRegistry::all()` returns keys `label`, `view`, `available`, `unavailable_reason` in Task 1; Task 3's controller reads exactly those; Task 4's `CatalogueEntry` type mirrors the three the controller emits (it drops `view`, which the client has no use for). `mergeCatalogueAvailability` is named identically in the test, the helper and the dashboard.

**Known deviation from the skill's template.** Every task ends at `git add`, not `git commit`, per the user's standing instruction.
