<?php

use App\Http\Controllers\Api\ProductivityRuleController;
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
Route::get('/settings/productivity-rules', [ProductivityRuleController::class, 'index'])->middleware('role:admin');
Route::post('/settings/productivity-rules', [ProductivityRuleController::class, 'store'])->middleware('role:admin');
Route::put('/settings/productivity-rules/{productivityRule}', [ProductivityRuleController::class, 'update'])->middleware('role:admin');
Route::delete('/settings/productivity-rules/{productivityRule}', [ProductivityRuleController::class, 'destroy'])->middleware('role:admin');
Route::post('/settings/productivity-rules/test', [ProductivityRuleController::class, 'test'])->middleware('role:admin');
