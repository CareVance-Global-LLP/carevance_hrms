<?php

use App\Http\Controllers\Api\AccountingExportController;
use Illuminate\Support\Facades\Route;

/**
 * Payroll to Tally or Zoho Books.
 *
 * Behind the payroll gate rather than the general settings one: the journal
 * carries what the organization pays in total, and posting it is an act with
 * financial consequences.
 */
Route::middleware('role:payroll')->group(function () {
    Route::get('/payroll/runs/{payrollMonthlyRun}/journal', [AccountingExportController::class, 'preview']);
    Route::get('/payroll/runs/{payrollMonthlyRun}/journal/export', [AccountingExportController::class, 'download']);
});
