<?php

use App\Http\Controllers\Api\LegalEntityController;
use Illuminate\Support\Facades\Route;

/**
 * The companies inside an organization.
 *
 * `role:payroll` — hierarchy level <= 20, the same gate as the administrative
 * payroll area. An entity's PAN and TAN decide which return every employee
 * under it appears on, so this is the same class of authority as running
 * payroll itself, not a general settings screen.
 *
 * Reading is separated from writing: a manager may legitimately need to see
 * which company employs somebody without being able to change the group's
 * statutory identity.
 */
Route::middleware('role:manager')->group(function () {
    Route::get('/legal-entities', [LegalEntityController::class, 'index']);
});

Route::middleware('role:payroll')->group(function () {
    Route::post('/legal-entities', [LegalEntityController::class, 'store']);
    Route::match(['put', 'patch'], '/legal-entities/{legalEntity}', [LegalEntityController::class, 'update']);
    Route::delete('/legal-entities/{legalEntity}', [LegalEntityController::class, 'destroy']);
    Route::post('/legal-entities/{legalEntity}/employees', [LegalEntityController::class, 'assignEmployees']);
});
