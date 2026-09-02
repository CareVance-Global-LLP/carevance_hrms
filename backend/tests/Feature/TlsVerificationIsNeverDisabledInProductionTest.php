<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\File;
use Tests\TestCase;

/**
 * Disabling TLS verification is a local-Windows workaround, never a default.
 *
 * `OAuthController` and `ExpoPushService` both relax verification only under
 * `app()->environment('local') && PHP_OS is WIN`, for the curl CA-bundle
 * problem on Windows dev machines. `AiChatService::request()` did it
 * unconditionally — on the request that carries the provider API key as a
 * bearer token, so the one call worth protecting was the one left open.
 *
 * This is asserted structurally rather than behaviourally because the defect
 * is the ABSENCE of a guard, and an absent guard has no runtime signature to
 * assert against — the request simply succeeds either way. A scanner over
 * app/ is the only thing that fails when someone adds the next one.
 */
class TlsVerificationIsNeverDisabledInProductionTest extends TestCase
{
    /** Anything that relaxes certificate checking. */
    private const RELAXERS = [
        'withoutVerifying(',
        'CURLOPT_SSL_VERIFYPEER',
        'CURLOPT_SSL_VERIFYHOST',
        "'verify' => false",
        '"verify" => false',
    ];

    /** How far above the call the guard may sit and still plainly govern it. */
    private const GUARD_WINDOW = 6;

    public function test_every_tls_relaxation_sits_behind_an_environment_guard(): void
    {
        $offenders = [];

        foreach (File::allFiles(app_path()) as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }

            $lines = file($file->getPathname());

            foreach ($lines as $index => $line) {
                // A comment describing the rule is not an instance of it.
                if (preg_match('/^\s*(\*|\/\/)/', $line) === 1) {
                    continue;
                }

                $relaxes = false;
                foreach (self::RELAXERS as $needle) {
                    if (str_contains($line, $needle)) {
                        $relaxes = true;
                        break;
                    }
                }

                if (! $relaxes) {
                    continue;
                }

                $window = implode('', array_slice(
                    $lines,
                    max(0, $index - self::GUARD_WINDOW),
                    min($index, self::GUARD_WINDOW) + 1
                ));

                if (! str_contains($window, "environment('local')")
                    && ! str_contains($window, "environment('local', 'testing')")) {
                    $offenders[] = str_replace(base_path().DIRECTORY_SEPARATOR, '', $file->getPathname())
                        .':'.($index + 1).'  '.trim($line);
                }
            }
        }

        $this->assertSame(
            [],
            $offenders,
            "TLS verification may only be relaxed behind app()->environment('local') — "
            ."see OAuthController and ExpoPushService for the pattern:\n  ".implode("\n  ", $offenders)
        );
    }
}
