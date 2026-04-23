<?php

namespace App\Services\Monitoring;

use App\Models\Activity;
use App\Models\ProductivityRule;
use App\Models\User;
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

        $rule = $this->resolveMatchingRule($normalized, $context);
        if ($rule) {
            return $this->buildResult(
                $normalized,
                (string) $rule->classification,
                (string) ($rule->reason ?: 'Matched configured productivity rule.'),
                $rule
            );
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

    private function resolveMatchingRule(array $normalized, array $context): ?ProductivityRule
    {
        $organizationId = (int) ($context['organization_id'] ?? 0);
        $userId = (int) ($context['user_id'] ?? 0);
        $groupIds = collect((array) ($context['group_ids'] ?? []))
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->values();

        $rules = Schema::hasTable('productivity_rules')
            ? ProductivityRule::query()
                ->where('is_active', true)
                ->when(
                    $organizationId > 0,
                    fn ($query) => $query->where(function ($inner) use ($organizationId) {
                        $inner->whereNull('organization_id')
                            ->orWhere('organization_id', $organizationId);
                    }),
                    fn ($query) => $query->whereNull('organization_id')
                )
                ->get()
            : collect();

        $scopeBuckets = [
            ['scope_type' => 'workspace', 'scope_ids' => [$organizationId]],
            ['scope_type' => 'group', 'scope_ids' => $groupIds->all()],
            ['scope_type' => 'user', 'scope_ids' => [$userId]],
            ['scope_type' => 'global', 'scope_ids' => [null]],
        ];

        foreach ($scopeBuckets as $bucket) {
            $bucketRules = $rules
                ->filter(function (ProductivityRule $rule) use ($bucket) {
                    if ($rule->scope_type !== $bucket['scope_type']) {
                        return false;
                    }

                    if ($rule->scope_type === 'global') {
                        return true;
                    }

                    return in_array((int) $rule->scope_id, array_map('intval', $bucket['scope_ids']), true);
                })
                ->sort(function (ProductivityRule $left, ProductivityRule $right) use ($bucket) {
                    $leftExactRank = $bucket['scope_type'] === 'global' && $left->match_mode === 'exact' ? 0 : 1;
                    $rightExactRank = $bucket['scope_type'] === 'global' && $right->match_mode === 'exact' ? 0 : 1;

                    return [$leftExactRank, -1 * (int) $left->priority, (int) $left->id]
                        <=> [$rightExactRank, -1 * (int) $right->priority, (int) $right->id];
                })
                ->values();

            foreach ($bucketRules as $rule) {
                if ($this->ruleMatches($rule, $normalized, $context)) {
                    return $rule;
                }
            }
        }

        return $this->matchDefaultRule($normalized, $context);
    }

    private function matchDefaultRule(array $normalized, array $context): ?ProductivityRule
    {
        $defaults = collect((array) config('productivity_monitoring.default_rules', []))
            ->map(function (array $rule, int $index) {
                $model = new ProductivityRule();
                $model->forceFill([
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
                ]);

                return $model;
            })
            ->sort(function (ProductivityRule $left, ProductivityRule $right) {
                $leftExactRank = $left->match_mode === 'exact' ? 0 : 1;
                $rightExactRank = $right->match_mode === 'exact' ? 0 : 1;

                return [$leftExactRank, -1 * (int) $left->priority, (int) $left->id]
                    <=> [$rightExactRank, -1 * (int) $right->priority, (int) $right->id];
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

    private function ruleMatches(ProductivityRule $rule, array $normalized, array $context): bool
    {
        $haystack = match ($rule->target_type) {
            'app' => (string) ($normalized['software_name'] ?? ''),
            'domain' => (string) ($normalized['normalized_domain'] ?? ''),
            'title_pattern' => mb_strtolower((string) ($normalized['clean_window_title'] ?? '')),
            'url_pattern' => mb_strtolower((string) ($context['url'] ?? $context['raw_name'] ?? '')),
            default => '',
        };

        $needle = mb_strtolower(trim((string) $rule->target_value));
        if ($haystack === '' || $needle === '') {
            return false;
        }

        return match ($rule->match_mode) {
            'exact' => $haystack === $needle,
            'contains' => str_contains($haystack, $needle),
            'starts_with' => str_starts_with($haystack, $needle),
            'ends_with' => str_ends_with($haystack, $needle),
            'regex' => @preg_match($rule->target_value, $haystack) === 1,
            default => false,
        };
    }

    private function buildResult(array $normalized, string $classification, string $reason, ?ProductivityRule $rule): array
    {
        return [
            'normalized_label' => $normalized['normalized_label'] ?? null,
            'normalized_domain' => $normalized['normalized_domain'] ?? null,
            'software_name' => $normalized['software_name'] ?? null,
            'tool_type' => $normalized['tool_type'] ?? null,
            'classification' => $classification,
            'classification_reason' => $reason,
            'matched_rule' => $rule ? [
                'id' => (int) $rule->id,
                'name' => $rule->name,
                'target_type' => $rule->target_type,
                'match_mode' => $rule->match_mode,
                'target_value' => $rule->target_value,
                'scope_type' => $rule->scope_type,
                'scope_id' => $rule->scope_id,
                'priority' => (int) $rule->priority,
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
}
