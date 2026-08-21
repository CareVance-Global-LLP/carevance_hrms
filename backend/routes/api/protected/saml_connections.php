<?php

use App\Http\Controllers\Api\SamlConnectionController;
use App\Http\Controllers\Api\ScimTokenController;
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

/**
 * SCIM tokens.
 *
 * Alongside the SAML routes because they are two halves of one story: signing
 * in, and being provisioned. Admin-only for the sharpest reason in the product
 * - whoever holds one of these can create and deactivate users across the whole
 * tenant.
 */
Route::middleware('role:admin')->group(function () {
    Route::get('/scim-tokens', [ScimTokenController::class, 'index']);
    Route::post('/scim-tokens', [ScimTokenController::class, 'store']);
    Route::post('/scim-tokens/{scimToken}/revoke', [ScimTokenController::class, 'revoke']);
});
