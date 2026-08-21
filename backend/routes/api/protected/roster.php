<?php

use App\Http\Controllers\Api\RosterController;
use Illuminate\Support\Facades\Route;

/**
 * The rota.
 *
 * Reading and writing are deliberately different gates. Anybody may see the
 * published rota and their own swaps - being able to find out when you are
 * working without asking your manager is the entire point of publishing it -
 * but only a manager builds, publishes or edits one.
 *
 * The read endpoint narrows itself by role rather than being duplicated: "show
 * me the rota" is one question, and forking it into two paths would let a
 * permissions mistake in one leak what the other was protecting.
 */
Route::get('/roster', [RosterController::class, 'index']);
Route::get('/roster/coverage', [RosterController::class, 'coverage']);
Route::get('/roster/swaps', [RosterController::class, 'swaps']);
Route::post('/roster/swaps', [RosterController::class, 'requestSwap']);
Route::post('/roster/swaps/{shiftSwapRequest}', [RosterController::class, 'respondToSwap']);

Route::middleware('role:manager')->group(function () {
    Route::get('/roster/rotations', [RosterController::class, 'rotations']);
    Route::post('/roster/generate', [RosterController::class, 'generate']);
    Route::post('/roster/publish', [RosterController::class, 'publish']);
    Route::post('/roster/day', [RosterController::class, 'setDay']);
    Route::post('/roster/rotations', [RosterController::class, 'saveRotation']);
    Route::match(['put', 'patch'], '/roster/rotations/{shiftRotation}', [RosterController::class, 'saveRotation']);
    Route::post('/roster/rotations/{shiftRotation}/assign', [RosterController::class, 'assignRotation']);
});
