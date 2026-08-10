<?php

namespace App\Services\Payroll;

use App\Models\Organization;
use Carbon\Carbon;

/**
 * The per-day salary divisor — the number a monthly salary is divided by to
 * value one day.
 *
 * This was previously the attendance-derived working-day count (Mon-Fri minus
 * holidays, ~21-23). That is both non-compliant and out of step with the
 * market:
 *
 *   - Payment of Wages Act s.9(2) caps a deduction for absence at the
 *     proportion the absent period bears to the wage period. The wage period
 *     is the calendar month, so one absent day may cost at most 1/30 of wages.
 *     A 22-day divisor charges 1/22 — an over-deduction on every absence,
 *     provable from the payslip itself.
 *   - EPFO counts non-contributory (NCP) days as calendar days, so a
 *     working-day LOP count cannot be reconciled against the ECR return.
 *   - Zoho, Keka, greytHR and RazorpayX all default to actual calendar days
 *     or a fixed 30. A customer migrating from any of them would see roughly
 *     a third more deducted for the same absence.
 *
 * Default is therefore CALENDAR. The other bases exist because real employers
 * run real policies: a fixed 30 is common, and 26 is the Minimum Wages daily
 * rate convention. ATTENDANCE is retained only so payroll items produced
 * before this change stay reproducible — it is not offered as a new choice.
 */
class PayrollDayBasisResolver
{
    public const BASIS_CALENDAR = 'calendar';
    public const BASIS_FIXED_30 = 'fixed_30';
    public const BASIS_FIXED_26 = 'fixed_26';

    /** Legacy only. Rows created before the divisor was made explicit. */
    public const BASIS_ATTENDANCE = 'attendance';

    public const DEFAULT_BASIS = self::BASIS_CALENDAR;

    /** Bases an organisation may choose today. */
    public const SELECTABLE = [self::BASIS_CALENDAR, self::BASIS_FIXED_30, self::BASIS_FIXED_26];

    /**
     * The basis configured for an organisation.
     *
     * Anything unrecognised — including the legacy 'attendance' value — falls
     * back to the statutory default rather than being honoured, so a stale
     * setting cannot keep an org on a non-compliant divisor.
     */
    public function basisFor(?Organization $organization): string
    {
        $settings = is_array($organization?->settings) ? $organization->settings : [];
        $basis = strtolower(trim((string) ($settings['payroll']['dayBasis'] ?? '')));

        return in_array($basis, self::SELECTABLE, true) ? $basis : self::DEFAULT_BASIS;
    }

    /**
     * How many days one month's salary is spread across.
     *
     * @param string $monthYear 'Y-m'
     */
    public function divisorDays(string $basis, string $monthYear, ?float $attendanceWorkingDays = null): float
    {
        return match ($basis) {
            self::BASIS_FIXED_30 => 30.0,
            self::BASIS_FIXED_26 => 26.0,
            // Only reachable for historical rows; falls back to the calendar
            // when no working-day count was recorded.
            self::BASIS_ATTENDANCE => $attendanceWorkingDays !== null && $attendanceWorkingDays > 0
                ? (float) $attendanceWorkingDays
                : $this->calendarDays($monthYear),
            default => $this->calendarDays($monthYear),
        };
    }

    /** Resolve both the basis and the divisor for an organisation and month. */
    public function resolve(?Organization $organization, string $monthYear, ?float $attendanceWorkingDays = null): array
    {
        $basis = $this->basisFor($organization);

        return [
            'basis' => $basis,
            'days' => $this->divisorDays($basis, $monthYear, $attendanceWorkingDays),
        ];
    }

    public function calendarDays(string $monthYear): float
    {
        return (float) Carbon::createFromFormat('Y-m', $monthYear)->startOfMonth()->daysInMonth;
    }

    /**
     * The divisor a stored payroll item was computed with.
     *
     * A locked or disbursed item must never re-derive against live config —
     * that is how an already-paid month silently changes its own arithmetic.
     */
    public function forStoredItem(\App\Models\PayrollItem $item): float
    {
        if ($item->salary_divisor_days !== null && (float) $item->salary_divisor_days > 0) {
            return (float) $item->salary_divisor_days;
        }

        // Pre-migration row with nothing stamped: the attendance count is what
        // it was actually divided by.
        $working = (float) ($item->total_working_days ?? 0);

        return $working > 0 ? $working : $this->calendarDays((string) $item->month_year);
    }
}
