<?php

use App\Http\Controllers\Api\AssetAssignmentController;
use App\Http\Controllers\Api\AssetController;
use Illuminate\Support\Facades\Route;

Route::get('/assets', [AssetController::class, 'index']);
Route::post('/assets', [AssetController::class, 'store']);
Route::get('/assets/{asset}', [AssetController::class, 'show'])->whereNumber('asset');
Route::put('/assets/{asset}', [AssetController::class, 'update'])->whereNumber('asset');
Route::patch('/assets/{asset}', [AssetController::class, 'update'])->whereNumber('asset');
Route::delete('/assets/{asset}', [AssetController::class, 'destroy'])->whereNumber('asset');

Route::post('/assets/{asset}/assign', [AssetAssignmentController::class, 'assign'])->whereNumber('asset');
Route::post('/assets/{asset}/return', [AssetAssignmentController::class, 'return'])->whereNumber('asset');

Route::get('/employees/{employee}/assets', [AssetAssignmentController::class, 'employeeAssets'])->whereNumber('employee');
