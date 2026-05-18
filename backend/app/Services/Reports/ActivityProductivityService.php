<?php

namespace App\Services\Reports;

use App\Services\Monitoring\ProductivityClassifier;

class ActivityProductivityService
{
    private const SYSTEM_UTILITY_CLASSIFICATION = 'neutral';

    public function __construct(
        private readonly ActivityDurationNormalizer $activityDurationNormalizer,
        private readonly ProductivityClassifier $productivityClassifier,
    ) {
    }

    private const BROWSER_TITLE_PATTERNS = [
        '/^(google chrome|chrome|microsoft edge|edge|mozilla firefox|firefox|brave|opera|vivaldi)\s*-\s*/iu',
        '/\s*-\s*(google chrome|chrome|microsoft edge|edge|mozilla firefox|firefox|brave|opera|vivaldi)$/iu',
    ];

    private const KNOWN_SITE_LABELS = [
        'instagram.com' => ['instagram'],
        'youtube.com' => ['youtube', 'youtu.be'],
        'netflix.com' => ['netflix'],
        'spotify.com' => ['spotify'],
        'facebook.com' => ['facebook', 'fb.com'],
        'x.com' => ['x.com', 'twitter'],
        'reddit.com' => ['reddit'],
        'tiktok.com' => ['tiktok'],
        'discord.com' => ['discord'],
        'web.whatsapp.com' => ['web.whatsapp', 'whatsapp', 'wa.me'],
        'twitch.tv' => ['twitch'],
        'pinterest.com' => ['pinterest'],
        'telegram.org' => ['telegram'],
        'primevideo.com' => ['primevideo'],
        'hotstar.com' => ['hotstar'],
        'cricbuzz.com' => ['cricbuzz'],
        'espncricinfo.com' => ['espncricinfo'],
        'github.com' => ['github'],
        'gitlab.com' => ['gitlab'],
        'bitbucket.org' => ['bitbucket'],
        'stackoverflow.com' => ['stackoverflow'],
        'figma.com' => ['figma'],
        'miro.com' => ['miro'],
        'canva.com' => ['canva'],
        'trello.com' => ['trello'],
        'asana.com' => ['asana'],
        'linear.app' => ['linear'],
        'clickup.com' => ['clickup'],
        'developer.mozilla.org' => ['developer.mozilla'],
        'learn.microsoft.com' => ['learn.microsoft'],
        'chat.openai.com' => ['chat.openai', 'chatgpt'],
        'claude.ai' => ['claude.ai'],
        'gemini.google' => ['gemini.google'],
        'snapchat.com' => ['snapchat'],
        '9gag.com' => ['9gag'],
    ];

    public function guessToolType(string $activityType): string
    {
        $type = strtolower(trim($activityType));

        return $type === 'url' ? 'website' : 'software';
    }

    public function normalizeToolLabel(string $name, string $activityType): string
    {
        $trimmed = trim($name);

        if ($trimmed === '') {
            return $this->guessToolType($activityType) === 'website' ? 'unknown-site' : 'unknown-app';
        }

        if (strtolower(trim($activityType)) === 'url') {
            if (filter_var($trimmed, FILTER_VALIDATE_URL)) {
                $host = (string) parse_url($trimmed, PHP_URL_HOST);
                if ($host !== '') {
                    return strtolower((string) preg_replace('/^www\./', '', $host));
                }
            }

            if (preg_match('/([a-z0-9-]+\.)+[a-z]{2,}/i', $trimmed, $matches)) {
                return strtolower((string) preg_replace('/^www\./', '', $matches[0]));
            }

            $cleanedTitle = $this->cleanBrowserWindowTitle($trimmed);
            $knownSiteLabel = $this->resolveKnownSiteLabel($cleanedTitle);

            if ($knownSiteLabel !== '') {
                return $knownSiteLabel;
            }

            return mb_substr($cleanedTitle !== '' ? $cleanedTitle : 'browser', 0, 120);
        }

        // Keep full app/window string so classifier can match terms like "YouTube" in "Chrome - YouTube".
        return mb_substr($trimmed, 0, 120);
    }

