<?php

use App\Http\Controllers\Api\TaskController;
use App\Http\Controllers\Api\TaskLabelController;
use App\Http\Controllers\Api\TimeEntryController;
use Illuminate\Support\Facades\Route;

Route::apiResource('tasks', TaskController::class);
Route::patch('/tasks/{task}/status', [TaskController::class, 'updateStatus']);
Route::get('/tasks/{id}/time-entries', [TaskController::class, 'timeEntries']);
Route::get('/tasks/{id}/activities', [TaskController::class, 'activities']);
Route::post('/tasks/{task}/watch', [TaskController::class, 'watch']);
Route::post('/tasks/{task}/unwatch', [TaskController::class, 'unwatch']);
Route::get('/tasks/{task}/watch-status', [TaskController::class, 'watchStatus']);
Route::get('/tasks/{id}/comments', [TaskController::class, 'comments']);
Route::post('/tasks/{id}/comments', [TaskController::class, 'storeComment']);
Route::delete('/tasks/comments/{comment}', [TaskController::class, 'destroyComment']);
Route::get('/tasks/{id}/attachments', [TaskController::class, 'attachments']);
Route::post('/tasks/{id}/attachments', [TaskController::class, 'storeAttachment']);
Route::delete('/tasks/attachments/{attachment}', [TaskController::class, 'destroyAttachment']);
Route::apiResource('task-labels', TaskLabelController::class)->only(['index', 'store', 'destroy']);
Route::post('/tasks/{task}/labels', [TaskController::class, 'addLabel']);
Route::delete('/tasks/{task}/labels/{label}', [TaskController::class, 'removeLabel']);

Route::get('/tasks/{id}/checklist-items', [TaskController::class, 'checklistItems']);
Route::post('/tasks/{id}/checklist-items', [TaskController::class, 'storeChecklistItem']);
Route::patch('/tasks/checklist-items/{item}', [TaskController::class, 'updateChecklistItem']);
Route::delete('/tasks/checklist-items/{item}', [TaskController::class, 'destroyChecklistItem']);

Route::get('/tasks/{id}/dependencies', [TaskController::class, 'dependencies']);
Route::post('/tasks/{id}/dependencies', [TaskController::class, 'storeDependency']);
Route::delete('/tasks/dependencies/{dependency}', [TaskController::class, 'destroyDependency']);

Route::post('/tasks/{task}/recurrence', [TaskController::class, 'storeRecurrence']);
Route::get('/tasks/{task}/recurrence', [TaskController::class, 'getRecurrence']);
Route::put('/tasks/recurrence/{recurrence}', [TaskController::class, 'updateRecurrence']);
Route::delete('/tasks/recurrence/{recurrence}', [TaskController::class, 'destroyRecurrence']);

Route::patch('/tasks/{task}/remind', [TaskController::class, 'updateReminder']);
Route::post('/time-entries/start', [TimeEntryController::class, 'start']);
Route::post('/time-entries/stop', [TimeEntryController::class, 'stop']);
Route::get('/time-entries/active', [TimeEntryController::class, 'active']);
Route::get('/time-entries/today', [TimeEntryController::class, 'today']);
Route::apiResource('time-entries', TimeEntryController::class);
