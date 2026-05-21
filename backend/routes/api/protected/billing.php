<?php

use App\Http\Controllers\Api\BillingController;
use Illuminate\Support\Facades\Route;

Route::get('/billing/current', [BillingController::class, 'current']);
Route::post('/billing/mock-pay', [BillingController::class, 'mockPay']);
Route::post('/billing/upgrade', [BillingController::class, 'upgradePlan']);
Route::post('/billing/confirm-upgrade', [BillingController::class, 'confirmUpgrade']);
Route::post('/billing/add-seats', [BillingController::class, 'addSeats']);
Route::post('/billing/confirm-add-seats', [BillingController::class, 'confirmAddSeats']);
