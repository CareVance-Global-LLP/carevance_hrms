<?php

use App\Http\Controllers\Api\DepartmentTeamController;
use App\Http\Controllers\Api\EmployeeWorkspaceController;
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
