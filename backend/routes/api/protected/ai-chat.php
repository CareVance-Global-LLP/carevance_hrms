<?php

use App\Http\Controllers\Api\AiChatController;
use Illuminate\Support\Facades\Route;

Route::post('/ai/chat', [AiChatController::class, 'chat'])->middleware('throttle:ai.chat');
