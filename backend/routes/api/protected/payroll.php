<?php

use App\Http\Controllers\Api\SimplePayrollController;
use Illuminate\Support\Facades\Route;

Route::middleware('payroll.enabled')->prefix('payroll')->group(function () {
    Route::get('/payslips', [SimplePayrollController::class, 'payslips']);
    Route::get('/payslips/{id}', [SimplePayrollController::class, 'showPayslip']);
    Route::get('/payslips/{id}/pdf', [SimplePayrollController::class, 'downloadPayslipPdf']);

    Route::middleware('role:admin,manager')->group(function () {
        Route::get('/overview', [SimplePayrollController::class, 'overview']);
        Route::get('/salary-profiles', [SimplePayrollController::class, 'salaryProfiles']);
        Route::put('/salary-profiles/{userId}', [SimplePayrollController::class, 'saveSalaryProfile']);
        Route::get('/runs', [SimplePayrollController::class, 'runs']);
        Route::post('/runs/generate', [SimplePayrollController::class, 'generateRun']);
        Route::get('/runs/{id}', [SimplePayrollController::class, 'showRun']);
        Route::post('/runs/{id}/approve', [SimplePayrollController::class, 'approveRun']);
        Route::post('/runs/{id}/mark-paid', [SimplePayrollController::class, 'markPaid']);
        Route::get('/adjustments', [SimplePayrollController::class, 'adjustments']);
        Route::post('/adjustments', [SimplePayrollController::class, 'saveAdjustment']);
        Route::get('/settings', [SimplePayrollController::class, 'settings']);
        Route::put('/settings', [SimplePayrollController::class, 'saveSettings']);
    });
});
