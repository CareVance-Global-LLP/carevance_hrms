<?php

namespace Tests\Unit\Ai;

use App\Models\User;
use App\Services\Ai\Actions\ActionCatalogue;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * The catalogue is the whole authority for what AI mode may change.
 *
 * `SemanticLayer` decides what the model may READ; this decides what it may
 * WRITE, and the asymmetry matters: a wrong read produces a wrong number that a
 * reader can dispute, while a wrong write changes the organisation's records.
 * So the tests here are deliberately written to trip on a FUTURE entry rather
 * than to pin today's three. Every prohibition scans the whole catalogue by
 * pattern — nobody has to remember to come back and add a case.
 *
 * Two failures these guard against, both of which are silent:
 *
 *  - **An endpoint that does not exist.** The executor dispatches an internal
 *    HTTP request; a route that was renamed or never registered fails at the
 *    very last step, after a human has already been shown a preview and clicked
 *    Apply. `test_every_declared_endpoint_is_a_route_this_application_registers`
 *    resolves each one against the real route collection.
 *  - **A prohibited action arriving by accretion.** Nobody adds
 *    `payroll.approve` deliberately. It arrives as "well, releasing is just a
 *    field edit really" on a Friday. The scans below are what says no.
 *
 * RefreshDatabase: `target_by` is checked against the real schema, because a
 * lookup column that does not exist resolves every target to nothing.
 *
 * @see docs/superpowers/specs/2026-08-26-ai-write-actions.md §3, §7
 */
class ActionCatalogueTest extends TestCase
{
    use RefreshDatabase;

    /**
     * §3: "First-pass catalogue — three actions, no more."
     *
     * Pinned as a set, not a count. A count passes when somebody swaps one
     * action for another, and the whole point of the list being short is that
     * each entry was argued for individually.
     */
    public function test_the_catalogue_holds_exactly_the_three_first_pass_actions(): void
    {
        $this->assertSame(
            ['department.rename', 'leave_type.update', 'organization.update'],
            collect(ActionCatalogue::keys())->sort()->values()->all(),
        );
    }

    /**
     * §7, first bullet. An entry missing any of these is not an action — it is
     * a hole. No permission means nobody is checked; no endpoint means nothing
     * can execute; no fields means a preview with an empty diff.
     */
    public function test_every_entry_declares_a_permission_an_endpoint_and_at_least_one_field(): void
    {
        foreach (ActionCatalogue::all() as $key => $entry) {
            $this->assertArrayHasKey('permission', $entry, "{$key} declares no permission");
            $this->assertIsString($entry['permission'], "{$key}'s permission is not a key");
            $this->assertNotSame('', trim($entry['permission']), "{$key}'s permission is blank");

            $this->assertArrayHasKey('endpoint', $entry, "{$key} declares no endpoint");
            $this->assertCount(2, $entry['endpoint'], "{$key}'s endpoint is not [METHOD, route]");
            [$method, $uri] = $entry['endpoint'];
            $this->assertSame(strtoupper($method), $method, "{$key}'s method is not upper-case");
            $this->assertStringStartsWith('/api/', $uri, "{$key}'s route is not an API route");

            $this->assertArrayHasKey('fields', $entry, "{$key} declares no fields");
            $this->assertNotEmpty($entry['fields'], "{$key} declares no editable field");
        }
    }

    /**
     * The permission key must be one the application actually grants.
     *
     * A typo here fails OPEN or CLOSED depending on how the check is written,
     * and neither is acceptable: `settings.manag` refused to everybody looks
     * exactly like a working guard until somebody legitimate is turned away.
     */
    public function test_every_permission_is_one_the_application_actually_grants(): void
    {
        $known = User::PERMISSIONS_ADMIN;

        foreach (ActionCatalogue::all() as $key => $entry) {
            $this->assertContains(
                $entry['permission'],
                $known,
                "{$key} names permission '{$entry['permission']}', which no role grants",
            );
        }
    }

