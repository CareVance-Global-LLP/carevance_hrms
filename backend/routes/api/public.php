<?php

use App\Http\Controllers\Api\AiChatController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DesktopDownloadController;
use App\Http\Controllers\Api\HealthCheckController;
use App\Http\Controllers\Api\InvitationController;
use App\Http\Controllers\Api\OAuthController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Auth\VerifyEmailController;
use App\Http\Controllers\Api\SupportController;
use App\Http\Controllers\Api\PasswordResetController;
use Illuminate\Support\Facades\Route;

Route::get('/health', [HealthCheckController::class, 'index']);
Route::get('/health/simple', [HealthCheckController::class, 'simple']);

Route::get('/auth/email/verify/{id}/{hash}', [VerifyEmailController::class, 'verify'])
    ->whereNumber('id')
    ->name('api.verification.verify');
Route::post('/auth/register', [AuthController::class, 'register'])->middleware('throttle:auth.register');
Route::post('/auth/signup-owner', [AuthController::class, 'signupOwner'])->middleware('throttle:auth.register');
Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:auth.login');
Route::post('/auth/check-email', [AuthController::class, 'checkEmail'])->middleware('throttle:auth.login');

/*
 * Completing a two-factor sign-in. Public because the caller is, by
 * definition, not authenticated yet — what stands in for authentication is the
 * challenge, which only a successful password check can produce and which is
 * destroyed the moment it is used.
 */
Route::post('/auth/mfa/verify', [AuthController::class, 'verifyMfaChallenge'])
    ->middleware('throttle:auth.mfa.verify');
Route::post('/auth/forgot-password', [PasswordResetController::class, 'store'])->middleware('throttle:auth.password.request');
Route::post('/auth/email/verification-notification/request', [AuthController::class, 'requestVerificationEmail'])
    ->middleware('throttle:auth.verification.resend.public');
Route::get('/auth/reset-password/validate', [PasswordResetController::class, 'validateToken'])->middleware('throttle:auth.password.request');
Route::post('/auth/reset-password', [PasswordResetController::class, 'update'])->middleware('throttle:auth.password.reset');
Route::get('/invitations/{token}', [InvitationController::class, 'show']);
Route::post('/invitations/{token}/accept', [InvitationController::class, 'accept'])->middleware('throttle:invitations.accept');
/*
 * The legacy `invites` system used to live here, alongside POST /invites/send.
 *
 * It was a second, parallel invite implementation with none of the guarantees of
 * `invitations`: the token was stored in plaintext, the table had no
 * organization_id at all, and /invites/send had no role gate and validated role
 * as `nullable|string` — so any authenticated user could invite any address with
 * any role.
 *
 * The accept path resolved the invited email with a bare `User::query()`. `User`
 * is deliberately excluded from the tenant scope, so that matched across *every*
 * organization, and an invite for an address that already had an account
 * overwrote that account's password. Verified: a plain employee in one
 * organization could mint an admin-role invite targeting another organization's
 * admin, and accepting an invite for an existing address replaced its password
 * and returned a live session token.
 *
 * That is a cross-tenant password reset that bypasses PasswordResetController,
 * which is properly throttled and binds its token to the user. Do not put this
 * back. Invitations go through routes/api/protected/invitations.php.
 */
Route::get('/downloads/desktop/windows', [DesktopDownloadController::class, 'windows'])->middleware('throttle:desktop.download');
Route::get('/media/public/{path}', [SettingsController::class, 'publicMedia'])->where('path', '.*');
// NOTE: screenshots.file deliberately lives in routes/api/protected/monitoring.php.
// It used to sit here, where `signed:relative` was its only guard — a signature
// proves the link was not forged, it does not prove the caller may view the
// image. Anyone holding the URL could read any employee's screen bytes
// unauthenticated. Do not move it back.
Route::post('/support/bug-reports', [SupportController::class, 'storeBugReport'])->middleware('throttle:support.bug-report');

// AI assistant — available to both logged-in users and public landing-page visitors.
// Optional auth: personalises the reply (and enables data tools) when a valid token is present.
Route::post('/ai/chat', [AiChatController::class, 'chat'])
    ->middleware(['api.token.optional', 'throttle:ai.chat']);

// Google OAuth routes
Route::post('/auth/google/login', [OAuthController::class, 'verifyGoogleToken'])->middleware('throttle:auth.login');

// Razorpay webhook (public endpoint for payment callbacks)
Route::post('/webhooks/razorpay', [\App\Http\Controllers\Api\BillingController::class, 'razorpayWebhook']);

/*
 * An unauthenticated open mail relay used to live here.
 *
 * POST /api/test/email took an arbitrary `email` from the request body and sent
 * through the production SMTP credentials — no authentication, no rate limit.
 * Anyone on the internet could send mail from this domain, which is both an
 * abuse vector and a fast way to get the sending domain blacklisted.
 *
 * To check mail delivery, use `php artisan tinker` on the server, or add a
 * route behind api.token + role:admin. Do not put this back.
 */

/*
 * An unauthenticated log-disclosure endpoint used to live here.
 *
 * GET /api/test/email-log read storage/logs/laravel.log into memory with
 * file_get_contents and returned matching lines as JSON, with no auth. It was
 * verified returning HTTP 200 with real log content on a running server.
 *
 * Laravel logs carry signed email-verification URLs, stack traces, request
 * payloads and occasionally credentials, so this disclosed far more than mail
 * status — and reading the whole file into memory made it a denial-of-service
 * lever once the log grew. Do not put this back.
 */
