<?php

use App\Http\Controllers\Api\SamlConnectionController;
use Illuminate\Support\Facades\Route;

/**
 * Configuring single sign-on.
 *
 * Admin-only, and not merely as a matter of tidiness: a connection decides
 * which certificate is trusted to assert who anybody in this organization is,
 * so whoever can write one can point it at an identity provider they control
 * and sign in as the payroll administrator.
 *
 * Distinct from the login routes in routes/api/public.php, which have to be
 * unauthenticated because the person using them has no session yet.
 */
Route::middleware('role:admin')->group(function () {
    Route::get('/saml-connections', [SamlConnectionController::class, 'index']);
    Route::post('/saml-connections', [SamlConnectionController::class, 'store']);
    Route::match(['put', 'patch'], '/saml-connections/{samlConnection}', [SamlConnectionController::class, 'update']);
    Route::delete('/saml-connections/{samlConnection}', [SamlConnectionController::class, 'destroy']);
});
