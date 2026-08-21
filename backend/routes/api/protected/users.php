<?php

use App\Http\Controllers\Api\DepartmentTeamController;
use App\Http\Controllers\Api\EmployeeWorkspaceController;
use App\Http\Controllers\Api\MyEmployeeRecordController;
use App\Http\Controllers\Api\ReportGroupController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\DocumentValidationController;
use Illuminate\Support\Facades\Route;

Route::get('/users', [UserController::class, 'index']);
Route::post('/users', [UserController::class, 'store'])->middleware('role:admin');

// ⚠️ MUST be BEFORE /users/{user} — otherwise Laravel matches "check-incomplete" as a {user} ID
Route::get('/users/check-incomplete', [UserController::class, 'checkIncomplete']);
// Deleting an account is an admin action. This route had no role middleware
// while the general /users/{user} delete eight lines below always has, so the
// cleanup path was a way around the gate on the real one.
Route::delete('/users/{id}/incomplete', [UserController::class, 'deleteIncomplete'])->middleware('role:admin');

// ⚠️ MUST be BEFORE /users/{user} — otherwise Laravel matches "export" as a {user} ID
Route::get('/users/export', [UserController::class, 'export']);

Route::get('/users/{user}', [UserController::class, 'show']);
Route::get('/users/{user}/groups', [UserController::class, 'groups']);
Route::match(['put', 'patch'], '/users/{user}', [UserController::class, 'update'])->middleware('role:admin,manager');
Route::delete('/users/{user}', [UserController::class, 'destroy'])->middleware('role:admin');
Route::get('/users/{id}/stats', [UserController::class, 'stats']);
Route::get('/users/{id}/profile-360', [UserController::class, 'profile360']);

Route::get('/groups', [ReportGroupController::class, 'index']);
Route::get('/groups/{id}', [ReportGroupController::class, 'show']);

// Document Validation Routes (available to all authenticated users)
Route::post('/validate/government-id', [DocumentValidationController::class, 'validateGovernmentId']);
Route::post('/validate/bank-details', [DocumentValidationController::class, 'validateBankDetails']);
Route::post('/validate/bulk', [DocumentValidationController::class, 'bulkValidate']);
Route::get('/validation/rules', [DocumentValidationController::class, 'getValidationRules']);

Route::middleware('role:admin,manager')->group(function () {
    Route::get('/employees/{id}/workspace', [EmployeeWorkspaceController::class, 'show']);
    Route::put('/employees/{id}/work-info', [EmployeeWorkspaceController::class, 'updateWorkInfo']);
    Route::post('/employees/{id}/government-ids', [EmployeeWorkspaceController::class, 'storeGovernmentId']);
    Route::post('/employees/{id}/bank-accounts', [EmployeeWorkspaceController::class, 'storeBankAccount']);
    Route::post('/employees/{id}/documents', [EmployeeWorkspaceController::class, 'storeDocument']);
    Route::get('/employees/{id}/documents/{documentId}/download', [EmployeeWorkspaceController::class, 'downloadDocument']);
    // Qualifications. HR-owned rather than self-service, because the
    // certificate is the evidence and the person it describes should not be
    // the one attesting to it.
    Route::post('/employees/{id}/educations', [EmployeeWorkspaceController::class, 'storeEducation']);
    Route::delete('/employees/{id}/educations/{educationId}', [EmployeeWorkspaceController::class, 'destroyEducation'])->whereNumber('educationId');
    Route::post('/groups', [ReportGroupController::class, 'store']);
    Route::match(['put', 'patch'], '/groups/{id}', [ReportGroupController::class, 'update']);
    Route::delete('/groups/{id}', [ReportGroupController::class, 'destroy']);
    Route::get('/report-groups', [ReportGroupController::class, 'index']);
    Route::get('/report-groups/{id}', [ReportGroupController::class, 'show']);
    Route::post('/report-groups', [ReportGroupController::class, 'store']);
    Route::match(['put', 'patch'], '/report-groups/{id}', [ReportGroupController::class, 'update']);
    Route::delete('/report-groups/{id}', [ReportGroupController::class, 'destroy']);

    // Department teams (sub-groupings within a department). Members/managers are
    // unlimited; managers must be higher-ups (manager/admin).
    Route::get('/departments/{departmentId}/teams', [DepartmentTeamController::class, 'index']);
    Route::post('/departments/{departmentId}/teams', [DepartmentTeamController::class, 'store']);
    Route::match(['put', 'patch'], '/departments/{departmentId}/teams/{teamId}', [DepartmentTeamController::class, 'update']);
    Route::delete('/departments/{departmentId}/teams/{teamId}', [DepartmentTeamController::class, 'destroy']);
    Route::post('/departments/{departmentId}/teams/{teamId}/members', [DepartmentTeamController::class, 'addMembers']);
    Route::delete('/departments/{departmentId}/teams/{teamId}/members/{userId}', [DepartmentTeamController::class, 'removeMember']);
    Route::post('/departments/{departmentId}/teams/{teamId}/managers', [DepartmentTeamController::class, 'addManagers']);
    Route::delete('/departments/{departmentId}/teams/{teamId}/managers/{userId}', [DepartmentTeamController::class, 'removeManager']);
});

// Employees can update their own profile (controller's canEditProfile enforces owner-only)
Route::put('/employees/{id}/profile', [EmployeeWorkspaceController::class, 'updateProfile']);

/*
 * The employee's own bank details, government IDs and documents.
 *
 * Everything above addresses a person by id and is gated on role:admin,manager.
 * These take no id at all — MyEmployeeRecordController resolves the subject
 * from the authenticated user — so they cannot be pointed at somebody else even
 * if an authorization helper were wrong. That is why this is a separate surface
 * rather than a relaxed owner check on the id-addressed routes.
 *
 * Work info and education stay admin-only above, deliberately: an employee
 * should not set their own joining date, and should not attest to their own
 * certificates.
 */
Route::get('/me/employee-records', [MyEmployeeRecordController::class, 'index']);
Route::post('/me/government-ids', [MyEmployeeRecordController::class, 'storeGovernmentId']);
Route::post('/me/bank-accounts', [MyEmployeeRecordController::class, 'storeBankAccount']);
Route::post('/me/documents', [MyEmployeeRecordController::class, 'storeDocument']);
/*
 * Qualifications, self-service.
 *
 * The admin routes above call these HR-owned. That was relaxed on purpose: a
 * joiner recording their own degree and attaching the certificate is how
 * onboarding actually runs. HR still verifies; they no longer have to type it.
 */
Route::post('/me/educations', [MyEmployeeRecordController::class, 'storeEducation']);
Route::delete('/me/educations/{educationId}', [MyEmployeeRecordController::class, 'destroyEducation'])
    ->whereNumber('educationId');
Route::get('/me/documents/{documentId}/download', [MyEmployeeRecordController::class, 'downloadDocument'])
    ->whereNumber('documentId');
