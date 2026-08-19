<?php

namespace App\Services\Monitoring;

use App\Models\MonitoringConsent;
use App\Models\MonitoringNotice;
use App\Models\Organization;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;

/**
 * Notice-and-consent for workforce monitoring.
 *
 * One choke point, deliberately. Screenshots, activity, geofenced punches and
 * attendance selfies all arrive through different controllers, and four
 * scattered permission checks would be four places to drift. Every capture
 * path asks this one question: may this person's data of this kind be
 * collected right now?
 *
 * Under the DPDP Act the penalty for collecting without notice falls on the
 * employer running this software, not on the vendor that wrote it — so a
 * customer deploying the tracker as shipped was carrying the risk without
 * being given the means to manage it.
 */
class MonitoringConsentService
{
    /** Everything the platform can capture about a person. */
    public const CAPTURE_TYPES = ['screenshot', 'activity', 'location', 'selfie'];

    /** Days an organisation has to collect consent before capture is refused. */
    public const DEFAULT_GRACE_DAYS = 30;

    /**
     * The wording an organisation gets if it has never written its own.
     *
     * Shipping a default is not a legal opinion, and it says so. It exists so
     * the machinery is exercised from day one rather than sitting dormant
     * behind a blank textarea nobody fills in.
     */
    public const DEFAULT_PURPOSES = [
        'screenshot' => 'Periodic screen captures during tracked working time, to verify billable work.',
        'activity' => 'Application and website names during tracked working time, to measure productive time.',
        'location' => 'Location at the moment of clocking in or out, to confirm attendance at an assigned site.',
        'selfie' => 'A photograph at the moment of clocking in, to confirm the person present is the employee.',
    ];

    // ---------------------------------------------------------------- notice

    public function activeNotice(?Organization $organization): ?MonitoringNotice
    {
        if (! $organization) {
            return null;
        }

        return MonitoringNotice::forOrganization($organization->id)
            ->whereNotNull('published_at')
            ->orderByDesc('version')
            ->first();
    }

    /**
     * Publish a new version. Never edits an existing one — see the model.
     *
     * @param  array<string, string>  $purposes
     */
    public function publishNotice(
        Organization $organization,
        string $body,
        array $purposes,
        int $retentionDays,
        ?User $actor = null,
    ): MonitoringNotice {
        $nextVersion = (int) MonitoringNotice::forOrganization($organization->id)->max('version') + 1;

        $notice = new MonitoringNotice([
            'organization_id' => $organization->id,
            'version' => $nextVersion,
            'body' => $body,
            'purposes' => array_intersect_key($purposes, array_flip(self::CAPTURE_TYPES)),
            'retention_days' => $retentionDays,
            'published_at' => now(),
            'published_by_user_id' => $actor?->id,
        ]);

        $notice->organization_id = $organization->id;
        $notice->save();

        return $notice;
    }

    // --------------------------------------------------------------- consent

    public function currentConsent(User $user): ?MonitoringConsent
    {
        return MonitoringConsent::forOrganization((int) $user->organization_id)
            ->where('user_id', $user->id)
            ->orderByDesc('id')
            ->first();
    }

    /**
     * Record agreement to a set of capture types.
     *
     * @param  array<int, string>  $captureTypes
     */
    public function grant(User $user, array $captureTypes, ?Request $request = null): MonitoringConsent
    {
        $notice = $this->activeNotice($user->organization);

        if (! $notice) {
            throw new \InvalidArgumentException(
                'Your organisation has not published a monitoring notice yet, so there is nothing to agree to.'
            );
        }

        $types = array_values(array_intersect($captureTypes, self::CAPTURE_TYPES));

        $consent = new MonitoringConsent([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'notice_version' => $notice->version,
            'capture_types' => $types,
            'granted_at' => now(),
            'ip_address' => $request?->ip(),
            'user_agent' => $request?->userAgent(),
        ]);

        $consent->organization_id = (int) $user->organization_id;
        $consent->save();

        return $consent;
    }

    public function withdraw(User $user): void
    {
        MonitoringConsent::forOrganization((int) $user->organization_id)
            ->where('user_id', $user->id)
            ->whereNull('withdrawn_at')
            ->update(['withdrawn_at' => now()]);
    }

    // ------------------------------------------------------------- the gate

    /**
     * May this capture type be collected for this person right now?
     *
     * The single question every ingestion path asks.
     */
    public function isCaptureAllowed(?User $user, string $captureType): bool
    {
        return $this->refusalReason($user, $captureType) === null;
    }

