<?php

use App\Http\Controllers\Api\ProductivityClassificationController;
use App\Http\Controllers\Api\SettingsController;
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
Route::get('/settings/productivity/history', [ProductivityClassificationController::class, 'history'])->middleware('role:admin');
Route::post('/settings/productivity/classifications', [ProductivityClassificationController::class, 'store'])->middleware('role:admin');
Route::put('/settings/productivity/classifications/{classification}', [ProductivityClassificationController::class, 'update'])->middleware('role:admin');
Route::delete('/settings/productivity/classifications/{classification}', [ProductivityClassificationController::class, 'destroy'])->middleware('role:admin');
Route::post('/settings/productivity/classifications/batch', [ProductivityClassificationController::class, 'batchUpdate'])->middleware('role:admin');

Route::get('/roles', [\App\Http\Controllers\Api\RoleController::class, 'index'])->middleware('role:admin,manager');
Route::post('/roles', [\App\Http\Controllers\Api\RoleController::class, 'store'])->middleware('role:admin');
Route::post('/roles/assign-user', [\App\Http\Controllers\Api\RoleController::class, 'assignUser'])->middleware('role:admin,manager');
Route::get('/roles/{role}', [\App\Http\Controllers\Api\RoleController::class, 'show'])->middleware('role:admin,manager');
Route::put('/roles/{role}', [\App\Http\Controllers\Api\RoleController::class, 'update'])->middleware('role:admin');
Route::delete('/roles/{role}', [\App\Http\Controllers\Api\RoleController::class, 'destroy'])->middleware('role:admin');

Route::get('/permissions', [\App\Http\Controllers\Api\PermissionController::class, 'index'])->middleware('role:admin,manager');
