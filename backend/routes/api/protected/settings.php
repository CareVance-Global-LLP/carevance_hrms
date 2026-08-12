<?php

use App\Http\Controllers\Api\ProductivityClassificationController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\WorkspaceOnboardingController;
use Illuminate\Support\Facades\Route;

Route::get('/settings/me', [SettingsController::class, 'me']);
Route::put('/settings/profile', [SettingsController::class, 'updateProfile']);
Route::post('/settings/profile', [SettingsController::class, 'updateProfile']);
Route::put('/settings/onboarding-profile', [SettingsController::class, 'updateOnboardingProfile']);
Route::put('/settings/onboarding-profile/skip', [SettingsController::class, 'skipOnboardingProfile']);
Route::put('/settings/password', [SettingsController::class, 'updatePassword'])->middleware('throttle:settings.password');
Route::put('/settings/preferences', [SettingsController::class, 'updatePreferences']);
Route::put('/settings/organization', [SettingsController::class, 'updateOrganization'])->middleware('role:admin,manager');
Route::post('/settings/organization', [SettingsController::class, 'updateOrganization'])->middleware('role:admin,manager');
Route::get('/settings/billing', [SettingsController::class, 'billing']);

/*
 * The workspace setup checklist.
 *
 * Status is readable by any member so the dashboard can render without a role
 * check; every write is admin-only, because dismissing the checklist or ticking
 * a setup step is an organization-wide decision.
 */
Route::get('/workspace/onboarding-status', [WorkspaceOnboardingController::class, 'status']);
Route::post('/workspace/onboarding/mark-step', [WorkspaceOnboardingController::class, 'markStep'])->middleware('role:admin');
Route::post('/workspace/onboarding/dismiss', [WorkspaceOnboardingController::class, 'dismiss'])->middleware('role:admin');
Route::post('/workspace/onboarding/reopen', [WorkspaceOnboardingController::class, 'reopen'])->middleware('role:admin');
Route::post('/workspace/onboarding/tour-seen', [WorkspaceOnboardingController::class, 'markTourSeen'])->middleware('role:admin');
Route::get('/settings/productivity/history', [ProductivityClassificationController::class, 'history'])->middleware('role:admin');
Route::post('/settings/productivity/classifications', [ProductivityClassificationController::class, 'store'])->middleware('role:admin');
Route::put('/settings/productivity/classifications/{classification}', [ProductivityClassificationController::class, 'update'])->middleware('role:admin');
Route::delete('/settings/productivity/classifications/{classification}', [ProductivityClassificationController::class, 'destroy'])->middleware('role:admin');
Route::post('/settings/productivity/classifications/batch', [ProductivityClassificationController::class, 'batchUpdate'])->middleware('role:admin');

// Readable by every authenticated member — the organization tree renders role
// names and headcounts. RoleController::index withholds the permission keys
// from anyone below manager; every mutating route below stays gated.
Route::get('/roles', [\App\Http\Controllers\Api\RoleController::class, 'index']);
Route::post('/roles', [\App\Http\Controllers\Api\RoleController::class, 'store'])->middleware('role:admin');
Route::post('/roles/assign-user', [\App\Http\Controllers\Api\RoleController::class, 'assignUser'])->middleware('role:admin,manager');
Route::get('/roles/{role}', [\App\Http\Controllers\Api\RoleController::class, 'show'])->middleware('role:admin,manager');
Route::put('/roles/{role}', [\App\Http\Controllers\Api\RoleController::class, 'update'])->middleware('role:admin');
Route::delete('/roles/{role}', [\App\Http\Controllers\Api\RoleController::class, 'destroy'])->middleware('role:admin');

Route::get('/permissions', [\App\Http\Controllers\Api\PermissionController::class, 'index'])->middleware('role:admin,manager');
