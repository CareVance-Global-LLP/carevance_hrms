<?php

namespace App\Services\Ai;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;

/**
 * Turns a period token from an AI query plan into a concrete, inclusive date
 * range — server-side, against `now()`, never by the model.
 *
 * Two rules run through everything here:
 *
 * 1. **An unrecognised token is null, never a guess.** A period decides *which*
 *    rows an answer is about, so a fallback of "today" or "this month" does not
 *    degrade the answer — it silently answers a different question with the
 *    same confidence. Null is a refusal the caller reports.
 * 2. **Both ends are inclusive**, and the label is derived from the resolved
 *    bounds rather than from the token. A label computed from the words can
 *    disagree with the range it describes; one computed from the range cannot.
 *
 * @see docs/superpowers/specs/2026-08-24-ai-mode-grammar-v2.md §3
 */
class PeriodResolver
{
    /** `2026-07` — a calendar month. Month must be 01-12 and zero-padded. */
    private const EXPLICIT_MONTH = '/^(\d{4})-(0[1-9]|1[0-2])$/';

    /** `2026` — a calendar year. */
    private const EXPLICIT_YEAR = '/^(\d{4})$/';

    /** `2026-07-01..2026-07-31` — an inclusive range. */
    private const EXPLICIT_RANGE = '/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/';

    /**
     * @return array{start: string, end: string, label: string}|null
     */
    public static function resolve(string $token): ?array
    {
        /*
         * Trim and lower-case only. That normalises how a token was written,
         * which is not the same as guessing what an unknown word meant —
         * nothing here maps spaces to underscores or reaches for a near match.
         */
        $token = strtolower(trim($token));

        if ($token === '') {
            return null;
        }

        $range = self::relative($token, Carbon::now()->toImmutable())
            ?? self::explicit($token);

        if ($range === null) {
            return null;
        }

        [$start, $end] = $range;

        /*
         * A reversed range is refused rather than swapped. Swapping decides the
         * asker mistyped the order; they may equally have mistyped one of the
         * two dates, and there is no way to tell which from here.
         */
        if ($start->greaterThan($end)) {
            return null;
        }

        return [
            'start' => $start->toDateString(),
            'end' => $end->toDateString(),
            'label' => self::label($start, $end),
        ];
    }

    /**
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}|null
     */
    private static function relative(string $token, CarbonImmutable $now): ?array
    {
        $today = $now->startOfDay();

        return match ($token) {
            'today' => [$today, $today],
            'yesterday' => [$today->subDay(), $today->subDay()],

            /*
             * The week start is pinned to Monday explicitly. Carbon's default
             * follows the locale, so a locale change anywhere in the app would
             * quietly move every weekly answer by a day without touching this
             * file. Each period's end is the day before the next period starts,
             * which is exact for any calendar unit.
             */
            'this_week' => [
                $today->startOfWeek(CarbonInterface::MONDAY),
                $today->startOfWeek(CarbonInterface::MONDAY)->addWeek()->subDay(),
            ],
            'last_week' => [
                $today->startOfWeek(CarbonInterface::MONDAY)->subWeek(),
                $today->startOfWeek(CarbonInterface::MONDAY)->subDay(),
            ],

            /*
             * Anchored on the start of the unit BEFORE subtracting. Carbon's
             * subMonth() on 31 March lands on 3 March, so the intuitive
             * now()->subMonth()->startOfMonth() answers "last month" with
             * *March* — and month ends are exactly when payroll asks.
             */
            'this_month' => [$today->startOfMonth(), $today->endOfMonth()->startOfDay()],
            'last_month' => [$today->startOfMonth()->subMonth(), $today->startOfMonth()->subDay()],

            'this_quarter' => [$today->startOfQuarter(), $today->endOfQuarter()->startOfDay()],
            'last_quarter' => [$today->startOfQuarter()->subQuarter(), $today->startOfQuarter()->subDay()],

            'this_year' => [$today->startOfYear(), $today->endOfYear()->startOfDay()],
            'last_year' => [$today->startOfYear()->subYear(), $today->startOfYear()->subDay()],

            /*
             * Rolling windows that END today, inclusive — "last 7 days" is 7
             * days of data including today, not 8 and not 7 ending yesterday.
             */
            'last_7_days' => [$today->subDays(6), $today],
            'last_30_days' => [$today->subDays(29), $today],
            'last_90_days' => [$today->subDays(89), $today],
            'last_12_months' => [$today->subMonthsNoOverflow(12)->addDay(), $today],

            default => null,
        };
    }

    /**
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}|null
     */
    private static function explicit(string $token): ?array
    {
        if (preg_match(self::EXPLICIT_MONTH, $token, $matches) === 1) {
            $start = self::day((int) $matches[1], (int) $matches[2], 1);

            return [$start, $start->endOfMonth()->startOfDay()];
        }

        if (preg_match(self::EXPLICIT_YEAR, $token, $matches) === 1) {
            $start = self::day((int) $matches[1], 1, 1);

            return [$start, $start->endOfYear()->startOfDay()];
        }

        if (preg_match(self::EXPLICIT_RANGE, $token, $matches) === 1) {
            $start = self::strictDate($matches[1]);
            $end = self::strictDate($matches[2]);

            return $start !== null && $end !== null ? [$start, $end] : null;
        }

        return null;
    }

    /**
     * A date that is not on the calendar is refused, not rolled forward.
     * Carbon would read `2026-02-30` as 2 March and answer about a window
     * nobody asked for; checkdate() is what stops it.
     */
    private static function strictDate(string $value): ?CarbonImmutable
    {
        [$year, $month, $day] = array_map('intval', explode('-', $value));

        if (! checkdate($month, $day, $year)) {
            return null;
        }

        return self::day($year, $month, $day);
    }

    private static function day(int $year, int $month, int $day): CarbonImmutable
    {
        // create() fills a null time component from now(), so startOfDay() is
        // not decoration — without it the bound carries the current clock.
        return CarbonImmutable::create($year, $month, $day)->startOfDay();
    }

    /**
     * Human-readable, for the `notes[]` line that tells the reader what was
     * actually computed. Derived from the bounds, so `last_month` and
     * `2026-07` asked in July produce the same label — which is the truth.
     *
     * format() rather than isoFormat(): month names here must not follow the
     * app locale, because the range they describe never does.
     */
    private static function label(CarbonImmutable $start, CarbonImmutable $end): string
    {
        if ($start->isSameDay($end)) {
            return $start->format('j M Y');
        }

        $isWholeMonth = $start->format('Y-m') === $end->format('Y-m')
            && $start->day === 1
            && $end->day === $end->daysInMonth;

        if ($isWholeMonth) {
            return $start->format('F Y');
        }

        $isWholeYear = $start->year === $end->year
            && $start->format('m-d') === '01-01'
            && $end->format('m-d') === '12-31';

        if ($isWholeYear) {
            return (string) $start->year;
        }

        return $start->format('j M Y').' – '.$end->format('j M Y');
    }
}
