<?php

use App\Http\Controllers\Api\TeamHierarchyController;
use Illuminate\Support\Facades\Route;

Route::get('/me/team-hierarchy', [TeamHierarchyController::class, 'index']);
