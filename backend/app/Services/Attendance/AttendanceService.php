<?php

namespace App\Services\Attendance;

use App\Models\AttendanceHoliday;
use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class AttendanceService
{
    private const DEFAULT_OFFICE_START = '09:00:00';
    private const DEFAULT_LATE_AFTER = '10:30:00';

    private function managerGroupIds(User $user): array
    {
        return $user->groups()
            ->pluck('groups.id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    private function visibleUsersQuery(User $user, bool $employeesOnlyForManager = false): Builder
    {
        $query = User::query()->where('organization_id', $user->organization_id);

        if ($user->role === 'admin') {
            return $query;
        }

        if ($user->role === 'manager') {
            $groupIds = $this->managerGroupIds($user);
            if (empty($groupIds)) {
                return User::query()->whereRaw('1 = 0');
            }

            if ($employeesOnlyForManager) {
                $query->where('role', 'employee');
            }

            return $query->whereHas('groups', fn (Builder $groupQuery) => $groupQuery->whereIn('groups.id', $groupIds));
        }

        return $query->whereKey($user->id);
    }

    public function todayPayload(?User $user, ?int $targetUserId = null): array
    {
        if (!$user || !$user->organization_id) {
            return [
                'record' => null,
                'has_approved_leave_today' => false,
                'has_half_day_leave_today' => false,
            ];
        }

        $targetUser = $user;
        if ($targetUserId && $targetUserId !== (int) $user->id) {
            if (! $this->canManage($user)) {
                return [
                    'record' => null,
                    'late_after' => $this->lateAfterTimeForUser($user),
                    'office_start' => $this->officeStartTimeForUser($user),
                    'shift_target_seconds' => $this->shiftTargetSeconds(),
                    'has_approved_leave_today' => false,
                    'has_half_day_leave_today' => false,
                    'leave_today' => null,
                ];
            }

            $targetUser = $this->visibleUsersQuery($user, $user->role === 'manager')
                ->whereKey($targetUserId)
                ->first();

            if (! $targetUser) {
                return [
                    'record' => null,
                    'late_after' => $this->lateAfterTimeForUser($user),
                    'office_start' => $this->officeStartTimeForUser($user),
                    'shift_target_seconds' => $this->shiftTargetSeconds(),
                    'has_approved_leave_today' => false,
                    'has_half_day_leave_today' => false,
                    'leave_today' => null,
                ];
            }
        }

        $today = now()->toDateString();
        $record = AttendanceRecord::where('user_id', $targetUser->id)
            ->whereDate('attendance_date', $today)
            ->with('punches')
            ->first();
        $leaveForToday = $this->approvedLeaveForDate($targetUser, $today);
        $shiftTarget = $this->shiftTargetSecondsForLeave($leaveForToday);

        return [
            'record' => $this->decorateRecord($record, $leaveForToday),
            'late_after' => $this->lateAfterTimeForUser($targetUser),
            'office_start' => $this->officeStartTimeForUser($targetUser),
            'shift_target_seconds' => $shiftTarget,
            'has_approved_leave_today' => $leaveForToday && !$leaveForToday->isHalfDay(),
            'has_half_day_leave_today' => (bool) ($leaveForToday?->isHalfDay()),
            'leave_today' => $leaveForToday ? [
                'leave_type' => $leaveForToday->leave_type,
                'units' => $leaveForToday->unitsForDate($today),
                'label' => $leaveForToday->isHalfDay() ? 'Half day applied' : 'Approved leave',
            ] : null,
        ];
    }

    public function checkIn(?User $user): array
    {
        if (!$user || !$user->organization_id) {
            return ['status' => 422, 'payload' => ['message' => 'Organization is required.']];
        }

        $today = now()->toDateString();
        if ($this->hasApprovedFullDayLeaveOnDate($user, $today)) {
            return ['status' => 422, 'payload' => ['message' => 'You are on approved leave today. Punch in is blocked.']];
        }

        $checkInAt = now();
        $record = AttendanceRecord::firstOrNew([
            'user_id' => $user->id,
            'attendance_date' => $today,
        ]);

        $openPunch = AttendancePunch::where('user_id', $user->id)
            ->whereHas('attendanceRecord', function ($query) use ($today) {
                $query->whereDate('attendance_date', $today);
            })
            ->whereNull('punch_out_at')
            ->first();

        if ($openPunch) {
            return ['status' => 422, 'payload' => ['message' => 'You are already checked in for today']];
        }

        $lateThreshold = Carbon::parse($today.' '.$this->lateAfterTimeForUser($user));
        $lateMinutes = max(0, $lateThreshold->diffInMinutes($checkInAt, false));

        $record->organization_id = $user->organization_id;
        $record->status = 'present';
        if (!$record->check_in_at) {
            $record->check_in_at = $checkInAt;
            $record->late_minutes = (int) $lateMinutes;
        }
        $record->save();

        AttendancePunch::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'attendance_record_id' => $record->id,
            'punch_in_at' => $checkInAt,
        ]);

        $this->closeRunningPrimaryTimers((int) $user->id, $checkInAt);
        $this->startPrimaryTimer($user, $checkInAt, 'Auto timer started from punch in');

        return [
            'status' => 200,
            'payload' => [
                'message' => 'Punched in successfully',
                'record' => $this->decorateRecord($record->fresh('punches')),
            ],
        ];
    }

    public function checkOut(?User $user): array
    {
        if (!$user || !$user->organization_id) {
            return ['status' => 422, 'payload' => ['message' => 'Organization is required.']];
        }

        $today = now()->toDateString();
        $record = AttendanceRecord::where('user_id', $user->id)
            ->whereDate('attendance_date', $today)
            ->with('punches')
            ->first();

        if (!$record || !$record->check_in_at) {
            return ['status' => 422, 'payload' => ['message' => 'Please check in first']];
        }

        $openPunch = $record->punches->first(fn ($p) => !$p->punch_out_at);
        if (!$openPunch) {
            return ['status' => 422, 'payload' => ['message' => 'No active punch-in found.']];
        }

        $checkOutAt = now();
        $sessionWorkedSeconds = max(0, Carbon::parse($openPunch->punch_in_at)->diffInSeconds($checkOutAt));
        $openPunch->update([
            'punch_out_at' => $checkOutAt,
            'worked_seconds' => (int) $sessionWorkedSeconds,
        ]);

        $record = $record->fresh('punches');
        $workedSeconds = $this->calculateClosedWorkedSeconds($record);

        $record->update([
            'check_out_at' => $checkOutAt,
            'worked_seconds' => (int) $workedSeconds,
            'status' => 'present',
        ]);
        $this->closeRunningPrimaryTimers((int) $user->id, $checkOutAt);

        return [
            'status' => 200,
            'payload' => [
                'message' => 'Punched out successfully',
                'record' => $this->decorateRecord($record->fresh('punches')),
            ],
        ];
    }

    public function calendar(Request $request, ?User $currentUser): array
    {
        if (!$currentUser || !$currentUser->organization_id) {
            return ['status' => 200, 'payload' => ['days' => [], 'summary' => null]];
        }

        $month = $request->get('month', now()->format('Y-m'));
        $monthStart = Carbon::createFromFormat('Y-m', $month)->startOfMonth();
        $monthEnd = $monthStart->copy()->endOfMonth();
        $scope = (string) $request->get('scope', 'selected');

        if ($scope === 'overall' && $this->canManage($currentUser)) {
            return $this->overallCalendarPayload($request, $currentUser, $monthStart, $monthEnd);
        }

        $targetUserId = $this->resolveTargetUserId($currentUser, $request);

        if (!$targetUserId) {
            return ['status' => 403, 'payload' => ['message' => 'Forbidden']];
        }

        $targetUser = $this->visibleUsersQuery($currentUser, $currentUser->role === 'manager')
            ->where('id', $targetUserId)
            ->first();
        if (!$targetUser) {
            return ['status' => 403, 'payload' => ['message' => 'Forbidden']];
        }

        $targetCountry = AttendanceHoliday::countryForSettings($targetUser->settings);

        $records = AttendanceRecord::where('organization_id', $currentUser->organization_id)
            ->where('user_id', $targetUserId)
            ->whereDate('attendance_date', '>=', $monthStart->toDateString())
            ->whereDate('attendance_date', '<=', $monthEnd->toDateString())
            ->orderBy('attendance_date')
            ->with('punches')
            ->get()
            ->keyBy(fn (AttendanceRecord $r) => Carbon::parse($r->attendance_date)->toDateString());

        $approvedLeaves = LeaveRequest::query()
            ->where('organization_id', $currentUser->organization_id)
            ->where('user_id', $targetUserId)
            ->where('status', 'approved')
            ->whereDate('start_date', '<=', $monthEnd->toDateString())
            ->whereDate('end_date', '>=', $monthStart->toDateString())
            ->get(['start_date', 'end_date', 'leave_type']);

        $leaveByDate = $approvedLeaves
            ->flatMap(fn (LeaveRequest $leave) => $leave->effectiveDateEntriesInRange($monthStart, $monthEnd))
            ->groupBy('date')
            ->map(function ($entries) {
                $maxUnits = (float) collect($entries)->max('units');
                $leaveType = collect($entries)->contains(fn ($entry) => ($entry['leave_type'] ?? null) === 'half_day')
                    ? 'half_day'
                    : 'full_day';

                return [
                    'units' => $maxUnits,
                    'leave_type' => $leaveType,
                ];
            });

        $holidays = AttendanceHoliday::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereBetween('holiday_date', [$monthStart->toDateString(), $monthEnd->toDateString()])
            ->whereIn('country', ['ALL', $targetCountry])
            ->orderBy('holiday_date')
            ->get();

        $holidayByDate = $holidays
            ->sortBy(fn (AttendanceHoliday $holiday) => $holiday->country === $targetCountry ? 0 : 1)
            ->groupBy(fn (AttendanceHoliday $holiday) => Carbon::parse($holiday->holiday_date)->toDateString())
            ->map(fn ($group) => $group->first());

        $days = [];
        $present = 0;
        $absent = 0;
        $weekend = 0;
        $leaveDays = 0;
        $holidayDays = 0;
        $late = 0;
        $totalWorked = 0;
        $today = now()->toDateString();

        foreach (CarbonPeriod::create($monthStart, $monthEnd) as $date) {
            $dateStr = $date->toDateString();
            $isWeekend = $date->isWeekend();
            $record = $records->get($dateStr);
            $leaveEntry = $leaveByDate->get($dateStr);
            $leaveUnits = (float) ($leaveEntry['units'] ?? 0);
            $isLeave = $leaveUnits > 0;
            $isHalfLeave = $leaveUnits > 0 && $leaveUnits < 1;
            $holiday = $holidayByDate->get($dateStr);
            $isHoliday = (bool) $holiday;

            if ($isHoliday) {
                $status = 'holiday';
                $holidayDays++;
                if ($record && $record->check_in_at) {
                    $present++;
                    $totalWorked += $this->calculateEffectiveWorkedSeconds($record);
                }
            } elseif ($isHalfLeave) {
                $status = 'half_leave';
                $leaveDays += $leaveUnits;
                if ($record && $record->check_in_at) {
                    $present++;
                    $totalWorked += $this->calculateEffectiveWorkedSeconds($record);
                }
            } elseif ($isLeave) {
                $status = 'leave';
                $leaveDays += $leaveUnits;
            } elseif ($record && $record->check_in_at && !$record->check_out_at) {
                $status = 'checked_in';
                $present++;
                $totalWorked += $this->calculateEffectiveWorkedSeconds($record);
            } elseif ($record && $record->check_in_at) {
                $status = 'present';
                $present++;
                $totalWorked += $this->calculateEffectiveWorkedSeconds($record);
            } else {
                $status = 'none';
                if ($isWeekend) {
                    $weekend++;
                } elseif ($dateStr <= $today) {
                    $absent++;
                }
            }

            if ($record && (int) $record->late_minutes > 0) {
                $late++;
            }

            $days[] = [
                'date' => $dateStr,
                'status' => $status,
                'is_weekend' => $isWeekend,
                'is_leave' => $isLeave,
                'is_half_leave' => $isHalfLeave,
                'leave_units' => $leaveUnits,
                'leave_type' => $leaveEntry['leave_type'] ?? null,
                'is_holiday' => $isHoliday,
                'check_in_at' => $record?->check_in_at,
                'check_out_at' => $record?->check_out_at,
                'late_minutes' => (int) ($record?->late_minutes ?? 0),
                'worked_seconds' => $record ? $this->calculateEffectiveWorkedSeconds($record) : 0,
                'holiday' => $holiday ? [
                    'id' => $holiday->id,
                    'date' => $dateStr,
                    'country' => $holiday->country,
                    'title' => $holiday->title,
                    'details' => $holiday->details,
                ] : null,
            ];
        }

        return [
            'status' => 200,
            'payload' => [
                'month' => $month,
                'scope' => 'selected',
                'user_id' => $targetUserId,
                'viewer_country' => $targetCountry,
                'days' => $days,
                'summary' => [
                    'present_days' => $present,
                    'absent_days' => $absent,
                    'weekend_days' => $weekend,
                    'leave_days' => round($leaveDays, 2),
                    'holiday_days' => $holidayDays,
                    'late_days' => $late,
                    'total_worked_seconds' => (int) $totalWorked,
                    'overall_employee_count' => 1,
                ],
            ],
        ];
    }

    private function overallCalendarPayload(Request $request, User $currentUser, Carbon $monthStart, Carbon $monthEnd): array
    {
        $countryFilter = AttendanceHoliday::normalizeCountry((string) $request->get('country', 'ALL'));

        $users = $this->visibleUsersQuery($currentUser, $currentUser->role === 'manager')
            ->get(['id', 'settings']);

        if ($countryFilter !== 'ALL') {
            $users = $users
                ->filter(fn (User $user) => AttendanceHoliday::countryForSettings($user->settings) === $countryFilter)
                ->values();
        }

        $userIds = $users->pluck('id')->values();
        $totalEmployees = $userIds->count();

        if ($userIds->isEmpty()) {
            $days = collect(CarbonPeriod::create($monthStart, $monthEnd))
                ->map(function (Carbon $date) {
                    return [
                        'date' => $date->toDateString(),
                        'status' => 'none',
                        'is_weekend' => $date->isWeekend(),
                        'is_leave' => false,
                        'is_holiday' => false,
                        'check_in_at' => null,
                        'check_out_at' => null,
                        'late_minutes' => 0,
                        'worked_seconds' => 0,
                        'holiday' => null,
                    ];
                })
                ->values()
                ->all();

            return [
                'status' => 200,
                'payload' => [
                    'month' => $monthStart->format('Y-m'),
                    'scope' => 'overall',
                    'user_id' => null,
                    'viewer_country' => $countryFilter,
                    'days' => $days,
                    'summary' => [
                        'present_days' => 0,
                        'absent_days' => 0,
                        'weekend_days' => collect($days)->where('is_weekend', true)->count(),
                        'leave_days' => 0,
                        'holiday_days' => 0,
                        'late_days' => 0,
                        'total_worked_seconds' => 0,
                        'overall_employee_count' => 0,
                    ],
                ],
            ];
        }

        $records = AttendanceRecord::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereIn('user_id', $userIds->all())
            ->whereDate('attendance_date', '>=', $monthStart->toDateString())
            ->whereDate('attendance_date', '<=', $monthEnd->toDateString())
            ->get(['attendance_date', 'check_in_at', 'check_out_at', 'worked_seconds', 'manual_adjustment_seconds', 'late_minutes']);

        $recordsByDate = $records->groupBy(fn (AttendanceRecord $record) => Carbon::parse($record->attendance_date)->toDateString());

        $leaveCountsByDate = collect();
        $approvedLeaves = LeaveRequest::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereIn('user_id', $userIds->all())
            ->where('status', 'approved')
            ->whereDate('start_date', '<=', $monthEnd->toDateString())
            ->whereDate('end_date', '>=', $monthStart->toDateString())
            ->get(['user_id', 'start_date', 'end_date', 'leave_type']);

        foreach ($approvedLeaves as $leave) {
            foreach ($leave->effectiveDateEntriesInRange($monthStart, $monthEnd) as $entry) {
                $dateStr = (string) ($entry['date'] ?? '');
                if ($dateStr === '') {
                    continue;
                }

                $existing = $leaveCountsByDate->get($dateStr, ['units' => 0.0, 'half_day_count' => 0, 'full_day_count' => 0]);
                $existing['units'] = (float) $existing['units'] + (float) ($entry['units'] ?? 0);
                if (($entry['leave_type'] ?? null) === 'half_day') {
                    $existing['half_day_count'] = (int) $existing['half_day_count'] + 1;
                } else {
                    $existing['full_day_count'] = (int) $existing['full_day_count'] + 1;
                }
                $leaveCountsByDate->put($dateStr, $existing);
            }
        }

        $holidayQuery = AttendanceHoliday::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereBetween('holiday_date', [$monthStart->toDateString(), $monthEnd->toDateString()]);

        if ($countryFilter !== 'ALL') {
            $holidayQuery->whereIn('country', ['ALL', $countryFilter]);
        }

        $holidays = $holidayQuery
            ->orderBy('holiday_date')
            ->get();

        $holidayByDate = $holidays
            ->sortBy(fn (AttendanceHoliday $holiday) => $holiday->country === $countryFilter ? 0 : 1)
            ->groupBy(fn (AttendanceHoliday $holiday) => Carbon::parse($holiday->holiday_date)->toDateString())
            ->map(fn ($group) => $group->first());

        $days = [];
        $present = 0;
        $absent = 0;
        $weekend = 0;
        $leaveDays = 0;
        $holidayDays = 0;
        $late = 0;
        $totalWorked = 0;
        $today = now()->toDateString();

        foreach (CarbonPeriod::create($monthStart, $monthEnd) as $date) {
            $dateStr = $date->toDateString();
            $isWeekend = $date->isWeekend();
            $dayRecords = $recordsByDate->get($dateStr, collect());
            $presentCount = $dayRecords->filter(fn ($record) => (bool) $record->check_in_at)->count();
            $lateCount = $dayRecords->filter(fn ($record) => (int) $record->late_minutes > 0)->count();
            $workedSeconds = (int) $dayRecords->sum(fn ($record) => (int) ($record->worked_seconds ?? 0) + (int) ($record->manual_adjustment_seconds ?? 0));
            $leaveMeta = $leaveCountsByDate->get($dateStr, ['units' => 0.0, 'half_day_count' => 0, 'full_day_count' => 0]);
            $leaveUnits = (float) ($leaveMeta['units'] ?? 0);
            $hasHalfLeave = (int) ($leaveMeta['half_day_count'] ?? 0) > 0;
            $holiday = $holidayByDate->get($dateStr);
            $isHoliday = (bool) $holiday;

            if ($isHoliday) {
                $status = 'holiday';
                $holidayDays++;
                if ($presentCount > 0) {
                    $present++;
                }
            } elseif ($hasHalfLeave) {
                $status = 'half_leave';
                $leaveDays += $leaveUnits;
                if ($presentCount > 0) {
                    $present++;
                }
            } elseif ($presentCount > 0) {
                $status = $presentCount >= $totalEmployees ? 'present' : 'checked_in';
                $present++;
            } elseif ($leaveUnits > 0) {
                $status = 'leave';
                $leaveDays += $leaveUnits;
            } else {
                $status = 'none';
                if ($isWeekend) {
                    $weekend++;
                } elseif ($dateStr <= $today) {
                    $absent++;
                }
            }

            if ($lateCount > 0) {
                $late++;
            }

            $totalWorked += $workedSeconds;

            $days[] = [
                'date' => $dateStr,
                'status' => $status,
                'is_weekend' => $isWeekend,
                'is_leave' => $leaveUnits > 0,
                'is_half_leave' => $hasHalfLeave,
                'leave_units' => $leaveUnits,
                'leave_type' => $hasHalfLeave ? 'half_day' : ($leaveUnits > 0 ? 'full_day' : null),
                'is_holiday' => $isHoliday,
                'check_in_at' => null,
                'check_out_at' => null,
                'late_minutes' => $lateCount,
                'worked_seconds' => $workedSeconds,
                'holiday' => $holiday ? [
                    'id' => $holiday->id,
                    'date' => $dateStr,
                    'country' => $holiday->country,
                    'title' => $holiday->title,
                    'details' => $holiday->details,
                ] : null,
            ];
        }

        return [
            'status' => 200,
            'payload' => [
                'month' => $monthStart->format('Y-m'),
                'scope' => 'overall',
                'user_id' => null,
                'viewer_country' => $countryFilter,
                'days' => $days,
                'summary' => [
                    'present_days' => $present,
                    'absent_days' => $absent,
                    'weekend_days' => $weekend,
                    'leave_days' => round($leaveDays, 2),
                    'holiday_days' => $holidayDays,
                    'late_days' => $late,
                    'total_worked_seconds' => (int) $totalWorked,
                    'overall_employee_count' => $totalEmployees,
                ],
            ],
        ];
    }

    public function summary(Request $request, ?User $currentUser): array
    {
        if (!$currentUser || !$currentUser->organization_id) {
            return ['data' => []];
        }

        $start = Carbon::parse($request->get('start_date', now()->startOfMonth()->toDateString()))->startOfDay();
        $end = Carbon::parse($request->get('end_date', now()->toDateString()))->endOfDay();
        if ($start->greaterThan($end)) {
            [$start, $end] = [$end->copy()->startOfDay(), $start->copy()->endOfDay()];
        }

        $usersQuery = $this->visibleUsersQuery($currentUser, $currentUser->role === 'manager');
        if ($this->canManage($currentUser) && $request->filled('q')) {
            $term = trim((string) $request->q);
            $usersQuery->where(function ($q) use ($term) {
                $q->where('name', 'like', "%{$term}%")
                    ->orWhere('email', 'like', "%{$term}%");
            });
        }

        $users = $usersQuery->orderBy('name')->get(['id', 'name', 'email', 'role']);
        $today = now()->toDateString();
        $approvedLeaveTodayByUserId = LeaveRequest::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereIn('user_id', $users->pluck('id'))
            ->where('status', 'approved')
            ->whereDate('start_date', '<=', $today)
            ->whereDate('end_date', '>=', $today)
            ->get(['user_id', 'leave_type'])
            ->keyBy(fn (LeaveRequest $leave) => (int) $leave->user_id);

        $rows = $users->map(function (User $user) use ($approvedLeaveTodayByUserId, $currentUser, $start, $end) {
            $records = AttendanceRecord::where('organization_id', $currentUser->organization_id)
                ->where('user_id', $user->id)
                ->whereDate('attendance_date', '>=', $start->toDateString())
                ->whereDate('attendance_date', '<=', $end->toDateString())
                ->with('punches')
                ->get();

            $presentDays = $records->whereNotNull('check_in_at')->count();
            $lateDays = $records->filter(fn ($r) => (int) $r->late_minutes > 0)->count();
            $totalWorkedSeconds = (int) $records->sum(fn (AttendanceRecord $r) => $this->calculateEffectiveWorkedSeconds($r));
            $todayRecord = $records->first(fn (AttendanceRecord $r) => Carbon::parse($r->attendance_date)->isToday());
            $latestRecord = $records->sortByDesc(fn (AttendanceRecord $r) => Carbon::parse($r->attendance_date)->timestamp)->first();
            $openPunch = $todayRecord?->punches?->first(fn (AttendancePunch $punch) => !$punch->punch_out_at);
            $latestPunch = $latestRecord?->punches?->sortByDesc(fn (AttendancePunch $punch) => Carbon::parse($punch->punch_in_at)->timestamp)->first();
            $checkedInToday = $todayRecord && $this->hasOpenPunch($todayRecord);
            $leaveToday = $approvedLeaveTodayByUserId->get((int) $user->id);
            $hasHalfDayLeaveToday = (bool) $leaveToday && $leaveToday->isHalfDay();
            $hasApprovedLeaveToday = (bool) $leaveToday && !$hasHalfDayLeaveToday;
            $attendanceStatus = (string) ($todayRecord?->status ?? '');

            if ($hasApprovedLeaveToday && !$checkedInToday && !$todayRecord?->check_in_at) {
                $attendanceStatus = 'leave';
            } elseif ($hasHalfDayLeaveToday && $attendanceStatus === '') {
                $attendanceStatus = 'half_leave';
            }

            return [
                'user' => $user,
                'present_days' => $presentDays,
                'late_days' => $lateDays,
                'late_minutes' => (int) ($todayRecord?->late_minutes ?? 0),
                'total_worked_seconds' => $totalWorkedSeconds,
                'is_checked_in' => (bool) $checkedInToday,
                'check_in_at' => $todayRecord?->check_in_at,
                'check_out_at' => $todayRecord?->check_out_at,
                'open_punch_in_at' => $openPunch?->punch_in_at,
                'last_check_in_at' => $latestPunch?->punch_in_at ?? $latestRecord?->check_in_at,
                'last_check_out_at' => $latestPunch?->punch_out_at ?? $latestRecord?->check_out_at,
                'last_attendance_date' => $latestRecord ? Carbon::parse($latestRecord->attendance_date)->toDateString() : null,
                'attendance_status' => $attendanceStatus,
                'has_approved_leave_today' => $hasApprovedLeaveToday,
                'has_half_day_leave_today' => $hasHalfDayLeaveToday,
                'is_leave' => $hasApprovedLeaveToday || $hasHalfDayLeaveToday || str_contains(strtolower($attendanceStatus), 'leave'),
            ];
        })->values();

        return [
            'start_date' => $start->toDateString(),
            'end_date' => $end->toDateString(),
            'data' => $rows,
        ];
    }

    private function resolveTargetUserId(User $currentUser, Request $request): ?int
    {
        if ($this->canManage($currentUser) && $request->filled('user_id')) {
            $target = $this->visibleUsersQuery($currentUser, $currentUser->role === 'manager')
                ->where('id', (int) $request->user_id)
                ->first();

            return $target?->id;
        }

        return $currentUser->id;
    }

    private function canManage(User $user): bool
    {
        return in_array($user->role, ['admin', 'manager'], true);
    }

    private function decorateRecord(?AttendanceRecord $record, ?LeaveRequest $leaveForDate = null): ?array
    {
        if (!$record) {
            if (!$leaveForDate) {
                return null;
            }

            $target = $this->shiftTargetSecondsForLeave($leaveForDate);

            return [
                'id' => null,
                'attendance_date' => now()->toDateString(),
                'check_in_at' => null,
                'check_out_at' => null,
                'worked_seconds' => 0,
                'manual_adjustment_seconds' => 0,
                'late_minutes' => 0,
                'status' => $leaveForDate->isHalfDay() ? 'half_leave' : 'absent',
                'is_checked_in' => false,
                'total_break_seconds' => 0,
                'shift_target_seconds' => $target,
                'remaining_shift_seconds' => $target,
                'completed_shift' => false,
                'leave_type' => $leaveForDate->leave_type,
                'leave_units' => $leaveForDate->unitsForDate(now()),
                'punches' => [],
            ];
        }

        if (!$record->relationLoaded('punches')) {
            $record->load('punches');
        }

        $worked = $this->calculateEffectiveWorkedSeconds($record);
        $breakSeconds = $this->calculateBreakSeconds($record);
        $target = $this->shiftTargetSecondsForLeave($leaveForDate);

        return [
            'id' => $record->id,
            'attendance_date' => Carbon::parse($record->attendance_date)->toDateString(),
            'check_in_at' => $record->check_in_at,
            'check_out_at' => $record->check_out_at,
            'worked_seconds' => $worked,
            'manual_adjustment_seconds' => (int) ($record->manual_adjustment_seconds ?? 0),
            'late_minutes' => (int) $record->late_minutes,
            'status' => $record->status,
            'is_checked_in' => $this->hasOpenPunch($record),
            'total_break_seconds' => $breakSeconds,
            'shift_target_seconds' => $target,
            'remaining_shift_seconds' => max(0, $target - $worked),
            'completed_shift' => $worked >= $target,
            'leave_type' => $leaveForDate?->leave_type,
            'leave_units' => $leaveForDate ? $leaveForDate->unitsForDate($record->attendance_date) : 0,
            'punches' => $record->punches->map(fn (AttendancePunch $punch) => [
                'id' => $punch->id,
                'punch_in_at' => $punch->punch_in_at,
                'punch_out_at' => $punch->punch_out_at,
                'worked_seconds' => (int) $punch->worked_seconds,
            ])->values(),
        ];
    }

    private function shiftTargetSeconds(): int
    {
        return config('attendance.shift_seconds', 8 * 3600);
    }

    private function officeStartTimeForUser(User $user): string
    {
        $attendanceSettings = $this->attendanceSettingsForUser($user);

        return $this->normalizeTimeString(
            $attendanceSettings['office_start_time'] ?? null,
            self::DEFAULT_OFFICE_START
        );
    }

    private function lateAfterTimeForUser(User $user): string
    {
        $attendanceSettings = $this->attendanceSettingsForUser($user);

        return $this->normalizeTimeString(
            $attendanceSettings['late_after_time'] ?? null,
            config('attendance.late_after', self::DEFAULT_LATE_AFTER)
        );
    }

    private function attendanceSettingsForUser(User $user): array
    {
        $settings = is_array($user->organization?->settings) ? $user->organization->settings : [];
        $attendance = $settings['attendance'] ?? null;

        return is_array($attendance) ? $attendance : [];
    }

    private function normalizeTimeString(mixed $value, string $fallback): string
    {
        if (!is_string($value) || trim($value) === '') {
            return Carbon::parse($fallback)->format('H:i:s');
        }

        try {
            return Carbon::parse($value)->format('H:i:s');
        } catch (\Throwable) {
            return Carbon::parse($fallback)->format('H:i:s');
        }
    }

    private function shiftTargetSecondsForLeave(?LeaveRequest $leave): int
    {
        $baseTarget = $this->shiftTargetSeconds();
        if (!$leave || !$leave->isHalfDay()) {
            return $baseTarget;
        }

        return max(1, (int) floor($baseTarget / 2));
    }

    private function approvedLeaveForDate(User $user, string $date): ?LeaveRequest
    {
        return LeaveRequest::where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->where('status', 'approved')
            ->whereDate('start_date', '<=', $date)
            ->whereDate('end_date', '>=', $date)
            ->orderByRaw("case when leave_type = 'full_day' then 0 else 1 end")
            ->first();
    }

    private function hasApprovedFullDayLeaveOnDate(User $user, string $date): bool
    {
        $leave = $this->approvedLeaveForDate($user, $date);

        return (bool) $leave && !$leave->isHalfDay();
    }

    private function calculateClosedWorkedSeconds(AttendanceRecord $record): int
    {
        if (!$record->relationLoaded('punches')) {
            $record->load('punches');
        }

        return (int) $record->punches
            ->filter(fn (AttendancePunch $punch) => (bool) $punch->punch_out_at)
            ->sum(fn (AttendancePunch $punch) => max(
                (int) $punch->worked_seconds,
                (int) Carbon::parse($punch->punch_in_at)->diffInSeconds(Carbon::parse($punch->punch_out_at))
            ));
    }

    private function calculateEffectiveWorkedSeconds(AttendanceRecord $record): int
    {
        if (!$record->relationLoaded('punches')) {
            $record->load('punches');
        }

        $closed = $this->calculateClosedWorkedSeconds($record);
        $open = 0;
        $openPunch = $record->punches->first(fn (AttendancePunch $punch) => !$punch->punch_out_at);
        if ($openPunch) {
            $open = max(0, Carbon::parse($openPunch->punch_in_at)->diffInSeconds(now()));
        }

        return (int) max(0, max($record->worked_seconds ?? 0, $closed + $open) + (int) ($record->manual_adjustment_seconds ?? 0));
    }

    private function calculateBreakSeconds(AttendanceRecord $record): int
    {
        if (!$record->relationLoaded('punches')) {
            $record->load('punches');
        }

        $ordered = $record->punches->sortBy('punch_in_at')->values();
        $breakSeconds = 0;

        for ($i = 1; $i < $ordered->count(); $i++) {
            $previous = $ordered[$i - 1];
            $current = $ordered[$i];

            if (!$previous->punch_out_at || !$current->punch_in_at) {
                continue;
            }

            $gap = Carbon::parse($previous->punch_out_at)->diffInSeconds(Carbon::parse($current->punch_in_at), false);
            if ($gap > 0) {
                $breakSeconds += $gap;
            }
        }

        return (int) $breakSeconds;
    }

    private function hasOpenPunch(AttendanceRecord $record): bool
    {
        if (!$record->relationLoaded('punches')) {
            $record->load('punches');
        }

        return $record->punches->contains(fn (AttendancePunch $punch) => !$punch->punch_out_at);
    }

    private function runningPrimaryTimersQuery(int $userId): Builder
    {
        return TimeEntry::query()
            ->where('user_id', $userId)
            ->whereNull('end_time')
            ->where(function (Builder $query) {
                $query->where('timer_slot', 'primary')
                    ->orWhereNull('timer_slot');
            });
    }

    private function closeRunningPrimaryTimers(int $userId, Carbon $endedAt): void
    {
        $runningEntries = $this->runningPrimaryTimersQuery($userId)
            ->orderByDesc('start_time')
            ->get();

        foreach ($runningEntries as $runningEntry) {
            $runningEntry->update([
                'end_time' => $endedAt,
                'duration' => $this->calculateEntryDuration($runningEntry, $endedAt),
            ]);
        }
    }

    private function startPrimaryTimer(User $user, Carbon $startedAt, ?string $description = null): void
    {
        TimeEntry::create([
            'user_id' => $user->id,
            'project_id' => null,
            'task_id' => null,
            'description' => $description,
            'start_time' => $startedAt,
            'timer_slot' => 'primary',
        ]);
    }

    private function calculateEntryDuration(TimeEntry $entry, ?Carbon $endedAt = null): int
    {
        if ($entry->end_time) {
            return (int) max(
                (int) ($entry->duration ?? 0),
                Carbon::parse($entry->start_time)->diffInSeconds(Carbon::parse($entry->end_time))
            );
        }

        $resolvedEnd = $endedAt ?: now();

        return (int) max(
            (int) ($entry->duration ?? 0),
            Carbon::parse($entry->start_time)->diffInSeconds($resolvedEnd)
        );
    }
}
