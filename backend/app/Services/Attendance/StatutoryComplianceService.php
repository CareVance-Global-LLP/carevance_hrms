<?php

namespace App\Services\Attendance;

use App\Models\AttendanceRecord;
use App\Models\BreakTime;
use App\Models\User;
use Carbon\Carbon;
use Carbon\CarbonPeriod;

/**
 * Where the working week broke the law, and by how much.
 *
 * Separate from OvertimeEngine on purpose. The engine answers "what is this
 * worth", which is a pay question and must keep working for an establishment
 * that has configured nothing. This answers "was this allowed", which is a
 * compliance question, produces no money, and is only meaningful once somebody
 * has said what the establishment is registered as.
 *
 * NOTHING HERE IS INFERRED FROM SILENCE. An unregulated establishment returns
 * an empty breach list rather than a clean bill of health, and the two are
 * distinguished in the payload: `is_regulated` false means nobody has told us
 * what this place is, which is not the same as nobody having broken a rule. A
 * compliance screen that shows a green tick over an unconfigured entity is
 * worse than one that shows nothing.
 *
 * A BREACH IS A FACT, NOT A JUDGEMENT. Each one carries the limit, the actual,
 * the excess and the provision it comes from, because the first thing anybody
 * asks is "says who" and the second is "by how much".
 */
class StatutoryComplianceService
{
    public const BREACH_DAILY_HOURS = 'daily_hours';
    public const BREACH_SPREAD_OVER = 'spread_over';
    public const BREACH_REST_INTERVAL = 'rest_interval';
    public const BREACH_WEEKLY_HOURS = 'weekly_hours';
    public const BREACH_WEEKLY_WITH_OVERTIME = 'weekly_with_overtime';
    public const BREACH_QUARTERLY_OVERTIME = 'quarterly_overtime';
    public const BREACH_OVERTIME_RATE = 'overtime_rate';

    public function __construct(
        private readonly StatutoryWorkingTime $statute,
    ) {
    }

    /**
     * Every breach for one person over a date range.
     *
     * @return array{
     *   is_regulated: bool,
     *   limits: array<string, mixed>,
     *   breaches: array<int, array<string, mixed>>,
     * }
     */
    public function forUser(User $user, Carbon|string $from, Carbon|string $to): array
    {
        $start = $this->day($from);
        $end = $this->day($to);
        $limits = $this->statute->forUser($user);

        if (! $limits->isRegulated()) {
            return [
                'is_regulated' => false,
                'limits' => $limits->toArray(),
                'breaches' => [],
            ];
        }

        $records = AttendanceRecord::query()
            ->where('user_id', $user->id)
            ->whereDate('attendance_date', '>=', $start->toDateString())
            ->whereDate('attendance_date', '<=', $end->toDateString())
            ->orderBy('attendance_date')
            ->get();

        $breaks = BreakTime::query()
            ->where('user_id', $user->id)
            ->whereDate('break_date', '>=', $start->toDateString())
            ->whereDate('break_date', '<=', $end->toDateString())
            ->get()
            ->groupBy(fn (BreakTime $row) => Carbon::parse($row->break_date)->toDateString());

        $breaches = [];

        foreach ($records as $record) {
            $breaches = array_merge($breaches, $this->dayBreaches($user, $record, $breaks, $limits));
        }

        $breaches = array_merge(
            $breaches,
            $this->weekBreaches($user, $records, $limits, $start, $end),
            $this->quarterBreaches($user, $records, $limits, $start, $end),
        );

        return [
            'is_regulated' => true,
            'limits' => $limits->toArray(),
            'breaches' => $breaches,
        ];
    }

