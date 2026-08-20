<?php

namespace App\Services\Attendance;

use App\Models\EmployeeWeeklyOffPolicy;
use App\Models\User;
use App\Models\WeeklyOffPolicy;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;

/**
 * WeeklyOffResolver's answer, for a whole roster over a whole range, in two
 * queries instead of two per person per day.
 *
 * WeeklyOffResolver is the authority and stays the authority: one employee, one
 * date, straight from the database, which is exactly right for the attendance
 * calendar asking about a single person's month. The attendance REPORT asks the
 * same question for every visible employee across a range that defaults to a
 * whole year. A hundred people over 365 days is 73,000 round trips through the
 * resolver, so this loads the assignments and the policies once and then
 * answers from memory.
 *
 * The resolution rules are copied deliberately rather than shared, and the unit
 * test asserts each of them, because a second convention would be a second
 * thing to get wrong:
 *
 *   1. An active EmployeeWeeklyOffPolicy whose [effective_from, effective_to]
 *      window contains the date. effective_to NULL is open-ended, windows
 *      overlap routinely, the latest effective_from wins and id breaks a
 *      same-day tie.
 *   2. If that assignment points at a policy that is missing or inactive, the
 *      organization default -- not the next-latest assignment. An archived
 *      policy means "this person has no special arrangement", not "use whatever
 *      they had before".
 *   3. The organization's default policy (is_default and is_active), newest
 *      first.
 *   4. Null, and null means NOTHING IS OFF.
 *
 * Step 4 is why `hasPolicyFor()` exists. Null cannot be handed to a report as
 * "works seven days a week" -- for an organization that has configured no
 * weekly-off policy at all that would mark everybody absent every Saturday and
 * Sunday, which is worse than the Sat/Sun guess it replaced. The caller asks
 * whether a policy speaks for this person at all, and keeps its own fallback
 * when none does.
 *
 * Tenancy is pinned in load() with forOrganization() rather than left to the
 * global scope, which is deliberately a no-op with no authenticated user. A
 * console command or queued job building this would otherwise match every
 * tenant's policy rows, and a weekly off is exactly the kind of quiet fact
 * nobody would notice had come from the wrong company.
 *
 * Everything below load() is pure: no clock, no database, no request.
 */
class WeeklyOffCalendar
{
    /** A real WeeklyOffPolicy decided this. */
    public const SOURCE_POLICY = 'policy';

    /** Nothing is configured, so the caller's Saturday/Sunday default stands. */
    public const SOURCE_CALENDAR_WEEKEND = 'calendar_weekend';

    /**
     * @param  array<int, list<array{policy_id: int, effective_from: string, effective_to: string|null, id: int}>>  $assignments  keyed by user id
     * @param  array<int, WeeklyOffPolicy>  $policies  keyed by policy id; active policies only
     */
    public function __construct(
        private readonly array $assignments,
        private readonly array $policies,
        private readonly ?WeeklyOffPolicy $organizationDefault,
    ) {
    }

    /**
     * Every assignment overlapping the range, and every active policy of the
     * organization, in two queries.
     *
     * @param  list<int>  $userIds
     */
    public static function load(int $organizationId, array $userIds, string $from, string $to): self
    {
        $userIds = array_values(array_unique(array_filter(array_map('intval', $userIds), fn (int $id) => $id > 0)));

        if ($organizationId <= 0 || $userIds === []) {
            return new self([], [], null);
        }

        $assignments = [];

        EmployeeWeeklyOffPolicy::forOrganization($organizationId)
            ->whereIn('user_id', $userIds)
            ->where('is_active', true)
            ->whereDate('effective_from', '<=', $to)
            ->where(function (Builder $window) use ($from) {
                $window->whereNull('effective_to')
                    ->orWhereDate('effective_to', '>=', $from);
            })
            ->get()
            ->each(function (EmployeeWeeklyOffPolicy $assignment) use (&$assignments) {
                $assignments[(int) $assignment->user_id][] = [
                    'policy_id' => (int) $assignment->weekly_off_policy_id,
                    'effective_from' => Carbon::parse($assignment->effective_from)->toDateString(),
                    'effective_to' => $assignment->effective_to
                        ? Carbon::parse($assignment->effective_to)->toDateString()
                        : null,
                    'id' => (int) $assignment->id,
                ];
            });

        $policies = WeeklyOffPolicy::forOrganization($organizationId)
            ->where('is_active', true)
            ->get()
            ->keyBy(fn (WeeklyOffPolicy $policy) => (int) $policy->id)
            ->all();

        $default = collect($policies)
            ->filter(fn (WeeklyOffPolicy $policy) => (bool) $policy->is_default)
            ->sortByDesc(fn (WeeklyOffPolicy $policy) => (int) $policy->id)
            ->first();

        return new self($assignments, $policies, $default);
    }

    /**
     * The policy in force for this person on this date, or null when none is.
     */
    public function policyFor(int $userId, string $date): ?WeeklyOffPolicy
    {
        $assignment = $this->assignmentFor($userId, $date);

        if ($assignment !== null) {
            $policy = $this->policies[$assignment['policy_id']] ?? null;

            if ($policy !== null) {
                return $policy;
            }
        }

        return $this->organizationDefault;
    }

    public function isWeeklyOff(int $userId, string $date): bool
    {
        return (bool) $this->policyFor($userId, $date)?->isOffOn($date);
    }

    /**
     * Does any configured policy speak for this person anywhere in the range?
     *
     * False is the caller's cue to keep its own fallback rather than report
     * that nothing is off -- see the class docblock.
     *
     * @param  iterable<string>  $dates
     */
    public function hasPolicyFor(int $userId, iterable $dates): bool
    {
        if ($this->organizationDefault !== null) {
            return true;
        }

        foreach ($dates as $date) {
            if ($this->policyFor($userId, (string) $date) !== null) {
                return true;
            }
        }

        return false;
    }

    /**
     * The off dates within the given dates, in the order they were given.
     *
     * Resolved date by date rather than once from the first, because an
     * effective-dated change lands mid-range more often than not and answering
     * a whole quarter from whichever policy was in force on day one is exactly
     * the mistake effective dating exists to prevent.
     *
     * @param  iterable<string>  $dates
     * @return list<string>
     */
    public function offDates(int $userId, iterable $dates): array
    {
        $off = [];

        foreach ($dates as $date) {
            $day = (string) $date;

            if ($this->isWeeklyOff($userId, $day)) {
                $off[] = $day;
            }
        }

        return $off;
    }

    /** Convenience for callers holding a User rather than an id. */
    public function offDatesForUser(User $user, iterable $dates): array
    {
        return $this->offDates((int) $user->id, $dates);
    }

    /**
     * The assignment window in force on the date: latest effective_from wins,
     * id breaks a same-day tie so two rows added on one day cannot flip between
     * requests.
     *
     * @return array{policy_id: int, effective_from: string, effective_to: string|null, id: int}|null
     */
    private function assignmentFor(int $userId, string $date): ?array
    {
        $candidates = [];

        foreach ($this->assignments[$userId] ?? [] as $assignment) {
            if ($assignment['effective_from'] > $date) {
                continue;
            }

            if ($assignment['effective_to'] !== null && $assignment['effective_to'] < $date) {
                continue;
            }

            $candidates[] = $assignment;
        }

        if ($candidates === []) {
            return null;
        }

        usort($candidates, function (array $left, array $right) {
            return [$right['effective_from'], $right['id']] <=> [$left['effective_from'], $left['id']];
        });

        return $candidates[0];
    }
}
