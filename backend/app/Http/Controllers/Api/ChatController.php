<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\Chat\CreateChatGroupRequest;
use App\Http\Requests\Api\Chat\SendChatMessageRequest;
use App\Http\Requests\Api\Chat\SetTypingStatusRequest;
use App\Http\Requests\Api\Chat\StartConversationRequest;
use App\Http\Requests\Api\Chat\ToggleChatReactionRequest;
use App\Http\Requests\Api\Chat\UpdateChatMessageRequest;
use App\Services\Chat\ChatService;
use Illuminate\Http\Request;

class ChatController extends Controller
{
    public function __construct(
        private readonly ChatService $chatService,
    ) {
    }

    public function conversations(Request $request)
    {
        return response()->json($this->chatService->conversations($request->user()));
    }

    public function availableUsers(Request $request)
    {
        return response()->json($this->chatService->availableUsers($request->user()));
    }

    public function unreadSummary(Request $request)
    {
        return response()->json($this->chatService->unreadSummary($request->user()));
    }

    public function startConversation(StartConversationRequest $request)
    {
        $result = $this->chatService->startConversation($request->user(), (string) $request->email);

        return response()->json($result['payload'], $result['status']);
    }

    public function groups(Request $request)
    {
        return response()->json($this->chatService->groups($request->user()));
    }

    public function createGroup(CreateChatGroupRequest $request)
    {
        $result = $this->chatService->createGroup($request->user(), (string) $request->name, (array) $request->input('user_ids', []));

        return response()->json($result['payload'], $result['status']);
    }

    public function messages(Request $request, int $conversationId)
    {
        $result = $this->chatService->messages($request->user(), $conversationId, $request->filled('since_id') ? (int) $request->since_id : null);

        return response()->json($result['payload'], $result['status']);
    }

    public function groupMessages(Request $request, int $groupId)
    {
        $result = $this->chatService->groupMessages($request->user(), $groupId, $request->filled('since_id') ? (int) $request->since_id : null);

        return response()->json($result['payload'], $result['status']);
    }

    public function searchMessages(Request $request)
    {
        $request->validate(['q' => 'required|string|min:2|max:120']);

        return response()->json([
            'data' => $this->chatService->searchMessages($request->user(), (string) $request->q),
        ]);
    }

    public function sendMessage(SendChatMessageRequest $request, int $conversationId)
    {
        $result = $this->chatService->sendMessage($request, $request->user(), $conversationId);

        return response()->json($result['payload'], $result['status']);
    }

    public function sendGroupMessage(SendChatMessageRequest $request, int $groupId)
    {
        $result = $this->chatService->sendGroupMessage($request, $request->user(), $groupId);

        return response()->json($result['payload'], $result['status']);
    }

    public function updateMessage(UpdateChatMessageRequest $request, int $conversationId, int $messageId)
    {
        $result = $this->chatService->updateMessage($request->user(), $conversationId, $messageId, (string) $request->body);

        return response()->json($result['payload'], $result['status']);
    }

    public function updateGroupMessage(UpdateChatMessageRequest $request, int $groupId, int $messageId)
    {
        $result = $this->chatService->updateGroupMessage($request->user(), $groupId, $messageId, (string) $request->body);

        return response()->json($result['payload'], $result['status']);
    }

    public function deleteMessage(Request $request, int $conversationId, int $messageId)
    {
        $result = $this->chatService->deleteMessage($request->user(), $conversationId, $messageId);

        return response()->json($result['payload'], $result['status']);
    }

    public function deleteGroupMessage(Request $request, int $groupId, int $messageId)
    {
        $result = $this->chatService->deleteGroupMessage($request->user(), $groupId, $messageId);

        return response()->json($result['payload'], $result['status']);
    }

    public function toggleMessageReaction(ToggleChatReactionRequest $request, int $conversationId, int $messageId)
    {
        $result = $this->chatService->toggleMessageReaction($request->user(), $conversationId, $messageId, (string) $request->emoji);

        return response()->json($result['payload'], $result['status']);
    }

    public function toggleGroupMessageReaction(ToggleChatReactionRequest $request, int $groupId, int $messageId)
    {
        $result = $this->chatService->toggleGroupMessageReaction($request->user(), $groupId, $messageId, (string) $request->emoji);

        return response()->json($result['payload'], $result['status']);
    }

    public function markRead(Request $request, int $conversationId)
    {
        $result = $this->chatService->markRead($request->user(), $conversationId);

        return response()->json($result['payload'], $result['status']);
    }

    public function markGroupRead(Request $request, int $groupId)
    {
        $result = $this->chatService->markGroupRead($request->user(), $groupId);

        return response()->json($result['payload'], $result['status']);
    }

    public function setTyping(SetTypingStatusRequest $request, int $conversationId)
    {
        $result = $this->chatService->setTyping($request->user(), $conversationId, $request->boolean('is_typing'));

        return response()->json($result['payload'], $result['status']);
    }

    public function setGroupTyping(SetTypingStatusRequest $request, int $groupId)
    {
        $result = $this->chatService->setGroupTyping($request->user(), $groupId, $request->boolean('is_typing'));

        return response()->json($result['payload'], $result['status']);
    }

    public function typingStatus(Request $request, int $conversationId)
    {
        $result = $this->chatService->typingStatus($request->user(), $conversationId);

        return response()->json($result['payload'], $result['status']);
    }

    public function groupTypingStatus(Request $request, int $groupId)
    {
        $result = $this->chatService->groupTypingStatus($request->user(), $groupId);

        return response()->json($result['payload'], $result['status']);
    }

    public function attachment(Request $request, int $messageId)
    {
        $result = $this->chatService->attachment($request->user(), $messageId);

        if (is_array($result)) {
            return response()->json($result['payload'], $result['status']);
        }

        return $result;
    }

    /**
     * A small preview for rendering in a notification or the panel.
     *
     * Returns the image itself rather than JSON so it can be used directly as
     * an <img> source or converted to a data URL for an OS toast.
     */
    public function thumbnail(Request $request, int $messageId)
    {
        $result = $this->chatService->thumbnail($request->user(), $messageId);

        if (is_array($result)) {
            return response()->json($result['payload'], $result['status']);
        }

        return $result;
    }

    public function groupThumbnail(Request $request, int $messageId)
    {
        $result = $this->chatService->groupThumbnail($request->user(), $messageId);

        if (is_array($result)) {
            return response()->json($result['payload'], $result['status']);
        }

        return $result;
    }

    public function groupAttachment(Request $request, int $messageId)
    {
        $result = $this->chatService->groupAttachment($request->user(), $messageId);

        if (is_array($result)) {
            return response()->json($result['payload'], $result['status']);
        }

        return $result;
    }
}
