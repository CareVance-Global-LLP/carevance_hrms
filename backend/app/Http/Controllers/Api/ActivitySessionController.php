<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivitySession;
use App\Models\TimeEntry;
use App\Services\Monitoring\ProductivityClassifier;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class ActivitySessionController extends Controller
{
    public function __construct(
        private readonly ProductivityClassifier $productivityClassifier,
    ) {
    }

    private function resolveWholeSeconds(Carbon $startedAt, Carbon $endedAt): int
    {
        return max(0, (int) round($startedAt->floatDiffInSeconds($endedAt, false)));
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'time_entry_id' => 'nullable|exists:time_entries,id',
            'source' => 'required|string|max:40',
            'activity_kind' => 'required|string|max:40',
            'tool_type' => 'required|string|max:40',
            'display_name' => 'required|string|max:255',
            'app_name' => 'nullable|string|max:255',
            'window_title' => 'nullable|string|max:255',
            'url' => 'nullable|string|max:2048',
            'started_at' => 'required|date',
            'ended_at' => 'nullable|date|after_or_equal:started_at',
            'confidence' => 'nullable|integer|min:0|max:100',
            'metadata' => 'nullable|array',
        ]);

        $validated['user_id'] = $request->user()->id;

        if (($validated['activity_kind'] ?? null) === 'website') {
            validator($validated, [
                'source' => 'required|in:browser_extension',
                'tool_type' => 'required|in:website',
                'url' => 'required|string|max:2048|url',
            ])->validate();
        }

        if (!empty($validated['time_entry_id'])) {
            $timeEntryBelongsToUser = TimeEntry::whereKey($validated['time_entry_id'])
                ->where('user_id', $validated['user_id'])
                ->exists();

            if (!$timeEntryBelongsToUser) {
                return response()->json(['message' => 'Selected time entry is invalid for this user.'], 422);
            }
        }

        $startedAt = Carbon::parse((string) $validated['started_at']);
        $endedAt = array_key_exists('ended_at', $validated) && $validated['ended_at']
            ? Carbon::parse((string) $validated['ended_at'])
            : null;

        $this->closeConflictingOpenSessions(
            userId: (int) $validated['user_id'],
            source: (string) $validated['source'],
            startedAt: $startedAt,
        );

        $classification = $this->classifySessionPayload($validated + ['user_id' => $validated['user_id']]);

        $session = ActivitySession::create([
            'user_id' => $validated['user_id'],
            'time_entry_id' => $validated['time_entry_id'] ?? null,
            'source' => $validated['source'],
            'activity_kind' => $validated['activity_kind'],
            'tool_type' => $validated['tool_type'],
            'display_name' => $validated['display_name'],
            'app_name' => $validated['app_name'] ?? null,
            'window_title' => $validated['window_title'] ?? null,
            'url' => $validated['url'] ?? null,
            'started_at' => $startedAt,
            'ended_at' => $endedAt,
            'duration_seconds' => $endedAt ? $this->resolveWholeSeconds($startedAt, $endedAt) : 0,
            'confidence' => $validated['confidence'] ?? 100,
            'metadata' => $validated['metadata'] ?? null,
        ] + $classification);

        return response()->json($session, 201);
    }

    public function update(Request $request, ActivitySession $activitySession)
    {
        $requestUser = $request->user();
        if (!$requestUser || $activitySession->user_id !== $requestUser->id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $validated = $request->validate([
            'ended_at' => 'required|date|after_or_equal:'.$activitySession->started_at->toIso8601String(),
            'confidence' => 'nullable|integer|min:0|max:100',
            'metadata' => 'nullable|array',
        ]);

        $endedAt = Carbon::parse((string) $validated['ended_at']);
        $activitySession->update([
            'ended_at' => $endedAt,
            'duration_seconds' => $this->resolveWholeSeconds($activitySession->started_at, $endedAt),
            'confidence' => $validated['confidence'] ?? $activitySession->confidence,
            'metadata' => array_key_exists('metadata', $validated) ? $validated['metadata'] : $activitySession->metadata,
        ]);

        return response()->json($activitySession->fresh());
    }

    private function classifySessionPayload(array $payload): array
    {
        $classification = $this->productivityClassifier->classifyContext([
            'activity_type' => ($payload['tool_type'] ?? null) === 'website' ? 'url' : 'app',
            'raw_name' => (string) ($payload['display_name'] ?? ''),
            'window_title' => (string) ($payload['window_title'] ?? $payload['display_name'] ?? ''),
            'app_name' => (string) ($payload['app_name'] ?? $payload['display_name'] ?? ''),
            'url' => (string) ($payload['url'] ?? ''),
            'user_id' => (int) ($payload['user_id'] ?? 0),
        ]);

        return [
            'normalized_label' => $classification['normalized_label'] ?? null,
            'normalized_domain' => $classification['normalized_domain'] ?? null,
            'software_name' => $classification['software_name'] ?? null,
            'classification' => $classification['classification'] ?? null,
            'classification_reason' => $classification['classification_reason'] ?? null,
        ];
    }

    private function closeConflictingOpenSessions(int $userId, string $source, Carbon $startedAt): void
    {
        ActivitySession::query()
            ->where('user_id', $userId)
            ->where('source', $source)
            ->whereNull('ended_at')
            ->where('started_at', '<=', $startedAt)
            ->orderBy('started_at')
            ->get()
            ->each(function (ActivitySession $session) use ($startedAt) {
                $resolvedEndedAt = $startedAt->greaterThan($session->started_at)
                    ? $startedAt->copy()
                    : $session->started_at->copy();

                $session->update([
                    'ended_at' => $resolvedEndedAt,
                    'duration_seconds' => $this->resolveWholeSeconds($session->started_at, $resolvedEndedAt),
                ]);
            });
    }
}
