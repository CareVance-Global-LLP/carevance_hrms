<?php

namespace App\Jobs;

use App\Models\Activity;
use App\Models\ActivitySession;
use App\Models\User;
use App\Services\Monitoring\ProductivityClassifier;
use App\Support\TenantContext;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ReclassifyProductivityJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 600;

    public function __construct(
        public int $organizationId,
        public string $targetType,
        public string $targetValue,
    ) {}

    public function handle(ProductivityClassifier $classifier): void
    {
        $scopedUserIds = User::query()
            ->where('organization_id', $this->organizationId)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->values();

        if ($scopedUserIds->isEmpty()) {
            return;
        }

        $column = $this->targetType === 'domain' ? 'normalized_domain' : 'software_name';
        $lowerValue = mb_strtolower(trim($this->targetValue));

        Log::info('Reclassify job: org=' . $this->organizationId . ' type=' . $this->targetType . ' value=' . $lowerValue . ' userCount=' . $scopedUserIds->count());

        $parts = explode('.', $lowerValue);
        $mainPart = $parts[0] ?? '';

        // Both queries below also pin to the organization explicitly via
        // forOrganization() rather than relying on the trait's ambient scope,
        // for the same reason the TenantContext pin below exists: a queued
        // job runs with no user authenticated by default, which makes
        // BelongsToOrganization's scope a deliberate no-op so console work
        // isn't silently filtered to nothing — and in a long-running queue
        // worker that default cuts the other way too, letting the ambient
        // Auth::user() left over from a PREVIOUS job steer this query onto
        // the wrong tenant.
        //
        // That covers Activity and ActivitySession, but not everything these
        // queries reach. Both chunk callbacks call into the classifier
        // (stampActivity()/classifyContext()), which resolves an admin's
        // override through ProductivityClassifier::overridesFor() —
        // ProductivityClassification::query()->where('organization_id', ...),
        // ALSO BelongsToOrganization-scoped. Its explicit where and the
        // model's own ambient scope both have to agree, and forOrganization()
        // on the two queries above does nothing for that: the ambient scope
        // there still reads whatever Auth::user() happens to be. In the
        // worker-reuse scenario — a previous job left a DIFFERENT
        // organization's user ambient — the explicit and ambient predicates
        // stop overlapping, the override lookup finds nothing, and every row
        // gets re-stamped with the default heuristic instead of the
        // administrator's override: the inverse of what this job exists to
        // do, since it only runs because an admin set one.
        //
        // TenantContext::pin() is checked FIRST in
        // BelongsToOrganization::currentOrganizationId(), ahead of Auth, so
        // one pin for the job's whole duration covers Activity,
        // ActivitySession AND ProductivityClassification consistently,
        // regardless of whatever the ambient Auth::user() is. clear() runs in
        // `finally` so a throw here can never leak the pin into the next job
        // on a reused worker — that leak would be the same class of bug this
        // fixes.
        TenantContext::pin($this->organizationId);

        try {
            Activity::forOrganization($this->organizationId)
                ->whereIn('user_id', $scopedUserIds)
                ->with('user.groups:id')
                ->where(function ($q) use ($column, $lowerValue, $mainPart) {
                    $q->whereRaw('LOWER(' . $column . ') = ?', [$lowerValue])
                      ->orWhereRaw('LOWER(name) LIKE ?', ['%' . $mainPart . '%'])
                      ->orWhereRaw('LOWER(window_title) LIKE ?', ['%' . $mainPart . '%'])
                      ->orWhereRaw('LOWER(url) LIKE ?', ['%' . $mainPart . '%'])
                      ->orWhereRaw('LOWER(app_name) LIKE ?', ['%' . $mainPart . '%']);
                })
                ->chunkById(200, function ($activities) use ($classifier) {
                    foreach ($activities as $activity) {
                        try {
                            $classifier->stampActivity($activity);
                            $activity->saveQuietly();
                        } catch (\Throwable $e) {
                            Log::error('Reclassify job failed for activity #' . $activity->id . ': ' . $e->getMessage());
                        }
                    }
                });

            ActivitySession::forOrganization($this->organizationId)
                ->whereIn('user_id', $scopedUserIds)
                ->with('user.groups:id')
                ->where(function ($q) use ($column, $lowerValue, $mainPart) {
                    $q->whereRaw('LOWER(' . $column . ') = ?', [$lowerValue])
                      ->orWhere(function ($sub) use ($mainPart) {
                          $sub->whereRaw('LOWER(display_name) LIKE ?', ['%' . $mainPart . '%'])
                                ->orWhereRaw('LOWER(window_title) LIKE ?', ['%' . $mainPart . '%'])
                                ->orWhereRaw('LOWER(url) LIKE ?', ['%' . $mainPart . '%']);
                      });
                })
                ->chunkById(200, function ($sessions) use ($classifier) {
                    foreach ($sessions as $session) {
                        try {
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
                            $classification = $classifier->classifyContext($context);
                            $session->tool_type = $classification['tool_type'];
                            $session->normalized_label = $classification['normalized_label'];
                            $session->normalized_domain = $classification['normalized_domain'];
                            $session->software_name = $classification['software_name'];
                            $session->classification = $classification['classification'];
                            $session->classification_reason = $classification['classification_reason'];
                            $session->saveQuietly();
                        } catch (\Throwable $e) {
                            Log::error('Reclassify job failed for session #' . $session->id . ': ' . $e->getMessage());
                        }
                    }
                });
        } finally {
            TenantContext::clear();
        }
    }
}

