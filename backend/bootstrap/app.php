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
            'role' => \App\Http\Middleware\EnsureUserHasRole::class,
            'sanitize' => \App\Http\Middleware\SanitizeInput::class,
            'payroll.enabled' => \App\Http\Middleware\PayrollEnabled::class,
            'plan.payroll' => \App\Http\Middleware\CheckPayrollPlan::class,
        ]);

        // Apply sanitize middleware to API routes
        $middleware->api(prepend: [
            \App\Http\Middleware\SanitizeInput::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
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
