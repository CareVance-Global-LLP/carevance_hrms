<?php

namespace App\Services\Monitoring;

use App\Models\Organization;
use App\Models\User;

/**
 * Single source of truth for the screenshot capture interval.
 *
 * The default used to disagree in seven places — 3 in the desktop client, 10 in
 * UserController, InvitationService, the invite-normalising migration, and three
 * admin UIs — so a user whose settings were never normalised was screenshotted
 * three times more often than any admin screen claimed.
 *
 * Resolution order is: a valid per-user override, else the organization default,
 * else the system default. Note that an INVALID value at one level falls through
 * to the next rather than short-circuiting to the system default; otherwise a
 * junk per-user value would silently bypass the org's policy.
 *
 * Absence of the per-user key is what "inherit from organization" means.
 */
class MonitoringSettingsResolver
{
    /** @var array<int, int|null> Memo of org id => org default, so list endpoints don't re-query per row. */
    private array $orgDefaultMemo = [];

    /*
     * Both of these read config and rebuild an array on every call, and
     * sanitize() calls allowedIntervals() every time it runs. That is invisible
     * for a single user and expensive in bulk: User appends
     * `effective_monitoring_interval_minutes`, so serialising a list endpoint
     * resolves it once per row — the task list alone spent ~270 ms of its 400 ms
     * inside these two methods for 450 assignees. Config cannot change inside a
     * request, so both answers are computed once.
     *
     * @var list<int>|null
     */
    private ?array $allowedIntervalsMemo = null;

    private ?int $systemDefaultMemo = null;

    /** @return array<int, int> */
    public function allowedIntervals(): array
    {
        if ($this->allowedIntervalsMemo !== null) {
            return $this->allowedIntervalsMemo;
        }

        $configured = config('screenshots.monitoring_interval.allowed_minutes', [1, 3, 5, 10, 15, 30]);

        return $this->allowedIntervalsMemo = array_values(array_map('intval', (array) $configured));
    }

    public function systemDefault(): int
    {
        if ($this->systemDefaultMemo !== null) {
            return $this->systemDefaultMemo;
        }

        $configured = (int) config('screenshots.monitoring_interval.default_minutes', 10);

        return $this->systemDefaultMemo = ($this->sanitize($configured) ?? 10);
    }

    /**
     * Validate a candidate interval. Returns null when it is absent or not one
     * of the allowed values, which callers treat as "inherit".
     */
    public function sanitize(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (! is_numeric($value)) {
            return null;
        }

        $minutes = (int) $value;

        /*
         * Anything not in the allowed list means "inherit".
         *
         * Inheriting is the right answer rather than rounding to the nearest
         * allowed value: the next value in the chain is the organization
         * default, which an admin actually chose, and rounding would override
         * that deliberate choice with a value nobody selected.
         *
         * The cost of this rule is that a rejected value is rejected SILENTLY —
         * it is still stored on the user and still shown back in the admin UI,
         * while capture quietly runs at the inherited interval. That is a real
         * trap, and the guard against it is that the allowed list has exactly
         * one definition (config/screenshots.php) which the request validation
         * also reads, so a value can never reach storage unless this method
         * will honour it.
         */
        return in_array($minutes, $this->allowedIntervals(), true) ? $minutes : null;
    }

    public function orgDefault(?Organization $organization): ?int
    {
        if (! $organization) {
            return null;
        }

        $settings = $organization->settings;
        $settings = is_array($settings) ? $settings : [];

        return $this->sanitize($settings['monitoring']['interval_minutes'] ?? null);
    }

    public function orgDefaultForOrganizationId(?int $organizationId): ?int
    {
        if (! $organizationId) {
            return null;
        }

        if (array_key_exists($organizationId, $this->orgDefaultMemo)) {
            return $this->orgDefaultMemo[$organizationId];
        }

        return $this->orgDefaultMemo[$organizationId] = $this->orgDefault(
            Organization::query()->find($organizationId, ['id', 'settings'])
        );
    }

    /**
     * The effective interval for a user, in minutes.
     */
    public function resolveForUser(?User $user): int
    {
        if (! $user) {
            return $this->systemDefault();
        }

        $settings = is_array($user->settings) ? $user->settings : [];

        return $this->resolve($settings, $user->organization_id ? (int) $user->organization_id : null);
    }

    /**
     * Same rule, from raw values — for invitations and migrations that have no
     * User instance yet.
     *
     * @param array<string, mixed>|null $userSettings
     */
    public function resolve(?array $userSettings, ?int $organizationId): int
    {
        $override = $this->sanitize($userSettings['monitoring_interval_minutes'] ?? null);
        if ($override !== null) {
            return $override;
        }

        $orgDefault = $this->orgDefaultForOrganizationId($organizationId);
        if ($orgDefault !== null) {
            return $orgDefault;
        }

        return $this->systemDefault();
    }

    /**
     * Merge an org default into an organization settings array without
     * disturbing sibling keys. Passing null clears the org default.
     *
     * @param array<string, mixed> $orgSettings
     * @return array<string, mixed>
     */
    public function withOrgDefault(array $orgSettings, ?int $minutes): array
    {
        $monitoring = is_array($orgSettings['monitoring'] ?? null) ? $orgSettings['monitoring'] : [];
        $monitoring['interval_minutes'] = $this->sanitize($minutes);
        $orgSettings['monitoring'] = $monitoring;

        return $orgSettings;
    }

    /**
     * Normalise the per-user override for storage: keep a valid value, drop the
     * key entirely otherwise so the user inherits.
     *
     * @param array<string, mixed> $settings
     * @return array<string, mixed>
     */
    public function normalizeUserOverride(array $settings): array
    {
        $override = $this->sanitize($settings['monitoring_interval_minutes'] ?? null);

        if ($override === null) {
            unset($settings['monitoring_interval_minutes']);

            return $settings;
        }

        $settings['monitoring_interval_minutes'] = $override;

        return $settings;
    }
}
