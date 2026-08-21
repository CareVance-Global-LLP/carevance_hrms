<?php

use App\Http\Controllers\Api\InterviewOfferController;
use App\Http\Controllers\Api\RecruitmentController;
use Illuminate\Support\Facades\Route;

/**
 * Recruitment: openings, candidates and the pipeline.
 *
 * Behind `role:manager` rather than the admin gate, because hiring is a line
 * management job — a hiring manager has to be able to move their own
 * candidates through the pipeline without asking HR. Candidate records carry
 * personal data and current salary, so it stops there rather than being open
 * to everybody.
 */
Route::middleware('role:manager')->group(function () {
    Route::get('/recruitment/openings', [RecruitmentController::class, 'openings']);
    Route::post('/recruitment/openings', [RecruitmentController::class, 'storeOpening']);
    Route::get('/recruitment/openings/{jobOpening}', [RecruitmentController::class, 'showOpening']);
    Route::match(['put', 'patch'], '/recruitment/openings/{jobOpening}', [RecruitmentController::class, 'updateOpening']);

    Route::get('/recruitment/candidates', [RecruitmentController::class, 'candidates']);
    Route::post('/recruitment/candidates', [RecruitmentController::class, 'storeCandidate']);

    Route::get('/recruitment/stages', [RecruitmentController::class, 'stages']);

    Route::get('/recruitment/applications', [RecruitmentController::class, 'applications']);
    Route::post('/recruitment/applications', [RecruitmentController::class, 'apply']);
    Route::post('/recruitment/applications/{jobApplication}/move', [RecruitmentController::class, 'moveApplication']);
    Route::post('/recruitment/applications/{jobApplication}/decide', [RecruitmentController::class, 'decideApplication']);
    Route::get('/recruitment/applications/{jobApplication}/events', [RecruitmentController::class, 'applicationEvents']);
});

/**
 * Interviews, panel feedback and offers.
 *
 * Submitting feedback is deliberately outside the manager gate: the service
 * refuses anybody who is not on the panel, and an interviewer is often a senior
 * engineer rather than a manager. Requiring a management role to record what you
 * thought of a candidate you just met is the kind of friction that ends with
 * feedback arriving by email and never being recorded at all.
 */
Route::post('/recruitment/interviews/{interview}/feedback', [InterviewOfferController::class, 'submitFeedback']);
Route::get('/recruitment/interviews', [InterviewOfferController::class, 'interviews']);

Route::middleware('role:manager')->group(function () {
    Route::post('/recruitment/interviews', [InterviewOfferController::class, 'scheduleInterview']);
    Route::get('/recruitment/interviews/{interview}/summary', [InterviewOfferController::class, 'interviewSummary']);
    Route::post('/recruitment/interviews/{interview}/cancel', [InterviewOfferController::class, 'cancelInterview']);

    Route::get('/recruitment/offers', [InterviewOfferController::class, 'offers']);
    Route::post('/recruitment/offers', [InterviewOfferController::class, 'draftOffer']);
    Route::post('/recruitment/offers/{jobOffer}/submit', [InterviewOfferController::class, 'submitOffer']);
    Route::post('/recruitment/offers/{jobOffer}/decide', [InterviewOfferController::class, 'decideOffer']);
    Route::post('/recruitment/offers/{jobOffer}/send', [InterviewOfferController::class, 'sendOffer']);
    Route::post('/recruitment/offers/{jobOffer}/respond', [InterviewOfferController::class, 'respondToOffer']);
    Route::post('/recruitment/offers/{jobOffer}/withdraw', [InterviewOfferController::class, 'withdrawOffer']);
    Route::post('/recruitment/offers/{jobOffer}/signing-link', [InterviewOfferController::class, 'issueSigningLink']);
    Route::get('/recruitment/offers/{jobOffer}/letter', [InterviewOfferController::class, 'offerLetter']);
});
