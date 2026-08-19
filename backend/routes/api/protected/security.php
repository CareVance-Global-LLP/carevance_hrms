<?php

use App\Http\Controllers\Api\BreakGlassController;
use Illuminate\Support\Facades\Route;

/**
 * The customer's half of break-glass support access.
 *
 * The vendor's half lives in super-admin.php behind `role:super_admin`.
 * Splitting them across files is deliberate: it makes it impossible to widen
 * the vendor endpoints to customer admins by editing one group, and it keeps
 * the customer-facing controls where a customer administrator expects them.
 */
Route::middleware('role:admin')->group(function () {
    Route::get('/security/break-glass', [BreakGlassController::class, 'index']);
    Route::post('/security/break-glass/{id}/approve', [BreakGlassController::class, 'approve']);
    Route::post('/security/break-glass/{id}/reject', [BreakGlassController::class, 'reject']);

    // Revocation is intentionally always available, whatever the session's
    // state. A customer ending access should be told "done", never "invalid
    // state" — hesitating over a back door is not a moment for a 422.
    Route::post('/security/break-glass/{id}/revoke', [BreakGlassController::class, 'revoke']);
});
