<?php

use App\Http\Controllers\Api\NotificationController;
use Illuminate\Support\Facades\Route;

Route::get('/notifications', [NotificationController::class, 'index']);
Route::post('/notifications/{id}/read', [NotificationController::class, 'markRead']);
Route::post('/notifications/read-all', [NotificationController::class, 'markAllRead']);
Route::post('/notifications/publish', [NotificationController::class, 'publish'])->middleware(['role:admin,manager', 'throttle:notifications.publish']);
Route::post('/notifications/register-device', [NotificationController::class, 'registerDevice']);
