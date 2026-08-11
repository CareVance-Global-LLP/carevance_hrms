<?php

use App\Http\Controllers\Api\InvitationController;
use Illuminate\Support\Facades\Route;

Route::get('/invitations', [InvitationController::class, 'index']);
Route::post('/invitations', [InvitationController::class, 'store'])->middleware('throttle:invitations.create');
Route::post('/invitations/import', [InvitationController::class, 'import'])->middleware('throttle:invitations.create');

// Resend rotates the token and sends again — it is a create in everything but
// name, so it shares the create throttle. Revoke is cheap and idempotent.
Route::post('/invitations/{invitation}/resend', [InvitationController::class, 'resend'])
    ->whereNumber('invitation')
    ->middleware('throttle:invitations.create');
Route::delete('/invitations/{invitation}', [InvitationController::class, 'destroy'])
    ->whereNumber('invitation');
