<?php

use App\Http\Controllers\Api\ActivityController;
use App\Http\Controllers\Api\ActivitySessionController;
use App\Http\Controllers\Api\MonitoringAlertRuleController;
use App\Http\Controllers\Api\ScreenshotController;
use Illuminate\Support\Facades\Route;

Route::get('/screenshots', [ScreenshotController::class, 'index']);
Route::post('/screenshots', [ScreenshotController::class, 'store'])->middleware('throttle:screenshots.upload');
Route::post('/screenshots/bulk-delete', [ScreenshotController::class, 'bulkDestroy']);
// Serves the raw image bytes. The signature keeps the link short-lived and
// tamper-proof; `api.token` (from the parent group) plus the authorization
// check inside file() are what prove the caller may actually see it.
Route::get('/screenshots/{screenshot}/file', [ScreenshotController::class, 'file'])
    ->middleware('signed:relative')
    ->name('screenshots.file');
Route::get('/screenshots/{screenshot}', [ScreenshotController::class, 'show']);
Route::put('/screenshots/{screenshot}', [ScreenshotController::class, 'update']);
Route::patch('/screenshots/{screenshot}', [ScreenshotController::class, 'update']);
Route::delete('/screenshots/{screenshot}', [ScreenshotController::class, 'destroy']);
// Declared BEFORE the resource route: apiResource binds /activities/{activity}
// and would otherwise swallow this path as a show().
Route::post('/activities/{activity}/resolve-idle', [ActivityController::class, 'resolveIdle']);
Route::apiResource('activities', ActivityController::class);
Route::apiResource('activity-sessions', ActivitySessionController::class)->only(['store', 'update']);

/*
 * Rules that decide when a monitoring figure is worth telling somebody about.
 * Admin-only, enforced in the controller: a rule chooses who gets told what
 * about whom.
 */
Route::get('/monitoring/alert-rules', [MonitoringAlertRuleController::class, 'index']);
Route::post('/monitoring/alert-rules', [MonitoringAlertRuleController::class, 'store']);
Route::put('/monitoring/alert-rules/{monitoringAlertRule}', [MonitoringAlertRuleController::class, 'update']);
Route::delete('/monitoring/alert-rules/{monitoringAlertRule}', [MonitoringAlertRuleController::class, 'destroy']);
