<?php

namespace App\Services\Monitoring;

use App\Models\AppNotification;
use App\Models\MonitoringAlertRule;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Collection;

/**
 * Turns monitoring figures into something that arrives unprompted.
 *
 * The reports could always show that somebody tracked nothing yesterday. What
 * they could not do is say so without being asked, and every defect found on
 * 17 Aug 2026 — a capped analytics query, a stranded offline queue, a timer
 * left running overnight — looked identical to a quiet day until a person went
 * looking.
 */
class MonitoringAlertEvaluator
{
    /**
     * Evaluate every enabled rule for one day.
     *
     * @return array{rules: int, notifications: int}
     */
    public function evaluateForDate(Carbon $date): array
    {
        $dayStart = $date->copy()->startOfDay();
        $dayEnd = $date->copy()->endOfDay();

        $rules = MonitoringAlertRule::query()
            ->withoutGlobalScopes()
            ->where('is_enabled', true)
            ->get();

        $notifications = 0;

        foreach ($rules as $rule) {
            $notifications += $this->evaluateRule($rule, $dayStart, $dayEnd);

            $rule->timestamps = false;
            $rule->forceFill(['last_evaluated_at' => now()])->save();
        }

        return ['rules' => $rules->count(), 'notifications' => $notifications];
    }

    private function evaluateRule(MonitoringAlertRule $rule, Carbon $dayStart, Carbon $dayEnd): int
    {
        $employees = $this->employeesInScope($rule);
        if ($employees->isEmpty()) {
            return 0;
        }

        $totals = $this->trackedTotals($employees->pluck('id')->all(), $dayStart, $dayEnd);
        $breached = $employees->filter(fn (User $employee) => $this->breaches($rule, $totals[$employee->id] ?? ['tracked' => 0, 'idle' => 0]));

        if ($breached->isEmpty()) {
            return 0;
        }

        return $this->notify($rule, $breached, $dayStart);
    }

    /** @return Collection<int, User> */
    private function employeesInScope(MonitoringAlertRule $rule): Collection
    {
        /*
         * Employees only.
         *
         * Admins and managers are the audience for these alerts, not the
         * subject: they are in the organisation but nobody is watching their
         * hours. Including them meant a "tracked nothing yesterday" rule named
         * the admin every single day, which is exactly how an alert channel
         * gets muted and stops being read at all.
         */
        $query = User::query()
            ->withoutGlobalScopes()
            ->where('organization_id', $rule->organization_id)
            ->where('role', 'employee');

        if ($rule->group_id) {
            $query->whereHas('groups', fn ($q) => $q->where('groups.id', $rule->group_id));
        }

        return $query->get(['id', 'name', 'organization_id']);
    }

    /**
     * Tracked and idle seconds per user for the day.
     *
     * Reads the same columns the timesheet does, so an alert can never disagree
     * with the report a person opens after receiving it.
     *
     * @param array<int, int> $userIds
     * @return array<int, array{tracked: int, idle: int}>
     */
    private function trackedTotals(array $userIds, Carbon $dayStart, Carbon $dayEnd): array
    {
        if ($userIds === []) {
            return [];
        }

        return TimeEntry::query()
            ->withoutGlobalScopes()
            ->whereIn('user_id', $userIds)
            ->whereBetween('start_time', [$dayStart, $dayEnd])
            ->where('is_break', false)
            ->get(['user_id', 'duration', 'idle_seconds', 'trailing_idle_seconds'])
            ->groupBy('user_id')
            ->map(fn ($entries) => [
                'tracked' => (int) $entries->sum('duration'),
                'idle' => (int) $entries->sum(fn ($entry) => (int) $entry->idle_seconds + (int) $entry->trailing_idle_seconds),
            ])
            ->all();
    }

    /** @param array{tracked: int, idle: int} $totals */
    private function breaches(MonitoringAlertRule $rule, array $totals): bool
    {
        $tracked = (int) $totals['tracked'];
        $idle = (int) $totals['idle'];

        return match ($rule->metric) {
            MonitoringAlertRule::METRIC_NO_ACTIVITY => $tracked <= 0,
            MonitoringAlertRule::METRIC_TRACKED_BELOW => $tracked < $rule->threshold,
            /*
             * A day with no tracked time has no idle share — dividing by zero
             * would make every absent person breach an idle rule, which is the
             * job of the no-activity rule and would double-report them.
             */
            MonitoringAlertRule::METRIC_IDLE_SHARE_ABOVE => $tracked > 0
                && (($idle / $tracked) * 100) > $rule->threshold,
            default => false,
        };
    }

    /** @param Collection<int, User> $breached */
    private function notify(MonitoringAlertRule $rule, Collection $breached, Carbon $day): int
    {
        $recipients = User::query()
            ->withoutGlobalScopes()
            ->where('organization_id', $rule->organization_id)
            ->whereIn('role', ['admin', 'manager'])
            ->pluck('id');

        if ($recipients->isEmpty()) {
            return 0;
        }

        $names = $breached->pluck('name')->filter()->values();
        $shown = $names->take(5)->implode(', ');
        $extra = $names->count() > 5 ? sprintf(' and %d more', $names->count() - 5) : '';

        $message = sprintf(
            '%d %s %s on %s — %s%s.',
            $names->count(),
            $names->count() === 1 ? 'person' : 'people',
            $rule->describe(),
            $day->toFormattedDateString(),
            $shown,
            $extra
        );

        $created = 0;
        foreach ($recipients as $recipientId) {
            AppNotification::create([
                'organization_id' => $rule->organization_id,
                'user_id' => $recipientId,
                'type' => 'alert',
                'title' => $rule->name,
                'message' => $message,
                'meta' => [
                    'rule_id' => $rule->id,
                    'metric' => $rule->metric,
                    'threshold' => $rule->threshold,
                    'date' => $day->toDateString(),
                    'user_ids' => $breached->pluck('id')->values()->all(),
                ],
            ]);
            $created++;
        }

        return $created;
    }
}
