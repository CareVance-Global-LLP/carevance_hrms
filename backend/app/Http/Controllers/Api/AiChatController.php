<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AiChatService;
use Illuminate\Http\Request;

class AiChatController extends Controller
{
    public function __construct(private readonly AiChatService $chatService)
    {
    }

    public function chat(Request $request)
    {
        $data = $request->validate([
            'message' => 'required|string|max:2000',
            'history' => 'nullable|array',
            'history.*.role' => 'required|in:user,assistant',
            'history.*.content' => 'required|string|max:2000',
        ]);

        $reply = $this->chatService->chat(
            $data['message'],
            $data['history'] ?? []
        );

        return response()->json(['reply' => $reply]);
    }
}
