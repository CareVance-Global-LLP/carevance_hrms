<?php

namespace App\Services\Monitoring;

class ActivityContextNormalizer
{
    private const INVALID_DOMAIN_SUFFIXES = [
        'php', 'js', 'jsx', 'ts', 'tsx', 'json', 'env', 'md', 'txt', 'log', 'sql',
        'yml', 'yaml', 'xml', 'scss', 'css', 'py', 'java', 'kt', 'c', 'cpp', 'h',
        'hpp', 'sh', 'ps1', 'bat', 'lock',
    ];

    public function normalize(
        ?string $rawName,
        ?string $activityType = 'app',
        ?string $windowTitle = null,
        ?string $appName = null,
        ?string $url = null,
    ): array {
        $type = strtolower(trim((string) $activityType));
        $rawName = trim((string) $rawName);
        $windowTitle = trim((string) $windowTitle);
        $appName = trim((string) $appName);
        $url = trim((string) $url);

        if ($type === 'idle') {
            return [
                'normalized_label' => 'idle',
                'normalized_domain' => null,
                'software_name' => null,
                'tool_type' => 'idle',
                'clean_window_title' => $this->cleanBrowserWindowTitle($windowTitle !== '' ? $windowTitle : $rawName),
                'raw_name' => $rawName,
                'activity_type' => 'idle',
                'is_browser_context' => false,
            ];
        }

        $cleanWindowTitle = $this->cleanBrowserWindowTitle($windowTitle !== '' ? $windowTitle : $rawName);
        $resolvedAppName = $appName !== '' ? $appName : $rawName;
        $normalizedApp = $this->normalizeAppName($resolvedAppName);
        $domain = $url !== '' ? $this->extractDomain($url) : null;

        if ($domain === null && $type === 'url') {
            $domain = $this->extractDomain($rawName) ?? $this->extractDomain($cleanWindowTitle);
        }

        $browserContext = $type === 'url' || ($domain !== null && $domain !== '');
        $softwareName = $normalizedApp ?: null;
        $normalizedLabel = $domain
            ?: ($softwareName ?: ($cleanWindowTitle !== '' ? mb_strtolower($cleanWindowTitle) : null));

        return [
            'normalized_label' => $normalizedLabel ?: ($type === 'url' ? 'unknown-site' : 'unknown-app'),
            'normalized_domain' => $domain,
            'software_name' => $softwareName,
            'tool_type' => $browserContext ? 'website' : 'software',
            'clean_window_title' => $cleanWindowTitle,
            'raw_name' => $rawName,
            'activity_type' => $type !== '' ? $type : 'app',
            'is_browser_context' => $browserContext || $this->isBrowserApp($normalizedApp ?: $resolvedAppName),
        ];
    }

    public function cleanBrowserWindowTitle(?string $title): string
    {
        $value = trim((string) preg_replace('/^\(\d+\)\s*/u', '', (string) $title));
        if ($value === '') {
            return '';
        }

        foreach ((array) config('productivity_monitoring.browser_title_patterns', []) as $pattern) {
            $value = trim((string) preg_replace((string) $pattern, '', $value));
        }

        return trim((string) preg_replace('/\s+/u', ' ', $value));
    }

    public function extractDomain(?string $value): ?string
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        try {
            $candidate = str_contains($value, '://') ? $value : 'https://'.$value;
            $host = (string) parse_url($candidate, PHP_URL_HOST);
            $normalizedHost = $this->normalizeDomain($host);
            if ($normalizedHost && $this->looksLikeDomain($normalizedHost) && ! $this->looksLikeFileReference($normalizedHost)) {
                return $normalizedHost;
            }
        } catch (\Throwable) {
        }

        if (preg_match('/([a-z0-9-]+\.)+[a-z]{2,}/iu', $value, $matches)) {
            $candidate = $this->normalizeDomain($matches[0]);
            if ($candidate && ! $this->looksLikeFileReference($candidate)) {
                return $candidate;
            }
        }

        $normalizedValue = mb_strtolower($this->cleanBrowserWindowTitle($value));
        foreach ((array) config('productivity_monitoring.default_rules', []) as $rule) {
            if (($rule['target_type'] ?? null) !== 'domain') {
                continue;
            }

            $candidateDomain = $this->normalizeDomain((string) ($rule['target_value'] ?? ''));
            if (! $candidateDomain) {
                continue;
            }

            $domainParts = array_values(array_filter(explode('.', $candidateDomain)));
            $keywords = array_unique(array_filter(array_merge(
                [$candidateDomain],
                array_filter($domainParts, fn ($part) => ! in_array($part, ['com', 'org', 'net', 'io', 'ai', 'tv', 'app', 'google'], true) && mb_strlen($part) >= 3)
            )));

            foreach ($keywords as $keyword) {
                if ($keyword !== '' && str_contains($normalizedValue, (string) $keyword)) {
                    return $candidateDomain;
                }
            }
        }

        return null;
    }

    public function normalizeDomain(?string $domain): ?string
    {
        $domain = strtolower(trim((string) $domain));
        if ($domain === '') {
            return null;
        }

        return preg_replace('/^www\./', '', $domain) ?: null;
    }

    public function normalizeAppName(?string $name): ?string
    {
        $normalized = mb_strtolower(trim((string) $name));
        if ($normalized === '') {
            return null;
        }

        $normalized = trim((string) preg_replace('/\s+/u', ' ', $normalized));
        foreach ((array) config('productivity_monitoring.app_aliases', []) as $canonical => $aliases) {
            foreach ((array) $aliases as $alias) {
                if ($normalized === $alias || str_contains($normalized, (string) $alias)) {
                    return $canonical;
                }
            }
        }

        return $normalized;
    }

    public function isBrowserApp(?string $name): bool
    {
        $normalized = mb_strtolower(trim((string) $name));
        if ($normalized === '') {
            return false;
        }

        foreach ((array) config('productivity_monitoring.browser_apps', []) as $browserApp) {
            if ($normalized === $browserApp || str_contains($normalized, (string) $browserApp)) {
                return true;
            }
        }

        return false;
    }

    private function looksLikeDomain(string $value): bool
    {
        if (in_array($value, ['localhost', '127.0.0.1'], true)) {
            return true;
        }

        return (bool) preg_match('/^[a-z0-9-]+(\.[a-z0-9-]+)+$/iu', $value);
    }

    private function looksLikeFileReference(string $value): bool
    {
        $segments = array_values(array_filter(explode('.', mb_strtolower(trim($value)))));
        if (count($segments) < 2) {
            return false;
        }

        return in_array((string) end($segments), self::INVALID_DOMAIN_SUFFIXES, true);
    }
}
