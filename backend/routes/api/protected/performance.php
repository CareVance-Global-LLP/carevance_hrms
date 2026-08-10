<?php

use App\Http\Controllers\Api\CompetencyController;
use App\Http\Controllers\Api\GoalCheckInController;
use App\Http\Controllers\Api\PerformanceGoalController;
use App\Http\Controllers\Api\PerformanceReviewController;
use App\Http\Controllers\Api\ReviewCycleController;
use Illuminate\Support\Facades\Route;

Route::prefix('performance')->middleware('plan.performance')->group(function () {
    // Goals
    Route::get('/goals', [PerformanceGoalController::class, 'index']);
    Route::post('/goals', [PerformanceGoalController::class, 'store']);
    Route::get('/goals/{id}', [PerformanceGoalController::class, 'show'])->whereNumber('id');
    Route::put('/goals/{id}', [PerformanceGoalController::class, 'update'])->whereNumber('id');
    Route::delete('/goals/{id}', [PerformanceGoalController::class, 'destroy'])->whereNumber('id');
    Route::get('/goals/{id}/check-ins', [GoalCheckInController::class, 'index'])->whereNumber('id');
    Route::post('/goals/{id}/check-ins', [GoalCheckInController::class, 'store'])->whereNumber('id');

    // Reviews — static paths before /{id}
    Route::get('/reviews', [PerformanceReviewController::class, 'index']);
    Route::post('/reviews', [PerformanceReviewController::class, 'store']);
    Route::get('/reviews/summary', [PerformanceReviewController::class, 'getSummary']);
    Route::get('/reviews/aggregate-360', [PerformanceReviewController::class, 'aggregate360']);
    Route::get('/reviews/employee/{employeeId}', [PerformanceReviewController::class, 'getEmployeeReviews'])->whereNumber('employeeId');
    Route::get('/reviews/{id}', [PerformanceReviewController::class, 'show'])->whereNumber('id');
    Route::put('/reviews/{id}', [PerformanceReviewController::class, 'update'])->whereNumber('id');
    Route::delete('/reviews/{id}', [PerformanceReviewController::class, 'destroy'])->whereNumber('id');

    // Review cycles — /active before /{id}
    Route::get('/cycles/active', [ReviewCycleController::class, 'active']);
    Route::get('/cycles', [ReviewCycleController::class, 'index']);
    Route::post('/cycles', [ReviewCycleController::class, 'store']);
    Route::get('/cycles/{id}', [ReviewCycleController::class, 'show'])->whereNumber('id');
    Route::put('/cycles/{id}', [ReviewCycleController::class, 'update'])->whereNumber('id');
    Route::delete('/cycles/{id}', [ReviewCycleController::class, 'destroy'])->whereNumber('id');

    // Competencies
    Route::get('/competencies', [CompetencyController::class, 'index']);
    Route::post('/competencies', [CompetencyController::class, 'store']);
    Route::put('/competencies/{id}', [CompetencyController::class, 'update'])->whereNumber('id');
    Route::delete('/competencies/{id}', [CompetencyController::class, 'destroy'])->whereNumber('id');
});
