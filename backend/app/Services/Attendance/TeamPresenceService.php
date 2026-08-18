<?php

namespace App\Services\Attendance;

use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Collection;

/**
 * The presence board an ordinary employee sees of their own department.
 *
 * Deliberately narrower than the HR attendance roster: presence answers
 * "who is around right now", not "who is underperforming". Attendance rates,
 * worked seconds, idle time and per-day absence history are not merely hidden
 * from the UI — they never enter this payload, so they cannot leak by being
 * read off the wire.
 */
class TeamPresenceService
{
    /**
     * People in the viewer's own department.
     *
     * Scoped on employee_work_infos.report_group_id rather than the group
     * pivot: pivot membership is a peer relationship and a person can sit in
     * several groups, which would widen the board well past their team.
     */
    /** How far ahead the "off soon" strip looks. */
    private const OFF_SOON_DAYS = 14;

    public function peopleFor(User $viewer): Collection
    {
        $people = $this->departmentMembers($viewer);

        if ($people->isEmpty()) {
            return collect();
        }

        $today = Carbon::today()->toDateString();

        $userIds = $people->pluck('id');

        $attendanceByUser = AttendanceRecord::query()
            ->whereIn('user_id', $userIds)
            ->where('attendance_date', $today)
            ->get()
            ->keyBy('user_id');

        // Only approved leave counts. A pending request is a hope, not an absence.
        $onLeaveUserIds = LeaveRequest::query()
            ->whereIn('user_id', $userIds)
            ->where('status', 'approved')
            ->whereDate('start_date', '<=', $today)
            ->whereDate('end_date', '>=', $today)
            ->pluck('user_id')
            ->map(fn ($id) => (int) $id)
            ->flip();

        return $people->map(function (User $person) use ($attendanceByUser, $onLeaveUserIds) {
            $attendance = $attendanceByUser->get($person->id);
            $checkedInAt = $attendance?->check_in_at;
            $checkedOutAt = $attendance?->check_out_at;

            // Leave outranks attendance: a stale check-in must not make someone
            // who is on approved leave read as present.
            $status = match (true) {
                $onLeaveUserIds->has((int) $person->id) => 'on_leave',
                $checkedInAt && !$checkedOutAt => 'in',
                default => 'not_in',
            };

            return [
                'id' => (int) $person->id,
                'name' => $person->name,
                'designation' => $person->employeeWorkInfo?->designation,
                'status' => $status,
                'checked_in_at' => $status === 'in' ? $checkedInAt?->toIso8601String() : null,
            ];
        })->values();
    }

    /**
     * Approved leave overlapping the next fortnight, for the viewer's department.
     *
     * The window test is an overlap, not a start-date match: leave that began
     * before today and runs on still means that person is away, and a strip
     * that only matched start dates would answer "nobody is off" while
     * somebody plainly is.
     */
    public function offSoonFor(User $viewer): Collection
    {
        $people = $this->departmentMembers($viewer);

        if ($people->isEmpty()) {
            return collect();
        }

        $nameById = $people->pluck('name', 'id');
        $today = Carbon::today();

        return LeaveRequest::query()
            ->whereIn('user_id', $people->pluck('id'))
            ->where('status', 'approved')
            ->whereDate('end_date', '>=', $today->toDateString())
            ->whereDate('start_date', '<=', $today->copy()->addDays(self::OFF_SOON_DAYS)->toDateString())
            ->orderBy('start_date')
            ->get()
            ->map(fn (LeaveRequest $leave) => [
                'id' => (int) $leave->user_id,
                'name' => $nameById->get($leave->user_id),
                'from' => Carbon::parse($leave->start_date)->toDateString(),
                'to' => Carbon::parse($leave->end_date)->toDateString(),
            ])
            ->values();
    }

    private function departmentMembers(User $viewer): Collection
    {
        $departmentId = $viewer->employeeWorkInfo?->report_group_id;

        if (!$departmentId) {
            return collect();
        }

        return User::query()
            ->where('organization_id', $viewer->organization_id)
            ->whereHas(
                'employeeWorkInfo',
                fn ($query) => $query->where('report_group_id', $departmentId)
            )
            ->with('employeeWorkInfo:id,user_id,designation')
            ->orderBy('name')
            ->get();
    }
}
