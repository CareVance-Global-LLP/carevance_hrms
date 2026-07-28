<?php

use App\Http\Controllers\Api\PayrollController;
use App\Http\Controllers\Api\PayrollDepartmentController;
use App\Http\Controllers\Api\PayrollDiagnosticController;
use App\Http\Controllers\Api\PayslipController;
use App\Http\Controllers\Api\PayrollFilingController;
use App\Http\Controllers\Api\PayrollOnboardingController;
use App\Http\Controllers\Api\PerformanceGoalController;
use App\Http\Controllers\Api\PerformanceReviewController;
use App\Http\Controllers\Api\ReimbursementController;
use App\Http\Controllers\Api\EnhancedPayrollController;
use App\Http\Controllers\Api\TaxProofUploadController;
use App\Http\Controllers\Api\DepartmentPayrollTemplateController;
use App\Http\Controllers\Api\SalaryStructureController;
use App\Http\Controllers\Api\SalaryComponentController;
use App\Http\Controllers\Api\EmployeePayrollCardController;
use App\Http\Controllers\Api\PayGroupSettingsController;
use App\Http\Controllers\PayrollAutoProcessController;
use Illuminate\Support\Facades\Route;

/**
 * Payroll API Routes - Comprehensive Payroll Management
 * 
 * All routes are protected by api.token middleware
 */

