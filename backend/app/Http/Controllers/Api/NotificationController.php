<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithApiResponses;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\Notifications\ListNotificationsRequest;
use App\Http\Requests\Api\Notifications\PublishNotificationRequest;
use App\Models\AppNotification;
use App\Models\DeviceToken;
use App\Models\Poll;
use App\Models\PollOption;
use App\Models\PollVote;
use App\Models\User;
use App\Services\AppNotificationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

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

$query = AppNotification::with(['sender:id,name,email', 'poll' => function ($query) use ($currentUser) {
                $query->with(['options' => function ($q) use ($currentUser) {
                    $q->withExists(['votes as has_voted' => function ($subq) use ($currentUser) {
                        $subq->where('user_id', $currentUser->id);
                    }]);
                }]);
            }])
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

        // For polls, create a single shared poll that all recipients vote on.
        $poll = null;
        if ($request->type === 'poll') {
            $poll = Poll::create([
                'question' => $request->question ?? $request->title,
                'expires_at' => $request->expires_at,
                'is_multiple_choice' => $request->boolean('is_multiple_choice'),
            ]);

            collect($request->options ?? [])
                ->filter(fn ($option) => is_string($option) && trim($option) !== '')
                ->each(fn ($option) => PollOption::create([
                    'poll_id' => $poll->id,
                    'option_text' => trim($option),
                    'vote_count' => 0,
                ]));
        }

        $broadcastId = (string) Str::uuid();

        $this->notificationService->sendToUsers(
            organizationId: (int) $currentUser->organization_id,
            userIds: $recipientIds,
            senderId: (int) $currentUser->id,
            type: (string) $request->type,
            title: (string) $request->title,
            message: (string) $request->message,
            meta: $request->priority ? ['priority' => $request->priority] : null,
            pollId: $poll?->id,
            broadcastId: $broadcastId,
        );

        return $this->createdResponse(['broadcast_id' => $broadcastId], 'Notification published.');
    }

    /**
     * How many recipients have opened each of the given broadcasts.
     *
     * Counts only — naming who has not read an announcement turns internal
     * comms into a compliance tool, which is a deliberate product decision and
     * not one this endpoint should make on anyone's behalf.
     */
    public function deliveryStats(Request $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['data' => []]);
        }
        if (!$this->canManage($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $request->validate([
            'broadcast_ids' => 'required|array|max:100',
            'broadcast_ids.*' => 'string|uuid',
        ]);

        $stats = AppNotification::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereIn('broadcast_id', $request->input('broadcast_ids'))
            ->groupBy('broadcast_id')
            ->selectRaw('broadcast_id, COUNT(*) as total, SUM(CASE WHEN is_read THEN 1 ELSE 0 END) as read_count')
            ->get()
            ->map(fn ($row) => [
                'broadcast_id' => (string) $row->broadcast_id,
                'total' => (int) $row->total,
                'read' => (int) $row->read_count,
            ]);

        return response()->json(['data' => $stats]);
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

    public function registerDevice(Request $request)
    {
        $request->validate([
            'token' => 'required|string',
            'platform' => 'required|string|in:ios,android',
        ]);

        $user = $request->user();

        DeviceToken::updateOrCreate(
            ['token' => $request->token],
            ['user_id' => $user->id, 'platform' => $request->platform]
        );

        return response()->json(['message' => 'Device registered for notifications.']);
    }

    public function vote(Request $request, int $pollId)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        $validated = $request->validate([
            'option_ids' => 'required|array|min:1',
            'option_ids.*' => 'required|exists:poll_options,id',
        ]);

        $poll = Poll::with('options')
            ->whereHas('notifications', fn ($q) => $q->where('organization_id', $user->organization_id))
            ->find($pollId);

        if (!$poll) {
            return response()->json(['message' => 'Poll not found.'], 404);
        }

        if ($poll->hasExpired()) {
            return response()->json(['message' => 'This poll has expired.'], 422);
        }

        $optionIds = collect($validated['option_ids']);
        if (!$poll->is_multiple_choice && $optionIds->count() > 1) {
            return response()->json(['message' => 'This poll only allows one vote.'], 422);
        }

        // Verify all options belong to this poll
        $validOptions = $poll->options->whereIn('id', $optionIds);
        if ($validOptions->count() !== $optionIds->count()) {
            return response()->json(['message' => 'Invalid poll options selected.'], 422);
        }

        DB::transaction(function () use ($poll, $user, $optionIds) {
            // Remove existing vote for this user (for single-choice polls)
            if (!$poll->is_multiple_choice) {
                PollVote::where('poll_id', $poll->id)
                    ->where('user_id', $user->id)
                    ->delete();

                $optionIds->each(function ($optionId) use ($poll, $user) {
                    PollOption::where('id', $optionId)->increment('vote_count');
                    PollVote::create([
                        'poll_id' => $poll->id,
                        'user_id' => $user->id,
                        'poll_option_id' => $optionId,
                    ]);
                });
            } else {
                // For multiple choice, handle each option
                $existingVotes = PollVote::where('poll_id', $poll->id)
                    ->where('user_id', $user->id)
                    ->pluck('poll_option_id')
                    ->toArray();

                $toRemove = array_diff($existingVotes, $optionIds->toArray());
                $toAdd = array_diff($optionIds->toArray(), $existingVotes);

                foreach ($toRemove as $optionId) {
                    PollVote::where('poll_id', $poll->id)
                        ->where('user_id', $user->id)
                        ->where('poll_option_id', $optionId)
                        ->delete();
                    PollOption::where('id', $optionId)->decrement('vote_count');
                }

                foreach ($toAdd as $optionId) {
                    PollOption::where('id', $optionId)->increment('vote_count');
                    PollVote::create([
                        'poll_id' => $poll->id,
                        'user_id' => $user->id,
                        'poll_option_id' => $optionId,
                    ]);
                }
            }
        });

        return $this->updatedResponse([], 'Vote recorded.');
    }

    public function results(Request $request, int $pollId)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['data' => [], 'total_votes' => 0]);
        }

        $poll = Poll::with(['options' => function ($query) use ($user) {
            $query->withExists(['votes as has_voted' => function ($q) use ($user) {
                $q->where('user_id', $user->id);
            }]);
        }])
            ->whereHas('notifications', fn ($q) => $q->where('organization_id', $user->organization_id))
            ->find($pollId);

        if (!$poll) {
            return response()->json(['message' => 'Poll not found.'], 404);
        }

        $totalVotes = $poll->options->sum('vote_count');

        return response()->json([
            'data' => $poll->options->map(fn ($option) => [
                'id' => $option->id,
                'option_text' => $option->option_text,
                'vote_count' => $option->vote_count,
                'has_voted' => (bool) $option->has_voted,
            ]),
            'total_votes' => $totalVotes,
            'is_multiple_choice' => $poll->is_multiple_choice,
            'has_expired' => $poll->hasExpired(),
        ]);
    }

    private function canManage(User $user): bool
    {
        return in_array($user->role, ['admin', 'manager'], true);
    }
}
