<?php

use App\Http\Controllers\Api\AuthController;
use Illuminate\Support\Facades\Route;

Route::get('/auth/me', [AuthController::class, 'user']);
Route::post('/auth/logout', [AuthController::class, 'logout']);
Route::post('/auth/handoff', [AuthController::class, 'handoff'])->middleware('throttle:auth.handoff');
Route::post('/auth/email/verification-notification', [AuthController::class, 'resendVerificationEmail'])->middleware('throttle:auth.verification.resend');
Route::post('/auth/cleanup-pending', [AuthController::class, 'cleanupPendingSignup']);
