<?php

namespace App\Support;

use Carbon\Carbon;
use InvalidArgumentException;

/**
 * The one place a 'YYYY-MM' string becomes a date.
 *
 * `Carbon::createFromFormat('Y-m', '2026-06')` names no day, so Carbon fills in
 * TODAY's day-of-month and then lets it overflow. Read on 31 August that parses
 * to 2026-06-31, which is 2026-07-01 — the wrong month entirely. February is
 * worse: on the 31st it lands three days into March.
 *
 *     setTestNow('2026-08-31'); createFromFormat('Y-m', '2026-06') -> 2026-07-01
 *     setTestNow('2026-08-24'); createFromFormat('Y-m', '2026-06') -> 2026-06-01
 *
 * So the bug is invisible for twenty-eight days a month and fires on the last
 * three — which are exactly the days payroll is run. It was found on 31 Aug 2026
 * by thirteen failing tests, eleven of which asserted some form of "31 is
 * identical to 30": PayrollDayBasisResolver priced a loss-of-pay day at 1/31 of
 * gross instead of 1/30, PayrollOverride's month scopes selected the following
 * month, and CompensationTimeline segmented a revision against a month the
 * employee did not work.
 *
 * **Appending `->startOfMonth()` does not fix it.** The overflow happens during
 * parsing, so that only returns the first of the wrong month. Fourteen of the
 * seventeen call sites did exactly that, and ArrearCalculatorService even
 * carried a comment describing the trap while applying the non-fix. That is why
 * this is a named helper rather than a corrected idiom copied around: the wrong
 * version looks right, and `grep -rn "createFromFormat('Y-m'"` returning nothing
 * is a test you can actually run. MonthYearParsingTest runs it.
 */
final class MonthYear
{
    /** Midnight on the first day of the month. */
    public static function start(string $monthYear): Carbon
    {
        [$year, $month] = self::parts($monthYear);

        return Carbon::create($year, $month, 1)->startOfDay();
    }

    /** The last instant of the month. */
    public static function end(string $monthYear): Carbon
    {
        return self::start($monthYear)->endOfMonth();
    }

    /** Calendar length of the month — 28, 29, 30 or 31. */
    public static function days(string $monthYear): int
    {
        return (int) self::start($monthYear)->daysInMonth;
    }

    /**
     * Shift by whole months and return 'YYYY-MM'.
     *
     * Anchored on the first, so it cannot skip a month the way `subMonth()` on
     * the 31st skips February.
     */
    public static function shift(string $monthYear, int $months): string
    {
        return self::start($monthYear)->addMonths($months)->format('Y-m');
    }

    /**
     * Validated (year, month).
     *
     * Rejects rather than coerces: a malformed month reaching payroll silently
     * as "today" is how a run is computed for the wrong period.
     *
     * @return array{int, int}
     */
    private static function parts(string $monthYear): array
    {
        if (preg_match('/^(\d{4})-(0[1-9]|1[0-2])$/', trim($monthYear), $m) !== 1) {
            throw new InvalidArgumentException("month_year must be YYYY-MM, got '{$monthYear}'");
        }

        return [(int) $m[1], (int) $m[2]];
    }
}
