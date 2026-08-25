<?php

namespace App\Services\Attendance;

use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\RosterDay;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * One organisation, one day, as scalars.
 *
 * Nothing returned counts today across the whole organisation. The dashboard's
 * only route to "how many people are in" was `AttendanceService::summary`,
 * which builds a row per employee and runs an AttendanceRecord query WITH a
 * punches eager-load inside `$users->map()` — a true N+1. At 93 employees that
 * is 93 queries to render six numbers, and it grows with headcount.
 *
 * Everything here is a grouped query over the whole set: five aggregates and
 * no per-user fan-out, whatever the headcount.
 *
 * Two rules the buckets obey:
 *
 * - THEY DO NOT OVERLAP. Somebody late is not also counted as on-time, and
 *   somebody on approved leave is never counted absent. Buckets that overlap
 *   produce a dashboard whose numbers do not add up to the headcount, which is
 *   the fastest way to lose a reader's trust.
 *
 * - AN OFF DAY IS NOT AN ABSENCE. `roster_days` with a null `shift_id` means
 *   "rostered, and off"; no row at all means "not rostered". Neither is a
 *   no-show, and both are reported separately so nobody has to guess which.
 *
 * Each bucket also returns its `user_ids`, so the dashboard's drill-down opens
 * the named people without a second round trip.
 */
class TodaySnapshotService
{
    /**
     * @return array{
     *   date:string,
     *   headcount:int,
     *   present_on_time:array{count:int,user_ids:array<int>},
     *   late:array{count:int,user_ids:array<int>,total_minutes:int},
     *   on_leave:array{count:int,user_ids:array<int>,half_day:int},
     *   rostered_absent:array{count:int,user_ids:array<int>},
     *   working_now:array{count:int,user_ids:array<int>},
     *   roster:array{published:bool,rostered:int,rest_day:int,not_rostered:int}
     * }
     */
    public function forOrganization(int $organizationId, Carbon|string|null $date = null): array
    {
        $day = $date ? Carbon::parse($date)->startOfDay() : now()->startOfDay();
        $iso = $day->toDateString();

        /*
         * The denominator. Anyone who could be expected in — role-filtered the
         * same way the attendance screens are, so the dashboard and the roster
         * cannot disagree about who counts.
         */
        $employees = User::query()
            ->where('organization_id', $organizationId)
            ->whereIn('role', ['employee', 'manager', 'admin'])
            ->pluck('id')
            ->map(fn ($id) => (int) $id);

        if ($employees->isEmpty()) {
            return $this->empty($iso);
        }

        // ---- one query: today's attendance rows -------------------------
        $records = AttendanceRecord::query()
            ->where('organization_id', $organizationId)
            ->whereIn('user_id', $employees)
            ->whereDate('attendance_date', $iso)
            ->get(['user_id', 'check_in_at', 'late_minutes']);

        $lateIds = $records
            ->filter(fn ($r) => $r->check_in_at && (int) $r->late_minutes > 0)
            ->pluck('user_id')->map(fn ($id) => (int) $id)->values();

        $onTimeIds = $records
            ->filter(fn ($r) => $r->check_in_at && (int) $r->late_minutes <= 0)
            ->pluck('user_id')->map(fn ($id) => (int) $id)->values();

        // ---- one query: approved leave overlapping the day --------------
        $leave = LeaveRequest::query()
            ->where('organization_id', $organizationId)
            ->whereIn('user_id', $employees)
            ->where('status', 'approved')
            ->whereDate('start_date', '<=', $iso)
            ->whereDate('end_date', '>=', $iso)
            ->get(['user_id', 'leave_type']);

        $onLeaveIds = $leave->pluck('user_id')->map(fn ($id) => (int) $id)->unique()->values();

        // ---- one query: the published roster for the day ----------------
        $rosterRows = RosterDay::query()
            ->where('organization_id', $organizationId)
            ->where('status', 'published')
            ->whereDate('roster_date', $iso)
            ->get(['user_id', 'shift_id']);

        $rosterPublished = $rosterRows->isNotEmpty();

        $rosteredIds = $rosterRows
            ->filter(fn ($r) => $r->shift_id !== null)
            ->pluck('user_id')->map(fn ($id) => (int) $id)->unique()->values();

        $restDayIds = $rosterRows
            ->filter(fn ($r) => $r->shift_id === null)
            ->pluck('user_id')->map(fn ($id) => (int) $id)->unique()->values();

        // ---- one query: desktop timers running right now ----------------
        $workingIds = TimeEntry::query()
            ->whereIn('user_id', $employees)
            ->whereNull('end_time')
            ->where('is_break', false)
            ->whereDate('start_time', '<=', $day->copy()->endOfDay())
            ->pluck('user_id')->map(fn ($id) => (int) $id)->unique()->values();

        /*
         * The number nothing in this codebase could produce: rostered onto a
         * shift, not on approved leave, and no punch.
         *
         * RosterService::coverageFor lists published roster days and never
         * joins them against attendance, so "who was told to be here and is
         * not" — the one genuinely time-critical fact on a shop floor, where a
         * line short two people at 09:30 is a decision taken by 09:45 — was not
         * answerable. Without a published roster it is not answerable either,
         * and the caller is told so rather than shown a zero.
         */
        $presentIds = $onTimeIds->merge($lateIds)->unique();

        $rosteredAbsentIds = $rosterPublished
            ? $rosteredIds->diff($presentIds)->diff($onLeaveIds)->values()
            : collect();

        return [
            'date' => $iso,
            'headcount' => $employees->count(),
            'present_on_time' => [
                'count' => $onTimeIds->count(),
                'user_ids' => $onTimeIds->all(),
            ],
            'late' => [
                'count' => $lateIds->count(),
                'user_ids' => $lateIds->all(),
                'total_minutes' => (int) $records
                    ->filter(fn ($r) => $r->check_in_at && (int) $r->late_minutes > 0)
                    ->sum('late_minutes'),
            ],
            'on_leave' => [
                'count' => $onLeaveIds->count(),
                'user_ids' => $onLeaveIds->all(),
                'half_day' => $leave->filter(
                    fn ($l) => str_contains(strtolower((string) $l->leave_type), 'half')
                )->count(),
            ],
            'rostered_absent' => [
                'count' => $rosteredAbsentIds->count(),
                'user_ids' => $rosteredAbsentIds->all(),
            ],
            'working_now' => [
                'count' => $workingIds->count(),
                'user_ids' => $workingIds->all(),
            ],
            'roster' => [
                // False means the absence figure is unknowable, not zero.
                'published' => $rosterPublished,
                'rostered' => $rosteredIds->count(),
                'rest_day' => $restDayIds->count(),
                'not_rostered' => $rosterPublished
                    ? $employees->diff($rosteredIds)->diff($restDayIds)->count()
                    : $employees->count(),
            ],
        ];
    }

    /** @return array<string, mixed> */
    private function empty(string $iso): array
    {
        $bucket = ['count' => 0, 'user_ids' => []];

        return [
            'date' => $iso,
            'headcount' => 0,
            'present_on_time' => $bucket,
            'late' => $bucket + ['total_minutes' => 0],
            'on_leave' => $bucket + ['half_day' => 0],
            'rostered_absent' => $bucket,
            'working_now' => $bucket,
            'roster' => ['published' => false, 'rostered' => 0, 'rest_day' => 0, 'not_rostered' => 0],
        ];
    }
}
