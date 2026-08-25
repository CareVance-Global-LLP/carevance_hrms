<?php

namespace App\Services\Payroll;

use Carbon\Carbon;

/**
 * When each statutory return is actually due.
 *
 * The single place the deadline is written down, with the provision each date
 * comes from — the same shape as StatutoryWorkingTime, and for the same reason:
 * a date somebody typed into a component is a date nobody can check.
 *
 * There WAS a compliance calendar before this, on PayrollDashboardController.
 * It was on no route at all, so nothing rendered it, and it computed PF and ESI
 * as the 15th of the PERIOD month rather than the month after — every deadline
 * a month early, every filing permanently overdue. Rather than wire that up,
 * this replaces it.
 *
 * Two rules hold everything here together:
 *
 * - A deadline is a CALENDAR DATE, so everything returns a date-only Carbon at
 *   start of day. Comparisons against "now" use endOfDay, because a return
 *   filed at 6pm on the 15th was filed on the 15th.
 *
 * - An unknown deadline returns NULL, never a guess. Several states levy no
 *   professional tax at all, and inventing a date for one of them produces an
 *   overdue badge for a return that does not exist. Null renders as
 *   "no deadline recorded", which is the truth and is actionable.
 */
class FilingDueDates
{
    /**
     * Monthly returns due on a fixed day of the FOLLOWING month.
     *
     * @var array<string, array{day:int, authority:string}>
     */
    private const MONTHLY = [
        'pf_ecr' => [
            'day' => 15,
            'authority' => 'EPF Scheme 1952, para 38 — within 15 days of the close of the month',
        ],
        'full_ecr' => [
            'day' => 15,
            'authority' => 'EPF Scheme 1952, para 38',
        ],
        'esi_challan' => [
            'day' => 15,
            'authority' => 'ESI (General) Regulations 1950, reg. 31 — within 15 days of the month',
        ],
    ];

    /**
     * Quarterly TDS statements. Keyed by the quarter the period falls in.
     *
     * Q4 is 31 May, not 30 April — the fourth quarter gets an extra month
     * because the annual reconciliation happens alongside it.
     *
     * @var array<int, array{month:int, day:int}>
     */
    private const TDS_QUARTER_END = [
        1 => ['month' => 7,  'day' => 31],   // Apr-Jun  -> 31 Jul
        2 => ['month' => 10, 'day' => 31],   // Jul-Sep  -> 31 Oct
        3 => ['month' => 1,  'day' => 31],   // Oct-Dec  -> 31 Jan (next year)
        4 => ['month' => 5,  'day' => 31],   // Jan-Mar  -> 31 May
    ];

    /**
     * Professional tax, which is state legislation and genuinely differs.
     *
     * Absent from this map means "we do not know", not "no deadline" and not
     * "the 15th" — see the null rule in the class comment. Several states levy
     * no PT at all and correctly never appear here.
     *
     * @var array<string, array{day:int, authority:string}>
     */
    private const PT_STATE_DAY = [
        'gujarat'     => ['day' => 15, 'authority' => 'Gujarat State Tax on Professions Act 1976, r.11'],
        'karnataka'   => ['day' => 20, 'authority' => 'Karnataka Tax on Professions Act 1976, r.9'],
        'maharashtra' => ['day' => 31, 'authority' => 'Maharashtra PT Act 1975, r.11 — month end'],
        'west_bengal' => ['day' => 21, 'authority' => 'West Bengal State Tax on Professions Act 1979'],
        'telangana'   => ['day' => 10, 'authority' => 'Telangana PT Act 1987, r.5'],
        'andhra_pradesh' => ['day' => 10, 'authority' => 'Andhra Pradesh PT Act 1987, r.5'],
        'tamil_nadu'  => ['day' => 30, 'authority' => 'Tamil Nadu Town Panchayats etc. Act 1998 — half-yearly'],
        'madhya_pradesh' => ['day' => 10, 'authority' => 'Madhya Pradesh PT Act 1995'],
    ];

    /**
     * The deadline for one filing of one period.
     *
     * @param  string  $type       Filing type, e.g. 'pf_ecr'.
     * @param  string  $monthYear  The PERIOD being filed for, as 'YYYY-MM'.
     * @param  string|null  $state  Lowercased state key, for state-levied returns.
     */
    public function dueDateFor(string $type, string $monthYear, ?string $state = null): ?Carbon
    {
        $period = $this->parsePeriod($monthYear);

        if (! $period) {
            return null;
        }

        if (isset(self::MONTHLY[$type])) {
            // The month AFTER the period. Getting this wrong is what made the
            // previous calendar mark everything overdue.
            return $period->copy()->addMonthNoOverflow()->day(self::MONTHLY[$type]['day'])->startOfDay();
        }

        if ($type === 'form_24q') {
            return $this->tdsStatementDue($period);
        }

        if ($type === 'form_16' || $type === 'form_16_annual') {
            // Rule 31: within 15 days of the due date for the Q4 statement.
            return Carbon::create($this->financialYearEnd($period), 6, 15)->startOfDay();
        }

        if ($type === 'form_12ba') {
            // Issued with Form 16, so it inherits that deadline.
            return Carbon::create($this->financialYearEnd($period), 6, 15)->startOfDay();
        }

        if ($type === 'pt_return') {
            $key = $this->normaliseState($state);

            if (! $key || ! isset(self::PT_STATE_DAY[$key])) {
                return null;
            }

            $due = $period->copy()->addMonthNoOverflow();

            // day(31) on a 30-day month rolls into the next one; clamp instead.
            return $due->day(min(self::PT_STATE_DAY[$key]['day'], $due->daysInMonth))->startOfDay();
        }

        if ($type === 'bonus_form_c' || $type === 'bonus_form_d') {
            /*
             * s.19 of the Payment of Bonus Act gives eight months from the
             * close of the accounting year to PAY, and r.5 gives 30 days from
             * payment to file the return. Eight months from a 31 March close is
             * 30 November, which is the date the whole industry works to.
             */
            return Carbon::create($this->financialYearEnd($period), 11, 30)->startOfDay();
        }

        // lwf_return is half-yearly and state-specific with too little
        // commonality to encode responsibly yet; registrations and declaration
        // forms have no period deadline at all. Null, not a guess.
        return null;
    }

