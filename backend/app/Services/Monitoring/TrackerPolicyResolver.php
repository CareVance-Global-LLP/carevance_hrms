<?php

namespace App\Services\Monitoring;

use App\Models\Organization;
use App\Models\User;

/**
 * The single authority for how the desktop tracker is allowed to behave.
 *
 * Tracker policy used to be scattered: idle thresholds lived in the client's
 * own env vars AND in config/time_tracking.php with nothing reconciling them,
 * the capture interval lived in MonitoringSettingsResolver, and retention and
 * privacy rules did not exist anywhere. A client whose idle threshold drifted
 * below the server's would propose stops the server rejected until it burned
 * its retry cap; a client above it left the cron as the real rule.
 *
 * Everything resolves the same way — per-user override, then organization
 * default, then system config — and ships to the client in the auth payload,
 * so policy changes deploy without rebuilding the desktop app.
 */
class TrackerPolicyResolver
{
    /**
     * Idle bounds. The floors are not style: below them the tracker stops
     * timers faster than a person can read a paragraph.
     */
    private const MIN_IDLE_TRACK_SECONDS = 60;
    private const MIN_IDLE_AUTO_STOP_SECONDS = 300;
    private const MAX_IDLE_SECONDS = 3600;

    /**
     * What happens to an idle span when someone comes back.
     *
     * PROMPT is the default and the fail-safe: an absent, unknown or malformed
     * value resolves to it rather than to either automatic answer. Silently
     * discarding someone's time because a setting was misspelled is not a
     * failure mode worth risking, and silently keeping it is how a tracker
     * stops being trusted.
     */
    public const IDLE_POLICY_PROMPT = 'prompt';
    public const IDLE_POLICY_ALWAYS_KEEP = 'always_keep';
    public const IDLE_POLICY_NEVER_KEEP = 'never_keep';

    private const IDLE_POLICIES = [
        self::IDLE_POLICY_PROMPT,
        self::IDLE_POLICY_ALWAYS_KEEP,
        self::IDLE_POLICY_NEVER_KEEP,
    ];

    private const MIN_RETENTION_DAYS = 7;
    private const MAX_RETENTION_DAYS = 730;

    public function __construct(
        private readonly MonitoringSettingsResolver $monitoringSettings,
    ) {
    }

    /**
     * The whole policy for one user, in the shape the client consumes.
     *
     * @return array<string, mixed>
     */
    public function resolveForUser(?User $user): array
    {
        $settings = is_array($user?->settings) ? $user->settings : [];
        $orgSettings = $this->orgSettings($user);

        $idleTrack = $this->resolveSeconds(
            $settings['idle_track_threshold_seconds'] ?? null,
            $orgSettings['idle_track_threshold_seconds'] ?? null,
            (int) config('time_tracking.idle_track_threshold_seconds', 180),
            self::MIN_IDLE_TRACK_SECONDS,
        );

        $idleAutoStop = $this->resolveSeconds(
            $settings['idle_auto_stop_threshold_seconds'] ?? null,
            $orgSettings['idle_auto_stop_threshold_seconds'] ?? null,
            (int) config('time_tracking.idle_auto_stop_threshold_seconds', 300),
            self::MIN_IDLE_AUTO_STOP_SECONDS,
        );

        // Auto-stop can never sit below the point where idle is first recorded:
        // the tracker would stop a timer before it had written the idle span
        // that justifies the stop.
        $idleAutoStop = max($idleAutoStop, $idleTrack);

        return [
            'idle_track_threshold_seconds' => $idleTrack,
            'idle_auto_stop_threshold_seconds' => $idleAutoStop,
            'lock_auto_stop_threshold_seconds' => $this->resolveSeconds(
                $settings['lock_auto_stop_threshold_seconds'] ?? null,
                $orgSettings['lock_auto_stop_threshold_seconds'] ?? null,
                (int) config('time_tracking.lock_auto_stop_threshold_seconds', 300),
                self::MIN_IDLE_TRACK_SECONDS,
            ),
            'capture_interval_minutes' => $this->monitoringSettings->resolveForUser($user),
            'idle_resolution_policy' => $this->idleResolutionPolicy($settings, $orgSettings),
            'screenshot_retention_days' => $this->retentionDays($orgSettings),
            'privacy' => $this->privacy($orgSettings),
            'can_view_own_activity' => $this->employeeActivityVisible($orgSettings),
            // Deletion is meaningless without visibility, and allowing it while
            // the gallery is hidden would let someone destroy records they were
            // never shown. It can only ever be a narrowing of self-view.
            'can_delete_own_screenshots' => $this->employeeActivityVisible($orgSettings)
                && $this->employeeDeleteEnabled($orgSettings),
        ];
    }

    /**
     * May an employee see their own screenshots and idle log?
     *
     * Off unless the organization turns it on. Each customer decides whether
     * the people being tracked get sight of their own record.
     */
    public function employeeActivityVisibleForOrganization(?Organization $organization): bool
    {
        $settings = is_array($organization?->settings) ? $organization->settings : [];

        return $this->employeeActivityVisible($settings);
    }

    /** @param array<string, mixed> $orgSettings */
    private function employeeActivityVisible(array $orgSettings): bool
    {
        return filter_var(
            $orgSettings['employee_activity_visible'] ?? false,
            FILTER_VALIDATE_BOOL
        );
    }

