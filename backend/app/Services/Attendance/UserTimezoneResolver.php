<?php

namespace App\Services\Attendance;

use App\Models\User;
use Illuminate\Support\Collection;

/**
 * The one authority on "which wall clock does this person work in".
 *
 * This chain lived privately inside AttendanceService, so the attendance
 * screens honoured a per-employee zone while the activity feed and the report
 * rollups resolved everything from `config('app.timezone')`. A tenant outside
 * the app default therefore read Timeline in the wrong wall clock and — the
 * expensive half — had their per-user-per-day rows bucketed under the wrong
 * calendar date, which silently moves work between days with nothing
 * downstream able to notice.
 *
 * Resolution order, unchanged from the AttendanceService original:
 *   1. employee_work_infos.expected_timezone  (the employee's own setting)
 *   2. users.settings['timezone']
 *   3. organizations.settings['timezone']
 *   4. config('app.timezone')
 *
 * Keka anchors this on the work location; `expected_timezone` is where that
 * lands here today, and step 1 is the seam a location-derived zone would slot
 * into without touching any caller.
 */
class UserTimezoneResolver
{
    /**
     * userId => timezone, for the life of this instance.
     *
     * Registered as a singleton (see AppServiceProvider), so within one request
     * a report that renders hundreds of rows resolves each person once instead
     * of re-reading employee_work_infos per row. A long-lived queue worker
     * keeps the memo across jobs; call flush() if a job changes a timezone and
     * then reads it back.
     *
     * @var array<int, string>
     */
    private array $memo = [];

    /**
     * Resolve for an already-hydrated user.
     *
     * Reads the relations off the model, lazy-loading them if absent — the same
     * access pattern AttendanceService used, so a User loaded with everything
     * costs no extra query.
     */
    public function forUser(?User $user): string
    {
        if (! $user) {
            // No user in scope: the app default is the only defensible answer.
            return $this->appDefault();
        }

        $id = (int) $user->getKey();
        if ($id > 0 && isset($this->memo[$id])) {
            return $this->memo[$id];
        }

        $timezone = $this->resolveChain($user);

        if ($id > 0) {
            $this->memo[$id] = $timezone;
        }

        return $timezone;
    }

    /**
     * Resolve for a bare user id — the shape the activity and report paths have,
     * where rows carry `user_id` and no model.
     */
    public function forUserId(?int $userId): string
    {
        $id = (int) $userId;
        if ($id <= 0) {
            return $this->appDefault();
        }

        if (isset($this->memo[$id])) {
            return $this->memo[$id];
        }

        $user = $this->query()->find($id);

        return $this->memo[$id] = $user ? $this->resolveChain($user) : $this->appDefault();
    }

    /**
     * Batch form: one query for every id not already memoized.
     *
     * Report rollups iterate thousands of rows over tens of users; resolving
     * one id at a time would be an N+1 on the hot path.
     *
     * @param  iterable<mixed>  $userIds
     * @return array<int, string>
     */
    public function forUserIds(iterable $userIds): array
    {
        $ids = collect($userIds)
            ->map(fn ($id) => (int) $id)
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return [];
        }

        $missing = $ids->reject(fn (int $id) => isset($this->memo[$id]))->values();

        if ($missing->isNotEmpty()) {
            /** @var Collection<int, User> $users */
            $users = $this->query()->whereIn('id', $missing->all())->get();

            foreach ($users as $user) {
                $this->memo[(int) $user->getKey()] = $this->resolveChain($user);
            }

            foreach ($missing as $id) {
                if (! isset($this->memo[$id])) {
                    $this->memo[$id] = $this->appDefault();
                }
            }
        }

        return $ids->mapWithKeys(fn (int $id) => [$id => $this->memo[$id]])->all();
    }

    /**
     * The zone to use where no single user is in scope: console commands, and
     * aggregates that span several people whose zones may differ.
     *
     * Safe there because such a value is never attributed to one person's
     * calendar day — it is either a system-wide instant or a total that carries
     * no day key. The moment a value IS per-person, use forUser/forUserId.
     */
    public function appDefault(): string
    {
        // No literal default zone here on purpose. config/app.php owns the
        // deployment's default; naming a real region as a code-level fallback is
        // how a tenant silently inherits someone else's calendar.
        return (string) config('app.timezone', 'UTC');
    }

    /**
     * Drop the memo. For long-lived processes that change a timezone and then
     * read it back within the same container.
     */
    public function flush(): void
    {
        $this->memo = [];
    }

    private function query()
    {
        // User is deliberately outside BelongsToOrganization (the scope resolves
        // the acting user through Auth), so nothing here needs — or may add — an
        // organization filter. Callers pass ids they have already scoped.
        return User::query()->with(['employeeWorkInfo', 'organization']);
    }

    private function resolveChain(User $user): string
    {
        // The employee's own expected_timezone wins.
        $employeeWorkInfo = $user->employeeWorkInfo;
        if ($employeeWorkInfo && $employeeWorkInfo->expected_timezone) {
            return (string) $employeeWorkInfo->expected_timezone;
        }

        // Then the user's personal setting.
        $userSettings = is_array($user->settings) ? $user->settings : [];
        if (! empty($userSettings['timezone'])) {
            return (string) $userSettings['timezone'];
        }

        // Then the organization's.
        $orgSettings = is_array($user->organization?->settings) ? $user->organization->settings : [];
        if (! empty($orgSettings['timezone'])) {
            return (string) $orgSettings['timezone'];
        }

        return $this->appDefault();
    }
}