    /**
     * One day: hours worked, spread-over, the rest interval, and the rate.
     *
     * @param  \Illuminate\Support\Collection<string, \Illuminate\Support\Collection<int, BreakTime>>  $breaksByDate
     * @return array<int, array<string, mixed>>
     */
    private function dayBreaches(User $user, AttendanceRecord $record, $breaksByDate, StatutoryLimits $limits): array
    {
        $date = Carbon::parse($record->attendance_date)->toDateString();
        $breaches = [];

        $workedMinutes = intdiv(max(0, (int) $record->worked_seconds), 60);

        if ($limits->maxDailyMinutes !== null && $workedMinutes > $limits->maxDailyMinutes) {
            $breaches[] = $this->breach(
                self::BREACH_DAILY_HOURS, $date,
                $limits->maxDailyMinutes, $workedMinutes,
                $limits->citations['max_daily_minutes'] ?? null,
                'Worked beyond the daily limit of ordinary hours.',
            );
        }

        /*
         * Spread-over is clock-in to clock-out INCLUDING breaks, which is the
         * whole point of it: it caps how long the working day may stretch, not
         * how much of it was worked. Computed from the timestamps rather than
         * from worked_seconds, which has breaks already taken out.
         */
        if ($limits->maxSpreadOverMinutes !== null && $record->check_in_at && $record->check_out_at) {
            $spread = (int) Carbon::parse($record->check_in_at)->diffInMinutes(Carbon::parse($record->check_out_at), false);

            if ($spread > $limits->maxSpreadOverMinutes) {
                $breaches[] = $this->breach(
                    self::BREACH_SPREAD_OVER, $date,
                    $limits->maxSpreadOverMinutes, $spread,
                    $limits->citations['max_spread_over_minutes'] ?? null,
                    'The working day stretched beyond the permitted spread-over.',
                );
            }
        }

        $rest = $this->restIntervalBreach($record, $breaksByDate->get($date), $limits);
        if ($rest) {
            $breaches[] = $rest;
        }

        return $breaches;
    }

    /**
     * The longest stretch worked without a qualifying rest.
     *
     * A rest only counts if it is at least the statutory length — two ten-minute
     * tea breaks are not a half-hour interval, and treating them as one is
     * exactly how an establishment convinces itself it is compliant when it is
     * not. Short breaks are still subtracted from nothing; they simply do not
     * reset the clock.
     *
     * With no check-in and check-out there is no span to divide, so nothing is
     * reported rather than a breach invented from a missing punch.
     *
     * @param  \Illuminate\Support\Collection<int, BreakTime>|null  $breaks
     * @return array<string, mixed>|null
     */
    private function restIntervalBreach(AttendanceRecord $record, $breaks, StatutoryLimits $limits): ?array
    {
        if ($limits->maxContinuousWorkMinutes === null || ! $record->check_in_at || ! $record->check_out_at) {
            return null;
        }

        $start = Carbon::parse($record->check_in_at);
        $end = Carbon::parse($record->check_out_at);

        if ($end->lessThanOrEqualTo($start)) {
            return null;
        }

        $qualifying = collect($breaks ?? [])
            ->filter(fn (BreakTime $row) => $row->start_at
                && intdiv(max(0, (int) $row->duration_seconds), 60) >= $limits->minimumRestMinutes)
            ->sortBy(fn (BreakTime $row) => Carbon::parse($row->start_at)->getTimestamp())
            ->values();

        $longest = 0;
        $cursor = $start->copy();

        foreach ($qualifying as $break) {
            $breakStart = Carbon::parse($break->start_at);
            $breakEnd = $break->end_at
                ? Carbon::parse($break->end_at)
                : $breakStart->copy()->addSeconds(max(0, (int) $break->duration_seconds));

            if ($breakStart->greaterThan($cursor)) {
                $longest = max($longest, (int) $cursor->diffInMinutes($breakStart, false));
            }

            // A break running past the cursor moves it; one entirely behind the
            // cursor (overlapping data) leaves it alone rather than rewinding.
            if ($breakEnd->greaterThan($cursor)) {
                $cursor = $breakEnd->copy();
            }
        }

        if ($end->greaterThan($cursor)) {
            $longest = max($longest, (int) $cursor->diffInMinutes($end, false));
        }

        if ($longest <= $limits->maxContinuousWorkMinutes) {
            return null;
        }

        return $this->breach(
            self::BREACH_REST_INTERVAL,
            Carbon::parse($record->attendance_date)->toDateString(),
            $limits->maxContinuousWorkMinutes,
            $longest,
            $limits->citations['max_continuous_work_minutes'] ?? null,
            "Worked {$longest} minutes without a rest interval of at least {$limits->minimumRestMinutes} minutes.",
        );
    }

