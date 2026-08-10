<?php

namespace App\Services\Lifecycle;

use App\Models\Organization;
use App\Models\User;
use Carbon\Carbon;
use Carbon\CarbonInterface;

/**
 * The single answer to "how much notice does this person owe, and are they short?".
 *
 * Three places need it — the resignation form (before submit), the exit record,
 * and the settlement calculator. Previously only the settlement knew, and it
 * learned by someone typing the number in by hand, so the employee could not
 * see a shortfall until payroll told them about it.
 */
class NoticePeriodService
{
    public const DEFAULT_DAYS = 30;
    private const SETTINGS_KEY = 'notice_period_days';

    /**
     * Resolution order: the employee's own work info, then the organisation
     * default, then the system default. Same shape as the monitoring interval
     * resolver, deliberately.
     */
    public function daysFor(User $user): int
    {
        // Per-person overrides live in the existing `meta` JSON rather than a new
        // column: only a minority of contracts differ from the org policy, and a
        // sparse column on every work-info row is not worth a migration.
        $meta = $user->employeeWorkInfo?->meta ?? [];
        $personal = is_array($meta) ? ($meta[self::SETTINGS_KEY] ?? null) : null;

        if (is_numeric($personal) && (int) $personal > 0) {
            return (int) $personal;
        }

        return $this->organizationDefault($user->organization_id);
    }

    public function organizationDefault(?int $organizationId): int
    {
        if (! $organizationId) {
            return self::DEFAULT_DAYS;
        }

        $settings = Organization::find($organizationId)?->settings ?? [];
        $configured = is_array($settings) ? ($settings[self::SETTINGS_KEY] ?? null) : null;

        return is_numeric($configured) && (int) $configured > 0
            ? (int) $configured
            : self::DEFAULT_DAYS;
    }

    /**
     * How the proposed last working day measures up.
     *
     * `served_days` is inclusive of both ends: a resignation submitted on the
     * 1st with a last working day of the 30th serves 30 days, not 29. Getting
     * this off by one understates every notice period by a day.
     *
     * @return array{required:int,served:int,shortfall:int,earliest_date:string}
     */
    public function evaluate(User $user, CarbonInterface $lastWorkingDate, ?CarbonInterface $from = null): array
    {
        $required = $this->daysFor($user);
        $start = ($from ? Carbon::parse($from) : Carbon::now())->startOfDay();
        $end = Carbon::parse($lastWorkingDate)->startOfDay();

        $served = $end->lt($start) ? 0 : (int) $start->diffInDays($end) + 1;
        $shortfall = max(0, $required - $served);

        return [
            'required' => $required,
            'served' => $served,
            'shortfall' => $shortfall,
            'earliest_date' => $start->copy()->addDays(max(0, $required - 1))->toDateString(),
        ];
    }
}
