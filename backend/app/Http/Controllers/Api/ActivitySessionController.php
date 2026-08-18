<?php

namespace App\Http\Controllers\Api;

use App\Support\CapturedUrl;
use App\Http\Controllers\Controller;
use App\Models\ActivitySession;
use App\Models\TimeEntry;
use App\Support\ExternalTimestamp;
use App\Services\Monitoring\ProductivityClassifier;
use App\Services\Monitoring\TrackerPolicyResolver;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class ActivitySessionController extends Controller
{
    public function __construct(
        private readonly ProductivityClassifier $productivityClassifier,
        private readonly TrackerPolicyResolver $trackerPolicyResolver,
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
            // Sent by the desktop tracker when replaying its offline queue.
            'local_id' => 'nullable|string|max:120',
            'device_id' => 'nullable|string|max:120',
        ]);

        $validated['user_id'] = $request->user()->id;

        // A replayed session must resolve to the row it already created. This
        // runs before closeConflictingOpenSessions() below, which would
        // otherwise treat the retry as a new session overlapping the original
        // and close the very row it is a duplicate of.
        if (!empty($validated['local_id']) && !empty($validated['device_id'])) {
            $existingSession = ActivitySession::query()
                ->where('local_id', $validated['local_id'])
                ->where('device_id', $validated['device_id'])
                ->first();

            if ($existingSession) {
                return response()->json($existingSession, 200);
            }
        }

        /*
         * A website session must carry a real URL, and the desktop agent is the
         * only thing that writes one.
         *
         * This used to pin the source to `browser_extension`, from when the
         * extension was the only thing that could know a URL. The desktop agent
         * reads URLs itself now and the extension was removed on 14 Aug 2026,
         * having never written a single session in the life of the database.
         *
         * The URL requirement is the part that matters and stays exactly as
         * strict: a website row with no address names nothing.
         */
        $urlDetailLevel = $this->trackerPolicyResolver->urlDetailLevelForUser($request->user());

        /*
         * With addresses switched off, a browser visit is recorded as the
         * application it happened in rather than as a website with no address.
         * Storing a website row whose URL is null would contradict the rule
         * below — and read in a report as a visit nobody can identify.
         */
        if ($urlDetailLevel === TrackerPolicyResolver::URL_DETAIL_OFF
            && ($validated['activity_kind'] ?? null) === 'website') {
            $validated['activity_kind'] = 'desktop_app';
            $validated['tool_type'] = 'software';
            $validated['url'] = null;
        }

        if (($validated['activity_kind'] ?? null) === 'website') {
            validator($validated, [
                'source' => 'required|in:desktop',
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

        $startedAt = ExternalTimestamp::parseToAppTimezone($validated['started_at']);
        $endedAt = array_key_exists('ended_at', $validated) && $validated['ended_at']
            ? ExternalTimestamp::parseToAppTimezone($validated['ended_at'])
            : null;

        $this->closeConflictingOpenSessions(
            userId: (int) $validated['user_id'],
            source: (string) $validated['source'],
            startedAt: $startedAt,
        );

        $classification = $this->classifySessionPayload($validated + ['user_id' => $validated['user_id']]);

        $attributes = [
            'user_id' => $validated['user_id'],
            'time_entry_id' => $validated['time_entry_id'] ?? null,
            'local_id' => $validated['local_id'] ?? null,
            'device_id' => $validated['device_id'] ?? null,
            'source' => $validated['source'],
            'activity_kind' => $validated['activity_kind'],
            'tool_type' => $validated['tool_type'],
            'display_name' => $validated['display_name'],
            'app_name' => $validated['app_name'] ?? null,
            'window_title' => $validated['window_title'] ?? null,
            // Sanitised here as well as on the desktop: an older build or a
            // replayed offline queue can still post a raw URL, and a query
            // string reaching this column is a credential in a report.
            'url' => CapturedUrl::sanitize($validated['url'] ?? null, $urlDetailLevel),
            'started_at' => $startedAt,
            'ended_at' => $endedAt,
            'duration_seconds' => $endedAt ? $this->resolveWholeSeconds($startedAt, $endedAt) : 0,
            'confidence' => $validated['confidence'] ?? 100,
            'metadata' => $validated['metadata'] ?? null,
        ] + $classification;

        try {
            $session = ActivitySession::create($attributes);
        } catch (\Illuminate\Database\QueryException $e) {
            // Concurrent replays of the same queued record: the unique index
            // decides, and losing that race means the row is already stored.
            $session = !empty($validated['local_id']) && !empty($validated['device_id'])
                ? ActivitySession::query()
                    ->where('local_id', $validated['local_id'])
                    ->where('device_id', $validated['device_id'])
                    ->first()
                : null;

            if (!$session) {
                throw $e;
            }

            return response()->json($session, 200);
        }

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

        $endedAt = ExternalTimestamp::parseToAppTimezone($validated['ended_at']);
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
