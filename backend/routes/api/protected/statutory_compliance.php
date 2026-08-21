<?php

use App\Http\Controllers\Api\StatutoryComplianceController;
use Illuminate\Support\Facades\Route;

/**
 * The overtime register and the working-hours breach list.
 *
 * `limits` is open to any signed-in user: what the law requires of the place
 * you work is your own information, and an employee ought to be able to see the
 * rate their overtime is owed at without asking the person who sets it.
 *
 * The register and the breach list read everybody's hours and price them, so
 * they sit behind the payroll gate rather than the general settings one - the
 * register is the document handed to an inspector, and it carries pay.
 */
Route::get('/statutory/limits', [StatutoryComplianceController::class, 'limits']);

Route::middleware('role:payroll')->group(function () {
    Route::get('/statutory/overtime-register', [StatutoryComplianceController::class, 'register']);
    Route::get('/statutory/breaches', [StatutoryComplianceController::class, 'breaches']);
});
