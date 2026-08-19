<?php

namespace App\Support;

use DateTimeInterface;
use Illuminate\Support\Carbon;

class ExternalTimestamp
{
    /**
     * Convert any incoming timestamp to the application timezone, preserving
     * the instant.
     *
     * The `DateTimeInterface` check must stay wider than `Carbon`. It was
     * previously `$value instanceof Carbon`, where `Carbon` is
     * `Illuminate\Support\Carbon` — a *subclass* of `Carbon\Carbon`. A plain
     * `Carbon\Carbon` (what `Carbon::createFromTimestamp()` returns, pinned to
     * UTC since Carbon 3) failed that check and fell through to the string
     * branch below. Casting a date-time to string yields 'Y-m-d H:i:s' with no
     * offset, so a UTC wall clock was re-read as an app-timezone wall clock and
     * the instant silently moved back by the app's UTC offset — 5h30m for an
     * IST tenant. The string branch must only ever see genuine strings.
     */
    public static function parseToAppTimezone(mixed $value, ?Carbon $fallback = null): ?Carbon
    {
        if ($value === null || $value === '') {
            return $fallback?->copy()->setTimezone(self::timezone());
        }

        if ($value instanceof DateTimeInterface) {
            return Carbon::instance($value)->setTimezone(self::timezone());
        }

        return Carbon::parse((string) $value)->setTimezone(self::timezone());
    }

    /**
     * Build a Carbon from a Unix timestamp in the application timezone.
     *
     * Always prefer this over `Carbon::createFromTimestamp($ts)`. The bare call
     * returns a UTC-pinned instance, which is right on the instant but wrong on
     * every local question asked of it afterwards — most damagingly
     * `toDateString()`, which buckets anything before the app's UTC offset into
     * the previous calendar day.
     */
    public static function fromTimestamp(int|float $timestamp): Carbon
    {
        return Carbon::createFromTimestamp($timestamp, self::timezone());
    }

    public static function timezone(): string
    {
        return (string) config('app.timezone', 'UTC');
    }
}
