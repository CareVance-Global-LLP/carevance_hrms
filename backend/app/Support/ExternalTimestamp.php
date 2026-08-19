<?php

namespace App\Support;

use App\Models\User;
use App\Services\Attendance\UserTimezoneResolver;
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
     *
     * Use this for values headed for STORAGE and for anything with no single
     * user in scope. Datetime columns carry no offset, so the app timezone is
     * the storage convention every reader assumes; writing a Tokyo wall clock
     * into one would move the instant for everyone else. For values that are
     * RENDERED to, or BUCKETED for, one person, use the *ForUser variants.
     */
    public static function parseToAppTimezone(mixed $value, ?Carbon $fallback = null): ?Carbon
    {
        return self::parseInTimezone($value, self::timezone(), $fallback);
    }

    /**
     * Same conversion, in the timezone the given user works in.
     *
     * @param  User|int|null  $user  a hydrated user, a bare user id, or null for the app default
     */
    public static function parseToUserTimezone(mixed $value, User|int|null $user, ?Carbon $fallback = null): ?Carbon
    {
        return self::parseInTimezone($value, self::timezoneForUser($user), $fallback);
    }

    public static function parseInTimezone(mixed $value, string $timezone, ?Carbon $fallback = null): ?Carbon
    {
        if ($value === null || $value === '') {
            return $fallback?->copy()->setTimezone($timezone);
        }

        if ($value instanceof DateTimeInterface) {
            return Carbon::instance($value)->setTimezone($timezone);
        }

        return Carbon::parse((string) $value)->setTimezone($timezone);
    }

    /**
     * Build a Carbon from a Unix timestamp in the application timezone.
     *
     * Always prefer this over `Carbon::createFromTimestamp($ts)`. The bare call
     * returns a UTC-pinned instance, which is right on the instant but wrong on
     * every local question asked of it afterwards — most damagingly
     * `toDateString()`, which buckets anything before the app's UTC offset into
     * the previous calendar day.
     *
     * Where the answer belongs to one person — a per-user-per-day rollup key,
     * for instance — use fromTimestampForUser() instead: the same reasoning
     * that makes a UTC-pinned instance wrong makes a config-pinned one wrong
     * for anyone outside the app's zone.
     */
    public static function fromTimestamp(int|float $timestamp): Carbon
    {
        return Carbon::createFromTimestamp($timestamp, self::timezone());
    }

    /**
     * @param  User|int|null  $user  a hydrated user, a bare user id, or null for the app default
     */
    public static function fromTimestampForUser(int|float $timestamp, User|int|null $user): Carbon
    {
        return self::fromTimestampIn($timestamp, self::timezoneForUser($user));
    }

    public static function fromTimestampIn(int|float $timestamp, string $timezone): Carbon
    {
        return Carbon::createFromTimestamp($timestamp, $timezone);
    }

    /**
     * The zone for a value that belongs to no one in particular: console
     * commands, and aggregates spanning users whose zones differ. Safe there
     * precisely because the result is never filed under one person's calendar
     * day.
     */
    public static function timezone(): string
    {
        return (string) config('app.timezone', 'UTC');
    }

    public static function timezoneForUser(User|int|null $user): string
    {
        $resolver = app(UserTimezoneResolver::class);

        if ($user instanceof User) {
            return $resolver->forUser($user);
        }

        return $resolver->forUserId($user);
    }
}
