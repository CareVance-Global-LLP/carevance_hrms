<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Routing\Exceptions\InvalidSignatureException;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'api.token' => \App\Http\Middleware\AuthenticateApiToken::class,
            'api.token.optional' => \App\Http\Middleware\OptionalApiToken::class,
            'role' => \App\Http\Middleware\EnsureUserHasRole::class,
            'sanitize' => \App\Http\Middleware\SanitizeInput::class,
            'payroll.enabled' => \App\Http\Middleware\PayrollEnabled::class,
            'plan.payroll' => \App\Http\Middleware\CheckPayrollPlan::class,
            'plan.performance' => \App\Http\Middleware\CheckPerformancePlan::class,
            // Offline-sync deduplication. The middleware existed but had no
            // alias and was attached to no route, so replayed syncs from the
            // desktop/mobile clients created duplicate rows despite the
            // (local_id, device_id) unique indexes being in place.
            'idempotent.sync' => \App\Http\Middleware\IdempotentSync::class,
            // Applied to the whole authenticated API in routes/api.php rather
            // than to a list of sensitive routes — a per-route list is one
            // somebody eventually forgets to extend.
            'mfa.enrolled' => \App\Http\Middleware\EnsureMfaEnrolled::class,
            // Authenticates a customer API key and pins its tenant. Takes the
            // required scope as a parameter, e.g. 'api.client:employees.read'.
            'api.client' => \App\Http\Middleware\AuthenticateApiClient::class,
        ]);

        // Apply sanitize middleware to API routes
        $middleware->api(prepend: [
            \App\Http\Middleware\SanitizeInput::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        /*
         * Error tracking.
         *
         * There was none: no Sentry, no Datadog, no OpenTelemetry, nothing. A
         * 500 wrote a line to a log file on a single instance and that was the
         * whole of the observability story, so nobody learned a payroll run had
         * broken until a customer said so.
         *
         * No-ops entirely when SENTRY_LARAVEL_DSN is unset, which is the point:
         * an unconfigured deployment behaves exactly as it did, and setting one
         * environment variable turns it on. See deploy/lightsail/RUNBOOK.md.
         *
         * The class_exists guard makes that promise true for a missing PACKAGE
         * as well as a missing DSN. Without it the call is reached while the
         * exception handler is still being built, so `Class
         * "Sentry\Laravel\Integration" not found` is thrown before routing and
         * EVERY request 500s — login included, with no way into the app at all.
         * That is what a deploy which ships the code but never runs `composer
         * install` produces, and it happened in production on 20 Aug 2026: the
         * scheduler failed on the same error every minute for as long as it
         * lasted, so idle timers stopped closing too.
         *
         * Error tracking must never be the thing that takes the application
         * down. If the package is absent the app runs exactly as it did before
         * error tracking existed, which is the whole promise above.
         */
        if (class_exists(\Sentry\Laravel\Integration::class)) {
            \Sentry\Laravel\Integration::handles($exceptions);
        }

        $exceptions->render(function (ValidationException $e, Request $request) {
            if (!$request->is('api/*')) {
                return null;
            }

            return response()->json([
                'success' => false,
                'message' => 'The given data was invalid.',
                'error_code' => 'VALIDATION_ERROR',
                'errors' => $e->errors(),
            ], 422);
        });

        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if (!$request->is('api/*')) {
                return null;
            }

            return response()->json([
                'success' => false,
                'message' => 'Unauthenticated.',
                'error_code' => 'UNAUTHORIZED',
            ], 401);
        });

        $exceptions->render(function (AuthorizationException $e, Request $request) {
            if (!$request->is('api/*')) {
                return null;
            }

            return response()->json([
                'success' => false,
                'message' => 'Forbidden',
                'error_code' => 'FORBIDDEN',
            ], 403);
        });

        $exceptions->render(function (ModelNotFoundException $e, Request $request) {
            if (!$request->is('api/*')) {
                return null;
            }

            return response()->json([
                'success' => false,
                'message' => 'Resource not found.',
                'error_code' => 'NOT_FOUND',
            ], 404);
        });

        $exceptions->render(function (InvalidSignatureException $e, Request $request) {
            if (!$request->is('api/*')) {
                return null;
            }

            return response()->json([
                'success' => false,
                'message' => 'Screenshot link expired. Refresh screenshots and try again.',
                'error_code' => 'FORBIDDEN',
                'request_id' => null,
            ], 403);
        });

        $exceptions->render(function (\Throwable $e, Request $request) {
            if (!$request->is('api/*')) {
                return null;
            }

            $status = $e instanceof HttpExceptionInterface ? $e->getStatusCode() : 500;
            $message = $status >= 500 ? 'Server error.' : ($e->getMessage() ?: 'Request failed.');
            $requestId = $status >= 500 ? (string) Str::uuid() : null;
            $codes = [
                400 => 'BAD_REQUEST',
                401 => 'UNAUTHORIZED',
                403 => 'FORBIDDEN',
                404 => 'NOT_FOUND',
                409 => 'CONFLICT',
                422 => 'UNPROCESSABLE_ENTITY',
                429 => 'TOO_MANY_REQUESTS',
                500 => 'SERVER_ERROR',
            ];

            if ($status >= 500) {
                Log::error('API request failed', [
                    'request_id' => $requestId,
                    'method' => $request->method(),
                    'path' => $request->path(),
                    'route' => optional($request->route())->getName(),
                    'user_id' => $request->user()?->id,
                    'ip' => $request->ip(),
                    'exception' => $e::class,
                    'message' => $e->getMessage(),
                ]);
            }

            return response()->json([
                'success' => false,
                'message' => $message,
                'error_code' => $codes[$status] ?? 'API_ERROR',
                'request_id' => $requestId,
            ], $status);
        });
    })->create();
