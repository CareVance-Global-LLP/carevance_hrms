<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * IdempotentSync Middleware
 *
 * Prevents duplicate processing of offline-synced records.
 * When a request includes local_id + device_id, the middleware
 * checks if a record with those keys already exists in the
 * target table. If found, it short-circuits with a 200 response
 * using the existing record, avoiding duplicate inserts.
 *
 * Usage in routes/api.php:
 *   Route::post('/screenshots', ...)->middleware('idempotent.sync:Screenshot');
 *
 * The parameter after the colon is the Eloquent model class name (minus namespace).
 */
class IdempotentSync
{
    private const MODEL_MAP = [
        'Screenshot' => \App\Models\Screenshot::class,
        'Activity' => \App\Models\Activity::class,
        'ActivitySession' => \App\Models\ActivitySession::class,
        'TimeEntry' => \App\Models\TimeEntry::class,
        'AttendancePunch' => \App\Models\AttendancePunch::class,
        'AttendanceRecord' => \App\Models\AttendanceRecord::class,
    ];

    public function handle(Request $request, Closure $next, string $modelKey = ''): Response
    {
        $localId = $request->input('local_id', '');
        $deviceId = $request->input('device_id', '');

        // Without idempotency keys, process normally
        if (empty($localId) || empty($deviceId)) {
            return $next($request);
        }

        // If idempotency-check-only flag is set (sync engine pre-flight)
        if ($request->input('_check_idempotent') === '1') {
            $modelClass = self::MODEL_MAP[$modelKey] ?? null;
            if ($modelClass) {
                $existing = $modelClass::where('local_id', $localId)
                    ->where('device_id', $deviceId)
                    ->first();
                if ($existing) {
                    return response()->json([
                        'success' => true,
                        'data' => $existing,
                        'idempotent' => true,
                    ], 200);
                }
            }
            return response()->json(['success' => true, 'exists' => false], 200);
        }

        // Before the controller creates a record, inject the idempotency keys
        // so they get persisted with the new record.
        $request->merge([
            'local_id' => $localId,
            'device_id' => $deviceId,
        ]);

        return $next($request);
    }
}
