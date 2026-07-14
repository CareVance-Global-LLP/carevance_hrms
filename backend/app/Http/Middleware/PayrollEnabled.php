<?php

namespace App\Http\Middleware;

use App\Services\Billing\PlanService;
use Closure;
use Illuminate\Http\Request;

class PayrollEnabled
{
    public function handle(Request $request, Closure $next)
    {
        $user = $request->user();

        if (! $user || ! $user->organization_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        // Be defensive: org relation might not be loaded / might be missing.
        $organization = $user->organization ?? null;

        if (! $organization) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $payrollDevMode = (bool) env('PAYROLL_DEV_MODE', false);

        // Dev mode bypasses feature gating.
        if (! $payrollDevMode && ! PlanService::hasFeature($organization, 'payroll')) {
            return response()->json([
                'message' => 'Payroll is not available on your current plan. Please upgrade to access payroll features.',
                'error_code' => 'PLAN_FEATURE_UNAVAILABLE',
            ], 403);
        }

        return $next($request);
    }
}
