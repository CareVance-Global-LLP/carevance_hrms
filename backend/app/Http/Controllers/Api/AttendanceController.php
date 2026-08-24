<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\Attendance\AttendanceCalendarRequest;
use App\Http\Requests\Api\Attendance\AttendanceSummaryRequest;
use App\Services\Attendance\AttendanceService;
use App\Services\Attendance\TeamPresenceService;
use App\Services\Attendance\TodaySnapshotService;
use Illuminate\Http\Request;

use Illuminate\Support\Facades\Log;
use Throwable;

class AttendanceController extends Controller
{
    public function __construct(
        private readonly AttendanceService $attendanceService,
    ) {
    }

    public function today(Request $request)
    {
        try {
            return response()->json($this->attendanceService->todayPayload(
                $request->user(),
                $request->integer('user_id') ?: null,
            ));
        } catch (Throwable $e) {
            Log::error('Attendance today error', ['error' => $e->getMessage(), 'user_id' => $request->user()?->id]);
            return response()->json(['message' => 'Failed to load attendance data', 'error' => 'Server error'], 500);
        }
    }

    public function checkIn(Request $request)
    {
        $request->validate([
            'latitude' => 'nullable|numeric|between:-90,90',
            'longitude' => 'nullable|numeric|between:-180,180',
            // Offline-sync metadata (see IdempotentSync middleware).
            'local_id' => 'nullable|string|max:191',
            'device_id' => 'nullable|string|max:191',
            'punch_at' => 'nullable|date',
        ]);

        $result = $this->attendanceService->checkIn(
            $request->user(),
            $request->filled('latitude') ? (float) $request->latitude : null,
            $request->filled('longitude') ? (float) $request->longitude : null,
            [
                'local_id' => $request->input('local_id'),
                'device_id' => $request->input('device_id'),
                'punch_at' => $request->input('punch_at'),
            ],
        );

        return response()->json($result['payload'], $result['status']);
    }

    public function checkOut(Request $request)
    {
        $request->validate([
            'latitude' => 'nullable|numeric|between:-90,90',
            'longitude' => 'nullable|numeric|between:-180,180',
            // Offline-sync metadata, mirroring checkIn above. The desktop queue
            // already sends these; without them a buffered punch-out was
            // stamped at sync time and could be applied twice.
            'local_id' => 'nullable|string|max:191',
            'device_id' => 'nullable|string|max:191',
            'punch_out_at' => 'nullable|date',
        ]);

        $result = $this->attendanceService->checkOut(
            $request->user(),
            $request->filled('latitude') ? (float) $request->latitude : null,
            $request->filled('longitude') ? (float) $request->longitude : null,
            [
                'local_id' => $request->input('local_id'),
                'device_id' => $request->input('device_id'),
                'punch_out_at' => $request->input('punch_out_at'),
            ],
        );

        return response()->json($result['payload'], $result['status']);
    }

    /**
     * The whole organisation, today, as scalars.
     *
     * Replaces six of the seven calls the dashboard's census strip used to
     * make. `summary()` below builds a row per employee and runs an
     * AttendanceRecord query with a punches eager-load inside the map — fine
     * for a roster table, a true N+1 for six numbers.
     */
    public function todaySummary(Request $request, TodaySnapshotService $snapshot)
    {
        $data = $request->validate([
            'date' => 'nullable|date',
        ]);

        return response()->json([
            'success' => true,
            'data' => $snapshot->forOrganization(
                $request->user()->organization_id,
                $data['date'] ?? null
            ),
        ]);
    }

    /**
     * Every queue waiting on an administrator, in one call.
     *
     * The attention strip made six round trips across three counting
     * conventions — a pre-limit paginator total, a data.length under a hard
     * 200-row cap, and a bare unpaginated array. These are COUNT queries, so
     * no cap applies and a count is a count.
     */
    public function pendingApprovals(Request $request, \App\Services\PendingApprovalsService $approvals)
    {
        return response()->json([
            'success' => true,
            'data' => $approvals->withTotal($request->user()->organization_id),
        ]);
    }

    public function calendar(AttendanceCalendarRequest $request)
    {
        try {
            // Limit date range to prevent memory issues (max 3 months)
            $month = $request->get('month', now()->format('Y-m'));
            $requestedDate = \Carbon\Carbon::createFromFormat('Y-m', $month);
            $maxRange = now()->subMonths(3);
            
            if ($requestedDate->lt($maxRange)) {
                $month = $maxRange->format('Y-m');
            }
            
            // Override the month in request for service
            $request->merge(['month' => $month]);
            
            $result = $this->attendanceService->calendar($request, $request->user());

            return response()->json($result['payload'], $result['status']);
        } catch (Throwable $e) {
            Log::error('Attendance calendar error', ['error' => $e->getMessage(), 'user_id' => $request->user()?->id]);
            return response()->json(['message' => 'Failed to load calendar data', 'error' => 'Server error'], 500);
        }
    }

    public function summary(AttendanceSummaryRequest $request)
    {
        try {
            // Limit date range to prevent memory issues (max 90 days)
            $start = $request->get('start_date');
            $end = $request->get('end_date');
            
            if ($start && $end) {
                $startDate = \Carbon\Carbon::parse($start);
                $endDate = \Carbon\Carbon::parse($end);
                
                if ($startDate->diffInDays($endDate) > 90) {
                    return response()->json([
                        'message' => 'Date range too large. Maximum 90 days allowed.'
                    ], 422);
                }
            }
            
            return response()->json($this->attendanceService->summary($request, $request->user()));
        } catch (Throwable $e) {
            Log::error('Attendance summary error', ['error' => $e->getMessage(), 'user_id' => $request->user()?->id]);
            return response()->json(['message' => 'Failed to load summary data', 'error' => 'Server error'], 500);
        }
    }

    public function teamPresence(Request $request, TeamPresenceService $teamPresence)
    {
        $viewer = $request->user();

        if (!$viewer) {
            return response()->json(['department' => null, 'people' => [], 'off_soon' => []]);
        }

        return response()->json([
            'department' => $viewer->employeeWorkInfo?->department?->name,
            'people' => $teamPresence->peopleFor($viewer),
            'off_soon' => $teamPresence->offSoonFor($viewer),
        ]);
    }
}