    /** Human-readable provision, for the tooltip beside the date. */
    public function authorityFor(string $type, ?string $state = null): ?string
    {
        if (isset(self::MONTHLY[$type])) {
            return self::MONTHLY[$type]['authority'];
        }

        if ($type === 'form_24q') {
            return 'Income-tax Rules, r.31A — quarterly statement of TDS on salary';
        }

        if ($type === 'form_16' || $type === 'form_16_annual' || $type === 'form_12ba') {
            return 'Income-tax Rules, r.31 — by 15 June following the financial year';
        }

        if ($type === 'pt_return') {
            $key = $this->normaliseState($state);

            return $key && isset(self::PT_STATE_DAY[$key])
                ? self::PT_STATE_DAY[$key]['authority']
                : null;
        }

        if ($type === 'bonus_form_c' || $type === 'bonus_form_d') {
            return 'Payment of Bonus Act 1965, s.19 (payment) and Rules 1975, r.5 (return)';
        }

        return null;
    }

    /**
     * Days remaining, and an urgency band the UI can colour by.
     *
     * `filedAt` matters: once a return is filed it can never become overdue,
     * however long ago the deadline was. A screen that reddens a filed return
     * is a screen people stop reading.
     *
     * @return array{due_date:?string, days_remaining:?int, urgency:string, authority:?string}
     */
    public function assess(string $type, string $monthYear, ?string $state = null, ?Carbon $filedAt = null): array
    {
        $due = $this->dueDateFor($type, $monthYear, $state);
        $authority = $this->authorityFor($type, $state);

        if (! $due) {
            return [
                'due_date' => null,
                'days_remaining' => null,
                'urgency' => 'unscheduled',
                'authority' => $authority,
            ];
        }

        if ($filedAt) {
            return [
                'due_date' => $due->toDateString(),
                'days_remaining' => null,
                // Filed late is a real fact and worth keeping distinct from
                // filed on time, but neither is a call to action any more.
                'urgency' => $filedAt->startOfDay()->lessThanOrEqualTo($due->copy()->endOfDay())
                    ? 'filed_on_time'
                    : 'filed_late',
                'authority' => $authority,
            ];
        }

        $days = (int) now()->startOfDay()->diffInDays($due->copy()->startOfDay(), false);

        return [
            'due_date' => $due->toDateString(),
            'days_remaining' => $days,
            'urgency' => match (true) {
                $days < 0 => 'overdue',
                $days <= 3 => 'critical',
                $days <= 7 => 'due_soon',
                default => 'scheduled',
            },
            'authority' => $authority,
        ];
    }

    /** Every type this service can date, so the calendar knows what to list. */
    public function scheduledTypes(): array
    {
        return array_merge(
            array_keys(self::MONTHLY),
            ['form_24q', 'form_16', 'form_12ba', 'pt_return', 'bonus_form_c', 'bonus_form_d'],
        );
    }

    private function parsePeriod(string $monthYear): ?Carbon
    {
        if (! preg_match('/^(\d{4})-(\d{2})$/', $monthYear, $m)) {
            return null;
        }

        $month = (int) $m[2];

        if ($month < 1 || $month > 12) {
            return null;
        }

        return Carbon::create((int) $m[1], $month, 1)->startOfDay();
    }

    private function tdsStatementDue(Carbon $period): Carbon
    {
        // Indian financial year: Apr-Jun is Q1.
        $quarter = (int) ceil(((($period->month - 4 + 12) % 12) + 1) / 3);
        $target = self::TDS_QUARTER_END[$quarter];

        // Q3 (Oct-Dec) is due in January of the following calendar year.
        $year = $quarter === 3 ? $period->year + 1 : $period->year;

        // Q4 (Jan-Mar) already sits in the next calendar year of the same FY.
        if ($quarter === 4) {
            $year = $period->year;
        }

        return Carbon::create($year, $target['month'], $target['day'])->startOfDay();
    }

    /** The calendar year in which the period's financial year ends. */
    private function financialYearEnd(Carbon $period): int
    {
        return $period->month >= 4 ? $period->year + 1 : $period->year;
    }

    private function normaliseState(?string $state): ?string
    {
        if (! $state) {
            return null;
        }

        return strtolower(str_replace([' ', '-'], '_', trim($state)));
    }
}