    /**
     * Weekly ceilings, on calendar weeks that overlap the range.
     *
     * A week is only judged when the range actually covers all of it. Reporting
     * "38 hours, under the limit" for a week the caller asked three days of is
     * a false negative, and a false negative in a compliance report is the one
     * failure mode that matters — nobody checks a clean row.
     *
     * @param  \Illuminate\Support\Collection<int, AttendanceRecord>  $records
     * @return array<int, array<string, mixed>>
     */
    private function weekBreaches(User $user, $records, StatutoryLimits $limits, Carbon $start, Carbon $end): array
    {
        if ($limits->maxWeeklyMinutes === null && $limits->maxWeeklyIncludingOvertimeMinutes === null) {
            return [];
        }

        $breaches = [];
        $week = $start->copy()->startOfWeek();

        while ($week->lessThanOrEqualTo($end)) {
            $weekEnd = $week->copy()->endOfWeek();

            /*
             * Compared as DATES. $weekEnd is 23:59:59 on the Sunday while $end
             * is midnight on it, so an instant comparison judges the week to
             * run past the range and drops it - which silently excluded the
             * final week of every report, the exact false negative this class
             * exists to avoid.
             */
            if ($week->toDateString() >= $start->toDateString()
                && $weekEnd->toDateString() <= $end->toDateString()) {
                $minutes = $records
                    ->filter(function (AttendanceRecord $record) use ($week, $weekEnd) {
                        $on = Carbon::parse($record->attendance_date);

                        return $on->betweenIncluded($week, $weekEnd);
                    })
                    ->sum(fn (AttendanceRecord $record) => intdiv(max(0, (int) $record->worked_seconds), 60));

                $label = $week->toDateString().' to '.$weekEnd->toDateString();

                if ($limits->maxWeeklyIncludingOvertimeMinutes !== null
                    && $minutes > $limits->maxWeeklyIncludingOvertimeMinutes) {
                    $breaches[] = $this->breach(
                        self::BREACH_WEEKLY_WITH_OVERTIME, $label,
                        $limits->maxWeeklyIncludingOvertimeMinutes, (int) $minutes,
                        $limits->citations['max_weekly_including_overtime_minutes'] ?? null,
                        'Total hours including overtime exceeded the weekly ceiling.',
                    );
                } elseif ($limits->maxWeeklyMinutes !== null && $minutes > $limits->maxWeeklyMinutes) {
                    /*
                     * Reported only when the harder ceiling was NOT breached.
                     * Exceeding 48 ordinary hours is what makes the excess
                     * overtime — lawful, and paid at the overtime rate. It is
                     * the 60-hour total that is prohibited outright, so raising
                     * both would file a normal week of overtime as a violation.
                     */
                    $breaches[] = $this->breach(
                        self::BREACH_WEEKLY_HOURS, $label,
                        $limits->maxWeeklyMinutes, (int) $minutes,
                        $limits->citations['max_weekly_minutes'] ?? null,
                        'Worked beyond the ordinary weekly hours; the excess is overtime.',
                    );
                }
            }

            $week->addWeek();
        }

        return $breaches;
    }