// Department-based Payroll Management
Route::prefix('payroll')->middleware('plan.payroll')->group(function () {
    // Debug endpoints
    Route::get('/debug', [\App\Http\Controllers\Api\PayrollDebugController::class, 'debugDepartments']);
    Route::get('/diagnose', [PayrollDiagnosticController::class, 'diagnose']);
    Route::post('/quick-fix', [PayrollDiagnosticController::class, 'quickFix']);
    Route::get('/test-departments/{departmentId}/employees', [PayrollDiagnosticController::class, 'testDepartmentEmployees']);
    
    // Test endpoints
    Route::get('/test-response/{departmentId}', [\App\Http\Controllers\Api\PayrollTestController::class, 'testResponse']);
    Route::get('/test-raw/{departmentId}', [\App\Http\Controllers\Api\PayrollTestController::class, 'rawData']);

    // Onboarding (first-time user guidance)
    Route::get('/onboarding-status', [PayrollOnboardingController::class, 'status']);
    Route::post('/onboarding/mark-defaults-configured', [PayrollOnboardingController::class, 'markDefaultsConfigured']);
    Route::post('/onboarding/dismiss', [PayrollOnboardingController::class, 'dismiss']);
    Route::post('/onboarding/reopen', [PayrollOnboardingController::class, 'reopen']);
    Route::post('/onboarding/complete-step', [PayrollOnboardingController::class, 'completeStep']);
    Route::post('/onboarding/mark-setup-step', [PayrollOnboardingController::class, 'markSetupStep']);
    Route::post('/onboarding/unmark-setup-step', [PayrollOnboardingController::class, 'unmarkSetupStep']);
    Route::post('/onboarding/mark-welcome-seen', [PayrollOnboardingController::class, 'markWelcomeSeen']);

    // Dashboard & Stats
    Route::get('/dashboard', [PayrollDepartmentController::class, 'getPayrollStats']);
    Route::get('/stats', [PayrollDepartmentController::class, 'getPayrollStats']);
    
    // Departments
    Route::get('/departments', [PayrollDepartmentController::class, 'getDepartments']);
    Route::get('/departments/{departmentId}/employees', [PayrollDepartmentController::class, 'getDepartmentEmployees']);

    // All employees across the organization (used by the Create Pay
    // Group modal). Supports ?search= and ?department_id= filters.
    Route::get('/all-employees', [PayrollDepartmentController::class, 'getAllEmployees']);

    // Employees not assigned to any pay group
    Route::get('/unassigned-employees', [PayrollDepartmentController::class, 'getUnassignedEmployees']);

    // Create a pay group and assign employees in one transaction.
    // Body: { name: string, user_ids: number[], effective_from?: YYYY-MM-DD }
    Route::post('/pay-groups/assign', [PayrollDepartmentController::class, 'assignEmployeesToPayGroup']);

    // Assign an employee to an existing pay group + salary structure
    Route::post('/pay-groups/assign-existing', [PayrollDepartmentController::class, 'assignEmployeeToExistingPayGroup']);

    // Pay Group employee list — same shape as getDepartmentEmployees so
    // the PayGroupEmployees view can share the EmployeeCard component.
    // Query: ?month_year=YYYY-MM (default: current month)
    Route::get('/pay-groups/{id}/employees', [PayrollFilingController::class, 'getPayGroupEmployees']);

    // Bulk-process payroll for the selected members of a pay group.
    // Body: { month_year, user_ids, working_days, default_annual_ctc?, lOP_days?, overtime_hours? }
    Route::post('/pay-groups/{id}/process-selected', [PayrollDepartmentController::class, 'processPayGroupSelectedEmployees']);

    // Reset a single employee's payroll item so they can be re-processed.
    // Body: { user_id: int, month_year: string }
    Route::post('/pay-groups/{id}/reset-employee', [PayrollDepartmentController::class, 'resetEmployeePayroll']);

    // Bulk Payroll Matrix — step completion tracking.
    // Body: { step: 1..6, user_ids: number[] }
    Route::post('/pay-groups/{id}/complete-step', [PayrollFilingController::class, 'completeStep']);
    // Body: { step: 1..6 } — applies to every active member of the pay group.
    Route::post('/pay-groups/{id}/complete-all-steps', [PayrollFilingController::class, 'completeAllSteps']);
    // Returns per-step completion counts for the BulkPayrollMatrix footer.
    Route::get('/pay-groups/{id}/step-status', [PayrollFilingController::class, 'getStepStatus']);
    
    // Employee Payroll
    Route::get('/employees/{userId}', [PayrollDepartmentController::class, 'getEmployeePayrollDetails']);
    Route::get('/employees/{userId}/benefits-summary', [PayrollDepartmentController::class, 'getBenefitsSummary']);
    Route::get('/attendance-summary', [PayrollDepartmentController::class, 'getMonthlyAttendanceSummary']);
    Route::put('/employees/{userId}/template', [PayrollDepartmentController::class, 'updateEmployeeTemplate']);
    Route::patch('/employees/{userId}/ctc', [PayrollDepartmentController::class, 'quickSaveCtc']);
    Route::post('/employees/{userId}/process', [PayrollDepartmentController::class, 'processEmployeePayroll']);

    // Department bulk process
    Route::post('/departments/{departmentId}/process-selected', [PayrollDepartmentController::class, 'processSelectedEmployees']);

    // Department-level salary templates (3-level hierarchy: org -> dept -> employee)
    Route::get('/department-templates', [DepartmentPayrollTemplateController::class, 'index']);
    Route::get('/department-templates/{departmentId}', [DepartmentPayrollTemplateController::class, 'show']);
    Route::put('/department-templates/{departmentId}', [DepartmentPayrollTemplateController::class, 'upsert']);
    Route::delete('/department-templates/{departmentId}', [DepartmentPayrollTemplateController::class, 'destroy']);

    // Salary Structure Templates
    Route::get('/salary-structures', [SalaryStructureController::class, 'index']);
    Route::post('/salary-structures', [SalaryStructureController::class, 'store']);
    Route::get('/salary-structures/default', [SalaryStructureController::class, 'default']);
    Route::get('/salary-structures/{id}', [SalaryStructureController::class, 'show']);
    Route::put('/salary-structures/{id}', [SalaryStructureController::class, 'update']);
    Route::delete('/salary-structures/{id}', [SalaryStructureController::class, 'destroy']);
    Route::post('/salary-structures/{id}/preview', [SalaryStructureController::class, 'preview']);

    // Employee Payroll Cards
    Route::get('/employee-cards', [EmployeePayrollCardController::class, 'index']);
    Route::get('/employee-cards/{userId}', [EmployeePayrollCardController::class, 'show']);
    Route::put('/employee-cards/{userId}', [EmployeePayrollCardController::class, 'update']);

    // Pay Group Settings
    Route::get('/pay-group-settings', [PayGroupSettingsController::class, 'index']);
    Route::post('/pay-group-settings', [PayGroupSettingsController::class, 'store']);
    Route::get('/pay-group-settings/{id}', [PayGroupSettingsController::class, 'show']);
    Route::put('/pay-group-settings/{id}', [PayGroupSettingsController::class, 'update']);
    Route::delete('/pay-group-settings/{id}', [PayGroupSettingsController::class, 'destroy']);
    Route::put('/pay-group-settings/{id}/statutory-rules', [PayGroupSettingsController::class, 'updateStatutoryRules']);
    Route::put('/pay-group-settings/{id}/filing-details', [PayGroupSettingsController::class, 'updateFilingDetails']);

    // Salary Components (org-level component manager)
    Route::get('/salary-components', [SalaryComponentController::class, 'index']);
    Route::post('/salary-components', [SalaryComponentController::class, 'store']);
    Route::get('/salary-components/{id}', [SalaryComponentController::class, 'show']);
    Route::put('/salary-components/{id}', [SalaryComponentController::class, 'update']);
    Route::delete('/salary-components/{id}', [SalaryComponentController::class, 'destroy']);
    Route::post('/salary-components/{id}/toggle', [SalaryComponentController::class, 'toggle']);

    // Salary Formulas (linked to components)
    Route::post('/salary-components/{componentId}/formula', [SalaryComponentController::class, 'saveFormula']);
    Route::delete('/salary-components/{componentId}/formula/{formulaId}', [SalaryComponentController::class, 'deleteFormula']);
    Route::post('/salary-components/{componentId}/formula/validate', [SalaryComponentController::class, 'validateFormula']);
    
    // Time tracking (standalone mode)
    Route::post('/check-in', [PayrollController::class, 'checkIn']);
    Route::post('/check-out', [PayrollController::class, 'checkOut']);
    Route::get('/time-entries', [PayrollController::class, 'getTimeEntries']);
    
    // Calculations
    Route::post('/calculate', [PayrollController::class, 'calculate']);
    Route::post('/calculate-bulk', [PayrollController::class, 'calculateBulk']);
    Route::post('/calculate-comprehensive', [EnhancedPayrollController::class, 'calculatePayroll']);
    Route::get('/employees/{userId}/ctc-breakdown', [EnhancedPayrollController::class, 'getCTCBreakdown']);
    
    // Professional Tax
    Route::get('/pt-states', [PayrollController::class, 'getPTStates']);
    Route::get('/pt-states/{state}/configuration', [PayrollController::class, 'getPTConfiguration']);
    
    // Payroll Run Lifecycle
    Route::get('/runs', [PayrollDepartmentController::class, 'getPayrollRuns']);
    Route::get('/runs/{runId}', [PayrollDepartmentController::class, 'getPayrollRunDetail']);
    Route::get('/runs/{runId}/completeness', [PayrollDepartmentController::class, 'getRunCompleteness']);
Route::get('/runs/{runId}/checklist', [PayrollDepartmentController::class, 'getRunChecklistStatus']);
    Route::get('/runs/{runId}/activity', [PayrollDepartmentController::class, 'getRunActivity']);
    Route::get('/approvals/payroll-locks', [PayrollDepartmentController::class, 'getPayrollLockApprovals']);
    Route::post('/runs/{runId}/reject', [PayrollDepartmentController::class, 'rejectPayrollRun']);
    Route::get('/runs/{runId}/review', [PayrollDepartmentController::class, 'getRunReviewData']);
    Route::post('/runs/{runId}/review', [PayrollDepartmentController::class, 'submitRunReviewDecisions']);
    Route::get('/review-data', [PayrollDepartmentController::class, 'getReviewDataByPayGroup']);
    Route::get('/stop-payment-flags', [PayrollDepartmentController::class, 'listStopPaymentFlags']);
    Route::post('/stop-payment-flags', [PayrollDepartmentController::class, 'createStopPaymentFlag']);
    Route::put('/stop-payment-flags/{id}', [PayrollDepartmentController::class, 'updateStopPaymentFlag']);
    Route::delete('/stop-payment-flags/{id}', [PayrollDepartmentController::class, 'resolveStopPaymentFlag']);
    Route::post('/runs/{runId}/process-remaining', [PayrollDepartmentController::class, 'processRemainingEmployees']);
    Route::post('/runs/{runId}/lock', [PayrollDepartmentController::class, 'lockPayrollRun']);
    Route::post('/runs/{runId}/unlock', [PayrollDepartmentController::class, 'unlockPayrollRun']);
    Route::post('/runs/{runId}/approve', [PayrollDepartmentController::class, 'approvePayrollRun']);
    Route::post('/runs/{runId}/release', [PayrollDepartmentController::class, 'releasePayrollRun']);
    Route::post('/runs/{runId}/release-payout', [PayrollDepartmentController::class, 'releasePayout']);
    Route::post('/runs/{runId}/disburse', [PayrollDepartmentController::class, 'disburseRun']);
    Route::post('/runs/{runId}/notify-payslips', [PayrollDepartmentController::class, 'resendPayslipNotification']);
    Route::post('/runs/{runId}/reverse', [PayrollDepartmentController::class, 'reversePaymentRun']);
    Route::get('/runs/{runId}/reversals', [PayrollDepartmentController::class, 'getRunReversals']);
    Route::post('/runs/{runId}/process-payment', [PayrollDepartmentController::class, 'processRunPayment']);
    Route::post('/items/{itemId}/mark-paid', [PayrollDepartmentController::class, 'markItemPaid']);

    // Atomic "Process & Pay" workflow — replaces the 4-step manual ceremony
    // with one call: bulk-process → lock → approve → release (with bank file inline).
    Route::post('/process-and-pay', [PayrollDepartmentController::class, 'processAndPay']);
    
    // Bank File
    Route::get('/runs/{runId}/bank-file', [PayrollDepartmentController::class, 'generateBankFile']);
    Route::get('/runs/{runId}/missing-bank-details', [PayrollDepartmentController::class, 'getRunMissingBankDetails']);
    
    // Bulk Payslips
    Route::get('/runs/{runId}/payslips', [PayrollDepartmentController::class, 'generateBulkPayslips']);
    
    // Payments
    Route::post('/process-payment', [PayrollController::class, 'processPayment']);
    
    // Payslips
    Route::post('/generate-payslip', [PayrollController::class, 'generatePayslip']);
    Route::get('/payslip/{userId}/{monthYear}/download', [PayrollController::class, 'downloadPayslipPdf']);
    Route::get('/payslip/{userId}/{monthYear}/view', [PayrollController::class, 'viewPayslipPdf']);
    
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

    // Tax Regime Comparison & Recommendations
    Route::post('/tax-simulator/compare', [\App\Http\Controllers\Api\EnhancedPayrollController::class, 'compareTaxRegimes']);
    Route::get('/tax-savings/recommendation', [\App\Http\Controllers\Api\EnhancedPayrollController::class, 'taxSavingsRecommendation']);
    Route::post('/tax-regime/bulk-update', [\App\Http\Controllers\Api\EnhancedPayrollController::class, 'bulkUpdateTaxRegime']);
    Route::post('/hra-optimization', [\App\Http\Controllers\Api\EnhancedPayrollController::class, 'hraOptimization']);

    // Loan / Advance Management
    Route::post('/loans/request', [\App\Http\Controllers\Api\LoanController::class, 'requestLoan']);
    Route::get('/my/loans', [\App\Http\Controllers\Api\LoanController::class, 'myLoans']);
    Route::get('/loans', [\App\Http\Controllers\Api\LoanController::class, 'listLoans']);
    Route::post('/loans/{loanId}/approve', [\App\Http\Controllers\Api\LoanController::class, 'approveLoan']);
    Route::post('/loans/{loanId}/reject', [\App\Http\Controllers\Api\LoanController::class, 'rejectLoan']);
    Route::post('/loans/{loanId}/close', [\App\Http\Controllers\Api\LoanController::class, 'closeLoan']);
    
    // Leave Encashment (NEW)
    Route::post('/leave-encashments', [EnhancedPayrollController::class, 'requestLeaveEncashment']);
    Route::get('/leave-encashments', [EnhancedPayrollController::class, 'listLeaveEncashments']);
    Route::post('/leave-encashments/{id}/approve', [EnhancedPayrollController::class, 'approveLeaveEncashment']);
    Route::post('/leave-encashments/{id}/reject', [EnhancedPayrollController::class, 'rejectLeaveEncashment']);
    
    // Arrear Payments (NEW)
    Route::post('/arrears', [EnhancedPayrollController::class, 'createArrear']);
    Route::get('/arrears', [EnhancedPayrollController::class, 'listArrears']);
    Route::post('/arrears/{id}/approve', [EnhancedPayrollController::class, 'approveArrear']);
    Route::post('/arrears/{id}/reject', [EnhancedPayrollController::class, 'rejectArrear']);
    
    // Full & Final Settlement (NEW)
    Route::post('/fnf-settlements', [EnhancedPayrollController::class, 'createFnFSettlement']);
    Route::get('/fnf-settlements', [EnhancedPayrollController::class, 'listFnFSettlements']);
    Route::get('/fnf-settlements/{id}', [EnhancedPayrollController::class, 'getFnFSettlement']);
    Route::post('/fnf-settlements/{id}/approve', [EnhancedPayrollController::class, 'approveFnFSettlement']);
    Route::post('/fnf-settlements/{id}/reject', [EnhancedPayrollController::class, 'rejectFnFSettlement']);
    Route::post('/fnf-settlements/{id}/process-payment', [EnhancedPayrollController::class, 'processFnFPayment']);
    
    // Payroll Organization Settings
    Route::get('/settings', [\App\Http\Controllers\Api\PayrollSettingsController::class, 'getSettings']);
    Route::put('/settings', [\App\Http\Controllers\Api\PayrollSettingsController::class, 'updateSettings']);
    Route::post('/settings/reset', [\App\Http\Controllers\Api\PayrollSettingsController::class, 'resetSettings']);
    Route::post('/settings/apply-to-all-employees', [\App\Http\Controllers\Api\PayrollSettingsController::class, 'applyToAllEmployees']);
    
    Route::get('/dashboard-attention', [PayrollDepartmentController::class, 'getDashboardAttention']);
    
    // Legacy endpoints
    Route::get('/employees', [PayrollController::class, 'getEmployees']);
    Route::put('/employees/{userId}/profile', [PayrollController::class, 'updateEmployeeProfile']);
    Route::get('/summary', [PayrollController::class, 'getSummary']);
    
    // Performance Management
    Route::get('/performance-goals', [PerformanceGoalController::class, 'index']);
    Route::post('/performance-goals', [PerformanceGoalController::class, 'store']);
    Route::get('/performance-goals/{id}', [PerformanceGoalController::class, 'show']);
    Route::put('/performance-goals/{id}', [PerformanceGoalController::class, 'update']);
    Route::delete('/performance-goals/{id}', [PerformanceGoalController::class, 'destroy']);
    
    Route::get('/performance-reviews', [PerformanceReviewController::class, 'index']);
    Route::post('/performance-reviews', [PerformanceReviewController::class, 'store']);
    Route::get('/performance-reviews/{id}', [PerformanceReviewController::class, 'show']);
    Route::put('/performance-reviews/{id}', [PerformanceReviewController::class, 'update']);
    Route::delete('/performance-reviews/{id}', [PerformanceReviewController::class, 'destroy']);
    Route::get('/performance-reviews/employee/{employeeId}', [PerformanceReviewController::class, 'getEmployeeReviews']);
    Route::get('/performance-reviews/summary', [PerformanceReviewController::class, 'getSummary']);
    
    // Automated Payroll Processing (Keka/GreytHR-style)
    Route::prefix('auto')->group(function () {
        Route::post('/quick-process', [PayrollAutoProcessController::class, 'quickProcess']);
        Route::post('/process-with-checklist', [PayrollAutoProcessController::class, 'processWithChecklist']);
        Route::post('/process-scoped', [PayrollAutoProcessController::class, 'processScoped']);
        Route::post('/quick-validate', [PayrollAutoProcessController::class, 'quickValidate']);
        Route::post('/detect-changes', [PayrollAutoProcessController::class, 'detectChanges']);
        Route::post('/diff', [PayrollAutoProcessController::class, 'getDiff']);
        Route::post('/generate-filings', [PayrollAutoProcessController::class, 'autoGenerateFilings']);
        Route::post('/validate-run', [PayrollAutoProcessController::class, 'validateRun']);
        Route::get('/checklist-status/{runId}', [PayrollAutoProcessController::class, 'checklistStatus']);
        
        // Simplified Attendance Sync Routes (NEW)
        Route::post('/runs/{runId}/sync-attendance', [PayrollAutoProcessController::class, 'syncAttendanceForRun']);
        Route::post('/runs/{runId}/employees/{userId}/sync-attendance', [PayrollAutoProcessController::class, 'syncAttendanceForUser']);
        Route::get('/runs/{runId}/attendance/status', [PayrollAutoProcessController::class, 'getAttendanceSyncStatus']);
        Route::get('/runs/{runId}/reconciliation', [PayrollAutoProcessController::class, 'getReconciliationReport']);
    });

    // Reimbursements (two-level approval: manager → admin)
    Route::get('/reimbursements', [ReimbursementController::class, 'index']);
    Route::get('/reimbursements/mine', [ReimbursementController::class, 'myReimbursements']);
    Route::get('/reimbursements/inbox/manager', [ReimbursementController::class, 'managerInbox']);
    Route::get('/reimbursements/inbox/admin', [ReimbursementController::class, 'adminInbox']);
    Route::get('/reimbursements/inbox-count', [ReimbursementController::class, 'inboxCount']);
    Route::get('/reimbursements/summary', [ReimbursementController::class, 'getSummary']);
    Route::get('/reimbursements/pending-payments', [ReimbursementController::class, 'pendingPayments']);
    Route::get('/reimbursements/{id}', [ReimbursementController::class, 'show']);
    Route::post('/reimbursements/upload-receipt', [ReimbursementController::class, 'uploadReceipt']);
    Route::post('/reimbursements', [ReimbursementController::class, 'store']);
    Route::put('/reimbursements/{id}', [ReimbursementController::class, 'update']);
    Route::delete('/reimbursements/{id}', [ReimbursementController::class, 'destroy']);
    Route::post('/reimbursements/{id}/manager-approve', [ReimbursementController::class, 'managerApprove']);
    Route::post('/reimbursements/{id}/manager-reject', [ReimbursementController::class, 'managerReject']);
    Route::post('/reimbursements/{id}/mark-read', [ReimbursementController::class, 'markInboxRead']);
    Route::post('/reimbursements/bulk/manager-approve', [ReimbursementController::class, 'bulkManagerApprove']);
    Route::post('/reimbursements/bulk/manager-reject', [ReimbursementController::class, 'bulkManagerReject']);
    Route::post('/reimbursements/{id}/mark-paid', [ReimbursementController::class, 'markPaid']);
    Route::post('/reimbursements/{id}/approve', [ReimbursementController::class, 'approve']);
    Route::post('/reimbursements/{id}/reject', [ReimbursementController::class, 'reject']);
    Route::post('/reimbursements/bulk/admin-approve', [ReimbursementController::class, 'bulkAdminApprove']);
    Route::post('/reimbursements/bulk/admin-reject', [ReimbursementController::class, 'bulkAdminReject']);
    Route::post('/reimbursements/{id}/remove', [ReimbursementController::class, 'remove']);

    // Tax-Proof Submissions (Form 12BB attachments)
    // Employee endpoints
    Route::get('/tax-proofs/mine', [TaxProofUploadController::class, 'myProofs']);
    Route::get('/tax-proofs/summary', [TaxProofUploadController::class, 'complianceSummary']);
    Route::get('/tax-proofs/my-12bb/{financialYear}', [TaxProofUploadController::class, 'downloadMy12BB']);
    Route::get('/tax-proofs', [TaxProofUploadController::class, 'index']);
    Route::post('/tax-proofs', [TaxProofUploadController::class, 'store']);
    Route::get('/tax-proofs/{id}', [TaxProofUploadController::class, 'show']);
    Route::get('/tax-proofs/{id}/download', [TaxProofUploadController::class, 'download']);
    Route::delete('/tax-proofs/{id}', [TaxProofUploadController::class, 'destroy']);

    // Payslip Management
    Route::post('/payslips/generate', [PayslipController::class, 'generate']);
    Route::get('/payslips', [PayslipController::class, 'index']);
    Route::get('/payslips/{id}', [PayslipController::class, 'show']);
    Route::get('/payslips/{id}/pdf', [PayslipController::class, 'downloadPdf']);
    Route::get('/payslips/{id}/ytd', [PayslipController::class, 'ytd']);

    // Admin-only endpoints
    Route::post('/tax-proofs/bulk-approve', [TaxProofUploadController::class, 'bulkApprove']);
    Route::post('/tax-proofs/{id}/review', [TaxProofUploadController::class, 'review']);
});
