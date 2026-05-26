<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceRecord;
use App\Models\GeofenceZone;
use App\Models\TimeEntry;
use App\Services\Billing\PlanService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmployeeDashboardController extends Controller
{
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

        $monthlySeconds = (int) TimeEntry::where('user_id', $user->id)
            ->whereNotNull('end_time')
            ->where('start_time', '>=', $monthStart)
            ->where('start_time', '<=', $monthEnd)
            ->sum('duration');

        $monthlyDays = (int) TimeEntry::where('user_id', $user->id)
            ->whereNotNull('end_time')
            ->where('start_time', '>=', $monthStart)
            ->where('start_time', '<=', $monthEnd)
            ->distinct('start_time')
            ->count(\DB::raw('DATE(start_time)'));

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
            'monthly_total_seconds' => $monthlySeconds,
            'monthly_total_hours' => $monthlyDays > 0
                ? sprintf('%d:%02d:00', floor($monthlySeconds / 3600), floor(($monthlySeconds % 3600) / 60))
                : '0:00:00',
            'monthly_days' => $monthlyDays,
        ]);
    }
}