    /**
     * The quarterly overtime cap.
     *
     * A quarter is a CALENDAR quarter beginning 1 January, 1 April, 1 July or
     * 1 October — s.64(4) says so explicitly, so a rolling three months would
     * be the wrong window and would clear an establishment that is over.
     *
     * The whole quarter is counted, not just the requested range: the cap is on
     * the quarter, and someone asking about March cannot be told they are
     * inside it on January and February's evidence alone.
     *
     * @param  \Illuminate\Support\Collection<int, AttendanceRecord>  $records
     * @return array<int, array<string, mixed>>
     */
    private function quarterBreaches(User $user, $records, StatutoryLimits $limits, Carbon $start, Carbon $end): array
    {
        if ($limits->quarterlyOvertimeMinutes === null) {
            return [];
        }

        $breaches = [];
        $seen = [];

        foreach (CarbonPeriod::create($start->copy()->startOfQuarter(), '1 month', $end) as $month) {
            $quarterStart = $month->copy()->startOfQuarter();
            $key = $quarterStart->toDateString();

            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;

            $quarterEnd = $quarterStart->copy()->endOfQuarter();
            $minutes = $this->overtimeMinutesBetween($user, $quarterStart, $quarterEnd);

            if ($minutes > $limits->quarterlyOvertimeMinutes) {
                $breaches[] = $this->breach(
                    self::BREACH_QUARTERLY_OVERTIME,
                    $quarterStart->toDateString().' to '.$quarterEnd->toDateString(),
                    $limits->quarterlyOvertimeMinutes, $minutes,
                    $limits->citations['quarterly_overtime_minutes'] ?? null,
                    'Overtime in the quarter exceeded the statutory cap.',
                );
            }
        }

        return $breaches;
    }

    /**
     * Statutory overtime over a window, in minutes.
     *
     * NOT the same thing as the overtime the OvertimeEngine prices, and the
     * difference matters in both directions. The engine measures the excess
     * over whatever shift was rostered, because that is what an employer agreed
     * to pay for. Section 59 defines overtime as work beyond nine hours in a
     * day or forty-eight in a week, whatever the roster says - so an employer
     * rostering eight-hour days would over-count against the cap on the engine's
     * numbers, and one rostering ten-hour days would under-count and appear to
     * be inside a cap they have blown through.
     *
     * It also means the cap works for an establishment with no roster
     * configured at all, which the engine deliberately cannot help with: the
     * nine-hour line comes from the Act, not from a shift somebody set up.
     *
     * Taken as the GREATER of the daily excesses and the weekly excess rather
     * than their sum, which is the settled reading - the two are alternative
     * measures of the same overtime, not two separate entitlements.
     */
    public function overtimeMinutesBetween(User $user, Carbon $from, Carbon $to): int
    {
        $limits = $this->statute->forUser($user);

        if ($limits->maxDailyMinutes === null && $limits->maxWeeklyMinutes === null) {
            return 0;
        }

        $records = AttendanceRecord::query()
            ->where('user_id', $user->id)
            ->whereDate('attendance_date', '>=', $from->toDateString())
            ->whereDate('attendance_date', '<=', $to->toDateString())
            ->get();

        $byWeek = $records->groupBy(
            fn (AttendanceRecord $record) => Carbon::parse($record->attendance_date)->startOfWeek()->toDateString()
        );

        $total = 0;

        foreach ($byWeek as $week) {
            $weekMinutes = 0;
            $dailyExcess = 0;

            foreach ($week as $record) {
                $minutes = intdiv(max(0, (int) $record->worked_seconds), 60);
                $weekMinutes += $minutes;

                if ($limits->maxDailyMinutes !== null) {
                    $dailyExcess += max(0, $minutes - $limits->maxDailyMinutes);
                }
            }

            $weeklyExcess = $limits->maxWeeklyMinutes !== null
                ? max(0, $weekMinutes - $limits->maxWeeklyMinutes)
                : 0;

            $total += max($dailyExcess, $weeklyExcess);
        }

        return $total;
    }

    /** @return array<string, mixed> */
    private function breach(
        string $type,
        string $period,
        int $limitMinutes,
        int $actualMinutes,
        ?string $citation,
        string $summary,
    ): array {
        return [
            'type' => $type,
            'period' => $period,
            'limit_minutes' => $limitMinutes,
            'actual_minutes' => $actualMinutes,
            'excess_minutes' => max(0, $actualMinutes - $limitMinutes),
            'citation' => $citation,
            'summary' => $summary,
        ];
    }

    private function day(Carbon|string $value): Carbon
    {
        return $value instanceof Carbon
            ? Carbon::parse($value->toDateString())->startOfDay()
            : Carbon::parse($value)->startOfDay();
    }
}
