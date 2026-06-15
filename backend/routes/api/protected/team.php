<?php

use App\Http\Controllers\Api\OrganizationController;
use App\Http\Controllers\Api\TeamHierarchyController;
use Illuminate\Support\Facades\Route;

Route::get('/me/team-hierarchy', [TeamHierarchyController::class, 'index']);
Route::get('/me/team-members', [OrganizationController::class, 'myMembers']);
