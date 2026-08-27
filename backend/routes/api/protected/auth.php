<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\MfaController;
use App\Http\Controllers\Api\OAuthController;
use App\Http\Controllers\Api\UserSessionController;
use Illuminate\Support\Facades\Route;

Route::get('/auth/me', [AuthController::class, 'user']);

/*
 * Where you are signed in.
 *
 * Registered here rather than in security.php on purpose: that whole file sits
 * behind `role:admin`, and this is a self-service surface over the caller's OWN
 * sessions. An employee must be able to see and cut off their own devices
 * without being an administrator, and an administrator must NOT get somebody
 * else's device list as a side effect of this route existing — the scoping is
 * to the acting user inside the controller, and there is no id-of-another-user
 * parameter to widen it with.
 */
Route::get('/auth/sessions', [UserSessionController::class, 'index'])
    // Throttled because reading this WRITES: every call records an
    // auth.sessions_viewed audit row, since disclosing the addresses an
    // account has been used from is itself a thing that has to be answerable
    // for. Unthrottled, a script holding one bearer token can bury the audit
    // trail in its own noise — and the endpoint an attacker with a stolen
    // token would poll (to watch whether they are being revoked) is this one.
    ->middleware('throttle:auth.sessions');
// Sign out everywhere else. Registered before the {id} route only for
// readability — the paths do not overlap.
Route::delete('/auth/sessions', [UserSessionController::class, 'destroyOthers']);
Route::delete('/auth/sessions/{id}', [UserSessionController::class, 'destroy'])
    ->whereNumber('id');

/*
 * Two-factor enrolment and management, always by an authenticated user about
 * their own account. Proving a code at sign-in is a public route — see
 * public.php — because the caller is not authenticated yet by definition.
 *
 * These paths are exempt from the mfa.enrolled gate, or a user obliged to set
 * up an authenticator could not reach the endpoints that let them do it.
 */
Route::get('/auth/mfa', [MfaController::class, 'status']);
Route::post('/auth/mfa/setup', [MfaController::class, 'begin']);
Route::post('/auth/mfa/confirm', [MfaController::class, 'confirm']);
Route::post('/auth/mfa/recovery-codes', [MfaController::class, 'regenerateRecoveryCodes']);
Route::delete('/auth/mfa', [MfaController::class, 'disable']);
Route::post('/auth/logout', [AuthController::class, 'logout']);
Route::post('/auth/handoff', [AuthController::class, 'handoff'])->middleware('throttle:auth.handoff');
Route::post('/auth/desktop-token', [AuthController::class, 'issueDesktopToken'])->middleware('throttle:auth.handoff');
Route::post('/auth/email/verification-notification', [AuthController::class, 'resendVerificationEmail'])->middleware('throttle:auth.verification.resend');
Route::post('/auth/cleanup-pending', [AuthController::class, 'cleanupPendingSignup']);

// Google OAuth completion route
Route::post('/auth/google/complete', [OAuthController::class, 'completeRegistration']);
