<?php

use App\Http\Controllers\Api\PayrollController;
use App\Http\Controllers\Api\PayrollDepartmentController;
use Illuminate\Support\Facades\Route;

/**
 * Payroll API Routes - Comprehensive Payroll Management
 * 
 * All routes are protected by api.token middleware
 */

// Department-based Payroll Management
Route::prefix('payroll')->middleware('plan.payroll')->group(function () {
    // Debug endpoint
    Route::get('/debug', [\App\Http\Controllers\Api\PayrollDebugController::class, 'debugDepartments']);
    
    // Dashboard & Stats
    Route::get('/dashboard', [PayrollDepartmentController::class, 'getPayrollStats']);
    Route::get('/stats', [PayrollDepartmentController::class, 'getPayrollStats']);
    
    // Departments
    Route::get('/departments', [PayrollDepartmentController::class, 'getDepartments']);
    Route::get('/departments/{departmentId}/employees', [PayrollDepartmentController::class, 'getDepartmentEmployees']);
    
    // Employee Payroll
    Route::get('/employees/{userId}', [PayrollDepartmentController::class, 'getEmployeePayrollDetails']);
    Route::put('/employees/{userId}/template', [PayrollDepartmentController::class, 'updateEmployeeTemplate']);
    Route::post('/employees/{userId}/process', [PayrollDepartmentController::class, 'processEmployeePayroll']);
    
    // Time tracking (standalone mode)
    Route::post('/check-in', [PayrollController::class, 'checkIn']);
    Route::post('/check-out', [PayrollController::class, 'checkOut']);
    Route::get('/time-entries', [PayrollController::class, 'getTimeEntries']);
    
    // Calculations
    Route::post('/calculate', [PayrollController::class, 'calculate']);
    Route::post('/calculate-bulk', [PayrollController::class, 'calculateBulk']);
    
    // Professional Tax
    Route::get('/pt-states', [PayrollController::class, 'getPTStates']);
    Route::get('/pt-states/{state}/configuration', [PayrollController::class, 'getPTConfiguration']);
    
    // Payroll Run Lifecycle
    Route::get('/runs', [PayrollDepartmentController::class, 'getPayrollRuns']);
    Route::get('/runs/{runId}', [PayrollDepartmentController::class, 'getPayrollRunDetail']);
    Route::post('/runs/{runId}/lock', [PayrollDepartmentController::class, 'lockPayrollRun']);
    Route::post('/runs/{runId}/approve', [PayrollDepartmentController::class, 'approvePayrollRun']);
    Route::post('/runs/{runId}/release', [PayrollDepartmentController::class, 'releasePayrollRun']);
    Route::post('/runs/{runId}/process-payment', [PayrollDepartmentController::class, 'processRunPayment']);
    
    // Bank File
    Route::get('/runs/{runId}/bank-file', [PayrollDepartmentController::class, 'generateBankFile']);
    
    // Bulk Payslips
    Route::get('/runs/{runId}/payslips', [PayrollDepartmentController::class, 'generateBulkPayslips']);
    
    // Payments
    Route::post('/process-payment', [PayrollController::class, 'processPayment']);
    
    // Payslips
    Route::post('/generate-payslip', [PayrollController::class, 'generatePayslip']);
    Route::get('/payslip/{userId}/{monthYear}/download', [PayrollController::class, 'downloadPayslipPdf']);
    
    // Employee Self-Service
    Route::get('/my/payslips', [PayrollController::class, 'myPayslips']);

    // Tax Declarations (Form 12BB)
    Route::get('/tax-sections', [\App\Http\Controllers\Api\TaxDeclarationController::class, 'getSections']);
    Route::get('/my/declaration', [\App\Http\Controllers\Api\TaxDeclarationController::class, 'myDeclaration']);
    Route::post('/my/declaration/items', [\App\Http\Controllers\Api\TaxDeclarationController::class, 'saveItems']);
    Route::post('/my/declaration/{declarationId}/submit', [\App\Http\Controllers\Api\TaxDeclarationController::class, 'submit']);
    Route::post('/declaration-items/{itemId}/proof', [\App\Http\Controllers\Api\TaxDeclarationController::class, 'uploadProof']);
    Route::post('/declarations/{declarationId}/review', [\App\Http\Controllers\Api\TaxDeclarationController::class, 'review']);
    Route::get('/declarations', [\App\Http\Controllers\Api\TaxDeclarationController::class, 'listDeclarations']);

    // Loan / Advance Management
    Route::post('/loans/request', [\App\Http\Controllers\Api\LoanController::class, 'requestLoan']);
    Route::get('/my/loans', [\App\Http\Controllers\Api\LoanController::class, 'myLoans']);
    Route::get('/loans', [\App\Http\Controllers\Api\LoanController::class, 'listLoans']);
    Route::post('/loans/{loanId}/approve', [\App\Http\Controllers\Api\LoanController::class, 'approveLoan']);
    Route::post('/loans/{loanId}/reject', [\App\Http\Controllers\Api\LoanController::class, 'rejectLoan']);
    Route::post('/loans/{loanId}/close', [\App\Http\Controllers\Api\LoanController::class, 'closeLoan']);
    
    // Payroll Organization Settings
    Route::get('/settings', [\App\Http\Controllers\Api\PayrollSettingsController::class, 'getSettings']);
    Route::put('/settings', [\App\Http\Controllers\Api\PayrollSettingsController::class, 'updateSettings']);
    Route::post('/settings/reset', [\App\Http\Controllers\Api\PayrollSettingsController::class, 'resetSettings']);
    
    // Dashboard Data
    Route::get('/dashboard-data', [\App\Http\Controllers\Api\PayrollDashboardController::class, 'getDashboardData']);
    
    // Legacy endpoints
    Route::get('/employees', [PayrollController::class, 'getEmployees']);
    Route::put('/employees/{userId}/profile', [PayrollController::class, 'updateEmployeeProfile']);
    Route::get('/summary', [PayrollController::class, 'getSummary']);
});
