<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\CompOffController;

Route::get('/comp-off/balance', [CompOffController::class, 'balance']);
Route::get('/comp-off/transactions', [CompOffController::class, 'transactions']);
Route::get('/comp-off/summary', [CompOffController::class, 'summary']);
