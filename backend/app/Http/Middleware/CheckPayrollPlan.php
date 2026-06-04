<?php

namespace App\Http\Middleware;

use App\Services\Billing\PlanService;
use Closure;
use Illuminate\Http\Request;

class CheckPayrollPlan
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

        $payrollDevMode = config('app.env') !== 'production'
            && (bool) env('PAYROLL_DEV_MODE', false);

        if (! $payrollDevMode && ! PlanService::hasFeature($organization, 'payroll')) {
            return response()->json([
                'message' => 'Payroll is not available on your current plan. Please upgrade to access payroll features.',
                'error_code' => 'PLAN_FEATURE_UNAVAILABLE',
            ], 403);
        }

        return $next($request);
    }
}
