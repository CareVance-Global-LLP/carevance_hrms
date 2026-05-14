<?php

$appEnv = (string) env('APP_ENV', 'production');
$isLocalEnvironment = in_array($appEnv, ['local', 'development', 'testing'], true);
$allowedOrigins = array_values(array_filter(array_map(
    static fn (string $origin) => trim($origin),
    explode(',', (string) env(
        'CORS_ALLOWED_ORIGINS',
        $isLocalEnvironment ? 'http://localhost:5173,http://127.0.0.1:5173' : ''
    ))
)));
$allowedOriginPatterns = array_values(array_filter(array_map(
    static fn (string $pattern) => trim($pattern),
    explode(',', (string) env(
        'CORS_ALLOWED_ORIGIN_PATTERNS',
        $isLocalEnvironment ? '#^https?://(localhost|127\.0\.0\.1)(:\d+)?$#' : ''
    ))
)));

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => $allowedOrigins,

    'allowed_origins_patterns' => $allowedOriginPatterns,

    'allowed_headers' => ['Accept', 'Authorization', 'Content-Type', 'Origin', 'X-Requested-With'],

    'exposed_headers' => [],

    'max_age' => (int) env('CORS_MAX_AGE', 3600),

    'supports_credentials' => filter_var(env('CORS_SUPPORTS_CREDENTIALS', true), FILTER_VALIDATE_BOOL),
];
