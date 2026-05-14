<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;

class HealthCheckController extends Controller
{
    public function index()
    {
        $checks = [
            'status' => 'healthy',
            'timestamp' => now()->toIso8601String(),
            'version' => config('app.version', '1.0.0'),
            'services' => [],
        ];

        // Database check
        try {
            DB::connection()->getPdo();
            $checks['services']['database'] = 'up';
        } catch (\Exception $e) {
            $checks['services']['database'] = 'down';
            $checks['status'] = 'unhealthy';
        }

        // Cache check
        try {
            Cache::put('health_check', 'ok', 10);
            $cacheValue = Cache::get('health_check');
            $checks['services']['cache'] = $cacheValue === 'ok' ? 'up' : 'down';
            if ($checks['services']['cache'] === 'down') {
                $checks['status'] = 'unhealthy';
            }
        } catch (\Exception $e) {
            $checks['services']['cache'] = 'down';
            $checks['status'] = 'unhealthy';
        }

        // Queue check (if database queue)
        if (config('queue.default') === 'database') {
            try {
                $queueCount = DB::table('jobs')->count();
                $checks['services']['queue'] = 'up';
                $checks['queue_pending_jobs'] = $queueCount;
            } catch (\Exception $e) {
                $checks['services']['queue'] = 'down';
                $checks['status'] = 'unhealthy';
            }
        }

        $statusCode = $checks['status'] === 'healthy' ? 200 : 503;

        return response()->json($checks, $statusCode);
    }

    public function simple()
    {
        return response()->json(['status' => 'ok']);
    }
}
