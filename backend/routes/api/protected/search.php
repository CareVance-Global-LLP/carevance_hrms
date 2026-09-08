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

// Applying a previewed change. Its own limiter, not `search.ask`, for two
// reasons that pull the same way. It is a WRITE, so it deserves a ceiling
// somebody can see and reason about separately from a read burst. And an Apply
// is the second half of an interaction whose first half already spent from the
// ask budget — sharing one bucket means a person who refined a preview four
// times can be refused the write itself, and a 429 after a human has read and
// agreed to a diff is indistinguishable to them from the change having failed.
//
// Registered in this file, inside the ['api.token', 'mfa.enrolled'] group, on
// purpose: the executor forwards the caller's own Authorization header to the
// internal request, so a route outside that group would hand an unauthenticated
// credential to the endpoint and fail closed at the very last step.
Route::post('/search/act', [SearchAskController::class, 'act'])->middleware('throttle:search.act');
