<?php

namespace App\Traits;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Idempotent Trait
 *
 * Add this trait to models that accept local_id + device_id from the
 * offline desktop tracker. When a request includes these fields, the
 * trait checks for an existing record before creating a new one,
 * preventing duplicate uploads from the sync engine.
 *
 * Usage in controller:
 *   $model = Idempotent::resolve($request, Screenshot::class, $additionalMatch);
 *   if ($model) return response()->json($model, 200);
 *   // ... create new record normally
 */
trait Idempotent
{
    /**
     * Resolve an idempotent request.
     *
     * Returns the existing model if a record with the same
     * (local_id, device_id) already exists, or null if not found.
     */
    public static function resolveIdempotent(Request $request, string $modelClass, array $extraMatch = []): ?Model
    {
        $localId = $request->input('local_id', '');
        $deviceId = $request->input('device_id', '');

        if (empty($localId) || empty($deviceId)) {
            // Without idempotency keys, proceed with normal creation
            return null;
        }

        $query = $modelClass::where('local_id', $localId)
            ->where('device_id', $deviceId);

        foreach ($extraMatch as $field => $value) {
            $query->where($field, $value);
        }

        $existing = $query->first();

        if ($existing) {
            return $existing;
        }

        return null;
    }

    /**
     * Generate a unique local_id for new records
     */
    public static function generateLocalId(): string
    {
        return 'off_' . (string) Str::uuid();
    }
}
