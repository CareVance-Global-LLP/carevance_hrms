<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceRecord;
use App\Models\GeofenceZone;
use App\Models\TimeEntry;
use App\Services\Billing\PlanService;
use App\Services\Reports\WorkTimeSummaryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmployeeDashboardController extends Controller
{
    public function __construct(
        private readonly WorkTimeSummaryService $workTimeSummaryService,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $month = $request->get('month', now()->format('Y-m'));

        $activeTimer = TimeEntry::where('user_id', $user->id)
            ->whereNull('end_time')
            ->where('timer_slot', 'primary')
            ->first();

        $attendanceToday = AttendanceRecord::where('user_id', $user->id)
            ->whereDate('attendance_date', now()->toDateString())
            ->with('punches')
            ->first();

        $zone = null;
        if (PlanService::hasFeature($user->organization, 'geo_fencing')) {
            $zone = GeofenceZone::activeForOrg((int) $user->organization_id)->first();
        }

        $monthStart = \Carbon\Carbon::createFromFormat('Y-m', $month)->startOfMonth();
        $monthEnd = $monthStart->copy()->endOfMonth();

        // Single aggregate query replaces two sequential TimeEntry queries
        // (monthly seconds + distinct active days) for this small payload.
        $monthlySummary = TimeEntry::where('user_id', $user->id)
            ->whereNotNull('end_time')
            ->where('start_time', '>=', $monthStart)
            ->where('start_time', '<=', $monthEnd)
            ->selectRaw('COALESCE(SUM(duration), 0) as total_seconds, COUNT(DISTINCT DATE(start_time)) as active_days')
            ->first();

        $monthlySeconds = (int) ($monthlySummary->total_seconds ?? 0);
        $monthlyDays = (int) ($monthlySummary->active_days ?? 0);

        $monthlyBreakSeconds = (int) TimeEntry::where('user_id', $user->id)
            ->where('is_break', true)
            ->whereNotNull('end_time')
            ->where('start_time', '>=', $monthStart)
            ->where('start_time', '<=', $monthEnd)
            ->sum('duration');

        $todaySummary = $this->workTimeSummaryService->forUserRange(
            $user->id,
            now()->startOfDay(),
            now()->endOfDay()
        );
        $monthlySummary = $this->workTimeSummaryService->forUserRange(
            $user->id,
            $monthStart,
            $monthEnd
        );

        return response()->json([
            'active_timer' => $activeTimer ? [
                'id' => $activeTimer->id,
                'start_time' => $activeTimer->start_time,
                'description' => $activeTimer->description,
            ] : null,
            'attendance_today' => $attendanceToday ? [
                'id' => $attendanceToday->id,
                'check_in_at' => $attendanceToday->check_in_at,
                'check_out_at' => $attendanceToday->check_out_at,
                'status' => $attendanceToday->status,
                'is_checked_in' => $attendanceToday->punches->contains(fn ($p) => !$p->punch_out_at),
                'worked_seconds' => (int) $attendanceToday->worked_seconds,
            ] : null,
            'geofence_zone' => $zone ? [
                'id' => $zone->id,
                'name' => $zone->name,
                'latitude' => $zone->latitude,
                'longitude' => $zone->longitude,
                'radius_meters' => $zone->radius_meters,
            ] : null,
            'today_track_time' => $todaySummary['track_time'],
            'today_work_time' => $todaySummary['work_time'],
            'today_idle_time' => $todaySummary['idle_time'],
            'today_break_time' => $todaySummary['break_time'],
            'monthly_total_seconds' => $monthlySummary['track_time'],
            'monthly_total_hours' => $monthlyDays > 0
                ? sprintf('%d:%02d:00', floor($monthlySummary['track_time'] / 3600), floor(($monthlySummary['track_time'] % 3600) / 60))
                : '0:00:00',
            'monthly_work_seconds' => $monthlySummary['work_time'],
            'monthly_idle_seconds' => $monthlySummary['idle_time'],
            'monthly_days' => $monthlyDays,
            'monthly_break_seconds' => $monthlySummary['break_time'],
            'monthly_break_hours' => sprintf('%d:%02d:00', floor($monthlySummary['break_time'] / 3600), floor(($monthlySummary['break_time'] % 3600) / 60)),
        ]);
    }
}
