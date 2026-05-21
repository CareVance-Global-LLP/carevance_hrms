<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class PayrollEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        if (!filter_var(env('PAYROLL_ENABLED', false), FILTER_VALIDATE_BOOL)) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        return $next($request);
    }
}
