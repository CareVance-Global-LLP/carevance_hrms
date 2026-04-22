<?php

use App\Http\Controllers\Api\ActivityController;
use App\Http\Controllers\Api\ActivitySessionController;
use App\Http\Controllers\Api\BrowserTrackingConnectionController;
use App\Http\Controllers\Api\ScreenshotController;
use Illuminate\Support\Facades\Route;

Route::get('/screenshots', [ScreenshotController::class, 'index']);
Route::post('/screenshots', [ScreenshotController::class, 'store'])->middleware('throttle:screenshots.upload');
Route::post('/screenshots/bulk-delete', [ScreenshotController::class, 'bulkDestroy']);
Route::get('/screenshots/{screenshot}', [ScreenshotController::class, 'show']);
Route::put('/screenshots/{screenshot}', [ScreenshotController::class, 'update']);
Route::patch('/screenshots/{screenshot}', [ScreenshotController::class, 'update']);
Route::delete('/screenshots/{screenshot}', [ScreenshotController::class, 'destroy']);
Route::apiResource('activities', ActivityController::class);
Route::apiResource('activity-sessions', ActivitySessionController::class)->only(['store', 'update']);
Route::post('/browser-tracking/connections/sync', [BrowserTrackingConnectionController::class, 'sync']);