    public function classifyProductivity(string $toolLabel, string $activityType): string
    {
        $result = $this->productivityClassifier->classifyContext([
            'raw_name' => $toolLabel,
            'activity_type' => $activityType,
        ]);

        return (string) ($result['classification'] ?? 'neutral');
    }

    public function buildToolBreakdown(iterable $activities): array
    {
        $rows = [];

        foreach ($this->collapseLogicalActivities($activities) as $activity) {
            $duration = max(0, (int) ($activity->duration ?? 0));
            if ($duration <= 0) {
                continue;
            }

            $label = (string) ($activity->normalized_label ?? $this->normalizeToolLabel((string) ($activity->name ?? ''), (string) ($activity->type ?? 'app')));
            $classification = (string) ($activity->classification ?? $this->classifyProductivity($label, (string) ($activity->type ?? 'app')));
            $type = (string) ($activity->tool_type ?? $this->guessToolType((string) ($activity->type ?? 'app')));

            if ($this->isSystemUtilitySoftwareLabel($label, $type)) {
                $classification = self::SYSTEM_UTILITY_CLASSIFICATION;
            }

            $key = strtolower($classification.'|'.$type.'|'.$label);

            if (! isset($rows[$key])) {
                $rows[$key] = [
                    'label' => $label,
                    'type' => $type,
                    'classification' => $classification,
                    'total_duration' => 0,
                    'total_events' => 0,
                ];
            }

            $rows[$key]['total_duration'] += $duration;
            $rows[$key]['total_events'] += 1;
        }

        $grouped = collect(array_values($rows))->sortByDesc('total_duration')->values();

        return [
            'productive' => $grouped->where('classification', 'productive')->values(),
            'unproductive' => $grouped->where('classification', 'unproductive')->values(),
            'neutral' => $grouped->where('classification', 'neutral')->values(),
            'context_dependent' => $grouped->where('classification', 'context_dependent')->values(),
        ];
    }

    public function collapseLogicalActivities(iterable $activities): \Illuminate\Support\Collection
    {
        return $this->activityDurationNormalizer->collapse(
            $activities,
            function ($activity) {
                $type = strtolower(trim((string) data_get($activity, 'type', 'app')));
                $userId = (int) data_get($activity, 'user_id', 0);
                $timeEntryId = (int) data_get($activity, 'time_entry_id', 0);

                if ($type === 'idle') {
                    return implode('|', [$userId, $timeEntryId, 'idle']);
                }

                return implode('|', [
                    $userId,
                    $timeEntryId,
                    $type,
                    strtolower($this->normalizeToolLabel(
                        (string) data_get($activity, 'name', ''),
                        $type
                    )),
                ]);
            }
        )->map(fn (array $row) => (object) $row);
    }

    private function cleanBrowserWindowTitle(string $title): string
    {
        $value = trim(preg_replace('/^\(\d+\)\s*/u', '', $title) ?? $title);

        if ($value === '') {
            return '';
        }

        for ($attempt = 0; $attempt < 3; $attempt++) {
            $previous = $value;

            foreach (self::BROWSER_TITLE_PATTERNS as $pattern) {
                $value = trim((string) preg_replace($pattern, '', $value));
            }

            if ($value === $previous) {
                break;
            }
        }

        return trim((string) preg_replace('/\s+/u', ' ', $value));
    }

    private function resolveKnownSiteLabel(string $value): string
    {
        $normalized = strtolower(trim($value));

        if ($normalized === '') {
            return '';
        }

        foreach (self::KNOWN_SITE_LABELS as $label => $keywords) {
            foreach ($keywords as $keyword) {
                if (str_contains($normalized, $keyword)) {
                    return $label;
                }
            }
        }

        return '';
    }

    private function isSystemUtilitySoftwareLabel(string $label, string $toolType): bool
    {
        if (strtolower(trim($toolType)) !== 'software') {
            return false;
        }

        $normalizedLabel = strtolower(trim($label));
        if ($normalizedLabel === '') {
            return false;
        }

        $utilityLabels = collect((array) config('productivity_monitoring.system_utility_software_labels', []))
            ->map(fn ($value) => strtolower(trim((string) $value)))
            ->filter()
            ->values();

        return $utilityLabels->contains($normalizedLabel);
    }
}
