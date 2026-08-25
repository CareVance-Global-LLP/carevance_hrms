<?php

use App\Http\Controllers\Api\SearchAskController;
use App\Http\Controllers\Api\SearchController;
use Illuminate\Support\Facades\Route;

// Cross-entity search for the command bar. Throttled because it is typed into:
// the client debounces, but the endpoint must not depend on a well-behaved
// client for that.
Route::get('/search', [SearchController::class, 'index'])->middleware('throttle:120,1');

// AI mode. Separate limiter from ai.chat: this one runs a database aggregate
// per call, so it is a different cost with a different ceiling.
Route::post('/search/ask', [SearchAskController::class, 'ask'])->middleware('throttle:search.ask');
Route::post('/search/ask/summary', [SearchAskController::class, 'summary'])->middleware('throttle:search.ask');
