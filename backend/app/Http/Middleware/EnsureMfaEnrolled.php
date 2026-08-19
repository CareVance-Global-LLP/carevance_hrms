<?php

namespace App\Http\Middleware;

use App\Services\Security\MfaService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Blocks a privileged account that has not set up a second factor, once its
 * organisation's grace window has closed.
 *
 * Applied to the whole authenticated API rather than to a list of sensitive
 * routes, and for the same reason auditing moved onto the model lifecycle: a
 * per-route list is a list somebody will forget to extend. Anything genuinely
 * needed *to* comply is allowed through by the exemptions below, and nothing
 * else is.
 */
class EnsureMfaEnrolled
{
    /**
     * Paths reachable while non-compliant.
     *
     * Exactly the ones a blocked user needs: read who they are, set up their
     * authenticator, and leave. Nothing here exposes payroll, employee or
     * statutory data.
     *
     * @var array<int, string>
     */
    private const EXEMPT = [
        'api/auth/mfa',
        'api/auth/mfa/setup',
        'api/auth/mfa/confirm',
        'api/auth/mfa/recovery-codes',
        'api/auth/me',
        'api/auth/logout',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user) {
            return $next($request);
        }

        $path = trim($request->path(), '/');

        foreach (self::EXEMPT as $exempt) {
            if ($path === $exempt) {
                return $next($request);
            }
        }

        if (! app(MfaService::class)->mustEnrolNow($user)) {
            return $next($request);
        }

        return response()->json([
            'success' => false,
            'message' => 'Your organisation requires two-factor authentication for your role. '
                .'Set up an authenticator app to continue.',
            'error_code' => 'MFA_ENROLMENT_REQUIRED',
        ], 403);
    }
}
