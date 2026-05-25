<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activity;
use App\Models\ActivitySession;
use App\Models\ProductivityClassification;
use App\Models\User;
use App\Services\Monitoring\ProductivityClassifier;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class ProductivityClassificationController extends Controller
{
    public function __construct(
        private readonly ProductivityClassifier $classifier,
    ) {
    }

    public function history(Request $request): JsonResponse
    {
        $user = $request->user();
        $organizationId = (int) ($user->organization_id ?? 0);
        if ($organizationId <= 0) {
            return response()->json(['data' => [], 'meta' => ['total' => 0, 'classifications' => []]]);
        }

        $search = trim((string) $request->input('search', ''));
        $classificationFilter = trim((string) $request->input('classification', ''));
        $targetTypeFilter = trim((string) $request->input('target_type', ''));
        $days = max(1, min(365, (int) $request->input('days', 7)));
        $page = max(1, (int) $request->input('page', 1));
        $perPage = max(10, min(100, (int) $request->input('per_page', 25)));

        $since = Carbon::now()->subDays($days);

        $scopedUserIds = User::query()
            ->where('organization_id', $organizationId)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->values();

        if ($scopedUserIds->isEmpty()) {
            return response()->json(['data' => [], 'meta' => ['total' => 0, 'classifications' => []]]);
        }

        $adminOverrides = ProductivityClassification::where('organization_id', $organizationId)->get()
            ->keyBy(fn ($r) => $r->target_type . ':' . mb_strtolower($r->target_value));

        $browserApps = collect((array) config('productivity_monitoring.browser_apps', []))
            ->map(fn ($v) => mb_strtolower(trim($v)))
            ->values();

        $domainItems = collect();
        $appItems = collect();

        // Collect unique domains and app names from activities table
        if (Schema::hasTable('activities')) {
            $activityQuery = DB::table('activities')
                ->selectRaw("COALESCE(normalized_domain, '') as domain, COALESCE(software_name, '') as app_name, COALESCE(normalized_label, '') as label, COUNT(DISTINCT user_id) as user_count, SUM(duration) as total_duration, MAX(recorded_at) as last_seen")
                ->whereIn('user_id', $scopedUserIds)
                ->where('recorded_at', '>=', $since)
                ->where(function ($q) {
                    $q->whereNotNull('normalized_domain')->where('normalized_domain', '!=', '')
                      ->orWhereNotNull('software_name')->where('software_name', '!=', '');
                })
                ->groupBy(DB::raw('COALESCE(normalized_domain, \'\')'), DB::raw('COALESCE(software_name, \'\')'), DB::raw('COALESCE(normalized_label, \'\')'));

            if ($search !== '') {
                $activityQuery->where(function ($q) use ($search) {
                    $q->where('normalized_domain', 'like', "%{$search}%")
                      ->orWhere('software_name', 'like', "%{$search}%")
                      ->orWhere('normalized_label', 'like', "%{$search}%");
                });
            }

            $activityResults = $activityQuery->get();

            foreach ($activityResults as $row) {
                if ($row->domain) {
                    $domainItems->push([
                        'key' => 'domain:' . $row->domain,
                        'target_type' => 'domain',
                        'target_value' => $row->domain,
                        'display_label' => $row->label ?: $row->domain,
                        'user_count' => (int) $row->user_count,
                        'total_duration' => (int) $row->total_duration,
                        'last_seen' => $row->last_seen,
                    ]);
                }
                if ($row->app_name) {
                    $lowerApp = mb_strtolower(trim($row->app_name));
                    if ($browserApps->contains($lowerApp)) {
                        continue;
                    }
                    $appItems->push([
                        'key' => 'app:' . $row->app_name,
                        'target_type' => 'app',
                        'target_value' => $row->app_name,
                        'display_label' => $row->label ?: $row->app_name,
                        'user_count' => (int) $row->user_count,
                        'total_duration' => (int) $row->total_duration,
                        'last_seen' => $row->last_seen,
                    ]);
                }
            }
        }

        // Also collect from activity_sessions table
        if (Schema::hasTable('activity_sessions')) {
            $sessionQuery = DB::table('activity_sessions')
                ->selectRaw("COALESCE(normalized_domain, '') as domain, COALESCE(software_name, '') as app_name, COALESCE(normalized_label, '') as label, COALESCE(display_name, '') as display, COUNT(DISTINCT user_id) as user_count, SUM(duration_seconds) as total_duration, MAX(started_at) as last_seen")
                ->whereIn('user_id', $scopedUserIds)
                ->where('started_at', '>=', $since)
                ->where(function ($q) {
                    $q->whereNotNull('normalized_domain')->where('normalized_domain', '!=', '')
                      ->orWhereNotNull('software_name')->where('software_name', '!=', '');
                })
                ->groupBy(DB::raw('COALESCE(normalized_domain, \'\')'), DB::raw('COALESCE(software_name, \'\')'), DB::raw('COALESCE(normalized_label, \'\')'), DB::raw('COALESCE(display_name, \'\')'));

            if ($search !== '') {
                $sessionQuery->where(function ($q) use ($search) {
                    $q->where('normalized_domain', 'like', "%{$search}%")
                      ->orWhere('software_name', 'like', "%{$search}%")
                      ->orWhere('normalized_label', 'like', "%{$search}%")
                      ->orWhere('display_name', 'like', "%{$search}%");
                });
            }

            $sessionResults = $sessionQuery->get();

            foreach ($sessionResults as $row) {
                if ($row->domain) {
                    $existing = $domainItems->firstWhere('key', 'domain:' . $row->domain);
                    if ($existing) {
                        $existing['user_count'] += (int) $row->user_count;
                        $existing['total_duration'] += (int) $row->total_duration;
                        if ($row->last_seen && $row->last_seen > $existing['last_seen']) {
                            $existing['last_seen'] = $row->last_seen;
                        }
                    } else {
                        $domainItems->push([
                            'key' => 'domain:' . $row->domain,
                            'target_type' => 'domain',
                            'target_value' => $row->domain,
                            'display_label' => $row->display ?: $row->label ?: $row->domain,
                            'user_count' => (int) $row->user_count,
                            'total_duration' => (int) $row->total_duration,
                            'last_seen' => $row->last_seen,
                        ]);
                    }
                }
                if ($row->app_name) {
                    $lowerApp = mb_strtolower(trim($row->app_name));
                    if ($browserApps->contains($lowerApp)) {
                        continue;
                    }
                    $existing = $appItems->firstWhere('key', 'app:' . $row->app_name);
                    if ($existing) {
                        $existing['user_count'] += (int) $row->user_count;
                        $existing['total_duration'] += (int) $row->total_duration;
                        if ($row->last_seen && $row->last_seen > $existing['last_seen']) {
                            $existing['last_seen'] = $row->last_seen;
                        }
                    } else {
                        $appItems->push([
                            'key' => 'app:' . $row->app_name,
                            'target_type' => 'app',
                            'target_value' => $row->app_name,
                            'display_label' => $row->label ?: $row->display ?: $row->app_name,
                            'user_count' => (int) $row->user_count,
                            'total_duration' => (int) $row->total_duration,
                            'last_seen' => $row->last_seen,
                        ]);
                    }
                }
            }
        }

        // Merge domain and app items, compute classification
        $allItems = $domainItems->merge($appItems)
            ->groupBy('key')
            ->map(function ($group) use ($adminOverrides, $browserApps) {
                $first = $group->first();
                $first['user_count'] = $group->sum('user_count');
                $first['total_duration'] = $group->sum('total_duration');
                $first['last_seen'] = $group->max('last_seen');

                $targetType = $first['target_type'];
                $targetValue = mb_strtolower($first['target_value']);

                // Check admin override
                $overrideKey = $targetType . ':' . $targetValue;
                if ($adminOverrides->has($overrideKey)) {
                    $override = $adminOverrides->get($overrideKey);
                    $first['current_classification'] = $override->classification;
                    $first['override_classification'] = $override->classification;
                    $first['override_id'] = $override->id;
                } else {
                    // Check browser inheritance: if this is a domain and the browser app is overridden
                    $inheritedClassification = null;
                    if ($targetType === 'domain') {
                        foreach ($browserApps as $browserName) {
                            $browserKey = 'app:' . $browserName;
                            if ($adminOverrides->has($browserKey)) {
                                $inheritedClassification = $adminOverrides->get($browserKey)->classification;
                                break;
                            }
                        }
                    }
                    $first['current_classification'] = $inheritedClassification ?? 'neutral';
                    $first['override_classification'] = null;
                    $first['override_id'] = null;
                }

                return $first;
            })
            ->values();

        // Filter by classification
        if ($classificationFilter !== '' && in_array($classificationFilter, ['productive', 'unproductive', 'neutral'])) {
            $allItems = $allItems->filter(fn ($item) => $item['current_classification'] === $classificationFilter);
        }

        // Filter by target type
        if ($targetTypeFilter !== '' && in_array($targetTypeFilter, ['domain', 'app'])) {
            $allItems = $allItems->filter(fn ($item) => $item['target_type'] === $targetTypeFilter);
        }

        // Count classifications
        $classificationCounts = [
            'productive' => $allItems->where('current_classification', 'productive')->count(),
            'unproductive' => $allItems->where('current_classification', 'unproductive')->count(),
            'neutral' => $allItems->where('current_classification', 'neutral')->count(),
        ];

        $total = $allItems->count();
        $allItems = $allItems->sortByDesc('last_seen')->values();

        // Paginate
        $totalPages = max(1, (int) ceil($total / $perPage));
        $offset = ($page - 1) * $perPage;
        $paginated = $allItems->slice($offset, $perPage)->values()->map(function ($item) {
            return [
                'id' => $item['override_id'] ?? $item['key'],
                'target_type' => $item['target_type'],
                'target_value' => $item['target_value'],
                'display_label' => $item['display_label'],
                'current_classification' => $item['current_classification'],
                'override_classification' => $item['override_classification'],
                'override_id' => $item['override_id'],
                'user_count' => $item['user_count'],
                'total_duration_seconds' => $item['total_duration'],
                'last_seen_at' => $item['last_seen'],
            ];
        });

        return response()->json([
            'data' => $paginated,
            'meta' => [
                'total' => $total,
                'page' => $page,
                'per_page' => $perPage,
                'total_pages' => $totalPages,
                'classifications' => $classificationCounts,
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $organizationId = (int) ($user->organization_id ?? 0);
        if ($organizationId <= 0) {
            return response()->json(['message' => 'No organization found'], 400);
        }

        $validated = $request->validate([
            'target_type' => 'required|in:domain,app',
            'target_value' => 'required|string|max:255',
            'classification' => 'required|in:productive,unproductive,neutral',
        ]);

        $lowerValue = mb_strtolower(trim($validated['target_value']));
        if ($lowerValue === '') {
            return response()->json(['message' => 'Target value cannot be empty'], 400);
        }

        $existing = ProductivityClassification::where('organization_id', $organizationId)
            ->where('target_type', $validated['target_type'])
            ->where('target_value', $lowerValue)
            ->first();

        if ($existing) {
            $existing->update([
                'classification' => $validated['classification'],
            ]);
            $classification = $existing;
        } else {
            $classification = ProductivityClassification::create([
                'organization_id' => $organizationId,
                'target_type' => $validated['target_type'],
                'target_value' => $lowerValue,
                'classification' => $validated['classification'],
                'created_by' => $user->id,
            ]);
        }

        $this->reclassifyMatching($organizationId, $validated['target_type'], $lowerValue);

        return response()->json(['data' => $classification], 201);
    }

    public function update(Request $request, ProductivityClassification $classification): JsonResponse
    {
        $user = $request->user();
        if ((int) $classification->organization_id !== (int) ($user->organization_id ?? 0)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $validated = $request->validate([
            'classification' => 'required|in:productive,unproductive,neutral',
        ]);

        $classification->update([
            'classification' => $validated['classification'],
        ]);

        $this->reclassifyMatching((int) $user->organization_id, $classification->target_type, $classification->target_value);

        return response()->json(['data' => $classification]);
    }

    public function destroy(Request $request, ProductivityClassification $classification): JsonResponse
    {
        $user = $request->user();
        if ((int) $classification->organization_id !== (int) ($user->organization_id ?? 0)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $targetType = $classification->target_type;
        $targetValue = $classification->target_value;
        $organizationId = (int) $classification->organization_id;

        $classification->delete();

        $this->reclassifyMatching($organizationId, $targetType, $targetValue);

        return response()->json(['message' => 'Classification override removed']);
    }

    public function batchUpdate(Request $request): JsonResponse
    {
        $user = $request->user();
        $organizationId = (int) ($user->organization_id ?? 0);
        if ($organizationId <= 0) {
            return response()->json(['message' => 'No organization found'], 400);
        }

        $validated = $request->validate([
            'classification' => 'required|in:productive,unproductive,neutral',
            'items' => 'required|array|min:1|max:100',
            'items.*.target_type' => 'required|in:domain,app',
            'items.*.target_value' => 'required|string|max:255',
        ]);

        $count = 0;
        foreach ($validated['items'] as $item) {
            $lowerValue = mb_strtolower(trim($item['target_value']));
            if ($lowerValue === '') {
                continue;
            }

            $existing = ProductivityClassification::where('organization_id', $organizationId)
                ->where('target_type', $item['target_type'])
                ->where('target_value', $lowerValue)
                ->first();

            if ($existing) {
                $existing->update(['classification' => $validated['classification']]);
            } else {
                ProductivityClassification::create([
                    'organization_id' => $organizationId,
                    'target_type' => $item['target_type'],
                    'target_value' => $lowerValue,
                    'classification' => $validated['classification'],
                    'created_by' => $user->id,
                ]);
            }

            $this->reclassifyMatching($organizationId, $item['target_type'], $lowerValue);
            $count++;
        }

        return response()->json(['message' => "{$count} classification(s) updated"]);
    }

    private function reclassifyMatching(int $organizationId, string $targetType, string $targetValue): void
    {
        $scopedUserIds = User::query()
            ->where('organization_id', $organizationId)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->values();

        if ($scopedUserIds->isEmpty()) {
            return;
        }

        $column = $targetType === 'domain' ? 'normalized_domain' : 'software_name';
        $lowerValue = mb_strtolower(trim($targetValue));

        Log::info('Reclassify starting: org=' . $organizationId . ' type=' . $targetType . ' value=' . $lowerValue . ' userCount=' . $scopedUserIds->count());

        // Reclassify matching activities — search by ALL relevant text fields
        $parts = explode('.', $lowerValue);
        $mainPart = $parts[0] ?? '';
        $activityQuery = Activity::query()
            ->whereIn('user_id', $scopedUserIds)
            ->with('user.groups:id')
            ->where(function ($q) use ($column, $lowerValue, $mainPart) {
                $q->whereRaw('LOWER(' . $column . ') = ?', [$lowerValue])
                  ->orWhereRaw('LOWER(name) LIKE ?', ['%' . $mainPart . '%'])
                  ->orWhereRaw('LOWER(window_title) LIKE ?', ['%' . $mainPart . '%'])
                  ->orWhereRaw('LOWER(url) LIKE ?', ['%' . $mainPart . '%'])
                  ->orWhereRaw('LOWER(app_name) LIKE ?', ['%' . $mainPart . '%']);
            });

        $activityCount = $activityQuery->count();
        Log::info('Reclassify: matching ' . $activityCount . ' activities');

        $activityQuery->chunkById(200, function ($activities) {
            foreach ($activities as $activity) {
                try {
                    $oldClass = $activity->classification;
                    $this->classifier->stampActivity($activity);
                    $activity->saveQuietly();
                    Log::info('Reclassify: activity #' . $activity->id . ' (' . $activity->name . '): ' . ($oldClass ?? 'null') . ' -> ' . ($activity->classification ?? 'null'));
                } catch (\Throwable $e) {
                    Log::error('Reclassify failed for activity #' . $activity->id . ': ' . $e->getMessage());
                }
            }
        });

        // Reclassify matching activity sessions
        $parts = explode('.', $lowerValue);
        $mainPart = $parts[0] ?? '';
        $sessionQuery = ActivitySession::query()
            ->whereIn('user_id', $scopedUserIds)
            ->with('user.groups:id')
            ->where(function ($q) use ($column, $lowerValue, $mainPart) {
                $q->whereRaw('LOWER(' . $column . ') = ?', [$lowerValue])
                  ->orWhere(function ($sub) use ($mainPart) {
                      $sub->whereRaw('LOWER(display_name) LIKE ?', ['%' . $mainPart . '%'])
                            ->orWhereRaw('LOWER(window_title) LIKE ?', ['%' . $mainPart . '%'])
                            ->orWhereRaw('LOWER(url) LIKE ?', ['%' . $mainPart . '%']);
                  });
            });

        $sessionQuery->chunkById(200, function ($sessions) {
            foreach ($sessions as $session) {
                try {
                    $oldClass = $session->classification;
                    $groupIds = $session->user
                        ? $session->user->groups->pluck('id')->map(fn ($id) => (int) $id)->values()->all()
                        : [];
                    $context = [
                        'activity_type' => $session->activity_kind ?? 'app',
                        'raw_name' => $session->display_name ?? '',
                        'window_title' => $session->window_title ?? '',
                        'app_name' => $session->app_name ?? '',
                        'url' => $session->url ?? '',
                        'user_id' => $session->user_id,
                        'organization_id' => $session->user?->organization_id ?? 0,
                        'group_ids' => $groupIds,
                    ];
                    $classification = $this->classifier->classifyContext($context);
                    $session->tool_type = $classification['tool_type'];
                    $session->normalized_label = $classification['normalized_label'];
                    $session->normalized_domain = $classification['normalized_domain'];
                    $session->software_name = $classification['software_name'];
                    $session->classification = $classification['classification'];
                    $session->classification_reason = $classification['classification_reason'];
                    $session->saveQuietly();
                    Log::info('Reclassify: session #' . $session->id . ' (' . $session->display_name . '): ' . ($oldClass ?? 'null') . ' -> ' . ($session->classification ?? 'null'));
                } catch (\Throwable $e) {
                    Log::error('Reclassify failed for session #' . $session->id . ': ' . $e->getMessage());
                }
            }
        });
    }
}