    /**
     * Why a capture is refused, phrased for the person who will read it, or
     * null when it is allowed.
     */
    public function refusalReason(?User $user, string $captureType): ?string
    {
        if (! $user) {
            return 'No signed-in user to attribute this capture to.';
        }

        $organization = $user->organization;

        // The organisation-wide off switch. Checked first and cheaply: an org
        // that has turned monitoring off should not pay for a consent lookup
        // on every screenshot.
        if (! $this->monitoringEnabled($organization)) {
            return 'Monitoring is switched off for this organisation.';
        }

        $policy = $this->policyFor($organization);

        if ($policy === 'off') {
            return null;
        }

        $notice = $this->activeNotice($organization);

        if (! $notice) {
            return $policy === 'enforced'
                ? 'No monitoring notice has been published, so this cannot be collected.'
                : null;
        }

        $consent = $this->currentConsent($user);

        if ($consent?->covers($captureType) && $consent->notice_version === $notice->version) {
            return null;
        }

        // Within the grace window the capture continues while the organisation
        // collects agreement. Refusing on deploy day would stop every tracker
        // in every existing tenant at once, which is not a safety improvement —
        // it is an outage that gets the control switched off again.
        if ($policy !== 'enforced' && $this->graceEndsAt($organization, $notice)?->isFuture()) {
            return null;
        }

        if ($consent && ! $consent->isActive()) {
            return 'This employee has withdrawn consent to monitoring.';
        }

        if ($consent && $consent->notice_version !== $notice->version) {
            return 'The monitoring notice has changed and this employee has not yet agreed to the new version.';
        }

        return 'This employee has not agreed to '.$captureType.' capture.';
    }

    // ---------------------------------------------------------------- policy

    public function monitoringEnabled(?Organization $organization): bool
    {
        if (! $organization) {
            return false;
        }

        $enabled = data_get($organization->settings, 'monitoring.enabled');

        // Absent means enabled: monitoring predates this switch, and defaulting
        // it off would silently stop every existing tracker.
        return $enabled === null ? true : (bool) $enabled;
    }

    /** off | grace | enforced */
    public function policyFor(?Organization $organization): string
    {
        if (! $organization) {
            return 'enforced';
        }

        $policy = data_get($organization->settings, 'monitoring.consent_policy');

        return in_array($policy, ['off', 'grace', 'enforced'], true) ? $policy : 'grace';
    }

    public function graceEndsAt(?Organization $organization, ?MonitoringNotice $notice = null): ?CarbonInterface
    {
        if (! $organization) {
            return null;
        }

        $configured = data_get($organization->settings, 'monitoring.consent_grace_ends_at');

        if ($configured) {
            try {
                return \Carbon\Carbon::parse($configured);
            } catch (\Throwable) {
                // Fall through: a malformed date must not decide policy.
            }
        }

        $notice ??= $this->activeNotice($organization);

        // Counted from when the notice was published, not from when the
        // organisation was created: the window is time to read something, and
        // it cannot start before the something exists.
        return $notice?->published_at?->copy()->addDays(self::DEFAULT_GRACE_DAYS);
    }

    /**
     * Everything an employee-facing screen needs to show.
     *
     * @return array<string, mixed>
     */
    public function disclosureFor(User $user): array
    {
        $organization = $user->organization;
        $notice = $this->activeNotice($organization);
        $consent = $this->currentConsent($user);

        return [
            'monitoring_enabled' => $this->monitoringEnabled($organization),
            'policy' => $this->policyFor($organization),
            'grace_ends_at' => $this->graceEndsAt($organization, $notice)?->toIso8601String(),
            'notice' => $notice ? [
                'version' => $notice->version,
                'body' => $notice->body,
                'purposes' => $notice->purposes,
                'retention_days' => $notice->retention_days,
                'published_at' => $notice->published_at?->toIso8601String(),
            ] : null,
            'consent' => $consent ? [
                'notice_version' => $consent->notice_version,
                'capture_types' => $consent->capture_types,
                'granted_at' => $consent->granted_at?->toIso8601String(),
                'withdrawn_at' => $consent->withdrawn_at?->toIso8601String(),
                'is_current' => $consent->isActive() && $notice && $consent->notice_version === $notice->version,
            ] : null,
            'capture_types' => collect(self::CAPTURE_TYPES)->mapWithKeys(fn (string $type) => [
                $type => [
                    'purpose' => $notice->purposes[$type] ?? self::DEFAULT_PURPOSES[$type],
                    'allowed_now' => $this->isCaptureAllowed($user, $type),
                    'refusal_reason' => $this->refusalReason($user, $type),
                ],
            ])->all(),
        ];
    }
}
