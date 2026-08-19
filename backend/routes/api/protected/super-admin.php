<?php

use App\Http\Controllers\Api\BreakGlassController;
use App\Http\Controllers\Api\SuperAdminController;
use App\Http\Controllers\Api\PlanController;
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

    /*
     * Break-glass replaces `POST /super-admin/users/{user}/impersonate`.
     *
     * That endpoint minted an unlimited, non-expiring, unlogged token for any
     * user in any tenant — no reason, no customer approval, no notification,
     * no audit entry. It also called a Sanctum method on a model that does not
     * use Sanctum, in an application that does not install it, so it threw a
     * fatal error on every call and had plainly never been executed.
     *
     * Nothing is preserved from it. There was no working behaviour to keep.
     */
    Route::post('/super-admin/break-glass', [BreakGlassController::class, 'store']);
    Route::get('/super-admin/break-glass', [BreakGlassController::class, 'indexAll']);
    Route::post('/super-admin/break-glass/{id}/token', [BreakGlassController::class, 'issueToken']);
    
    // Billing & subscriptions
    Route::get('/super-admin/subscriptions', [SuperAdminController::class, 'subscriptions']);
    Route::get('/super-admin/revenue', [SuperAdminController::class, 'revenue']);
    
    // Export & Search
    Route::get('/super-admin/organizations/export', [SuperAdminController::class, 'exportOrganizations']);
    Route::get('/super-admin/search', [SuperAdminController::class, 'globalSearch']);
    
    // Plan Management
    Route::get('/super-admin/plans', [PlanController::class, 'index']);
    Route::post('/super-admin/plans', [PlanController::class, 'store']);
    Route::get('/super-admin/plans/{code}', [PlanController::class, 'show']);
    Route::put('/super-admin/plans/{code}', [PlanController::class, 'update']);
    Route::delete('/super-admin/plans/{code}', [PlanController::class, 'destroy']);
    Route::get('/super-admin/plans/comparison', [PlanController::class, 'comparison']);
    Route::post('/super-admin/plans/{code}/toggle-feature', [PlanController::class, 'toggleFeature']);
});
