<?php

namespace App\Services\Billing;

use App\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;

/**
 * The single place subscription dates and states are computed.
 *
 * Before this existed the rules lived nowhere: `subscription_expires_at` was
 * written by the payment paths and read only for display, and the one piece of
 * enforcement — in AuthenticateApiToken — looked exclusively at trials. A paid
 * plan whose date had passed kept full access forever.
 *
 * Everything that needs to know "is this subscription still good" asks here,
 * so the daily command and the per-request middleware cannot disagree.
 */
class SubscriptionCycleService
{
    /** Days after the renewal date during which access is unchanged. */
    public const GRACE_DAYS = 7;

    /** Days before renewal at which an admin is reminded. Descending. */
    public const REMINDER_STAGES = [7, 3, 1];

    public const STATE_TRIAL = 'trial';
    public const STATE_ACTIVE = 'active';
    public const STATE_PAST_DUE = 'past_due';
    public const STATE_EXPIRED = 'expired';
    public const STATE_CANCELLED = 'cancelled';
    public const STATE_INACTIVE = 'inactive';

    private function today(): CarbonImmutable
    {
        return CarbonImmutable::parse(Carbon::now()->toDateString());
    }

    private function toDate(mixed $value): ?CarbonImmutable
    {
        if (!$value) {
            return null;
        }

        return CarbonImmutable::parse($value instanceof \DateTimeInterface ? $value->format('Y-m-d') : (string) $value);
    }

    /**
     * The date the current period ends. For a trial that is the trial end; for a
     * paid plan it is the subscription expiry.
     */
    public function periodEndsAt(Organization $organization): ?CarbonImmutable
    {
        if ($organization->subscription_status === self::STATE_TRIAL) {
            return $this->toDate($organization->trial_ends_at ?? $organization->subscription_expires_at);
        }

        return $this->toDate($organization->subscription_expires_at);
    }

    /** Last day of the grace window, or null when there is no period end. */
    public function graceEndsAt(Organization $organization): ?CarbonImmutable
    {
        $periodEnd = $this->periodEndsAt($organization);
        if (!$periodEnd) {
            return null;
        }

        // A trial has no grace: it either converts or it stops.
        if ($organization->subscription_status === self::STATE_TRIAL) {
            return $periodEnd;
        }

        return $periodEnd->addDays(self::GRACE_DAYS);
    }

    /** Whole days until the period ends. Negative once it has passed. */
    public function daysRemaining(Organization $organization): ?int
    {
        $periodEnd = $this->periodEndsAt($organization);

        return $periodEnd ? $this->today()->diffInDays($periodEnd, false) : null;
    }

    /** Length of the current billing period in days, for the progress bar. */
    public function cycleLengthDays(Organization $organization): ?int
    {
        $start = $this->cycleStartsAt($organization);
        $end = $this->periodEndsAt($organization);

        if (!$start || !$end) {
            return null;
        }

        return max(1, $start->diffInDays($end, false));
    }

    /**
     * When the current period began. Uses the recorded renewal where there is
     * one, and otherwise walks back one cycle from the end date — which is the
     * best available answer for a subscription created before this shipped.
     */
    public function cycleStartsAt(Organization $organization): ?CarbonImmutable
    {
        $recorded = $this->toDate($organization->last_renewal_at);
        $end = $this->periodEndsAt($organization);

        if ($recorded && $end && $recorded->lessThan($end)) {
            return $recorded;
        }

        if (!$end) {
            return null;
        }

        if ($organization->subscription_status === self::STATE_TRIAL) {
            return $this->toDate($organization->trial_starts_at) ?? $end->subDays((int) config('carevance.trial_days', 14));
        }

        return $organization->billing_cycle === 'yearly' ? $end->subYear() : $end->subMonth();
    }

    /**
     * The state the dates say this subscription is in, regardless of what the
     * status column currently claims.
     */
    public function resolveState(Organization $organization): string
    {
        $status = (string) ($organization->subscription_status ?: self::STATE_TRIAL);

        // Terminal-ish states are honoured as recorded; nothing about a date
        // should resurrect a cancelled or deactivated workspace.
        if (in_array($status, [self::STATE_CANCELLED, self::STATE_INACTIVE], true)) {
            return $status;
        }

        $periodEnd = $this->periodEndsAt($organization);

        // No end date means nothing to enforce. A workspace without one is left
        // exactly as it is rather than being guessed into expiry.
        if (!$periodEnd) {
            return $status === self::STATE_TRIAL ? self::STATE_TRIAL : $status;
        }

        $today = $this->today();

        if ($today->lessThanOrEqualTo($periodEnd)) {
            return $status === self::STATE_TRIAL ? self::STATE_TRIAL : self::STATE_ACTIVE;
        }

        if ($status === self::STATE_TRIAL) {
            return self::STATE_EXPIRED;
        }

        $graceEnd = $this->graceEndsAt($organization);

        return $graceEnd && $today->lessThanOrEqualTo($graceEnd)
            ? self::STATE_PAST_DUE
            : self::STATE_EXPIRED;
    }

    /** True when the workspace should be read-only. */
    public function isReadOnly(Organization $organization): bool
    {
        return in_array(
            $this->resolveState($organization),
            [self::STATE_EXPIRED, self::STATE_CANCELLED, self::STATE_INACTIVE],
            true
        );
    }

