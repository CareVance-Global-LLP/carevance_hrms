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
    /*
     * The development shortcut, and only where development happens.
     *
     * mockPay activates a paid subscription with no payment. `role:admin` is
     * not a defence — the admin is precisely the person who benefits from
     * never paying, and every tenant has one. Registered conditionally so the
     * endpoint genuinely does not exist in production rather than existing and
     * refusing; BillingController::mockPay carries the same check as a backstop
     * for a route cache built in the wrong environment.
     *
     * This is the same gate verifyRazorpayPayment already applies to its
     * `mock_order_` branch.
     */
    if (app()->environment('local', 'testing')) {
        Route::post('/billing/mock-pay', [BillingController::class, 'mockPay']);
    }
    Route::post('/billing/upgrade', [BillingController::class, 'upgradePlan']);
    Route::post('/billing/confirm-upgrade', [BillingController::class, 'confirmUpgrade']);
    Route::post('/billing/add-seats', [BillingController::class, 'addSeats']);
    Route::post('/billing/confirm-add-seats', [BillingController::class, 'confirmAddSeats']);
    Route::post('/billing/reduce-seats', [BillingController::class, 'reduceSeats']);
    Route::post('/billing/confirm-reduce-seats', [BillingController::class, 'confirmReduceSeats']);
    // Turning auto-renew on or off commits or cancels a future charge, so it
    // belongs behind the same gate as the rest of the spending routes.
    Route::post('/billing/auto-renew', [BillingController::class, 'setAutoRenew']);
    Route::post('/billing/cancel-plan', [BillingController::class, 'cancelPlan']);
    Route::post('/billing/cancel-pending-upgrade', [BillingController::class, 'cancelPendingUpgrade']);

    // Razorpay payment routes
    Route::post('/billing/razorpay/create-order', [BillingController::class, 'createRazorpayOrder']);
    Route::post('/billing/razorpay/verify-payment', [BillingController::class, 'verifyRazorpayPayment']);
});
