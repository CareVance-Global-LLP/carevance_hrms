<?php

namespace App\Services\Attendance;

use App\Models\EmployeeWeeklyOffPolicy;
use App\Models\User;
use App\Models\WeeklyOffPolicy;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;

/**
 * The single answer to "is this date a weekly off for this person".
 *
 * Resolution order mirrors ShiftResolver exactly, because the two are assigned
 * the same way and a second convention would be a second thing to get wrong:
 *
 *   1. An active EmployeeWeeklyOffPolicy whose [effective_from, effective_to]
 *      window contains the date. effective_to NULL is open-ended, windows
 *      routinely overlap, and the latest effective_from wins.
 *   2. The organization's default policy (is_default and is_active), newest
 *      first.
 *   3. Null — and null means NOTHING IS OFF.
 *
 * That last step is the one worth stating out loud. An unconfigured
 * weekly-off policy could plausibly mean "Saturday and Sunday, like everyone
 * else", and guessing that would mark an entire organization off on two days a
 * week they were told to work — which downstream reads as absence, as unpaid
 * overtime at the weekly-off rate, or as a penalty waived. The same asymmetry
 * is documented on WeeklyOffPolicy itself: empty day_rules marks nothing off,
 * the opposite of Shift::appliesOn where empty means "runs every day".
 *
 * Tenancy: every lookup is pinned with forOrganization($user->organization_id)
 * rather than leaning on the ambient global scope, which is deliberately a
 * no-op when nothing is authenticated. A queued payroll job asking about one
 * employee would otherwise be free to match another tenant's policy row.
 */
class WeeklyOffResolver
{
    public const SOURCE_ASSIGNMENT = 'assignment';
    public const SOURCE_ORGANIZATION_DEFAULT = 'organization_default';

    /**
     * Is this calendar date a weekly off for this person?
     *
     * False when nothing is configured — see the class docblock.
     */
    public function isWeeklyOff(?User $user, Carbon|string|null $date = null): bool
    {
        $on = $this->normalizeDate($date);

        return (bool) $this->policyFor($user, $on)?->isOffOn($on);
    }

    /**
     * The policy in force for this person on this date, or null.
     */
    public function policyFor(?User $user, Carbon|string|null $date = null): ?WeeklyOffPolicy
    {
        if (! $user || ! $user->organization_id) {
            return null;
        }

        $organizationId = (int) $user->organization_id;
        $assignment = $this->assignmentFor($user, $date);

        if ($assignment) {
            $policy = WeeklyOffPolicy::forOrganization($organizationId)
                ->where('is_active', true)
                ->find($assignment->weekly_off_policy_id);

            if ($policy) {
                return $policy;
            }
        }

        return $this->organizationDefault($organizationId);
    }

    /**
     * Where the answer came from, for a caller that has to explain itself.
     */
    public function sourceFor(?User $user, Carbon|string|null $date = null): ?string
    {
        if (! $user || ! $user->organization_id) {
            return null;
        }

        $assignment = $this->assignmentFor($user, $date);

        if ($assignment && WeeklyOffPolicy::forOrganization((int) $user->organization_id)
            ->where('is_active', true)
            ->find($assignment->weekly_off_policy_id)) {
            return self::SOURCE_ASSIGNMENT;
        }

        return $this->organizationDefault((int) $user->organization_id)
            ? self::SOURCE_ORGANIZATION_DEFAULT
            : null;
    }

    /**
     * The assignment row in force on the date, whether or not the policy behind
     * it is still usable — the rostering screen cares about the assignment even
     * when the policy has been archived.
     */
    public function assignmentFor(User $user, Carbon|string|null $date = null): ?EmployeeWeeklyOffPolicy
    {
        if (! $user->organization_id) {
            // forOrganization(0) would match nothing anyway; refusing outright
            // keeps an org-less user from ever reaching a tenant-scoped query.
            return null;
        }

        $on = $this->normalizeDate($date)->toDateString();

        return EmployeeWeeklyOffPolicy::forOrganization((int) $user->organization_id)
            ->where('user_id', $user->id)
            ->where('is_active', true)
            ->whereDate('effective_from', '<=', $on)
            ->where(function (Builder $window) use ($on) {
                $window->whereNull('effective_to')
                    ->orWhereDate('effective_to', '>=', $on);
            })
            // Latest window wins; id breaks a same-day tie deterministically so
            // two assignments added on one day cannot flip between requests.
            ->orderByDesc('effective_from')
            ->orderByDesc('id')
            ->first();
    }

    /**
     * Every weekly off in a month, as Y-m-d strings, ascending. Empty when
     * nothing is configured.
     *
     * Resolved date by date rather than once from the 1st: an effective-dated
     * change lands mid-month more often than not, and answering the whole month
     * from whichever policy was in force on the 1st is exactly the
     * off-by-a-fortnight that effective dating exists to prevent.
     *
     * @return list<string>
     */
    public function offDatesForMonth(?User $user, int $year, int $month): array
    {
        $cursor = Carbon::create($year, $month, 1)->startOfDay();
        $days = (int) $cursor->daysInMonth;
        $dates = [];

        for ($day = 1; $day <= $days; $day++) {
            $date = $cursor->copy()->day($day);

            if ($this->isWeeklyOff($user, $date)) {
                $dates[] = $date->toDateString();
            }
        }

        return $dates;
    }

    private function organizationDefault(int $organizationId): ?WeeklyOffPolicy
    {
        return WeeklyOffPolicy::forOrganization($organizationId)
            ->where('is_active', true)
            ->where('is_default', true)
            ->orderByDesc('id')
            ->first();
    }

    /**
     * A Carbon passed here contributes only its Y-m-d. Its own time and zone
     * are ignored, because "is the 16th an off day" must not become the 15th
     * just because the caller's clock was behind the employee's.
     */
    private function normalizeDate(Carbon|string|null $date): Carbon
    {
        if ($date instanceof Carbon) {
            return Carbon::parse($date->toDateString())->startOfDay();
        }

        if (is_string($date) && trim($date) !== '') {
            return Carbon::parse($date)->startOfDay();
        }

        return Carbon::now()->startOfDay();
    }
}
