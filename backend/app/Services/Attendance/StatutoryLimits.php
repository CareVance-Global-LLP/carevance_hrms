<?php

namespace App\Services\Attendance;

/**
 * What the law requires of one establishment, as numbers.
 *
 * Every field is nullable except the rest length, because "this establishment
 * has no statutory ceiling on daily hours" is a real answer and must not be
 * confused with zero. A null limit is never breached; a zero limit is breached
 * by one minute of work.
 *
 * Minutes throughout, because every clock in this codebase is minutes and a
 * unit change between the statute and the measurement is how a nine-hour limit
 * becomes a nine-minute one.
 */
final class StatutoryLimits
{
    /** Registered under the Factories Act 1948. */
    public const FACTORY = 'factory';

    /** Under the state's Shops and Establishments Act. */
    public const SHOPS_ESTABLISHMENT = 'shops_establishment';

    /**
     * Nobody has said. The default, and deliberately inert: it asserts no
     * limits at all rather than guessing a regime, because guessing `factory`
     * invents breaches for a software company and guessing the other
     * under-states a real factory's obligations.
     */
    public const UNREGULATED = 'unregulated';

    public function __construct(
        public readonly string $establishmentType,
        /** Ordinary hours in a day before overtime begins. Factories Act s.54. */
        public readonly ?int $maxDailyMinutes = null,
        /** Ordinary hours in a week before overtime begins. Factories Act s.51. */
        public readonly ?int $maxWeeklyMinutes = null,
        /** Clock-in to clock-out, breaks included. Factories Act s.56. */
        public readonly ?int $maxSpreadOverMinutes = null,
        /** Everything, overtime included, in one week. Factories Act s.64(4). */
        public readonly ?int $maxWeeklyIncludingOvertimeMinutes = null,
        /** Continuous work before a rest interval is due. Factories Act s.55. */
        public readonly ?int $maxContinuousWorkMinutes = null,
        /** How long that rest interval must be. */
        public readonly int $minimumRestMinutes = 30,
        /**
         * The least an overtime hour may be worth, as a decimal string
         * multiplier of the ordinary rate. Factories Act s.59: twice.
         *
         * A string, not a float, for the same reason every other rate in this
         * codebase is — it is compared against a configured multiplier in
         * bcmath, and a float comparison of 2.0 against "2.00" is a coin toss
         * on the wrong day.
         */
        public readonly ?string $overtimeMultiplierFloor = null,
        /** Overtime in one calendar quarter. Factories Act s.64(4): fifty hours. */
        public readonly ?int $quarterlyOvertimeMinutes = null,
        /** Whether the floor is applied to pay or only reported. */
        public readonly bool $enforceOvertimeFloor = false,
        /** The order granting any exemption reflected in the numbers above. */
        public readonly ?string $exemptionReference = null,
        /** @var array<string, string> field => the provision it comes from */
        public readonly array $citations = [],
    ) {
    }

    /** Nothing is regulated, so nothing can be breached. */
    public static function none(string $establishmentType = self::UNREGULATED): self
    {
        return new self(establishmentType: $establishmentType);
    }

    public function isRegulated(): bool
    {
        return $this->establishmentType !== self::UNREGULATED;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'establishment_type' => $this->establishmentType,
            'is_regulated' => $this->isRegulated(),
            'max_daily_minutes' => $this->maxDailyMinutes,
            'max_weekly_minutes' => $this->maxWeeklyMinutes,
            'max_spread_over_minutes' => $this->maxSpreadOverMinutes,
            'max_weekly_including_overtime_minutes' => $this->maxWeeklyIncludingOvertimeMinutes,
            'max_continuous_work_minutes' => $this->maxContinuousWorkMinutes,
            'minimum_rest_minutes' => $this->minimumRestMinutes,
            'overtime_multiplier_floor' => $this->overtimeMultiplierFloor,
            'quarterly_overtime_minutes' => $this->quarterlyOvertimeMinutes,
            'enforce_overtime_floor' => $this->enforceOvertimeFloor,
            'exemption_reference' => $this->exemptionReference,
            'citations' => $this->citations,
        ];
    }
}
