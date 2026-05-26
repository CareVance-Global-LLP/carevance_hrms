<?php

use App\Http\Controllers\Api\EmployeeDashboardController;
use App\Http\Controllers\Api\GeofenceController;
use Illuminate\Support\Facades\Route;

Route::get('/geofence/zones', [GeofenceController::class, 'index']);
Route::post('/geofence/verify', [GeofenceController::class, 'verifyLocation']);
Route::get('/employee/dashboard', [EmployeeDashboardController::class, 'index']);

Route::middleware('role:admin')->group(function () {
    Route::post('/geofence/zones', [GeofenceController::class, 'store']);
    Route::put('/geofence/zones/{zone}', [GeofenceController::class, 'update']);
    Route::delete('/geofence/zones/{zone}', [GeofenceController::class, 'destroy']);
});
