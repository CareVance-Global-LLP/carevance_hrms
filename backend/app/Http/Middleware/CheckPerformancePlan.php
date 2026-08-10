<?php

namespace App\Http\Middleware;

use App\Services\Billing\PlanService;
use Closure;
use Illuminate\Http\Request;

class CheckPerformancePlan
{
    public function handle(Request $request, Closure $next)
    {
        $user = $request->user();
        if (! $user || ! $user->organization_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $organization = $user->organization;
        if (! $organization) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        // Same dev-mode escape hatch as CheckPayrollPlan (config(), not env(),
        // so it survives `php artisan config:cache`).
        $devMode = (bool) config('payroll.dev_mode', false);

        if (! $devMode && ! PlanService::hasFeature($organization, 'performance_management')) {
            return response()->json([
                'message' => 'Performance management is not available on your current plan. Please upgrade to access it.',
                'error_code' => 'PLAN_FEATURE_UNAVAILABLE',
            ], 403);
        }

        return $next($request);
    }
}
