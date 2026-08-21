<?php

use App\Http\Controllers\Api\BiometricDeviceController;
use Illuminate\Support\Facades\Route;

/**
 * Registering punch devices and claiming device ids.
 *
 * Admin-only. A registered serial can post attendance into this tenant, and a
 * mapping decides whose day a reading becomes - both are decisions about other
 * people's records.
 *
 * Distinct from routes/api/biometric.php, which is the unauthenticated protocol
 * the hardware speaks.
 */
Route::middleware('role:admin')->group(function () {
    Route::get('/biometric-devices', [BiometricDeviceController::class, 'index']);
    Route::post('/biometric-devices', [BiometricDeviceController::class, 'store']);
    Route::match(['put', 'patch'], '/biometric-devices/{biometricDevice}', [BiometricDeviceController::class, 'update']);
    Route::post('/biometric-devices/claim', [BiometricDeviceController::class, 'claim']);
});
