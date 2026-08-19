<?php

use App\Http\Controllers\Api\IntegrationController;
use Illuminate\Support\Facades\Route;

/**
 * A customer administering their own integrations.
 *
 * Admin-only: an API key is a credential that reads employee and payroll data
 * without a person attached, and a webhook endpoint is somewhere that data
 * gets sent. Neither is a self-service setting.
 */
Route::middleware('role:admin')->prefix('integrations')->group(function () {
    Route::get('/keys', [IntegrationController::class, 'listKeys']);
    Route::post('/keys', [IntegrationController::class, 'createKey']);
    Route::delete('/keys/{id}', [IntegrationController::class, 'revokeKey']);

    Route::get('/webhooks', [IntegrationController::class, 'listWebhooks']);
    Route::post('/webhooks', [IntegrationController::class, 'createWebhook']);
    Route::post('/webhooks/{id}/enable', [IntegrationController::class, 'enableWebhook']);
    Route::delete('/webhooks/{id}', [IntegrationController::class, 'deleteWebhook']);

    Route::get('/webhook-deliveries', [IntegrationController::class, 'deliveries']);
    Route::post('/webhook-deliveries/{id}/retry', [IntegrationController::class, 'retryDelivery']);
});
