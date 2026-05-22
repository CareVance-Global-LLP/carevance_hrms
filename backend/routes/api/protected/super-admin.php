<?php

use App\Http\Controllers\Api\SuperAdminController;
use Illuminate\Support\Facades\Route;

Route::middleware(['role:super_admin'])->group(function () {
    
    // Dashboard stats
    Route::get('/super-admin/stats', [SuperAdminController::class, 'stats']);
    
    // Organizations management
    Route::get('/super-admin/organizations', [SuperAdminController::class, 'organizations']);
    Route::post('/super-admin/organizations', [SuperAdminController::class, 'createOrganization']);
    Route::get('/super-admin/organizations/{organization}', [SuperAdminController::class, 'showOrganization']);
    Route::put('/super-admin/organizations/{organization}/toggle-status', [SuperAdminController::class, 'toggleStatus']);
    Route::delete('/super-admin/organizations/{organization}', [SuperAdminController::class, 'deleteOrganization']);
    
    // Users across all orgs
    Route::get('/super-admin/users', [SuperAdminController::class, 'allUsers']);
    Route::post('/super-admin/users/{user}/impersonate', [SuperAdminController::class, 'impersonate']);
    
    // Billing & subscriptions
    Route::get('/super-admin/subscriptions', [SuperAdminController::class, 'subscriptions']);
    Route::get('/super-admin/revenue', [SuperAdminController::class, 'revenue']);
    
    // Export & Search
    Route::get('/super-admin/organizations/export', [SuperAdminController::class, 'exportOrganizations']);
    Route::get('/super-admin/search', [SuperAdminController::class, 'globalSearch']);
});
