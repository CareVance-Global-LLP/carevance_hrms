<?php

use App\Http\Controllers\Api\WorkingTime\MyWorkingTimePolicyController;
use App\Http\Controllers\Api\WorkingTime\OvertimePolicyController;
use App\Http\Controllers\Api\WorkingTime\PenalisationPolicyController;
use App\Http\Controllers\Api\WorkingTime\ShiftAllowancePolicyController;
use App\Http\Controllers\Api\WorkingTime\WeeklyOffPolicyController;
use Illuminate\Support\Facades\Route;

/*
 * Working time: four policies that used to be columns on the shift row.
 *
 * Shifts stay next door in attendance.php — this file is the other four objects
 * a shift was overloaded with (weekly off, penalisation, overtime and shift
 * allowance), each created, versioned and assigned on its own.
 *
 * ROUTE ORDER MATTERS. "/assignments" is declared before "/{id}" for every kind
 * so the word is never captured as an id, which is the same trap shifts.php
 * calls out.
 *
 * THERE IS NO `role:` MIDDLEWARE HERE, on purpose and for the same reason as
 * shifts: the gate is inline in WorkingTimePolicyController::guard, which reads
 * the settings.manage permission first and only falls back to hierarchy. A
 * `role:` string match would turn away a custom role holding that permission
 * before it ever reached the check meant to admit it.
 *
 * "/working-time/my-policies" is open to every member, because reading which
 * late rule and which weekly off apply to YOU is not a management action — and
 * an employee who cannot see the policy behind a deduction has no way to
 * question it.
 */

Route::get('/working-time/my-policies', [MyWorkingTimePolicyController::class, 'show']);

// Weekly off.
Route::get('/working-time/weekly-off-policies/assignments', [WeeklyOffPolicyController::class, 'assignments']);
Route::post('/working-time/weekly-off-policies/assignments', [WeeklyOffPolicyController::class, 'assign']);
Route::delete('/working-time/weekly-off-policies/assignments/{id}', [WeeklyOffPolicyController::class, 'unassign']);
Route::get('/working-time/weekly-off-policies', [WeeklyOffPolicyController::class, 'index']);
Route::post('/working-time/weekly-off-policies', [WeeklyOffPolicyController::class, 'store']);
Route::match(['put', 'patch'], '/working-time/weekly-off-policies/{id}', [WeeklyOffPolicyController::class, 'update']);
Route::delete('/working-time/weekly-off-policies/{id}', [WeeklyOffPolicyController::class, 'destroy']);

// Penalisation.
Route::get('/working-time/penalisation-policies/assignments', [PenalisationPolicyController::class, 'assignments']);
Route::post('/working-time/penalisation-policies/assignments', [PenalisationPolicyController::class, 'assign']);
Route::delete('/working-time/penalisation-policies/assignments/{id}', [PenalisationPolicyController::class, 'unassign']);
Route::get('/working-time/penalisation-policies', [PenalisationPolicyController::class, 'index']);
Route::post('/working-time/penalisation-policies', [PenalisationPolicyController::class, 'store']);
Route::match(['put', 'patch'], '/working-time/penalisation-policies/{id}', [PenalisationPolicyController::class, 'update']);
Route::delete('/working-time/penalisation-policies/{id}', [PenalisationPolicyController::class, 'destroy']);

// Overtime.
Route::get('/working-time/overtime-policies/assignments', [OvertimePolicyController::class, 'assignments']);
Route::post('/working-time/overtime-policies/assignments', [OvertimePolicyController::class, 'assign']);
Route::delete('/working-time/overtime-policies/assignments/{id}', [OvertimePolicyController::class, 'unassign']);
Route::get('/working-time/overtime-policies', [OvertimePolicyController::class, 'index']);
Route::post('/working-time/overtime-policies', [OvertimePolicyController::class, 'store']);
Route::match(['put', 'patch'], '/working-time/overtime-policies/{id}', [OvertimePolicyController::class, 'update']);
Route::delete('/working-time/overtime-policies/{id}', [OvertimePolicyController::class, 'destroy']);

// Shift allowance.
Route::get('/working-time/shift-allowance-policies/assignments', [ShiftAllowancePolicyController::class, 'assignments']);
Route::post('/working-time/shift-allowance-policies/assignments', [ShiftAllowancePolicyController::class, 'assign']);
Route::delete('/working-time/shift-allowance-policies/assignments/{id}', [ShiftAllowancePolicyController::class, 'unassign']);
Route::get('/working-time/shift-allowance-policies', [ShiftAllowancePolicyController::class, 'index']);
Route::post('/working-time/shift-allowance-policies', [ShiftAllowancePolicyController::class, 'store']);
Route::match(['put', 'patch'], '/working-time/shift-allowance-policies/{id}', [ShiftAllowancePolicyController::class, 'update']);
Route::delete('/working-time/shift-allowance-policies/{id}', [ShiftAllowancePolicyController::class, 'destroy']);
