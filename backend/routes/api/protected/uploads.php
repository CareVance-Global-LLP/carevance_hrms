<?php

use App\Http\Controllers\Api\UploadController;
use Illuminate\Support\Facades\Route;

/*
 * Resumable uploads.
 *
 * Generic rather than chat-specific: the same session shape will serve any
 * other place that needs a file bigger than one request can carry. What an
 * upload is FOR is decided when it is claimed, not when it is sent.
 *
 * Chunk posts are rate-limited separately from ordinary writes. A 200 MB file
 * is legitimately ~40 requests in quick succession, which a normal write
 * throttle would read as abuse and cut off mid-upload.
 */
Route::get('/uploads/limits', [UploadController::class, 'limits']);
Route::post('/uploads', [UploadController::class, 'begin']);
Route::get('/uploads/{uploadKey}', [UploadController::class, 'status']);
Route::post('/uploads/{uploadKey}/chunks/{index}', [UploadController::class, 'storeChunk'])
    ->whereNumber('index')
    ->middleware('throttle:uploads.chunks');
Route::post('/uploads/{uploadKey}/complete', [UploadController::class, 'complete']);
Route::delete('/uploads/{uploadKey}', [UploadController::class, 'abort']);