    /**
     * Write the resolved state back to the organization. Returns true when
     * something changed, so callers can log only real transitions.
     */
    public function reconcile(Organization $organization): bool
    {
        $resolved = $this->resolveState($organization);
        $graceEnd = $this->graceEndsAt($organization);

        $changes = [];

        if ($resolved !== $organization->subscription_status) {
            $changes['subscription_status'] = $resolved;
        }

        $graceValue = $resolved === self::STATE_PAST_DUE ? $graceEnd?->toDateString() : null;
        if ($graceValue !== $this->toDate($organization->grace_ends_at)?->toDateString()) {
            $changes['grace_ends_at'] = $graceValue;
        }

        if (!$changes) {
            return false;
        }

        $organization->forceFill($changes)->save();

        return true;
    }

    /**
     * Advance the period after a payment clears.
     *
     * The next end date is measured from the previous one, not from today, so a
     * customer who pays three days late does not silently lose three days and
     * the renewal date stays on the same day of the month. If the previous end
     * is further back than one whole cycle — a workspace returning after a long
     * lapse — the anchor moves to today instead, which is the only honest
     * option once the missed periods were never paid for.
     */
    public function markRenewed(Organization $organization, ?string $billingCycle = null, ?int $seats = null): void
    {
        $cycle = $billingCycle ?: ($organization->billing_cycle ?: 'monthly');
        $today = $this->today();
        $previousEnd = $this->toDate($organization->subscription_expires_at);

        $anchor = $previousEnd && $previousEnd->greaterThanOrEqualTo($this->stepBack($today, $cycle))
            ? $previousEnd
            : $today;

        $nextEnd = $this->step($anchor, $cycle);

        $attributes = [
            'subscription_status' => self::STATE_ACTIVE,
            'subscription_intent' => 'paid',
            'billing_cycle' => $cycle,
            'last_renewal_at' => $anchor->toDateString(),
            'subscription_expires_at' => $nextEnd->toDateString(),
            // Cleared deliberately: a renewed subscription owes no grace and
            // must be able to warn again as the next period closes.
            'grace_ends_at' => null,
            'renewal_reminder_stage' => null,
            'renewal_reminder_for' => null,
        ];

        if ($seats !== null) {
            $attributes['max_seats'] = $seats;
        }

        $organization->forceFill($attributes)->save();
    }

    private function step(CarbonImmutable $from, string $cycle): CarbonImmutable
    {
        return $cycle === 'yearly' ? $from->addYear() : $from->addMonth();
    }

    private function stepBack(CarbonImmutable $from, string $cycle): CarbonImmutable
    {
        return $cycle === 'yearly' ? $from->subYear() : $from->subMonth();
    }

    /**
     * Which reminder is due right now, or null. Returns the largest stage that
     * has been reached and not yet sent for this renewal date, so a workspace
     * whose admins were away over the T-7 mark still gets one at T-3.
     */
    public function dueReminderStage(Organization $organization): ?int
    {
        if (in_array($organization->subscription_status, [self::STATE_CANCELLED, self::STATE_INACTIVE], true)) {
            return null;
        }

        $daysRemaining = $this->daysRemaining($organization);
        $periodEnd = $this->periodEndsAt($organization);

        if ($daysRemaining === null || $periodEnd === null || $daysRemaining < 0) {
            return null;
        }

        $alreadySentFor = $this->toDate($organization->renewal_reminder_for)?->toDateString();
        $alreadySentStage = $alreadySentFor === $periodEnd->toDateString()
            ? $organization->renewal_reminder_stage
            : null;

        foreach (self::REMINDER_STAGES as $stage) {
            if ($daysRemaining <= $stage && ($alreadySentStage === null || $stage < $alreadySentStage)) {
                return $stage;
            }
        }

        return null;
    }

    public function markReminderSent(Organization $organization, int $stage): void
    {
        $organization->forceFill([
            'renewal_reminder_stage' => $stage,
            'renewal_reminder_for' => $this->periodEndsAt($organization)?->toDateString(),
        ])->save();
    }

    /** Everything the client needs to render the cycle, in one shape. */
    public function summary(Organization $organization): array
    {
        $periodEnd = $this->periodEndsAt($organization);
        $cycleStart = $this->cycleStartsAt($organization);
        $daysRemaining = $this->daysRemaining($organization);
        $state = $this->resolveState($organization);
        $graceEnd = $this->graceEndsAt($organization);

        return [
            'state' => $state,
            'is_read_only' => $this->isReadOnly($organization),
            'period_start' => $cycleStart?->toDateString(),
            'period_end' => $periodEnd?->toDateString(),
            'cycle_length_days' => $this->cycleLengthDays($organization),
            'days_remaining' => $daysRemaining,
            'grace_ends_at' => $state === self::STATE_PAST_DUE ? $graceEnd?->toDateString() : null,
            'grace_days_left' => $state === self::STATE_PAST_DUE && $graceEnd
                ? max(0, $this->today()->diffInDays($graceEnd, false))
                : null,
            'auto_renew' => (bool) $organization->auto_renew,
            'has_mandate' => (bool) $organization->razorpay_mandate_id,
            'reminder_stages' => self::REMINDER_STAGES,
        ];
    }
}
