<?php

use App\Http\Controllers\Api\AiChatController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DesktopDownloadController;
use App\Http\Controllers\Api\HealthCheckController;
use App\Http\Controllers\Api\InviteController;
use App\Http\Controllers\Api\InvitationController;
use App\Http\Controllers\Api\OAuthController;
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
Route::post('/auth/check-email', [AuthController::class, 'checkEmail'])->middleware('throttle:auth.login');
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

// AI assistant — available to both logged-in users and public landing-page visitors.
// Optional auth: personalises the reply (and enables data tools) when a valid token is present.
Route::post('/ai/chat', [AiChatController::class, 'chat'])
    ->middleware(['api.token.optional', 'throttle:ai.chat']);

// Google OAuth routes
Route::post('/auth/google/login', [OAuthController::class, 'verifyGoogleToken'])->middleware('throttle:auth.login');

// Razorpay webhook (public endpoint for payment callbacks)
Route::post('/webhooks/razorpay', [\App\Http\Controllers\Api\BillingController::class, 'razorpayWebhook']);

// Test email route for debugging
Route::post('/test/email', function (\Illuminate\Http\Request $request) {
    $email = $request->input('email', 'test@example.com');
    $name = $request->input('name', 'Test User');
    
    try {
        \Illuminate\Support\Facades\Mail::raw('Test email from CareVance at ' . now(), function ($message) use ($email) {
            $message->to($email)
                    ->subject('Test Email');
        });
        
        return response()->json([
            'success' => true,
            'message' => 'Test email sent. Check your logs at: storage/logs/laravel.log',
            'mail_driver' => config('mail.default'),
            'to' => $email,
        ]);
    } catch (\Exception $e) {
        return response()->json([
            'success' => false,
            'error' => $e->getMessage(),
            'mail_driver' => config('mail.default'),
        ], 500);
    }
});

// Check email log - show last email
Route::get('/test/email-log', function () {
    $logFile = storage_path('logs/laravel.log');
    
    if (!file_exists($logFile)) {
        return response()->json([
            'success' => false,
            'message' => 'Log file not found',
        ]);
    }
    
    $content = file_get_contents($logFile);
    
    // Find email-related log entries
    preg_match_all('/\[.*?\].*?(?:To:|From:|Subject:|Mail|email).*?(?=\n\[|$)/is', $content, $matches);
    
    return response()->json([
        'success' => true,
        'mail_driver' => config('mail.default'),
        'log_file' => $logFile,
        'recent_emails' => array_slice($matches[0], -5), // Last 5 email-related entries
    ]);
});
