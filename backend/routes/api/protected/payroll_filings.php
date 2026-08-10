<?php

use App\Http\Controllers\Api\PayrollFilingController;
use Illuminate\Support\Facades\Route;

/**
 * Employee self-service slice of the filings file.
 *
 * Registered first, and deliberately tiny. Everything else in this file —
 * statutory filings, the bank batch and file endpoints, FBP approvals,
 * perquisites, revision-letter generation — is administrative and is gated
 * below. Before this split the whole file sat behind `plan.payroll` alone,
 * which checks the organisation's subscription and not the caller, so an
 * ordinary employee could generate a PF ECR or create and download a bank
 * transfer batch.
 */
Route::prefix('payroll')->middleware('plan.payroll')->group(function () {
    // Submitting a claim and accepting or declining your own salary revision
    // are things the employee is the correct actor for.
    Route::post('/fbp/claims', [PayrollFilingController::class, 'submitFbpClaim']);
    Route::post('/revision-letters/{id}/accept', [PayrollFilingController::class, 'acceptRevisionLetter']);
    Route::post('/revision-letters/{id}/reject', [PayrollFilingController::class, 'rejectRevisionLetter']);

    // Modelling your own take-home. Reads nothing it is not given.
    Route::prefix('tax-simulator')->group(function () {
        Route::post('/compare', [PayrollFilingController::class, 'compareTaxRegimes']);
        Route::post('/what-if', [PayrollFilingController::class, 'taxWhatIf']);
        Route::post('/monthly-take-home', [PayrollFilingController::class, 'calculateMonthlyTakeHome']);
    });
});

Route::prefix('payroll')->middleware(['plan.payroll', 'role:admin,manager'])->group(function () {

    // ===== Statutory Filings =====
    Route::prefix('filings')->group(function () {
        Route::get('/', [PayrollFilingController::class, 'listFilings']);
        Route::get('/{id}/download', [PayrollFilingController::class, 'downloadFiling']);
        Route::get('/{id}/portal', [PayrollFilingController::class, 'portalInfo']);
        Route::get('/{id}', [PayrollFilingController::class, 'getFiling']);

        // Pre-flight validation (Phase B)
        Route::post('/validate', [PayrollFilingController::class, 'validateFiling']);
        Route::post('/validate-run', [PayrollFilingController::class, 'validateRun']);

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

        // Bonus Form D (register of bonus paid)
        Route::post('/generate/bonus-form-d', [PayrollFilingController::class, 'generateBonusFormD']);

        // Bonus Form E (Labour Commissioner summary)
        Route::post('/generate/bonus-form-e', [PayrollFilingController::class, 'generateBonusFormE']);

        // Bonus All (C + D + E)
        Route::post('/generate/bonus-all', [PayrollFilingController::class, 'generateBonusAll']);

        // Declaration Forms (Pattern A — generate here, human uploads to portal)
        Route::post('/generate/form-19', [PayrollFilingController::class, 'generateForm19']);
        Route::post('/generate/form-31', [PayrollFilingController::class, 'generateForm31']);
        Route::post('/generate/form-1', [PayrollFilingController::class, 'generateForm1']);
        Route::post('/generate/form-2', [PayrollFilingController::class, 'generateForm2']);
        Route::post('/generate/form-6', [PayrollFilingController::class, 'generateForm6']);
        Route::post('/generate/eshram-registration', [PayrollFilingController::class, 'generateEShramRegistration']);
        Route::post('/generate/uan-activation', [PayrollFilingController::class, 'generateUanActivation']);
        Route::post('/generate/se-registration', [PayrollFilingController::class, 'generateSeRegistration']);
        Route::post('/generate/shram-card-registration', [PayrollFilingController::class, 'generateShramCardRegistration']);
        Route::post('/generate/form-124', [PayrollFilingController::class, 'generateForm124']);
        Route::post('/generate/full-ecr', [PayrollFilingController::class, 'generateFullEcr']);

        // Generate All
        Route::post('/generate/all', [PayrollFilingController::class, 'generateAllFilings']);
        // Mark filed
        Route::post('/{id}/mark-filed', [PayrollFilingController::class, 'markFiled']);
    });

    // ===== Flexible Benefits Plan (FBP) =====
    Route::prefix('fbp')->group(function () {
        Route::get('/components', [PayrollFilingController::class, 'getFbpComponents']);
        Route::get('/allocations/{userId}', [PayrollFilingController::class, 'getFbpAllocation']);
        Route::post('/allocate', [PayrollFilingController::class, 'allocateFbp']);
        Route::post('/claims/{id}/approve', [PayrollFilingController::class, 'approveFbpClaim']);
        Route::post('/claims/{id}/reject', [PayrollFilingController::class, 'rejectFbpClaim']);
    });

    // ===== Perquisites =====
    Route::prefix('perquisites')->group(function () {
        Route::post('/', [PayrollFilingController::class, 'createPerquisite']);
        Route::get('/user/{userId}', [PayrollFilingController::class, 'getUserPerquisites']);
    });

    // Tax simulator lives in the self-service group at the top of this file.

    // ===== Salary Revision Letters =====
    Route::prefix('revision-letters')->group(function () {
        Route::post('/', [PayrollFilingController::class, 'generateRevisionLetter']);
        Route::get('/', [PayrollFilingController::class, 'getRevisionLetters']);
        Route::get('/user/{userId}', [PayrollFilingController::class, 'getRevisionLetters']);
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
        Route::get('/batches', [PayrollFilingController::class, 'listBatches']);
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
