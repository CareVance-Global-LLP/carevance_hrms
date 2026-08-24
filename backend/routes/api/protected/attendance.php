<?php

use App\Http\Controllers\Api\AttendanceController;
use App\Http\Controllers\Api\AttendanceDayOutcomeController;
use App\Http\Controllers\Api\AttendanceHolidayController;
use App\Http\Controllers\Api\AttendanceSelfieController;
use App\Http\Controllers\Api\AttendanceTimeEditRequestController;
use App\Http\Controllers\Api\BreakTrackingController;
use App\Http\Controllers\Api\LeaveRequestController;
use App\Http\Controllers\Api\ShiftAssignmentController;
use App\Http\Controllers\Api\ShiftController;
use Illuminate\Support\Facades\Route;

Route::get('/attendance/today', [AttendanceController::class, 'today']);
Route::post('/attendance/check-in', [AttendanceController::class, 'checkIn']);
Route::post('/attendance/check-out', [AttendanceController::class, 'checkOut']);
/*
 * Org-wide scalars for today. Registered beside the calendar because they
 * answer the same question at two resolutions - this one for the dashboard's
 * census strip, the calendar for the trend behind it.
 *
 * It exists to replace AttendanceController::summary on that strip: summary
 * runs one AttendanceRecord query per employee, which is a roster table's
 * cost paid to render six numbers.
 */
Route::get('/attendance/today-summary', [AttendanceController::class, 'todaySummary']);

/*
 * Every approval queue as one number each. Six badges used to cost six round
 * trips across three counting conventions; these are COUNT queries, so the
 * 200-row cap on time-edit requests cannot render as a confident "200".
 */
Route::get('/approvals/pending-counts', [AttendanceController::class, 'pendingApprovals']);
Route::get('/attendance/calendar', [AttendanceController::class, 'calendar']);
// The calendar says what happened; this says what it COST and why. Kept apart
// because a month of penalisation outcomes walks an exemption cycle per day.
Route::get('/attendance/day-outcomes', [AttendanceDayOutcomeController::class, 'index']);
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

/*
 * Shifts.
 *
 * Route order matters: "/shifts/my" and "/shifts/assignments" are declared
 * before "/shifts/{id}" so neither word is ever captured as an id.
 *
 * There is no `role:` middleware here on purpose. The gate is inline in the
 * controllers (ShiftController::canManage), which reads the settings.manage
 * permission first and only falls back to hierarchy — a custom role holding
 * that permission would be turned away at the door by a role-string match and
 * never reach the check meant to admit it. "/shifts/my" is open to every member
 * because reading your own roster is not a management action.
 */
Route::get('/shifts/my', [ShiftController::class, 'my']);
Route::get('/shifts/assignments', [ShiftAssignmentController::class, 'index']);
Route::post('/shifts/assignments', [ShiftAssignmentController::class, 'store']);
Route::delete('/shifts/assignments/{id}', [ShiftAssignmentController::class, 'destroy']);
Route::get('/shifts', [ShiftController::class, 'index']);
Route::post('/shifts', [ShiftController::class, 'store']);
Route::match(['put', 'patch'], '/shifts/{id}', [ShiftController::class, 'update']);
Route::delete('/shifts/{id}', [ShiftController::class, 'destroy']);
