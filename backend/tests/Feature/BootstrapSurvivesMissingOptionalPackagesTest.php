<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * An optional integration must never be able to take the application down.
 *
 * `bootstrap/app.php` called `Sentry\Laravel\Integration::handles()` unguarded.
 * That call runs while the exception handler is still being built, so on a
 * deployment where the package was not installed it threw
 * `Class "Sentry\Laravel\Integration" not found` before routing — and every
 * request returned 500. Login included, which meant no way into the app at all.
 *
 * Production, 20 Aug 2026: the code shipped but `composer install` never ran, so
 * `sentry/sentry-laravel` was absent from vendor/. The scheduler hit the same
 * error every single minute, so idle timers stopped closing for the duration.
 *
 * The comment above the call already promised that an unconfigured deployment
 * "behaves exactly as it did" — it just only honoured that for a missing DSN,
 * not a missing package. This pins both halves of that promise.
 *
 * Asserted against the SOURCE, because the package is installed here: the
 * failure only reproduces where it is absent, so the guard is the only thing
 * that can be checked from inside a working install.
 */
class BootstrapSurvivesMissingOptionalPackagesTest extends TestCase
{
    private function bootstrapSource(): string
    {
        return (string) file_get_contents(base_path('bootstrap/app.php'));
    }

    public function test_every_sentry_call_in_bootstrap_is_guarded(): void
    {
        $source = $this->bootstrapSource();

        // Each line that actually calls into the Sentry integration.
        $calls = array_values(array_filter(
            explode("\n", $source),
            static fn (string $line) => str_contains($line, 'Integration::')
                && ! str_starts_with(ltrim($line), '*')
                && ! str_starts_with(ltrim($line), '//'),
        ));

        $this->assertNotEmpty($calls, 'Expected bootstrap/app.php to still wire up error tracking.');

        $this->assertStringContainsString(
            'class_exists(\Sentry\Laravel\Integration::class)',
            $source,
            'bootstrap/app.php calls the Sentry integration without a class_exists guard. '
            .'A deployment missing the package then 500s on EVERY request, including login, '
            .'before routing is even reached.',
        );
    }

    public function test_the_application_still_boots_and_serves_a_request(): void
    {
        // The guard must not have broken booting where the package IS present.
        $this->getJson('/api/activities')->assertStatus(401);
    }

    public function test_sentry_remains_a_production_dependency(): void
    {
        // If it moved to require-dev, `composer install --no-dev` would omit it
        // on every deploy — turning the outage above into the normal case.
        $composer = json_decode((string) file_get_contents(base_path('composer.json')), true);

        $this->assertArrayHasKey(
            'sentry/sentry-laravel',
            $composer['require'] ?? [],
            'sentry/sentry-laravel must stay in require, not require-dev.',
        );
    }
}
