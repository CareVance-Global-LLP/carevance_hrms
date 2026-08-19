<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\MfaController;
use App\Http\Controllers\Api\OAuthController;
use Illuminate\Support\Facades\Route;

Route::get('/auth/me', [AuthController::class, 'user']);

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
