<?php

use App\Http\Controllers\Api\AttendanceController;
use App\Http\Controllers\Api\AttendanceHolidayController;
use App\Http\Controllers\Api\AttendanceTimeEditRequestController;
use App\Http\Controllers\Api\LeaveRequestController;
use Illuminate\Support\Facades\Route;

Route::get('/attendance/today', [AttendanceController::class, 'today']);
Route::post('/attendance/check-in', [AttendanceController::class, 'checkIn']);
Route::post('/attendance/check-out', [AttendanceController::class, 'checkOut']);
Route::get('/attendance/calendar', [AttendanceController::class, 'calendar']);
Route::get('/attendance/holidays', [AttendanceHolidayController::class, 'index']);
Route::get('/attendance/summary', [AttendanceController::class, 'summary'])->middleware('role:admin,manager');

Route::get('/leave-requests', [LeaveRequestController::class, 'index']);
Route::get('/leave-requests/balances', [LeaveRequestController::class, 'balances']);
Route::post('/leave-requests', [LeaveRequestController::class, 'store']);
Route::post('/leave-requests/{id}/revoke-request', [LeaveRequestController::class, 'requestRevoke']);
Route::get('/attendance-time-edit-requests', [AttendanceTimeEditRequestController::class, 'index']);
Route::post('/attendance-time-edit-requests', [AttendanceTimeEditRequestController::class, 'store']);

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
