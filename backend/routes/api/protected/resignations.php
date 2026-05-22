<?php

use App\Http\Controllers\Api\ResignationController;
use Illuminate\Support\Facades\Route;

// Employee routes
Route::post('/resignations', [ResignationController::class, 'submit']);
Route::get('/resignations/my', [ResignationController::class, 'getMyResignation']);
Route::get('/resignations/my/history', [ResignationController::class, 'getMyResignationHistory']);
Route::delete('/resignations/my', [ResignationController::class, 'cancel']);

// Manager/Admin routes
Route::get('/resignations', [ResignationController::class, 'list']);
Route::post('/resignations/{id}/approve', [ResignationController::class, 'approve']);
Route::post('/resignations/{id}/reject', [ResignationController::class, 'reject']);
