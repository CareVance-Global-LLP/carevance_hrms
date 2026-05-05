<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\Attendance\AttendanceCalendarRequest;
use App\Http\Requests\Api\Attendance\AttendanceSummaryRequest;
use App\Services\Attendance\AttendanceService;
use Illuminate\Http\Request;

class AttendanceController extends Controller
{
    public function __construct(
        private readonly AttendanceService $attendanceService,
    ) {
    }

    public function today(Request $request)
    {
        return response()->json($this->attendanceService->todayPayload(
            $request->user(),
            $request->integer('user_id') ?: null,
        ));
    }

    public function checkIn(Request $request)
    {
        $result = $this->attendanceService->checkIn($request->user());

        return response()->json($result['payload'], $result['status']);
    }

    public function checkOut(Request $request)
    {
        $result = $this->attendanceService->checkOut($request->user());

        return response()->json($result['payload'], $result['status']);
    }

    public function calendar(AttendanceCalendarRequest $request)
    {
        $result = $this->attendanceService->calendar($request, $request->user());

        return response()->json($result['payload'], $result['status']);
    }

    public function summary(AttendanceSummaryRequest $request)
    {
        return response()->json($this->attendanceService->summary($request, $request->user()));
    }
}
