<?php

namespace App\Services\Attendance;

use App\Models\EmployeeOvertimePolicy;
use App\Models\EmployeePenalisationPolicy;
use App\Models\EmployeeShiftAllowancePolicy;
use App\Models\EmployeeWeeklyOffPolicy;
use App\Models\OvertimePolicy;
use App\Models\PenalisationPolicy;
use App\Models\ShiftAllowancePolicy;
use App\Models\User;
use App\Models\WeeklyOffPolicy;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use InvalidArgumentException;

/**
 * "Which working-time policy is this person on, on this date" — for all four
 * kinds, by exactly the rule ShiftResolver already uses for shifts.
 *
 * Resolution order, most specific first:
 *
 *   1. An active assignment row whose [effective_from, effective_to] window
 *      contains the date, pointing at a policy that is still active.
 *      effective_to NULL is open-ended. Windows overlap routinely — the
 *      previous assignment is usually left open when a new one is added — and
 *      the LATEST effective_from wins, with id breaking a same-day tie so two
 *      rows added on one day cannot flip between requests.
 *   2. The workspace default: the newest active policy of that kind flagged
 *      is_default. That is what the flag is for; without this step a default
 *      would be a label with no behaviour.
 *   3. Nothing. Never a guessed policy — the caller decides what "unconfigured"
 *      means, because only the caller knows whether the honest answer is zero
 *      or the legacy shift column.
 *
 * Tenancy is pinned with forOrganization($user->organization_id) on every read
 * rather than left to the ambient global scope. That scope is deliberately a
 * no-op when nothing is authenticated, so a queued job or a console command
 * asking about one employee would otherwise be free to match another tenant's
 * row.
 */
class PolicyAssignmentResolver
{
    public const KIND_WEEKLY_OFF = 'weekly_off';
    public const KIND_PENALISATION = 'penalisation';
    public const KIND_OVERTIME = 'overtime';
    public const KIND_SHIFT_ALLOWANCE = 'shift_allowance';

    /**
     * kind => [assignment model, policy model, foreign key].
     *
     * @var array<string, array{0: class-string, 1: class-string, 2: string}>
     */
    private const KINDS = [
        self::KIND_WEEKLY_OFF => [EmployeeWeeklyOffPolicy::class, WeeklyOffPolicy::class, 'weekly_off_policy_id'],
        self::KIND_PENALISATION => [EmployeePenalisationPolicy::class, PenalisationPolicy::class, 'penalisation_policy_id'],
        self::KIND_OVERTIME => [EmployeeOvertimePolicy::class, OvertimePolicy::class, 'overtime_policy_id'],
        self::KIND_SHIFT_ALLOWANCE => [EmployeeShiftAllowancePolicy::class, ShiftAllowancePolicy::class, 'shift_allowance_policy_id'],
    ];

    /** @return list<string> */
    public static function kinds(): array
    {
        return array_keys(self::KINDS);
    }

    public function resolve(string $kind, ?User $user, Carbon|string|null $date = null): ResolvedPolicy
    {
        if (! isset(self::KINDS[$kind])) {
            throw new InvalidArgumentException("Unknown working-time policy kind [{$kind}].");
        }

        if (! $user || ! $user->organization_id) {
            return ResolvedPolicy::none($kind);
        }

        [$assignmentClass, $policyClass, $foreignKey] = self::KINDS[$kind];

        $organizationId = (int) $user->organization_id;
        $on = self::normalizeDate($date);

        $assignment = $assignmentClass::forOrganization($organizationId)
            ->where('user_id', $user->id)
            ->where('is_active', true)
            ->whereDate('effective_from', '<=', $on)
            ->where(function (Builder $window) use ($on) {
                $window->whereNull('effective_to')
                    ->orWhereDate('effective_to', '>=', $on);
            })
            ->orderByDesc('effective_from')
            ->orderByDesc('id')
            ->first();

        if ($assignment) {
            $policy = $policyClass::forOrganization($organizationId)
                ->where('is_active', true)
                ->find((int) $assignment->{$foreignKey});

            if ($policy) {
                return new ResolvedPolicy($kind, ResolvedPolicy::SOURCE_ASSIGNMENT, $policy, $assignment);
            }

            // The assignment survives a deactivated policy on purpose: the
            // roster row is still the historical fact. It simply stops
            // resolving, and the default below answers instead.
        }

        $default = $policyClass::forOrganization($organizationId)
            ->where('is_active', true)
            ->where('is_default', true)
            ->orderByDesc('id')
            ->first();

        return $default
            ? new ResolvedPolicy($kind, ResolvedPolicy::SOURCE_DEFAULT, $default)
            : ResolvedPolicy::none($kind);
    }

    public function weeklyOffFor(?User $user, Carbon|string|null $date = null): ResolvedPolicy
    {
        return $this->resolve(self::KIND_WEEKLY_OFF, $user, $date);
    }

    public function penalisationFor(?User $user, Carbon|string|null $date = null): ResolvedPolicy
    {
        return $this->resolve(self::KIND_PENALISATION, $user, $date);
    }

    public function overtimeFor(?User $user, Carbon|string|null $date = null): ResolvedPolicy
    {
        return $this->resolve(self::KIND_OVERTIME, $user, $date);
    }

    public function shiftAllowanceFor(?User $user, Carbon|string|null $date = null): ResolvedPolicy
    {
        return $this->resolve(self::KIND_SHIFT_ALLOWANCE, $user, $date);
    }

    /**
     * All four at once, for the screen that shows a person their working-time
     * setup.
     *
     * @return array<string, ResolvedPolicy>
     */
    public function resolveAll(?User $user, Carbon|string|null $date = null): array
    {
        $resolved = [];

        foreach (self::kinds() as $kind) {
            $resolved[$kind] = $this->resolve($kind, $user, $date);
        }

        return $resolved;
    }

    /**
     * A calendar date, as Y-m-d.
     *
     * A Carbon passed here contributes only its Y-m-d: "the policy in force on
     * the 19th" must not become the 18th because the caller's clock was behind
     * the employee's.
     */
    private static function normalizeDate(Carbon|string|null $date): string
    {
        if ($date instanceof Carbon) {
            return $date->toDateString();
        }

        if (is_string($date) && trim($date) !== '') {
            return Carbon::parse($date)->toDateString();
        }

        return Carbon::now()->toDateString();
    }
}
