<?php

use App\Http\Controllers\Api\LeaveTypeController;
use Illuminate\Support\Facades\Route;

/**
 * Leave types and the ledger behind a balance.
 *
 * The breakdown is deliberately outside the admin gate: the controller lets
 * somebody read their OWN rows and refuses anybody else's. Being able to see
 * why your own balance is what it is should not require asking HR - that is the
 * question the ledger was built to answer.
 *
 * Everything that changes a policy is admin-only. An accrual rate decides how
 * much leave every employee earns, and leave encashes into pay.
 */
Route::get('/leave-types', [LeaveTypeController::class, 'index']);
Route::get('/leave-ledger/{userId}', [LeaveTypeController::class, 'ledger']);

Route::middleware('role:admin')->group(function () {
    Route::post('/leave-types', [LeaveTypeController::class, 'store']);
    Route::match(['put', 'patch'], '/leave-types/{leaveType}', [LeaveTypeController::class, 'update']);
});
