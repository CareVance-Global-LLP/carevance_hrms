<?php

namespace Tests\Feature;

use App\Services\Payroll\FilingGeneratorRegistry;
use Tests\TestCase;

class FilingCatalogueTest extends TestCase
{
    /**
     * The registry must agree with the filesystem.
     *
     * This assertion keeps passing unchanged as the ten missing templates get
     * written — a hardcoded expectation would need editing ten more times, and
     * would be wrong in the window between each template landing and someone
     * remembering to update it.
     */
    public function test_registry_availability_matches_views_on_disk(): void
    {
        $registry = new FilingGeneratorRegistry();

        foreach ($registry->all() as $type => $meta) {
            if ($meta['view'] === null) {
                $this->assertTrue(
                    $meta['available'],
                    "Filing {$type} needs no blade view and must report available."
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
                $this->assertNull(
                    $meta['unavailable_reason'],
                    "Available filing {$type} must not carry an unavailability reason."
                );
            } else {
                $this->assertNotEmpty(
                    $meta['unavailable_reason'],
                    "Unavailable filing {$type} must say why, so the UI can tell the user."
                );
            }
        }
    }

    /**
     * Every PDF filing is available.
     *
     * Two tests used to live here: one asserting three PDF filings worked and
     * one asserting ten were unavailable for want of a template. The ten
     * templates were written in Aug 2026, so the split no longer describes
     * anything and the pair has become a single list of thirteen.
     *
     * Kept as an explicit roster rather than a loop over the catalogue - that
     * loop already exists above. This is the list a person can read against
     * the statute to see what the product claims to produce.
     */
    public function test_every_pdf_filing_is_available(): void
    {
        $registry = new FilingGeneratorRegistry();

        foreach ([
            'form_12ba', 'form_16', 'form_16_annual',
            'form_19', 'form_31', 'form_1', 'form_2', 'form_6', 'form_124',
            'eshram_registration', 'uan_activation', 'se_registration',
            'shram_card_registration',
        ] as $type) {
            $this->assertTrue(
                $registry->isAvailable($type),
                "{$type} must have a blade view on disk and report available."
            );
        }
    }

    public function test_non_pdf_filings_need_no_view_and_are_available(): void
    {
        $registry = new FilingGeneratorRegistry();

        foreach (['pf_ecr', 'esi_challan', 'form_24q', 'full_ecr', 'pt_return', 'lwf_return', 'bonus'] as $type) {
            $this->assertTrue(
                $registry->isAvailable($type),
                "{$type} writes a text or aggregate format and must report available."
            );
        }
    }

    /**
     * Every filing family `generateAllFilings` attempts must be known to the
     * registry. If one is not, its availability falls through to the unknown
     * default and the catalogue cannot describe it — which is the drift this
     * class exists to prevent.
     */
    public function test_every_family_attempted_by_generate_all_is_known_to_the_registry(): void
    {
        $registry = new FilingGeneratorRegistry();
        $source = file_get_contents(base_path('app/Services/PayrollFilingService.php'));

        preg_match_all("/\\\$attempt\(\s*[\"']([a-z_0-9]+)/", $source, $matches);
        preg_match_all("/\\\$attempt\(\s*\"([a-z_0-9]+):/", $source, $stateScoped);

        $families = array_unique(array_merge($matches[1] ?? [], $stateScoped[1] ?? []));

        $this->assertNotEmpty($families, 'Fixture assumption: generateAllFilings attempts named filing types.');

        foreach ($families as $family) {
            $this->assertTrue(
                $registry->isKnown($family),
                "generateAllFilings attempts '{$family}' but the registry has no entry for it."
            );
        }
    }

    /**
     * An unavailable filing is a third outcome, not a failure.
     *
     * Folding it into `failures` would tell the user something broke, which
     * is untrue and sends them to support instead of to the roadmap.
     */
    public function test_generate_all_reports_unavailable_filings_as_a_distinct_category(): void
    {
        $source = file_get_contents(base_path('app/Services/PayrollFilingService.php'));

        $this->assertStringContainsString(
            "'unavailable' => \$unavailable",
            $source,
            'generateAllFilings must return unavailable filings separately from failures.'
        );

        $this->assertStringContainsString(
            'FilingGeneratorRegistry',
            $source,
            'generateAllFilings must consult the registry before attempting a generator.'
        );
    }

    public function test_catalogue_endpoint_is_registered(): void
    {
        $uris = collect(\Illuminate\Support\Facades\Route::getRoutes())
            ->map(fn ($route) => $route->uri())
            ->all();

        $this->assertContains(
            'api/payroll/filings/catalogue',
            $uris,
            'The dashboard needs a server-side catalogue rather than a hardcoded list.'
        );
    }

    /**
     * '/catalogue' must be declared before '/{id}'. Laravel matches in
     * declaration order, so the wildcard would otherwise capture the literal
     * and the endpoint would 404 on every request.
     */
    public function test_catalogue_route_is_registered_before_the_id_wildcard(): void
    {
        $uris = collect(\Illuminate\Support\Facades\Route::getRoutes())
            ->map(fn ($route) => $route->uri())
            ->values();

        $catalogueIndex = $uris->search('api/payroll/filings/catalogue');
        $wildcardIndex = $uris->search('api/payroll/filings/{id}');

        $this->assertNotFalse($catalogueIndex, 'The catalogue route must be registered.');
        $this->assertNotFalse($wildcardIndex, 'Fixture assumption: a filings/{id} route exists.');

        $this->assertLessThan(
            $wildcardIndex,
            $catalogueIndex,
            'The router matches in registration order, so filings/{id} would capture '
                .'"catalogue" as an id and the endpoint would 404 on every request.'
        );
    }

    public function test_form19_does_not_call_count_as_a_method_on_an_array(): void
    {
        $source = file_get_contents(base_path('app/Services/PayrollFilingService.php'));

        $this->assertStringNotContainsString(
            '$entries->count()',
            $source,
            '$entries is a plain array; ->count() is a fatal Error that ?? cannot rescue.'
        );
    }
}
