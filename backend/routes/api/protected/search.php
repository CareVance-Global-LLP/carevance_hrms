<?php

use App\Http\Controllers\Api\SearchController;
use Illuminate\Support\Facades\Route;

// Cross-entity search for the command bar. Throttled because it is typed into:
// the client debounces, but the endpoint must not depend on a well-behaved
// client for that.
Route::get('/search', [SearchController::class, 'index'])->middleware('throttle:120,1');