    /**
     * The endpoint is dispatched for real, so it must resolve for real.
     *
     * Checked against `Route::getRoutes()` rather than against a hand-written
     * list, because the failure this prevents is a route being RENAMED
     * somewhere else in the codebase — which no list kept here would notice.
     */
    public function test_every_declared_endpoint_is_a_route_this_application_registers(): void
    {
        $registered = [];

        foreach (Route::getRoutes() as $route) {
            foreach ($route->methods() as $method) {
                $registered[$method.' '.ltrim($route->uri(), '/')] = true;
            }
        }

        foreach (ActionCatalogue::all() as $key => $entry) {
            [$method, $uri] = $entry['endpoint'];
            $signature = $method.' '.ltrim($uri, '/');

            $this->assertArrayHasKey(
                $signature,
                $registered,
                "{$key} names '{$signature}', which this application does not route",
            );
        }
    }

    /**
     * The preview's permission check must refuse exactly who the endpoint would.
     *
     * §4 requires the acting user to be checked at preview "so an unauthorised
     * person is told immediately rather than after composing a change". A
     * permission key alone cannot do that here: `settings.manage` is granted to
     * admin, hr and payroll_manager, while `role:admin` on the leave-type route
     * admits only admin. Check the key alone and an HR user is walked through
     * composing a change and shown a diff, then 403'd at Apply.
     *
     * So each entry mirrors its route's own gate, and this reads that gate off
     * the REGISTERED ROUTE rather than off a list kept here — the failure worth
     * catching is somebody widening or narrowing the middleware in the routes
     * file and never touching the catalogue.
     */
    public function test_every_entry_mirrors_the_role_gate_its_route_actually_carries(): void
    {
        foreach (ActionCatalogue::all() as $key => $entry) {
            $this->assertArrayHasKey('roles', $entry, "{$key} mirrors no role gate");

            [$method, $uri] = $entry['endpoint'];
            $route = collect(Route::getRoutes())->first(
                fn ($candidate) => ltrim($candidate->uri(), '/') === ltrim($uri, '/')
                    && in_array($method, $candidate->methods(), true),
            );

            $this->assertNotNull($route, "{$key} names a route that does not exist");

            $gates = collect($route->gatherMiddleware())
                ->filter(fn ($middleware) => is_string($middleware) && str_starts_with($middleware, 'role:'))
                ->flatMap(fn (string $middleware) => explode(',', substr($middleware, strlen('role:'))))
                ->map(fn (string $role) => strtolower(trim($role)))
                ->sort()
                ->values()
                ->all();

            $this->assertSame(
                $gates,
                collect($entry['roles'])->sort()->values()->all(),
                "{$key} claims a different role gate from the one its route carries",
            );
        }
    }

    /**
     * §5's execution response sends the person somewhere to see the change.
     * A change nobody can go and look at is one they have to take on trust.
     */
    public function test_every_entry_names_a_screen_to_see_the_change_on(): void
    {
        foreach (ActionCatalogue::all() as $key => $entry) {
            $this->assertArrayHasKey('view_route', $entry, "{$key} names no screen");
            $this->assertStringStartsWith('/', $entry['view_route'], "{$key}'s screen is not a path");
            $this->assertStringStartsNotWith('/api/', $entry['view_route'], "{$key} points at the API, not a screen");
        }
    }

    /**
     * §3: "Answers 'and who does this land on?' — a count, never a list of
     * names." An unrecognised impact key is a preview that cannot say who is
     * affected, which is the one thing the preview exists to say.
     */
    public function test_every_entry_declares_a_recognised_impact(): void
    {
        foreach (ActionCatalogue::all() as $key => $entry) {
            $this->assertArrayHasKey('impact', $entry, "{$key} declares no impact");
            $this->assertContains(
                $entry['impact'],
                ActionCatalogue::IMPACTS,
                "{$key} declares impact '{$entry['impact']}', which nothing can compute",
            );
        }
    }

