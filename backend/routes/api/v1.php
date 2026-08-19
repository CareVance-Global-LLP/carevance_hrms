<?php

use App\Http\Controllers\Api\PublicApiController;
use Illuminate\Support\Facades\Route;

/**
 * The customer-facing read API.
 *
 * Deliberately OUTSIDE the `api.token` group. That middleware authenticates a
 * person and inherits their permissions; these routes authenticate an
 * organisation and carry their own scopes. Running both would mean a machine
 * credential quietly acquiring the rights of whoever created it.
 *
 * Every route names the scope it requires, so what a key can reach is
 * readable in this file rather than buried in a controller.
 */
Route::prefix('v1')
    ->middleware('throttle:api.public')
    ->group(function () {
        Route::get('/employees', [PublicApiController::class, 'employees'])
            ->middleware('api.client:employees.read');

        Route::get('/attendance', [PublicApiController::class, 'attendance'])
            ->middleware('api.client:attendance.read');

        Route::get('/leave', [PublicApiController::class, 'leave'])
            ->middleware('api.client:leave.read');
    });
