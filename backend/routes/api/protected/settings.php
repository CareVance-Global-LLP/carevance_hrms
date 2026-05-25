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
