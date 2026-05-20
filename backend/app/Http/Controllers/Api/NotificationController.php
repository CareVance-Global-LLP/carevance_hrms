<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithApiResponses;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\Notifications\ListNotificationsRequest;
use App\Http\Requests\Api\Notifications\PublishNotificationRequest;
use App\Models\AppNotification;
use App\Models\User;
use App\Services\AppNotificationService;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    use InteractsWithApiResponses;

    private const CHAT_NOTIFICATION_TYPES = [
        'chat_direct_message',
        'chat_group_message',
        'chat_message',
        'direct_message',
        'group_message',
    ];

    public function __construct(private readonly AppNotificationService $notificationService)
    {
    }

    public function index(ListNotificationsRequest $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['data' => [], 'unread_count' => 0]);
        }

        $limit = (int) ($request->limit ?: 30);
        $excludeTypes = collect((array) $request->input('exclude_types', []))
            ->map(fn ($type) => trim((string) $type))
            ->filter()
            ->unique()
            ->values();

        $includeTypes = collect((array) $request->input('types', []))
            ->map(fn ($type) => trim((string) $type))
            ->filter()
            ->unique()
            ->values();

        $query = AppNotification::with('sender:id,name,email')
            ->where('organization_id', $currentUser->organization_id)
            ->where('user_id', $currentUser->id)
            ->when($request->filled('type'), fn ($builder) => $builder->where('type', (string) $request->type))
            ->when($includeTypes->isNotEmpty(), fn ($builder) => $builder->whereIn('type', $includeTypes->all()))
            ->when($excludeTypes->isNotEmpty(), fn ($builder) => $builder->whereNotIn('type', $excludeTypes->all()))
            ->when($request->boolean('unread_only'), fn ($builder) => $builder->where('is_read', false))
            ->when($request->filled('q'), function ($builder) use ($request) {
                $term = trim((string) $request->q);
                $builder->where(function ($nested) use ($term) {
                    $nested->where('title', 'like', "%{$term}%")
                        ->orWhere('message', 'like', "%{$term}%");
                });
            })
            ->orderByDesc('created_at');

        return response()->json([
            'data' => $query->limit($limit)->get(),
            'unread_count' => (int) (clone $query)->where('is_read', false)->count(),
        ]);
    }

    public function publish(PublishNotificationRequest $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }
        if (!$this->canManage($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $recipientIds = collect($request->recipient_user_ids ?? []);
        if ($recipientIds->isEmpty()) {
            $recipientIds = User::where('organization_id', $currentUser->organization_id)->pluck('id');
        } else {
            $recipientIds = User::where('organization_id', $currentUser->organization_id)
                ->whereIn('id', $recipientIds->map(fn ($id) => (int) $id))
                ->pluck('id');
        }

        $this->notificationService->sendToUsers(
            organizationId: (int) $currentUser->organization_id,
            userIds: $recipientIds,
            senderId: (int) $currentUser->id,
            type: (string) $request->type,
            title: (string) $request->title,
            message: (string) $request->message,
            meta: $request->priority ? ['priority' => $request->priority] : null
        );

        return $this->createdResponse([], 'Notification published.');
    }

    public function markRead(Request $request, int $id)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        $notification = AppNotification::where('organization_id', $currentUser->organization_id)
            ->where('user_id', $currentUser->id)
            ->find($id);
        if (!$notification) {
            return response()->json(['message' => 'Notification not found'], 404);
        }

        if (!$notification->is_read) {
            $notification->update([
                'is_read' => true,
                'read_at' => now(),
            ]);
        }

        return $this->updatedResponse([], 'Marked as read.');
    }

    public function markAllRead(Request $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        $excludeTypes = collect((array) $request->input('exclude_types', []))
            ->map(fn ($type) => trim((string) $type))
            ->filter()
            ->unique()
            ->values();

        AppNotification::where('organization_id', $currentUser->organization_id)
            ->where('user_id', $currentUser->id)
            ->where('is_read', false)
            ->when($excludeTypes->isNotEmpty(), fn ($builder) => $builder->whereNotIn('type', $excludeTypes->all()))
            ->update([
                'is_read' => true,
                'read_at' => now(),
                'updated_at' => now(),
            ]);

        return $this->updatedResponse([], 'All notifications marked as read.');
    }

    private function canManage(User $user): bool
    {
        return in_array($user->role, ['admin', 'manager'], true);
    }
}