    /**
     * May an employee delete their own screenshots?
     *
     * Off unless the organization turns it on. Enabling it by default would
     * give every existing customer a way to erase tracked time that nobody
     * asked for; making it opt-in means the decision is recorded as a
     * deliberate one.
     */
    public function employeeDeleteEnabledForOrganization(?Organization $organization): bool
    {
        $settings = is_array($organization?->settings) ? $organization->settings : [];

        return $this->employeeDeleteEnabled($settings);
    }

    /** @param array<string, mixed> $orgSettings */
    private function employeeDeleteEnabled(array $orgSettings): bool
    {
        return filter_var(
            $orgSettings['screenshot_employee_delete'] ?? false,
            FILTER_VALIDATE_BOOL
        );
    }

    /**
     * How long screenshots survive for this organization.
     *
     * Nothing used to delete them at all, which is both an unbounded storage
     * bill and the easiest finding for a data-protection review to write up.
     */
    public function retentionDaysForOrganization(?Organization $organization): int
    {
        $settings = is_array($organization?->settings) ? $organization->settings : [];

        return $this->retentionDays($settings);
    }

    /**
     * Apps whose screenshots must never be captured, for one organization.
     *
     * @return array<string, mixed>
     */
    public function privacyForOrganization(?Organization $organization): array
    {
        $settings = is_array($organization?->settings) ? $organization->settings : [];

        return $this->privacy($settings);
    }

    /** @param array<string, mixed> $orgSettings */
    /**
     * Per-user override, else the organization's, else prompt.
     *
     * Same chain as every other tracker setting. Anything not in the allow-list
     * falls through to the next level rather than short-circuiting, so a junk
     * per-user value cannot bypass what the organization chose.
     *
     * @param array<string, mixed> $settings
     * @param array<string, mixed> $orgSettings
     */
    public function idleResolutionPolicy(array $settings, array $orgSettings): string
    {
        foreach ([$settings['idle_resolution_policy'] ?? null, $orgSettings['idle_resolution_policy'] ?? null] as $candidate) {
            if (is_string($candidate) && in_array($candidate, self::IDLE_POLICIES, true)) {
                return $candidate;
            }
        }

        return self::IDLE_POLICY_PROMPT;
    }

    /**
     * The policy for a user, read straight off the models. For callers that
     * hold a User but not its resolved policy array.
     */
    public function idleResolutionPolicyForUser(?User $user): string
    {
        return $this->idleResolutionPolicy(
            is_array($user?->settings) ? $user->settings : [],
            $this->orgSettings($user)
        );
    }

    private function retentionDays(array $orgSettings): int
    {
        $configured = $orgSettings['screenshot_retention_days']
            ?? config('screenshots.retention.default_days', 90);

        $days = (int) $configured;
        if ($days <= 0) {
            $days = (int) config('screenshots.retention.default_days', 90);
        }

        return max(self::MIN_RETENTION_DAYS, min(self::MAX_RETENTION_DAYS, $days));
    }

    /**
     * Capture-time privacy rules.
     *
     * A screenshot is a full-resolution picture of whatever happens to be on
     * screen — a password manager, personal banking, someone else's medical
     * leave request. Skipping capture while a blocklisted app is in the
     * foreground is the cheapest data-minimisation measure available, and it
     * is the one a DPDP notice can actually point at.
     *
     * @param array<string, mixed> $orgSettings
     * @return array<string, mixed>
     */
    private function privacy(array $orgSettings): array
    {
        $configuredApps = $orgSettings['screenshot_blocked_apps']
            ?? config('screenshots.privacy.blocked_apps', []);

        $blockedApps = collect(is_array($configuredApps) ? $configuredApps : [])
            ->map(fn ($app) => trim(mb_strtolower((string) $app)))
            ->filter()
            ->unique()
            ->values()
            ->all();

        return [
            'blocked_apps' => $blockedApps,
            'skip_on_private_browsing' => (bool) ($orgSettings['screenshot_skip_private_browsing']
                ?? config('screenshots.privacy.skip_on_private_browsing', true)),
        ];
    }

    /** @return array<string, mixed> */
    private function orgSettings(?User $user): array
    {
        $settings = $user?->organization?->settings;

        return is_array($settings) ? $settings : [];
    }

    /**
     * user override -> organization default -> system config, with anything
     * outside the sane band discarded rather than clamped silently at the
     * wrong level.
     */
    private function resolveSeconds(mixed $userValue, mixed $orgValue, int $systemDefault, int $floor): int
    {
        foreach ([$userValue, $orgValue] as $candidate) {
            $seconds = $this->sanitizeSeconds($candidate, $floor);
            if ($seconds !== null) {
                return $seconds;
            }
        }

        return $this->sanitizeSeconds($systemDefault, $floor)
            ?? max($floor, $systemDefault);
    }

    private function sanitizeSeconds(mixed $value, int $floor): ?int
    {
        if ($value === null || $value === '' || !is_numeric($value)) {
            return null;
        }

        $seconds = (int) $value;
        if ($seconds < $floor || $seconds > self::MAX_IDLE_SECONDS) {
            return null;
        }

        return $seconds;
    }
}
