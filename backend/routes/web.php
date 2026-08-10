<?php

use App\Http\Controllers\Auth\VerifyEmailController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return response()->json([
        'status' => 'ok',
        'service' => 'carevance-hrms-api',
        'message' => 'API is running',
    ]);
});

Route::get('/email/verify/{id}/{hash}', [VerifyEmailController::class, 'verify'])
    ->whereNumber('id')
    ->name('verification.verify');

/*
 * A local-only /test-mail route lived here, marked "remove once SMTP is
 * confirmed". SMTP is confirmed, so it is gone.
 *
 * To check mail delivery, use `php artisan tinker` on the machine in question.
 * Do not add a route for it — an earlier unauthenticated version of exactly this
 * idea was an open mail relay through the production SMTP credentials. See the
 * note in routes/api/public.php.
 */
