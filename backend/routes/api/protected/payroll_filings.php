<?php

use App\Http\Controllers\Api\PayrollFilingController;
use Illuminate\Support\Facades\Route;

Route::prefix('payroll')->middleware('plan.payroll')->group(function () {

    // ===== Statutory Filings =====
    Route::prefix('filings')->group(function () {
        // Reviewer queue (must precede /{id} GET)
        Route::get('/review/queue', [PayrollFilingController::class, 'reviewQueue']);

        Route::get('/', [PayrollFilingController::class, 'listFilings']);
        Route::get('/{id}/download', [PayrollFilingController::class, 'downloadFiling']);
        Route::get('/{id}/portal', [PayrollFilingController::class, 'portalInfo']);
        Route::get('/{id}', [PayrollFilingController::class, 'getFiling']);

        // Pre-flight validation (Phase B)
        Route::post('/validate', [PayrollFilingController::class, 'validateFiling']);
        Route::post('/validate-run', [PayrollFilingController::class, 'validateRun']);

        // Maker-checker review workflow (Phase C)
        Route::post('/{id}/submit', [PayrollFilingController::class, 'submitForReview']);
        Route::post('/{id}/approve', [PayrollFilingController::class, 'approveFiling']);
        Route::post('/{id}/reject', [PayrollFilingController::class, 'rejectFiling']);
        Route::post('/{id}/mark-filed', [PayrollFilingController::class, 'markFiled']);

        // PF ECR
        Route::post('/generate/pf-ecr', [PayrollFilingController::class, 'generatePfEcr']);

        // ESI Challan
        Route::post('/generate/esi-challan', [PayrollFilingController::class, 'generateEsiChallan']);

        // Form 24Q (TDS Quarterly)
        Route::post('/generate/form-24q', [PayrollFilingController::class, 'generateForm24Q']);

        // Form 16 (per employee)
        Route::post('/generate/form-16', [PayrollFilingController::class, 'generateForm16']);
        Route::post('/upload/form-16', [PayrollFilingController::class, 'uploadForm16']);

        // Form 12BA (perquisites)
        Route::post('/generate/form-12ba', [PayrollFilingController::class, 'generateForm12BA']);

        // PT Return (state-wise)
        Route::post('/generate/pt-return', [PayrollFilingController::class, 'generatePtReturn']);

        // LWF Return (state-wise)
        Route::post('/generate/lwf-return', [PayrollFilingController::class, 'generateLwfReturn']);

        // Bonus Form C (annual, configurable %)
        Route::post('/generate/bonus-form-c', [PayrollFilingController::class, 'generateBonusFormC']);

        // Generate All
        Route::post('/generate/all', [PayrollFilingController::class, 'generateAllFilings']);
    });

    // ===== Flexible Benefits Plan (FBP) =====
    Route::prefix('fbp')->group(function () {
        Route::get('/components', [PayrollFilingController::class, 'getFbpComponents']);
        Route::get('/allocations/{userId}', [PayrollFilingController::class, 'getFbpAllocation']);
        Route::post('/allocate', [PayrollFilingController::class, 'allocateFbp']);
        Route::post('/claims', [PayrollFilingController::class, 'submitFbpClaim']);
        Route::post('/claims/{id}/approve', [PayrollFilingController::class, 'approveFbpClaim']);
        Route::post('/claims/{id}/reject', [PayrollFilingController::class, 'rejectFbpClaim']);
    });

    // ===== Perquisites =====
    Route::prefix('perquisites')->group(function () {
        Route::post('/', [PayrollFilingController::class, 'createPerquisite']);
        Route::get('/user/{userId}', [PayrollFilingController::class, 'getUserPerquisites']);
    });

    // ===== Tax Simulator =====
    Route::prefix('tax-simulator')->group(function () {
        Route::post('/compare', [PayrollFilingController::class, 'compareTaxRegimes']);
        Route::post('/what-if', [PayrollFilingController::class, 'taxWhatIf']);
        Route::post('/monthly-take-home', [PayrollFilingController::class, 'calculateMonthlyTakeHome']);
    });

    // ===== Salary Revision Letters =====
    Route::prefix('revision-letters')->group(function () {
        Route::post('/', [PayrollFilingController::class, 'generateRevisionLetter']);
        Route::get('/', [PayrollFilingController::class, 'getRevisionLetters']);
        Route::get('/user/{userId}', [PayrollFilingController::class, 'getRevisionLetters']);
        Route::post('/{id}/accept', [PayrollFilingController::class, 'acceptRevisionLetter']);
        Route::post('/{id}/reject', [PayrollFilingController::class, 'rejectRevisionLetter']);
    });

    // ===== Payroll Checklist / Validation =====
    Route::prefix('checklist')->group(function () {
        Route::post('/validate-run', [PayrollFilingController::class, 'runPayrollValidation']);
        Route::get('/run/{runId}', [PayrollFilingController::class, 'getChecklistStatus']);
        Route::post('/resolve', [PayrollFilingController::class, 'resolveCheck']);
    });

    // ===== Arrear Detection =====
    Route::prefix('arrears')->group(function () {
        Route::get('/detect/{userId}', [PayrollFilingController::class, 'detectCtcArrears']);
        Route::post('/calculate', [PayrollFilingController::class, 'calculateArrear']);
    });

    // ===== Variable Pay =====
    Route::prefix('variable-pay')->group(function () {
        Route::post('/calculate', [PayrollFilingController::class, 'calculateVariablePay']);
    });

    // ===== Payroll Register / Reports =====
    Route::prefix('reports')->group(function () {
        Route::post('/payroll-register', [PayrollFilingController::class, 'getPayrollRegister']);
        Route::post('/statutory-register', [PayrollFilingController::class, 'getStatutoryRegister']);
        Route::post('/bank-reconciliation', [PayrollFilingController::class, 'getBankReconciliation']);
    });

    // ===== Bank Integration =====
    Route::prefix('bank')->group(function () {
        Route::post('/create-batch', [PayrollFilingController::class, 'createTransferBatch']);
        Route::post('/batches/{batchId}/process', [PayrollFilingController::class, 'processBatch']);
        Route::post('/batches/{batchId}/file', [PayrollFilingController::class, 'generateBankFile']);
        Route::post('/payment-reversal', [PayrollFilingController::class, 'initiatePaymentReversal']);
    });

    // ===== Salary Formula Engine =====
    Route::prefix('formula-engine')->group(function () {
        Route::post('/evaluate', [PayrollFilingController::class, 'evaluateFormula']);
        Route::post('/validate', [PayrollFilingController::class, 'validateFormula']);
    });

    // ===== Pay Groups =====
    Route::prefix('pay-groups')->group(function () {
        Route::get('/', [PayrollFilingController::class, 'listPayGroups']);
        Route::post('/', [PayrollFilingController::class, 'storePayGroup']);
    });

    // ===== Daily Wage & CTC Bands =====
    Route::prefix('compensation')->group(function () {
        Route::get('/daily-wage-structures', [PayrollFilingController::class, 'listDailyWageStructures']);
        Route::get('/ctc-bands', [PayrollFilingController::class, 'listCtcBands']);
        Route::post('/find-ctc-band', [PayrollFilingController::class, 'findCtcBand']);
    });
});
