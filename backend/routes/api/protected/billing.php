<?php

use App\Http\Controllers\Api\BillingController;
use Illuminate\Support\Facades\Route;

/*
 * Billing.
 *
 * `current` is plan status — the client needs it to decide which features to
 * render, so every authenticated member of the organisation may read it.
 *
 * Everything else spends or cancels the organisation's money. None of these
 * routes carried a role gate and BillingController has no authorisation check
 * of its own, so any authenticated employee could cancel the plan, reduce the
 * seat count out from under their colleagues, or drive the Razorpay callbacks.
 * The frontend already treats this as owner-only — settings/billing is behind
 * StrictAdminRoute — and the gate belongs here too, where it cannot be routed
 * around.
 */
Route::get('/billing/current', [BillingController::class, 'current']);

Route::middleware('role:admin')->group(function () {
    Route::post('/billing/mock-pay', [BillingController::class, 'mockPay']);
    Route::post('/billing/upgrade', [BillingController::class, 'upgradePlan']);
    Route::post('/billing/confirm-upgrade', [BillingController::class, 'confirmUpgrade']);
    Route::post('/billing/add-seats', [BillingController::class, 'addSeats']);
    Route::post('/billing/confirm-add-seats', [BillingController::class, 'confirmAddSeats']);
    Route::post('/billing/reduce-seats', [BillingController::class, 'reduceSeats']);
    Route::post('/billing/confirm-reduce-seats', [BillingController::class, 'confirmReduceSeats']);
    Route::post('/billing/cancel-plan', [BillingController::class, 'cancelPlan']);
    Route::post('/billing/cancel-pending-upgrade', [BillingController::class, 'cancelPendingUpgrade']);

    // Razorpay payment routes
    Route::post('/billing/razorpay/create-order', [BillingController::class, 'createRazorpayOrder']);
    Route::post('/billing/razorpay/verify-payment', [BillingController::class, 'verifyRazorpayPayment']);
});
