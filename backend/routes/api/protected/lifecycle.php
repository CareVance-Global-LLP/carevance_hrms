<?php

use App\Http\Controllers\Api\EmployeeExitController;
use App\Http\Controllers\Api\OnboardingJourneyController;
use Illuminate\Support\Facades\Route;

/*
 * Onboarding — a joining journey and its checklist.
 */
// Declared before the {id} route so "my-journey" is not read as an id.
Route::get('/onboarding/my-journey', [OnboardingJourneyController::class, 'myJourney']);
Route::get('/onboarding/journeys', [OnboardingJourneyController::class, 'index']);
Route::post('/onboarding/journeys', [OnboardingJourneyController::class, 'store']);
Route::get('/onboarding/journeys/{id}', [OnboardingJourneyController::class, 'show']);
Route::patch('/onboarding/journeys/{id}', [OnboardingJourneyController::class, 'update']);
Route::post('/onboarding/journeys/{id}/items/{itemId}/complete', [OnboardingJourneyController::class, 'completeItem']);
Route::post('/onboarding/journeys/{id}/items/{itemId}/reopen', [OnboardingJourneyController::class, 'reopenItem']);

/*
 * Exits — the process that runs after a resignation is approved, and the only
 * way in for terminations, retirements and redundancies.
 */
Route::get('/exits', [EmployeeExitController::class, 'index']);
Route::post('/exits', [EmployeeExitController::class, 'store']);
Route::post('/exits/notice-preview', [EmployeeExitController::class, 'noticePreview']);
Route::get('/exits/attrition', [EmployeeExitController::class, 'attritionReport']);
Route::get('/exits/{id}', [EmployeeExitController::class, 'show']);
Route::post('/exits/{id}/advance', [EmployeeExitController::class, 'advance']);
Route::post('/exits/{id}/revoke-access', [EmployeeExitController::class, 'revokeAccess']);
Route::post('/exits/{id}/rehire-eligibility', [EmployeeExitController::class, 'setRehireEligibility']);
Route::post('/exits/{id}/rejoin', [EmployeeExitController::class, 'rejoin']);
Route::post('/exits/{id}/interview', [EmployeeExitController::class, 'saveInterview']);
Route::post('/exits/{id}/items/{itemId}/complete', [EmployeeExitController::class, 'completeItem']);
Route::post('/exits/{id}/items/{itemId}/reopen', [EmployeeExitController::class, 'reopenItem']);
