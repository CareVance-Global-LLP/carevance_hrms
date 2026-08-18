<?php

use App\Http\Controllers\Api\AttendanceController;
use App\Http\Controllers\Api\AttendanceHolidayController;
use App\Http\Controllers\Api\AttendanceSelfieController;
use App\Http\Controllers\Api\AttendanceTimeEditRequestController;
use App\Http\Controllers\Api\BreakTrackingController;
use App\Http\Controllers\Api\LeaveRequestController;
use Illuminate\Support\Facades\Route;

Route::get('/attendance/today', [AttendanceController::class, 'today']);
Route::post('/attendance/check-in', [AttendanceController::class, 'checkIn']);
Route::post('/attendance/check-out', [AttendanceController::class, 'checkOut']);
Route::get('/attendance/calendar', [AttendanceController::class, 'calendar']);
Route::post('/attendance/selfie', [AttendanceSelfieController::class, 'upload']);
Route::get('/attendance/selfies/today', [AttendanceSelfieController::class, 'todayStatus']);
Route::get('/attendance/selfies/map', [AttendanceSelfieController::class, 'mapData'])->middleware('role:admin,manager');
Route::get('/attendance/holidays', [AttendanceHolidayController::class, 'index']);
Route::get('/attendance/summary', [AttendanceController::class, 'summary'])->middleware('role:admin,manager');
Route::get('/attendance/team-presence', [AttendanceController::class, 'teamPresence']);

Route::get('/leave-requests', [LeaveRequestController::class, 'index']);
Route::get('/leave-requests/balances', [LeaveRequestController::class, 'balances']);
Route::post('/leave-requests', [LeaveRequestController::class, 'store']);
Route::post('/leave-requests/{id}/revoke-request', [LeaveRequestController::class, 'requestRevoke']);
Route::post('/leave-requests/{id}/transfer', [LeaveRequestController::class, 'transfer']);
Route::get('/leave-requests/{id}/forward-targets', [LeaveRequestController::class, 'forwardTargets']);
Route::get('/attendance-time-edit-requests', [AttendanceTimeEditRequestController::class, 'index']);
Route::post('/attendance-time-edit-requests', [AttendanceTimeEditRequestController::class, 'store']);
Route::post('/attendance-time-edit-requests/{id}/transfer', [AttendanceTimeEditRequestController::class, 'transfer']);
Route::get('/attendance-time-edit-requests/{id}/forward-targets', [AttendanceTimeEditRequestController::class, 'forwardTargets']);

Route::middleware('role:admin,manager')->group(function () {
    Route::patch('/leave-requests/{id}/approve', [LeaveRequestController::class, 'approve']);
    Route::patch('/leave-requests/{id}/reject', [LeaveRequestController::class, 'reject']);
    Route::patch('/leave-requests/{id}/revoke-approve', [LeaveRequestController::class, 'approveRevoke']);
    Route::patch('/leave-requests/{id}/revoke-reject', [LeaveRequestController::class, 'rejectRevoke']);
    Route::patch('/attendance-time-edit-requests/{id}/approve', [AttendanceTimeEditRequestController::class, 'approve']);
    Route::patch('/attendance-time-edit-requests/{id}/reject', [AttendanceTimeEditRequestController::class, 'reject']);
    Route::post('/attendance/holidays', [AttendanceHolidayController::class, 'upsert']);
    Route::delete('/attendance/holidays/{id}', [AttendanceHolidayController::class, 'destroy']);
});

Route::get('/breaks/today', [BreakTrackingController::class, 'today']);
Route::get('/breaks/history', [BreakTrackingController::class, 'history']);
Route::post('/breaks/start', [BreakTrackingController::class, 'start']);
Route::post('/breaks/end', [BreakTrackingController::class, 'end']);
// Types before the {id} wildcard so "types" is never captured as an id.
Route::get('/breaks/types', [BreakTrackingController::class, 'types']);
Route::post('/breaks/types', [BreakTrackingController::class, 'storeType']);
Route::put('/breaks/types/{id}', [BreakTrackingController::class, 'updateType']);
Route::delete('/breaks/types/{id}', [BreakTrackingController::class, 'destroyType']);
Route::delete('/breaks/{id}', [BreakTrackingController::class, 'destroy']);