    /**
     * Every field carries the bounds its type needs, stated here independently
     * of the catalogue so the two have to agree.
     *
     * Bounds are not decoration. The model supplies the value; without a
     * declared range, "set the carry-forward cap to 4000" reaches the endpoint
     * and is refused there as a 422 the person cannot act on, instead of being
     * refused at preview in words about days.
     */
    public function test_every_field_declares_a_type_and_the_bounds_that_type_needs(): void
    {
        $requiredBounds = [
            'integer' => ['min', 'max'],
            'number' => ['min', 'max'],
            'text' => ['max_length'],
            'time' => ['format'],
            'timezone' => [],
        ];

        foreach (ActionCatalogue::all() as $key => $entry) {
            foreach ($entry['fields'] as $field => $spec) {
                $this->assertArrayHasKey('label', $spec, "{$key}.{$field} has no label");
                $this->assertArrayHasKey('type', $spec, "{$key}.{$field} has no type");
                $this->assertArrayHasKey(
                    $spec['type'],
                    $requiredBounds,
                    "{$key}.{$field} has unknown type '{$spec['type']}'",
                );

                foreach ($requiredBounds[$spec['type']] as $bound) {
                    $this->assertArrayHasKey(
                        $bound,
                        $spec,
                        "{$key}.{$field} is a {$spec['type']} with no {$bound}",
                    );
                }

                if ($spec['type'] === 'integer' || $spec['type'] === 'number') {
                    $this->assertLessThanOrEqual(
                        $spec['max'],
                        $spec['min'],
                        "{$key}.{$field} has a min above its max",
                    );
                }

                if ($spec['type'] === 'text') {
                    $this->assertGreaterThan(0, $spec['max_length'], "{$key}.{$field} allows no characters");
                }
            }
        }
    }

    /**
     * `model` is what the preview reads `before` from, and what the executor
     * re-reads at Apply. A class that is not an Eloquent model cannot do either.
     */
    public function test_every_entry_names_a_real_eloquent_model(): void
    {
        foreach (ActionCatalogue::all() as $key => $entry) {
            $this->assertArrayHasKey('model', $entry, "{$key} names no model");
            $this->assertTrue(class_exists($entry['model']), "{$key} names missing class {$entry['model']}");
            $this->assertTrue(
                is_subclass_of($entry['model'], Model::class),
                "{$key}'s model is not an Eloquent model",
            );
        }
    }

    /**
     * `target_by` is how a phrase like "casual leave" becomes a row.
     *
     * Each entry is either a REAL COLUMN on the model's table or the one
     * sentinel that means "the acting user's own organisation, there is no
     * other addressable one". A column that does not exist resolves every
     * target to nothing, and a preview that finds nothing looks identical to a
     * question about a row that genuinely is not there.
     */
    public function test_every_entry_says_how_to_find_its_target_and_the_columns_exist(): void
    {
        foreach (ActionCatalogue::all() as $key => $entry) {
            $this->assertArrayHasKey('target_by', $entry, "{$key} says nothing about finding a target");
            $this->assertNotEmpty($entry['target_by'], "{$key} has no way to find a target");

            $table = (new $entry['model'])->getTable();

            foreach ($entry['target_by'] as $lookup) {
                if ($lookup === ActionCatalogue::TARGET_ACTING_ORGANIZATION) {
                    continue;
                }

                $this->assertTrue(
                    Schema::hasColumn($table, $lookup),
                    "{$key} looks a target up by {$table}.{$lookup}, which does not exist",
                );
            }
        }
    }

    /**
     * §4: "NOTHING DESTRUCTIVE. No deletes."
     *
     * Scanned by pattern over the whole catalogue — the method, the route, the
     * action key and the model name — so an action added in six months trips
     * this without anyone editing the test.
     */
    public function test_no_entry_deletes_anything(): void
    {
        $destructive = [
            'delete', 'deletes', 'destroy', 'remove', 'removes', 'purge',
            'drop', 'truncate', 'terminate', 'revoke', 'deactivate', 'archive',
        ];

        foreach (ActionCatalogue::all() as $key => $entry) {
            $this->assertNotSame('DELETE', strtoupper($entry['endpoint'][0]), "{$key} is an HTTP DELETE");

            $found = array_intersect($destructive, $this->wordsIn($key, $entry));

            $this->assertSame(
                [],
                array_values($found),
                "{$key} reads as destructive: ".implode(', ', $found),
            );
        }
    }

