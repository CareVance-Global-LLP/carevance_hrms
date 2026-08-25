<?php

use App\Http\Controllers\Api\ReportController;
use Illuminate\Support\Facades\Route;

Route::get('/dashboard', [ReportController::class, 'dashboard']);
Route::get('/reports/daily', [ReportController::class, 'daily']);
Route::get('/reports/weekly', [ReportController::class, 'weekly']);
Route::get('/reports/monthly', [ReportController::class, 'monthly']);
Route::get('/reports/productivity', [ReportController::class, 'productivity']);
Route::get('/reports/attendance', [ReportController::class, 'attendance']);
/*
 * Joiners, leavers and a running headcount by month.
 *
 * The only server aggregation of joining_date/exit_date was inside
 * /payroll/runs/{id}/review, which needs a run to exist for that month - so
 * twelve months of movement meant pulling every user row and reducing in the
 * browser, which also cannot see anyone removed from the directory.
 */
Route::get('/reports/headcount-series', [ReportController::class, 'headcountSeries']);
Route::get('/reports/project/{projectId}', [ReportController::class, 'project']);
Route::get('/reports/export', [ReportController::class, 'export']);
Route::get('/reports/attendance/export', [ReportController::class, 'exportAttendanceSimple']);

Route::middleware('role:admin,manager')->group(function () {
    Route::get('/reports/hub-summary', [ReportController::class, 'hubSummary']);
    Route::get('/reports/team', [ReportController::class, 'team']);
    Route::get('/reports/employee-insights', [ReportController::class, 'employeeInsights']);
    Route::get('/reports/overall', [ReportController::class, 'overall']);
});
