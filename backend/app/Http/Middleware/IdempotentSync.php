<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
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
        $localId = (string) $request->input('local_id', '');
        $deviceId = (string) $request->input('device_id', '');

        // Without idempotency keys, process normally
        if ($localId === '' || $deviceId === '') {
            return $next($request);
        }

        $modelClass = self::MODEL_MAP[$modelKey] ?? null;
        $userId = $request->user()?->id;

        // Always check first, not only on the `_check_idempotent` pre-flight.
        // The pre-flight alone was a time-of-check/time-of-use race: two
        // concurrent syncs of the same record both passed through and both
        // inserted, and the DB unique index turned the loser into an
        // unhandled 500 that offline clients then retried forever.
        if ($modelClass !== null) {
            $existing = $this->findExisting($modelClass, $localId, $deviceId, $userId);

            if ($existing !== null) {
                return response()->json([
                    'success' => true,
                    'data' => $existing,
                    'idempotent' => true,
                ], 200);
            }
        }

        if ($request->input('_check_idempotent') === '1') {
            return response()->json(['success' => true, 'exists' => false], 200);
        }

        // Before the controller creates a record, inject the idempotency keys
        // so they get persisted with the new record.
        $request->merge([
            'local_id' => $localId,
            'device_id' => $deviceId,
        ]);

        try {
            return $next($request);
        } catch (QueryException $e) {
            // Lost the insert race against a concurrent sync of the same
            // record. The winner's row is the correct answer, so resolve to it
            // instead of surfacing a 500.
            if (!$this->isUniqueViolation($e)) {
                throw $e;
            }

            $existing = $modelClass !== null
                ? $this->findExisting($modelClass, $localId, $deviceId, $userId)
                : null;

            if ($existing === null) {
                throw $e;
            }

            return response()->json([
                'success' => true,
                'data' => $existing,
                'idempotent' => true,
            ], 200);
        }
    }

    /**
     * Look up a previously synced record.
     *
     * Scoped by user where the model supports it: without that, anyone could
     * probe another account's data by guessing a (local_id, device_id) pair,
     * since the pre-flight returns the full record.
     *
     * @param  class-string<\Illuminate\Database\Eloquent\Model>  $modelClass
     */
    private function findExisting(string $modelClass, string $localId, string $deviceId, ?int $userId): ?Model
    {
        $query = $modelClass::query()
            ->where('local_id', $localId)
            ->where('device_id', $deviceId);

        if ($userId !== null && $this->hasUserColumn($modelClass)) {
            $query->where('user_id', $userId);
        }

        return $query->first();
    }

    /** @param  class-string<\Illuminate\Database\Eloquent\Model>  $modelClass */
    private function hasUserColumn(string $modelClass): bool
    {
        $model = new $modelClass();

        return Schema::hasColumn($model->getTable(), 'user_id');
    }

    private function isUniqueViolation(QueryException $e): bool
    {
        return in_array((string) $e->getCode(), ['23000', '23505'], true);
    }
}
