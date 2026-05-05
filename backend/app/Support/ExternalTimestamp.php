<?php

namespace App\Support;

use Illuminate\Support\Carbon;

class ExternalTimestamp
{
    public static function parseToAppTimezone(mixed $value, ?Carbon $fallback = null): ?Carbon
    {
        if ($value === null || $value === '') {
            return $fallback?->copy()->setTimezone(self::timezone());
        }

        if ($value instanceof Carbon) {
            return $value->copy()->setTimezone(self::timezone());
        }

        return Carbon::parse((string) $value)->setTimezone(self::timezone());
    }

    public static function timezone(): string
    {
        return (string) config('app.timezone', 'UTC');
    }
}
