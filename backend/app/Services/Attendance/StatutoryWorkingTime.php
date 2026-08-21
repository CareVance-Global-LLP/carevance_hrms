<?php

namespace App\Services\Attendance;

use App\Models\LegalEntity;
use App\Models\User;
use App\Services\Payroll\LegalEntityResolver;

/**
 * The statute, in one place.
 *
 * Working-hour limits and the overtime rate are law, not configuration, so they
 * are written here once with the provision each number comes from rather than
 * scattered as literals through the engines that apply them. When a state
 * amends a limit, this is the file that changes.
 *
 * WHAT IS AND IS NOT INFERRED FROM A STATE. The numbers below are the central
 * Act. States amend them, and several have — but an amendment usually operates
 * through an EXEMPTION that a particular factory holds a written order for
 * (s.55 lets the Chief Inspector permit six hours of continuous work instead of
 * five; s.65(3) raises the quarterly overtime cap). A factory in Gujarat
 * WITHOUT that order is still on five hours. So an exemption is read from the
 * legal entity, where somebody recorded the order reference, and is never
 * inferred from an address. Inferring it would hand a customer a compliance
 * report that quietly says they are fine when they are not.
 *
 * SHOPS AND ESTABLISHMENTS. Deliberately thinner than the Factories Act
 * entries: the S&E Acts are state legislation and genuinely differ, so only the
 * limits that are common across the major states are asserted, and the daily
 * and spread-over ceilings are left null rather than guessed. A null limit
 * reports nothing; a wrong limit reports a breach that is not one, and a
 * compliance screen that cries wolf gets switched off.
 */
class StatutoryWorkingTime
{
    public function __construct(
        private readonly LegalEntityResolver $entities,
    ) {
    }

    /** The limits in force for one person, via the entity they file under. */
    public function forUser(?User $user): StatutoryLimits
    {
        if (! $user) {
            return StatutoryLimits::none();
        }

        return $this->forEntity($this->entities->forUser($user));
    }

    public function forEntity(?LegalEntity $entity): StatutoryLimits
    {
        $type = strtolower(trim((string) ($entity?->establishment_type ?? StatutoryLimits::UNREGULATED)));

        return match ($type) {
            StatutoryLimits::FACTORY => $this->factory($entity),
            StatutoryLimits::SHOPS_ESTABLISHMENT => $this->shopsEstablishment($entity),
            default => StatutoryLimits::none(),
        };
    }

    /**
     * The Factories Act 1948.
     *
     * s.51  48 hours in a week.
     * s.54  9 hours in a day.
     * s.55  no continuous period beyond 5 hours without at least 30 minutes
     *       rest; the Chief Inspector may exempt up to 6 hours in writing.
     * s.56  a spread-over of 10.5 hours.
     * s.59  overtime at twice the ordinary rate of wages.
     * s.64(4) 50 hours of overtime a quarter, and 60 hours in a week including
     *       overtime.
     */
    private function factory(?LegalEntity $entity): StatutoryLimits
    {
        return new StatutoryLimits(
            establishmentType: StatutoryLimits::FACTORY,
            maxDailyMinutes: 9 * 60,
            maxWeeklyMinutes: 48 * 60,
            maxSpreadOverMinutes: (int) (10.5 * 60),
            maxWeeklyIncludingOvertimeMinutes: 60 * 60,
            maxContinuousWorkMinutes: $this->continuousWorkMinutes($entity, 5 * 60),
            minimumRestMinutes: 30,
            overtimeMultiplierFloor: '2.00',
            quarterlyOvertimeMinutes: $this->quarterlyOvertimeMinutes($entity, 50 * 60),
            enforceOvertimeFloor: (bool) ($entity?->enforce_overtime_floor ?? false),
            exemptionReference: $entity?->exemption_reference,
            citations: [
                'max_weekly_minutes' => 'Factories Act 1948, s.51',
                'max_daily_minutes' => 'Factories Act 1948, s.54',
                'max_continuous_work_minutes' => 'Factories Act 1948, s.55',
                'max_spread_over_minutes' => 'Factories Act 1948, s.56',
                'overtime_multiplier_floor' => 'Factories Act 1948, s.59',
                'quarterly_overtime_minutes' => 'Factories Act 1948, s.64(4)',
                'max_weekly_including_overtime_minutes' => 'Factories Act 1948, s.64(4)',
            ],
        );
    }

    /**
     * The state Shops and Establishments Acts.
     *
     * Only what is common across the major states is asserted here. Overtime at
     * twice the ordinary rate and a 48-hour ordinary week hold in Karnataka,
     * Maharashtra, Delhi and Tamil Nadu alike; the daily ceiling, the
     * spread-over and the quarterly cap differ enough that stating one number
     * would be wrong somewhere, so they are left unasserted.
     */
    private function shopsEstablishment(?LegalEntity $entity): StatutoryLimits
    {
        return new StatutoryLimits(
            establishmentType: StatutoryLimits::SHOPS_ESTABLISHMENT,
            maxDailyMinutes: null,
            maxWeeklyMinutes: 48 * 60,
            maxSpreadOverMinutes: null,
            maxWeeklyIncludingOvertimeMinutes: null,
            maxContinuousWorkMinutes: $this->continuousWorkMinutes($entity, 5 * 60),
            minimumRestMinutes: 30,
            overtimeMultiplierFloor: '2.00',
            quarterlyOvertimeMinutes: $this->quarterlyOvertimeMinutes($entity, null),
            enforceOvertimeFloor: (bool) ($entity?->enforce_overtime_floor ?? false),
            exemptionReference: $entity?->exemption_reference,
            citations: [
                'max_weekly_minutes' => 'State Shops and Establishments Act',
                'max_continuous_work_minutes' => 'State Shops and Establishments Act',
                'overtime_multiplier_floor' => 'State Shops and Establishments Act',
            ],
        );
    }

    /**
     * An exemption may only ever RELAX the statutory period, never tighten it
     * below the Act — a recorded value shorter than the default is treated as
     * a data-entry mistake rather than obeyed, because obeying it would produce
     * breach reports the law does not require and train people to ignore them.
     */
    private function continuousWorkMinutes(?LegalEntity $entity, int $default): int
    {
        $exempt = (int) ($entity?->rest_interval_exemption_minutes ?? 0);

        return $exempt > $default ? $exempt : $default;
    }

    private function quarterlyOvertimeMinutes(?LegalEntity $entity, ?int $default): ?int
    {
        $hours = (int) ($entity?->quarterly_overtime_cap_hours ?? 0);

        return $hours > 0 ? $hours * 60 : $default;
    }
}
