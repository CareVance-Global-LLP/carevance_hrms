<?php

namespace App\Services\Chat;

use App\Models\ChatConversation;
use App\Models\ChatGroup;
use App\Models\ChatGroupMember;
use App\Models\ChatGroupMessage;
use App\Models\ChatGroupMessageReaction;
use App\Models\ChatGroupTypingStatus;
use App\Models\ChatMessage;
use App\Models\ChatMessageReaction;
use App\Models\ChatTypingStatus;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ChatService
{
    public function conversations(?User $user)
    {
        if (!$user || !$user->organization_id) {
            return collect();
        }

        return ChatConversation::query()
            ->where('organization_id', $user->organization_id)
            ->where(function ($query) use ($user) {
                $query->where('participant_one_id', $user->id)
                    ->orWhere('participant_two_id', $user->id);
            })
            ->with(['participantOne:id,name,email,last_seen_at', 'participantTwo:id,name,email,last_seen_at'])
            ->with(['messages' => function ($query) {
                $query->with('reactionEntries')->latest()->limit(1);
            }])
            ->orderByDesc('updated_at')
            ->get()
            ->map(function (ChatConversation $conversation) use ($user) {
                $other = $conversation->participant_one_id === $user->id
                    ? $conversation->participantTwo
                    : $conversation->participantOne;
                $lastMessage = $conversation->messages->first();

                $unreadCount = ChatMessage::where('conversation_id', $conversation->id)
                    ->whereNull('read_at')
                    ->where('sender_id', '!=', $user->id)
                    ->count();

                $otherUser = $other ? [
                    'id' => $other->id,
                    'name' => $other->name,
                    'email' => $other->email,
                    'last_seen_at' => $other->last_seen_at,
                    'is_online' => $other->last_seen_at ? $other->last_seen_at->greaterThanOrEqualTo(now()->subMinutes(2)) : false,
                ] : null;

                return [
                    'id' => $conversation->id,
                    'type' => 'direct',
                    'other_user' => $otherUser,
                    'last_message' => $lastMessage,
                    'unread_count' => $unreadCount,
                    'updated_at' => $conversation->updated_at,
                ];
            })
            ->values();
    }

    public function availableUsers(?User $user)
    {
        if (!$user || !$user->organization_id) {
            return collect();
        }

        return User::query()
            ->where('organization_id', $user->organization_id)
            ->orderBy('name')
            ->get(['id', 'name', 'email', 'role']);
    }

    public function unreadSummary(?User $user): array
    {
        if (!$user || !$user->organization_id) {
            return [
                'unread_messages' => 0,
                'unread_conversations' => 0,
                'unread_senders' => 0,
            ];
        }

        $conversationIds = ChatConversation::query()
            ->where('organization_id', $user->organization_id)
            ->where(function ($query) use ($user) {
                $query->where('participant_one_id', $user->id)
                    ->orWhere('participant_two_id', $user->id);
            })
            ->pluck('id');

        $baseUnreadQuery = ChatMessage::query()
            ->whereIn('conversation_id', $conversationIds)
            ->whereNull('read_at')
            ->where('sender_id', '!=', $user->id);

        $groupMemberships = ChatGroupMember::query()
            ->where('user_id', $user->id)
            ->with('group:id')
            ->get();

        $groupUnreadMessages = 0;
        $groupUnreadThreads = 0;
        $groupUnreadSenders = [];

        foreach ($groupMemberships as $membership) {
            $unreadQuery = ChatGroupMessage::query()
                ->where('group_id', $membership->group_id)
                ->where('sender_id', '!=', $user->id)
                ->when($membership->last_read_at, fn ($query, $lastReadAt) => $query->where('created_at', '>', $lastReadAt));

            $count = (clone $unreadQuery)->count();
            if ($count > 0) {
                $groupUnreadMessages += $count;
                $groupUnreadThreads++;
                foreach ((clone $unreadQuery)->distinct('sender_id')->pluck('sender_id') as $senderId) {
                    $groupUnreadSenders[(int) $senderId] = true;
                }
            }
        }

        foreach ((clone $baseUnreadQuery)->distinct('sender_id')->pluck('sender_id') as $senderId) {
            $groupUnreadSenders[(int) $senderId] = true;
        }

        return [
            'unread_messages' => (clone $baseUnreadQuery)->count() + $groupUnreadMessages,
            'unread_conversations' => (clone $baseUnreadQuery)->distinct('conversation_id')->count('conversation_id') + $groupUnreadThreads,
            'unread_senders' => count($groupUnreadSenders),
        ];
    }

    public function startConversation(?User $user, string $email): array
    {
        if (!$user || !$user->organization_id) {
            return ['status' => 403, 'payload' => ['message' => 'Forbidden']];
        }

        $other = User::where('organization_id', $user->organization_id)
            ->where('email', $email)
            ->first();
        if (!$other) {
            return ['status' => 404, 'payload' => ['message' => 'User not found in your organization.']];
        }
        if ((int) $other->id === (int) $user->id) {
            return ['status' => 422, 'payload' => ['message' => 'Cannot start chat with yourself.']];
        }

        [$one, $two] = $this->normalizeParticipants($user->id, $other->id);
        $conversation = ChatConversation::firstOrCreate([
            'organization_id' => $user->organization_id,
            'participant_one_id' => $one,
            'participant_two_id' => $two,
        ]);

        return [
            'status' => 201,
            'payload' => [
                'id' => $conversation->id,
                'other_user' => [
                    'id' => $other->id,
                    'name' => $other->name,
                    'email' => $other->email,
                ],
            ],
        ];
    }

    public function groups(?User $user)
    {
        if (!$user || !$user->organization_id) {
            return collect();
        }

        return ChatGroup::query()
            ->where('organization_id', $user->organization_id)
            ->whereHas('members', fn ($query) => $query->where('user_id', $user->id))
            ->with([
                'creator:id,name,email',
                'members.user:id,name,email,last_seen_at',
                'messages' => fn ($query) => $query->with('sender:id,name,email')->latest()->limit(1),
                'messages.reactionEntries',
            ])
            ->orderByDesc('updated_at')
            ->get()
            ->map(function (ChatGroup $group) use ($user) {
                $membership = $group->members->firstWhere('user_id', $user->id);
                $lastMessage = $group->messages->first();

                $unreadCount = ChatGroupMessage::query()
                    ->where('group_id', $group->id)
                    ->where('sender_id', '!=', $user->id)
                    ->when($membership?->last_read_at, fn ($query, $lastReadAt) => $query->where('created_at', '>', $lastReadAt))
                    ->count();

                return [
                    'id' => $group->id,
                    'type' => 'group',
                    'name' => $group->name,
                    'member_count' => $group->members->count(),
                    'members' => $group->members
                        ->map(fn (ChatGroupMember $member) => [
                            'id' => $member->user?->id,
                            'name' => $member->user?->name,
                            'email' => $member->user?->email,
                            'last_seen_at' => $member->user?->last_seen_at,
                            'is_online' => $member->user?->last_seen_at ? $member->user->last_seen_at->greaterThanOrEqualTo(now()->subMinutes(2)) : false,
                        ])
                        ->filter(fn ($member) => !empty($member['id']))
                        ->values(),
                    'last_message' => $lastMessage,
                    'unread_count' => $unreadCount,
                    'updated_at' => $group->updated_at,
                ];
            })
            ->values();
    }

    public function createGroup(?User $user, string $name, array $userIds): array
    {
        if (!$user || !$user->organization_id) {
            return ['status' => 403, 'payload' => ['message' => 'Forbidden']];
        }

        $memberIds = collect($userIds)->map(fn ($id) => (int) $id)->push((int) $user->id)->unique()->values();
        $validMembers = User::query()
            ->where('organization_id', $user->organization_id)
            ->whereIn('id', $memberIds)
            ->get(['id']);

        if ($validMembers->count() !== $memberIds->count()) {
            return ['status' => 422, 'payload' => ['message' => 'All group members must belong to your organization.']];
        }

        $group = ChatGroup::create([
            'organization_id' => $user->organization_id,
            'created_by' => $user->id,
            'name' => trim($name),
        ]);

        foreach ($memberIds as $memberId) {
            ChatGroupMember::create([
                'group_id' => $group->id,
                'user_id' => $memberId,
                'last_read_at' => $memberId === (int) $user->id ? now() : null,
            ]);
        }

        return ['status' => 201, 'payload' => ['id' => $group->id, 'name' => $group->name]];
    }

    public function messages(?User $user, int $conversationId, ?int $sinceId): array
    {
        $conversation = $this->findUserConversation($user?->id, $conversationId);
        if (!$conversation) {
            return ['status' => 404, 'payload' => ['message' => 'Conversation not found']];
        }

        return [
            'status' => 200,
            'payload' => ChatMessage::query()
                ->where('conversation_id', $conversation->id)
                ->when($sinceId, fn ($query, $id) => $query->where('id', '>', $id))
                ->with(['sender:id,name,email', 'reactionEntries'])
                ->orderBy('created_at')
                ->get(),
        ];
    }

    public function groupMessages(?User $user, int $groupId, ?int $sinceId): array
    {
        $group = $this->findUserGroup($user?->id, $groupId);
        if (!$group) {
            return ['status' => 404, 'payload' => ['message' => 'Group not found']];
        }

        return [
            'status' => 200,
            'payload' => ChatGroupMessage::query()
                ->where('group_id', $group->id)
                ->when($sinceId, fn ($query, $id) => $query->where('id', '>', $id))
                ->with(['sender:id,name,email', 'reactionEntries'])
                ->orderBy('created_at')
                ->get(),
        ];
    }

    public function sendMessage(Request $request, ?User $user, int $conversationId): array
    {
        $conversation = $this->findUserConversation($user?->id, $conversationId);
        if (!$conversation || !$user) {
            return ['status' => 404, 'payload' => ['message' => 'Conversation not found']];
        }

        $payload = $this->buildMessagePayload($request);
        if (isset($payload['error'])) {
            return ['status' => 422, 'payload' => ['message' => $payload['error']]];
        }

        $message = ChatMessage::create(array_merge($payload, [
            'conversation_id' => $conversation->id,
            'sender_id' => $user->id,
        ]));

        $conversation->touch();
        return ['status' => 201, 'payload' => $message->load(['sender:id,name,email', 'reactionEntries'])];
    }

    public function sendGroupMessage(Request $request, ?User $user, int $groupId): array
    {
        $group = $this->findUserGroup($user?->id, $groupId);
        if (!$group || !$user) {
            return ['status' => 404, 'payload' => ['message' => 'Group not found']];
        }

        $payload = $this->buildMessagePayload($request);
        if (isset($payload['error'])) {
            return ['status' => 422, 'payload' => ['message' => $payload['error']]];
        }

        $message = ChatGroupMessage::create(array_merge($payload, [
            'group_id' => $group->id,
            'sender_id' => $user->id,
        ]));

        $group->touch();
        return ['status' => 201, 'payload' => $message->load(['sender:id,name,email', 'reactionEntries'])];
    }

    public function updateMessage(?User $user, int $conversationId, int $messageId, string $body): array
    {
        $conversation = $this->findUserConversation($user?->id, $conversationId);
        if (!$conversation || !$user) {
            return ['status' => 404, 'payload' => ['message' => 'Conversation not found']];
        }

        $message = ChatMessage::query()
            ->where('id', $messageId)
            ->where('conversation_id', $conversation->id)
            ->first();

        if (!$message) {
            return ['status' => 404, 'payload' => ['message' => 'Message not found']];
        }

        if ((int) $message->sender_id !== (int) $user->id) {
            return ['status' => 403, 'payload' => ['message' => 'You can only edit your own messages.']];
        }

        $trimmedBody = trim($body);
        if ($trimmedBody === '') {
            return ['status' => 422, 'payload' => ['message' => 'Message cannot be empty.']];
        }

        $message->update([
            'body' => $trimmedBody,
            'edited_at' => now(),
        ]);

        return ['status' => 200, 'payload' => $message->fresh()->load(['sender:id,name,email', 'reactionEntries'])];
    }

    public function updateGroupMessage(?User $user, int $groupId, int $messageId, string $body): array
    {
        $group = $this->findUserGroup($user?->id, $groupId);
        if (!$group || !$user) {
            return ['status' => 404, 'payload' => ['message' => 'Group not found']];
        }

        $message = ChatGroupMessage::query()
            ->where('id', $messageId)
            ->where('group_id', $group->id)
            ->first();

        if (!$message) {
            return ['status' => 404, 'payload' => ['message' => 'Message not found']];
        }

        if ((int) $message->sender_id !== (int) $user->id) {
            return ['status' => 403, 'payload' => ['message' => 'You can only edit your own messages.']];
        }

        $trimmedBody = trim($body);
        if ($trimmedBody === '') {
            return ['status' => 422, 'payload' => ['message' => 'Message cannot be empty.']];
        }

        $message->update([
            'body' => $trimmedBody,
            'edited_at' => now(),
        ]);

        return ['status' => 200, 'payload' => $message->fresh()->load(['sender:id,name,email', 'reactionEntries'])];
    }

    public function deleteMessage(?User $user, int $conversationId, int $messageId): array
    {
        $conversation = $this->findUserConversation($user?->id, $conversationId);
        if (!$conversation || !$user) {
            return ['status' => 404, 'payload' => ['message' => 'Conversation not found']];
        }

        $message = ChatMessage::query()
            ->where('id', $messageId)
            ->where('conversation_id', $conversation->id)
            ->first();

        if (!$message) {
            return ['status' => 404, 'payload' => ['message' => 'Message not found']];
        }

        if ((int) $message->sender_id !== (int) $user->id) {
            return ['status' => 403, 'payload' => ['message' => 'You can only delete your own messages.']];
        }

        $this->deleteMessageAttachment($message->attachment_path);
        $message->delete();
        $conversation->touch();

        return ['status' => 200, 'payload' => ['message' => 'Message deleted.']];
    }

    public function deleteGroupMessage(?User $user, int $groupId, int $messageId): array
    {
        $group = $this->findUserGroup($user?->id, $groupId);
        if (!$group || !$user) {
            return ['status' => 404, 'payload' => ['message' => 'Group not found']];
        }

        $message = ChatGroupMessage::query()
            ->where('id', $messageId)
            ->where('group_id', $group->id)
            ->first();

        if (!$message) {
            return ['status' => 404, 'payload' => ['message' => 'Message not found']];
        }

        if ((int) $message->sender_id !== (int) $user->id) {
            return ['status' => 403, 'payload' => ['message' => 'You can only delete your own messages.']];
        }

        $this->deleteMessageAttachment($message->attachment_path);
        $message->delete();
        $group->touch();

        return ['status' => 200, 'payload' => ['message' => 'Message deleted.']];
    }

    public function toggleMessageReaction(?User $user, int $conversationId, int $messageId, string $emoji): array
    {
        $conversation = $this->findUserConversation($user?->id, $conversationId);
        if (!$conversation || !$user) {
            return ['status' => 404, 'payload' => ['message' => 'Conversation not found']];
        }

        $message = ChatMessage::query()
            ->where('id', $messageId)
            ->where('conversation_id', $conversation->id)
            ->first();

        if (!$message) {
            return ['status' => 404, 'payload' => ['message' => 'Message not found']];
        }

        $normalizedEmoji = trim($emoji);
        if ($normalizedEmoji === '') {
            return ['status' => 422, 'payload' => ['message' => 'Reaction is required.']];
        }

        $existingReactions = ChatMessageReaction::query()
            ->where('message_id', $message->id)
            ->where('user_id', $user->id)
            ->get();

        $hasSameEmoji = $existingReactions->contains(
            fn (ChatMessageReaction $reaction) => (string) $reaction->emoji === $normalizedEmoji
        );

        if ($existingReactions->isNotEmpty()) {
            ChatMessageReaction::query()
                ->where('message_id', $message->id)
                ->where('user_id', $user->id)
                ->delete();
        }

        if (!$hasSameEmoji) {
            ChatMessageReaction::create([
                'message_id' => $message->id,
                'user_id' => $user->id,
                'emoji' => $normalizedEmoji,
            ]);
        }

        return ['status' => 200, 'payload' => $message->fresh()->load(['sender:id,name,email', 'reactionEntries'])];
    }

    public function toggleGroupMessageReaction(?User $user, int $groupId, int $messageId, string $emoji): array
    {
        $group = $this->findUserGroup($user?->id, $groupId);
        if (!$group || !$user) {
            return ['status' => 404, 'payload' => ['message' => 'Group not found']];
        }

        $message = ChatGroupMessage::query()
            ->where('id', $messageId)
            ->where('group_id', $group->id)
            ->first();

        if (!$message) {
            return ['status' => 404, 'payload' => ['message' => 'Message not found']];
        }

        $normalizedEmoji = trim($emoji);
        if ($normalizedEmoji === '') {
            return ['status' => 422, 'payload' => ['message' => 'Reaction is required.']];
        }

        $existingReactions = ChatGroupMessageReaction::query()
            ->where('group_message_id', $message->id)
            ->where('user_id', $user->id)
            ->get();

        $hasSameEmoji = $existingReactions->contains(
            fn (ChatGroupMessageReaction $reaction) => (string) $reaction->emoji === $normalizedEmoji
        );

        if ($existingReactions->isNotEmpty()) {
            ChatGroupMessageReaction::query()
                ->where('group_message_id', $message->id)
                ->where('user_id', $user->id)
                ->delete();
        }

        if (!$hasSameEmoji) {
            ChatGroupMessageReaction::create([
                'group_message_id' => $message->id,
                'user_id' => $user->id,
                'emoji' => $normalizedEmoji,
            ]);
        }

        return ['status' => 200, 'payload' => $message->fresh()->load(['sender:id,name,email', 'reactionEntries'])];
    }

    public function markRead(?User $user, int $conversationId): array
    {
        $conversation = $this->findUserConversation($user?->id, $conversationId);
        if (!$conversation || !$user) {
            return ['status' => 404, 'payload' => ['message' => 'Conversation not found']];
        }

        ChatMessage::where('conversation_id', $conversation->id)
            ->whereNull('read_at')
            ->where('sender_id', '!=', $user->id)
            ->update(['read_at' => now()]);

        return ['status' => 200, 'payload' => ['message' => 'Marked as read']];
    }

    public function markGroupRead(?User $user, int $groupId): array
    {
        $membership = ChatGroupMember::query()
            ->where('group_id', $groupId)
            ->where('user_id', $user?->id)
            ->first();

        if (!$membership) {
            return ['status' => 404, 'payload' => ['message' => 'Group not found']];
        }

        $membership->update(['last_read_at' => now()]);

        return ['status' => 200, 'payload' => ['message' => 'Marked as read']];
    }

    public function setTyping(?User $user, int $conversationId, bool $isTyping): array
    {
        $conversation = $this->findUserConversation($user?->id, $conversationId);
        if (!$conversation || !$user) {
            return ['status' => 404, 'payload' => ['message' => 'Conversation not found']];
        }

        if ($isTyping) {
            ChatTypingStatus::updateOrCreate(
                ['conversation_id' => $conversation->id, 'user_id' => $user->id],
                ['typing_until' => now()->addSeconds(8)]
            );
        } else {
            ChatTypingStatus::where('conversation_id', $conversation->id)
                ->where('user_id', $user->id)
                ->delete();
        }

        return ['status' => 200, 'payload' => ['message' => 'Typing status updated']];
    }

    public function setGroupTyping(?User $user, int $groupId, bool $isTyping): array
    {
        $group = $this->findUserGroup($user?->id, $groupId);
        if (!$group || !$user) {
            return ['status' => 404, 'payload' => ['message' => 'Group not found']];
        }

        if ($isTyping) {
            ChatGroupTypingStatus::updateOrCreate(
                ['group_id' => $group->id, 'user_id' => $user->id],
                ['typing_until' => now()->addSeconds(8)]
            );
        } else {
            ChatGroupTypingStatus::where('group_id', $group->id)
                ->where('user_id', $user->id)
                ->delete();
        }

        return ['status' => 200, 'payload' => ['message' => 'Typing status updated']];
    }

    public function typingStatus(?User $user, int $conversationId): array
    {
        $conversation = $this->findUserConversation($user?->id, $conversationId);
        if (!$conversation || !$user) {
            return ['status' => 404, 'payload' => ['message' => 'Conversation not found']];
        }

        return [
            'status' => 200,
            'payload' => ChatTypingStatus::query()
                ->where('conversation_id', $conversation->id)
                ->where('user_id', '!=', $user->id)
                ->where('typing_until', '>', now())
                ->with('user:id,name,email')
                ->get()
                ->map(fn (ChatTypingStatus $status) => [
                    'id' => $status->user?->id,
                    'name' => $status->user?->name,
                    'email' => $status->user?->email,
                ])
                ->filter(fn ($item) => !empty($item['id']))
                ->values(),
        ];
    }

    public function groupTypingStatus(?User $user, int $groupId): array
    {
        $group = $this->findUserGroup($user?->id, $groupId);
        if (!$group || !$user) {
            return ['status' => 404, 'payload' => ['message' => 'Group not found']];
        }

        return [
            'status' => 200,
            'payload' => ChatGroupTypingStatus::query()
                ->where('group_id', $group->id)
                ->where('user_id', '!=', $user->id)
                ->where('typing_until', '>', now())
                ->with('user:id,name,email')
                ->get()
                ->map(fn (ChatGroupTypingStatus $status) => [
                    'id' => $status->user?->id,
                    'name' => $status->user?->name,
                    'email' => $status->user?->email,
                ])
                ->filter(fn ($item) => !empty($item['id']))
                ->values(),
        ];
    }

    public function attachment(?User $user, int $messageId)
    {
        $message = ChatMessage::with('conversation')->find($messageId);
        if (!$message || !$message->conversation) {
            return ['status' => 404, 'payload' => ['message' => 'Message not found']];
        }

        if (!$this->findUserConversation($user?->id, (int) $message->conversation_id)) {
            return ['status' => 403, 'payload' => ['message' => 'Forbidden']];
        }

        return $this->buildAttachmentResponse($message->attachment_path, $message->attachment_mime, $message->attachment_name);
    }

    public function groupAttachment(?User $user, int $messageId)
    {
        $message = ChatGroupMessage::with('group')->find($messageId);
        if (!$message || !$message->group) {
            return ['status' => 404, 'payload' => ['message' => 'Message not found']];
        }

        if (!$this->findUserGroup($user?->id, (int) $message->group_id)) {
            return ['status' => 403, 'payload' => ['message' => 'Forbidden']];
        }

        return $this->buildAttachmentResponse($message->attachment_path, $message->attachment_mime, $message->attachment_name);
    }

    private function buildMessagePayload(Request $request): array
    {
        $body = trim((string) $request->input('body', ''));
        $attachmentPath = null;
        $attachmentName = null;
        $attachmentMime = null;
        $attachmentSize = null;

        if ($request->hasFile('attachment')) {
            $file = $request->file('attachment');
            $attachmentPath = $file->store('', 'chat_attachments');
            $attachmentName = $file->getClientOriginalName();
            $attachmentMime = $file->getClientMimeType();
            $attachmentSize = $file->getSize();
        }

        if ($body === '' && !$attachmentPath) {
            return ['error' => 'Message or attachment is required.'];
        }

        return [
            'body' => $body !== '' ? $body : 'Attachment',
            'attachment_path' => $attachmentPath,
            'attachment_name' => $attachmentName,
            'attachment_mime' => $attachmentMime,
            'attachment_size' => $attachmentSize,
        ];
    }

    private function buildAttachmentResponse(?string $path, ?string $mime, ?string $name)
    {
        $safePath = $path ? basename($path) : null;

        if (!$safePath || !Storage::disk('chat_attachments')->exists($safePath)) {
            return ['status' => 404, 'payload' => ['message' => 'Attachment not found']];
        }

        $extension = pathinfo((string) $name, PATHINFO_EXTENSION);
        $baseName = Str::slug(pathinfo((string) $name, PATHINFO_FILENAME) ?: 'attachment') ?: 'attachment';
        $downloadName = $baseName.($extension ? '.'.Str::lower($extension) : '');

        return response()->file(Storage::disk('chat_attachments')->path($safePath), [
            'Content-Type' => $mime ?: 'application/octet-stream',
            'Content-Disposition' => 'attachment; filename="' . addslashes($downloadName) . '"',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function deleteMessageAttachment(?string $path): void
    {
        $safePath = $path ? basename($path) : null;

        if ($safePath && Storage::disk('chat_attachments')->exists($safePath)) {
            Storage::disk('chat_attachments')->delete($safePath);
        }
    }

    private function normalizeParticipants(int $a, int $b): array
    {
        return $a < $b ? [$a, $b] : [$b, $a];
    }

    private function findUserConversation(?int $userId, int $conversationId): ?ChatConversation
    {
        if (!$userId) {
            return null;
        }

        return ChatConversation::query()
            ->where('id', $conversationId)
            ->where(function ($query) use ($userId) {
                $query->where('participant_one_id', $userId)
                    ->orWhere('participant_two_id', $userId);
            })
            ->first();
    }

    private function findUserGroup(?int $userId, int $groupId): ?ChatGroup
    {
        if (!$userId) {
            return null;
        }

        return ChatGroup::query()
            ->where('id', $groupId)
            ->whereHas('members', fn ($query) => $query->where('user_id', $userId))
            ->first();
    }
}
