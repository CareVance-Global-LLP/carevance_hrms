<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\Attendance\AttendanceCalendarRequest;
use App\Http\Requests\Api\Attendance\AttendanceSummaryRequest;
use App\Services\Attendance\AttendanceService;
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
        $result = $this->attendanceService->checkIn(
            $request->user(),
            $request->filled('latitude') ? (float) $request->latitude : null,
            $request->filled('longitude') ? (float) $request->longitude : null,
        );

        return response()->json($result['payload'], $result['status']);
    }

    public function checkOut(Request $request)
    {
        $result = $this->attendanceService->checkOut(
            $request->user(),
            $request->filled('latitude') ? (float) $request->latitude : null,
            $request->filled('longitude') ? (float) $request->longitude : null,
        );

        return response()->json($result['payload'], $result['status']);
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
}