    /**
     * §4: "PAYROLL IS READ, NAVIGATE AND PREPARE ONLY. No action may lock,
     * approve, release or disburse a run."
     *
     * Those transitions carry maker-checker exactly so one actor cannot do them
     * alone. An AI shortcut through the control does not weaken it slightly, it
     * removes it — the confirming human and the acting human become the same
     * person by construction.
     */
    public function test_no_entry_touches_a_payroll_state_transition(): void
    {
        $transitions = [
            'lock', 'locked', 'unlock', 'approve', 'approves', 'approval',
            'release', 'released', 'disburse', 'disbursement', 'finalize',
            'finalise', 'reopen', 'void', 'process', 'payroll', 'payslip',
            'payrun', 'filing', 'filings', 'settlement',
        ];

        foreach (ActionCatalogue::all() as $key => $entry) {
            $found = array_intersect($transitions, $this->wordsIn($key, $entry));

            $this->assertSame(
                [],
                array_values($found),
                "{$key} reaches into payroll: ".implode(', ', $found),
            );
        }
    }

    /**
     * §4: "no money".
     *
     * The strongest reason is not that a wrong figure is expensive — it is that
     * money in this system is `decimal` and rounded once at a boundary, and an
     * AI-supplied value entering anywhere else is a rounding path nobody
     * reviewed. Leave days are counts, not currency, which is why
     * `annual_quota` and `carry_forward_cap` are allowed and anything that
     * tokenises to a money word is not.
     */
    public function test_no_field_is_a_money_field(): void
    {
        $money = [
            'salary', 'salaries', 'pay', 'payment', 'payments', 'wage', 'wages',
            'ctc', 'gross', 'net', 'amount', 'amounts', 'bonus', 'gratuity',
            'arrear', 'arrears', 'encash', 'encashment', 'reimbursement',
            'currency', 'price', 'cost', 'deduction', 'deductions', 'tds',
            'esi', 'epf', 'invoice', 'invoices', 'money', 'rate', 'rates',
            'allowance', 'allowances', 'ifsc', 'bank', 'account', 'ledger',
        ];

        foreach (ActionCatalogue::all() as $key => $entry) {
            foreach ($entry['fields'] as $field => $spec) {
                $this->assertNotSame('money', $spec['type'], "{$key}.{$field} is typed as money");

                $found = array_intersect(
                    $money,
                    array_merge($this->words($field), $this->words((string) $spec['label'])),
                );

                $this->assertSame(
                    [],
                    array_values($found),
                    "{$key}.{$field} reads as money: ".implode(', ', $found),
                );
            }

            $found = array_intersect($money, $this->wordsIn($key, $entry));

            $this->assertSame(
                [],
                array_values($found),
                "{$key} reads as money: ".implode(', ', $found),
            );
        }
    }

    public function test_an_unknown_key_is_not_in_the_catalogue(): void
    {
        $this->assertFalse(ActionCatalogue::has('employee.delete'));
        $this->assertNull(ActionCatalogue::get('employee.delete'));
        $this->assertTrue(ActionCatalogue::has('leave_type.update'));
        $this->assertIsArray(ActionCatalogue::get('leave_type.update'));
    }

    public function test_a_field_is_only_readable_through_the_action_that_declares_it(): void
    {
        $this->assertNotNull(ActionCatalogue::field('leave_type.update', 'carry_forward_cap'));
        $this->assertNull(ActionCatalogue::field('leave_type.update', 'is_active'));
        $this->assertNull(ActionCatalogue::field('department.rename', 'carry_forward_cap'));
        $this->assertNull(ActionCatalogue::field('nope.nothing', 'name'));
    }

    /**
     * Every word an entry is written out of: its key, its label, its model, its
     * HTTP method and route, and every field name and label. One haystack, so a
     * prohibited concept cannot hide in whichever part of the entry a scan
     * happened not to look at.
     *
     * @return list<string>
     */
    private function wordsIn(string $key, array $entry): array
    {
        $text = [$key, (string) ($entry['label'] ?? ''), (string) ($entry['model'] ?? '')];
        $text[] = implode(' ', $entry['endpoint'] ?? []);
        $text[] = (string) ($entry['view_route'] ?? '');

        foreach (($entry['fields'] ?? []) as $field => $spec) {
            $text[] = $field;
            $text[] = (string) ($spec['label'] ?? '');
        }

        return $this->words(implode(' ', $text));
    }

    /** @return list<string> */
    private function words(string $text): array
    {
        return array_values(array_filter(
            preg_split('/[^a-z0-9]+/', strtolower($text)) ?: [],
            static fn (string $word): bool => $word !== '',
        ));
    }
}
