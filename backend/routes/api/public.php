<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DesktopDownloadController;
use App\Http\Controllers\Api\HealthCheckController;
use App\Http\Controllers\Api\InviteController;
use App\Http\Controllers\Api\InvitationController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Auth\VerifyEmailController;
use App\Http\Controllers\Api\ScreenshotController;
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
Route::post('/auth/forgot-password', [PasswordResetController::class, 'store'])->middleware('throttle:auth.password.request');
Route::post('/auth/email/verification-notification/request', [AuthController::class, 'requestVerificationEmail'])
    ->middleware('throttle:auth.verification.resend.public');
Route::get('/auth/reset-password/validate', [PasswordResetController::class, 'validateToken'])->middleware('throttle:auth.password.request');
Route::post('/auth/reset-password', [PasswordResetController::class, 'update'])->middleware('throttle:auth.password.reset');
Route::get('/invitations/{token}', [InvitationController::class, 'show']);
Route::post('/invitations/{token}/accept', [InvitationController::class, 'accept'])->middleware('throttle:invitations.accept');
Route::get('/invites/validate', [InviteController::class, 'validateInvite'])->middleware('throttle:invitations.validate');
Route::post('/invites/accept', [InviteController::class, 'acceptInvite'])->middleware('throttle:invitations.accept');
Route::get('/downloads/desktop/windows', [DesktopDownloadController::class, 'windows'])->middleware('throttle:desktop.download');
Route::get('/media/public/{path}', [SettingsController::class, 'publicMedia'])->where('path', '.*');
Route::get('/screenshots/{screenshot}/file', [ScreenshotController::class, 'file'])
    ->middleware('signed:relative')
    ->name('screenshots.file');
Route::post('/support/bug-reports', [SupportController::class, 'storeBugReport'])->middleware('throttle:support.bug-report');
