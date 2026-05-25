<?php

namespace App\Services\Monitoring;

use App\Models\Activity;
use App\Models\ProductivityClassification;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class ProductivityClassifier
{
    public function __construct(
        private readonly ActivityContextNormalizer $normalizer,
    ) {
    }

    public function classifyActivity(Activity|array $activity, ?User $user = null): array
    {
        $activityData = $activity instanceof Activity ? $activity->toArray() : $activity;
        $resolvedUser = $user;

        if (! $resolvedUser) {
            $userId = (int) data_get($activityData, 'user_id', 0);
            if ($userId > 0 && Schema::hasTable('users')) {
                $resolvedUser = User::query()->with('groups:id')->find($userId);
            }
        }

        return $this->classifyContext([
            'activity_type' => (string) data_get($activityData, 'type', 'app'),
            'raw_name' => (string) data_get($activityData, 'name', ''),
            'window_title' => (string) data_get($activityData, 'window_title', data_get($activityData, 'name', '')),
            'app_name' => (string) data_get($activityData, 'app_name', data_get($activityData, 'name', '')),
            'url' => (string) data_get($activityData, 'url', ''),
            'user_id' => (int) data_get($activityData, 'user_id', 0),
            'organization_id' => (int) ($resolvedUser?->organization_id ?? data_get($activityData, 'organization_id', 0)),
            'group_ids' => $resolvedUser
                ? $resolvedUser->groups->pluck('id')->map(fn ($id) => (int) $id)->values()->all()
                : [],
        ]);
    }

    public function classifyContext(array $context): array
    {
        $normalized = $this->normalizer->normalize(
            (string) ($context['raw_name'] ?? ''),
            (string) ($context['activity_type'] ?? 'app'),
            (string) ($context['window_title'] ?? ''),
            (string) ($context['app_name'] ?? ''),
            (string) ($context['url'] ?? ''),
        );

        if (($normalized['activity_type'] ?? 'app') === 'idle') {
            return $this->buildResult($normalized, 'neutral', 'Idle time is never marked productive.', null);
        }

        if ($this->isSystemUtilitySoftware($normalized)) {
            return $this->buildResult(
                $normalized,
                'neutral',
                'System utility process is excluded from productivity scoring.',
                null
            );
        }

        $override = $this->resolveAdminOverride($normalized, $context);
        if ($override) {
            return $this->buildResult($normalized, $override['classification'], $override['reason'], $override);
        }

        $defaultRule = $this->matchDefaultRule($normalized, $context);
        if ($defaultRule) {
            return $this->buildResult($normalized, $defaultRule['classification'], $defaultRule['reason'] ?: 'Matched configured productivity rule.', $defaultRule);
        }

        if (($normalized['tool_type'] ?? null) === 'website' && ! ($normalized['normalized_domain'] ?? null)) {
            $keywordRule = $this->matchKeywordFallbackRule($normalized, $context, 'website');
            if ($keywordRule) {
                return $this->buildKeywordResult($normalized, $keywordRule);
            }

            return $this->buildResult(
                $normalized,
                (string) config('productivity_monitoring.fallback_classification.browser_without_context', 'context_dependent'),
                'Browser activity without a reliable domain stays context-dependent until configured.',
                null
            );
        }

        $keywordRule = $this->matchKeywordFallbackRule($normalized, $context);
        if ($keywordRule) {
            return $this->buildKeywordResult($normalized, $keywordRule);
        }

        return $this->buildResult(
            $normalized,
            (string) config('productivity_monitoring.fallback_classification.unknown', 'neutral'),
            'No rule matched, so the activity stays non-productive by default.',
            null
        );
    }

    public function stampActivity(Activity $activity): void
    {
        $classification = $this->classifyActivity($activity, $activity->relationLoaded('user') ? $activity->user : null);

        $activity->normalized_label = $classification['normalized_label'];
        $activity->normalized_domain = $classification['normalized_domain'];
        $activity->software_name = $classification['software_name'];
        $activity->tool_type = $classification['tool_type'];
        $activity->classification = $classification['classification'];
        $activity->classification_reason = $classification['classification_reason'];
        $activity->classified_at = now();
        $activity->classifier_version = $classification['classifier_version'];
    }

    private function resolveAdminOverride(array $normalized, array $context): ?array
    {
        $organizationId = (int) ($context['organization_id'] ?? 0);
        if ($organizationId <= 0) {
            $user = Auth::user();
            if ($user) {
                $organizationId = (int) ($user->organization_id ?? 0);
            }
        }
        if ($organizationId <= 0 || ! Schema::hasTable('productivity_classifications')) {
            return null;
        }

        $domain = (string) ($normalized['normalized_domain'] ?? '');
        $softwareName = (string) ($normalized['software_name'] ?? '');
        $isWebsite = ($normalized['tool_type'] ?? null) === 'website';

        if ($domain !== '') {
            $override = ProductivityClassification::where('organization_id', $organizationId)
                ->where('target_type', 'domain')
                ->where('target_value', mb_strtolower($domain))
                ->first();

            if ($override) {
                Log::info('Classifier: domain direct match for ' . $domain . ' -> ' . $override->classification);
                return $this->formatOverrideRule($override, "Admin domain override: {$domain} is classified as {$override->classification}");
            }

            Log::info('Classifier: no domain override found for ' . $domain . ' (org=' . $organizationId . ')');
        }

        // When no explicit domain was extracted but activity is browser-based, match
        // admin domain overrides by checking if the override's name appears in the title
        if ($domain === '' && $isWebsite) {
            $rawName = mb_strtolower(trim((string) ($context['raw_name'] ?? '')));
            $windowTitle = mb_strtolower(trim((string) ($context['window_title'] ?? '')));
            $haystack = $rawName . ' ' . $windowTitle;

            if ($haystack !== '') {
                $domainOverrides = ProductivityClassification::where('organization_id', $organizationId)
                    ->where('target_type', 'domain')
                    ->get();

                foreach ($domainOverrides as $override) {
                    $parts = explode('.', mb_strtolower(trim($override->target_value)));
                    $mainName = $parts[0] ?? '';
                    if ($mainName !== '' && str_contains($haystack, $mainName)) {
                        return $this->formatOverrideRule($override, "Admin domain override: {$override->target_value} matched via title keyword");
                    }
                }
            }
        }

        if ($softwareName !== '') {
            $override = ProductivityClassification::where('organization_id', $organizationId)
                ->where('target_type', 'app')
                ->where('target_value', mb_strtolower($softwareName))
                ->first();

            if ($override) {
                $browserApps = collect((array) config('productivity_monitoring.browser_apps', []))
                    ->map(fn ($v) => mb_strtolower(trim($v)))
                    ->values();

                $isBrowser = $browserApps->contains(mb_strtolower($softwareName));

                if ($isWebsite && $isBrowser) {
                    return $this->formatOverrideRule($override, "Browser rule: {$softwareName} is classified as {$override->classification}, inherited by all URLs");
                }

                return $this->formatOverrideRule($override, "Admin app override: {$softwareName} is classified as {$override->classification}");
            }

            // When software_name doesn't match, check if any app override's target_value
            // appears in the activity name/title/URL (handles sessions where software_name
            // is the browser name but the override is for the actual site name)
            $rawName = mb_strtolower(trim((string) ($context['raw_name'] ?? '')));
            $windowTitle = mb_strtolower(trim((string) ($context['window_title'] ?? '')));
            $url = mb_strtolower(trim((string) ($context['url'] ?? '')));
            $appHaystack = $rawName . ' ' . $windowTitle . ' ' . $url;

            if ($appHaystack !== '') {
                $appOverrides = ProductivityClassification::where('organization_id', $organizationId)
                    ->where('target_type', 'app')
                    ->get();

                foreach ($appOverrides as $appOverride) {
                    $overrideValue = mb_strtolower(trim($appOverride->target_value));
                    if ($overrideValue !== '' && str_contains($appHaystack, $overrideValue)) {
                        return $this->formatOverrideRule($appOverride, "Admin app override: {$appOverride->target_value} matched via title/URL keyword");
                    }
                }
            }

            if ($isWebsite && $domain !== '') {
                $browserApps = collect((array) config('productivity_monitoring.browser_apps', []))
                    ->map(fn ($v) => mb_strtolower(trim($v)))
                    ->values();

                $isBrowser = $browserApps->contains(mb_strtolower($softwareName));

                if ($isBrowser) {
                    $browserOverride = ProductivityClassification::where('organization_id', $organizationId)
                        ->where('target_type', 'app')
                        ->whereIn('target_value', $browserApps->toArray())
                        ->first();

                    if ($browserOverride) {
                        return $this->formatOverrideRule($browserOverride, "Browser rule: {$browserOverride->target_value} is classified as {$browserOverride->classification}, inherited by all URLs");
                    }
                }
            }
        }

        return null;
    }

    private function formatOverrideRule(ProductivityClassification $override, string $reason): array
    {
        return [
            'id' => $override->id,
            'name' => $override->target_value,
            'target_type' => $override->target_type,
            'match_mode' => 'contains',
            'target_value' => $override->target_value,
            'scope_type' => 'global',
            'scope_id' => null,
            'priority' => 999,
            'classification' => $override->classification,
            'reason' => $reason,
        ];
    }

    private function matchDefaultRule(array $normalized, array $context): ?array
    {
        $defaults = collect((array) config('productivity_monitoring.default_rules', []))
            ->map(function (array $rule, int $index) {
                return [
                    'id' => -1 * ($index + 1),
                    'organization_id' => null,
                    'name' => $rule['name'] ?? null,
                    'target_type' => $rule['target_type'],
                    'match_mode' => $rule['match_mode'],
                    'target_value' => $rule['target_value'],
                    'classification' => $rule['classification'],
                    'priority' => $rule['priority'] ?? 100,
                    'scope_type' => 'global',
                    'scope_id' => null,
                    'is_active' => true,
                    'reason' => $rule['reason'] ?? null,
                    'notes' => 'Default seeded fallback rule',
                ];
            })
            ->sort(function (array $left, array $right) {
                $leftExactRank = $left['match_mode'] === 'exact' ? 0 : 1;
                $rightExactRank = $right['match_mode'] === 'exact' ? 0 : 1;

                return [$leftExactRank, -1 * (int) $left['priority'], (int) $left['id']]
                    <=> [$rightExactRank, -1 * (int) $right['priority'], (int) $right['id']];
            })
            ->values();

        foreach ($defaults as $rule) {
            if ($this->ruleMatches($rule, $normalized, $context)) {
                return $rule;
            }
        }

        return null;
    }

    private function matchKeywordFallbackRule(array $normalized, array $context, ?string $toolType = null): ?array
    {
        $resolvedToolType = $toolType ?: (string) ($normalized['tool_type'] ?? '');
        $haystacks = collect([
            (string) ($context['raw_name'] ?? ''),
            (string) ($context['window_title'] ?? ''),
            (string) ($context['app_name'] ?? ''),
            (string) ($context['url'] ?? ''),
            (string) ($normalized['normalized_domain'] ?? ''),
            (string) ($normalized['normalized_label'] ?? ''),
            (string) ($normalized['clean_window_title'] ?? ''),
            (string) ($normalized['software_name'] ?? ''),
        ])
            ->map(fn ($value) => mb_strtolower(trim($value)))
            ->filter()
            ->values();

        if ($haystacks->isEmpty()) {
            return null;
        }

        foreach ((array) config('productivity_monitoring.keyword_fallback_rules', []) as $rule) {
            if (($rule['tool_type'] ?? null) !== $resolvedToolType) {
                continue;
            }

            $keywords = collect((array) ($rule['keywords'] ?? []))
                ->map(fn ($keyword) => mb_strtolower(trim((string) $keyword)))
                ->filter()
                ->values();

            if ($keywords->isEmpty()) {
                continue;
            }

            foreach ($haystacks as $haystack) {
                foreach ($keywords as $keyword) {
                    if ($keyword !== '' && str_contains($haystack, $keyword)) {
                        return $rule;
                    }
                }
            }
        }

        return null;
    }

    private function ruleMatches(array $rule, array $normalized, array $context): bool
    {
        $haystack = match ($rule['target_type']) {
            'app' => (string) ($normalized['software_name'] ?? ''),
            'domain' => (string) ($normalized['normalized_domain'] ?? ''),
            'title_pattern' => mb_strtolower((string) ($normalized['clean_window_title'] ?? '')),
            'url_pattern' => mb_strtolower((string) ($context['url'] ?? $context['raw_name'] ?? '')),
            default => '',
        };

        $needle = mb_strtolower(trim((string) ($rule['target_value'] ?? '')));
        if ($haystack === '' || $needle === '') {
            return false;
        }

        return match ($rule['match_mode']) {
            'exact' => $haystack === $needle,
            'contains' => str_contains($haystack, $needle),
            'starts_with' => str_starts_with($haystack, $needle),
            'ends_with' => str_ends_with($haystack, $needle),
            'regex' => @preg_match((string) $rule['target_value'], $haystack) === 1,
            default => false,
        };
    }

    private function buildResult(array $normalized, string $classification, string $reason, ?array $rule): array
    {
        return [
            'normalized_label' => $normalized['normalized_label'] ?? null,
            'normalized_domain' => $normalized['normalized_domain'] ?? null,
            'software_name' => $normalized['software_name'] ?? null,
            'tool_type' => $normalized['tool_type'] ?? null,
            'classification' => $classification,
            'classification_reason' => $reason,
            'matched_rule' => $rule ? [
                'id' => (int) ($rule['id'] ?? 0),
                'name' => $rule['name'] ?? null,
                'target_type' => $rule['target_type'] ?? null,
                'match_mode' => $rule['match_mode'] ?? null,
                'target_value' => $rule['target_value'] ?? null,
                'scope_type' => $rule['scope_type'] ?? null,
                'scope_id' => $rule['scope_id'] ?? null,
                'priority' => (int) ($rule['priority'] ?? 0),
            ] : null,
            'classifier_version' => (string) config('productivity_monitoring.classifier_version'),
        ];
    }

    private function buildKeywordResult(array $normalized, array $rule): array
    {
        return [
            'normalized_label' => $normalized['normalized_label'] ?? null,
            'normalized_domain' => $normalized['normalized_domain'] ?? null,
            'software_name' => $normalized['software_name'] ?? null,
            'tool_type' => $normalized['tool_type'] ?? null,
            'classification' => (string) ($rule['classification'] ?? config('productivity_monitoring.fallback_classification.unknown', 'neutral')),
            'classification_reason' => (string) ($rule['reason'] ?? 'Matched configured keyword fallback rule.'),
            'matched_rule' => [
                'id' => null,
                'name' => (string) ($rule['label'] ?? 'Keyword fallback'),
                'target_type' => 'keyword_fallback',
                'match_mode' => 'contains',
                'target_value' => implode(', ', (array) ($rule['keywords'] ?? [])),
                'scope_type' => 'global',
                'scope_id' => null,
                'priority' => (int) ($rule['priority'] ?? 120),
            ],
            'classifier_version' => (string) config('productivity_monitoring.classifier_version'),
        ];
    }

    private function isSystemUtilitySoftware(array $normalized): bool
    {
        if (($normalized['tool_type'] ?? null) !== 'software') {
            return false;
        }

        $labels = collect((array) config('productivity_monitoring.system_utility_software_labels', []))
            ->map(fn ($label) => mb_strtolower(trim((string) $label)))
            ->filter()
            ->values();

        if ($labels->isEmpty()) {
            return false;
        }

        $softwareName = mb_strtolower(trim((string) ($normalized['software_name'] ?? '')));
        if ($softwareName === '') {
            return false;
        }

        return $labels->contains($softwareName);
    }
}
