<?php

namespace App\Services\Billing;

use App\Models\Organization;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * The seat cap, enforced.
 *
 * `organizations.max_seats` existed from the beginning and was read only for
 * display — no code path checked it before creating a user. That is how a
 * workspace paying for 5 seats came to hold 86 people, and why the billing page
 * could show "86 / 5" without anything being wrong from the app's point of view.
 *
 * Enforcement is forward-only by design: an organization already over its cap
 * keeps every person it has. The guard refuses the *next* one and says how many
 * seats short it is. Removing people to fit a cap is a decision for a human.
 */
class SeatGuard
{
    /** People currently holding a seat. Every login counts, admins included. */
    public function usedSeats(Organization $organization): int
    {
        return $organization->users()->count();
    }

    public function maxSeats(Organization $organization): int
    {
        return (int) ($organization->max_seats ?? 0);
    }

    /**
     * The lowest cap this organization may set. Reducing below the people
     * already in the workspace is not a saving, it is an inconsistency.
     */
    public function minimumAllowedSeats(Organization $organization): int
    {
        $plans = config('carevance.plans', []);
        $planCode = $organization->plan_code ?: config('carevance.default_plan', 'basic_tracking');
        $planConfig = $plans[$planCode] ?? [];
        $planFloor = PlanService::isPayrollPlan((string) $planCode)
            ? (int) ($planConfig['min_seats'] ?? 50)
            : (int) ($planConfig['min_seats'] ?? 10);

        return max($planFloor, $this->usedSeats($organization));
    }

    public function remaining(Organization $organization): int
    {
        return $this->maxSeats($organization) - $this->usedSeats($organization);
    }

    public function isOverCap(Organization $organization): bool
    {
        return $this->remaining($organization) < 0;
    }

    /** True when `$count` more people would fit inside the cap. */
    public function canAdd(Organization $organization, int $count = 1): bool
    {
        // A cap of zero or less has never been configured for this workspace;
        // treat it as unset rather than as "nobody may join", which would lock
        // out organizations created before seats existed.
        if ($this->maxSeats($organization) <= 0) {
            return true;
        }

        return $this->usedSeats($organization) + $count <= $this->maxSeats($organization);
    }

    /**
     * Refuse with a 422 the client can act on: it carries the shortfall, so the
     * UI can offer "add N seats" rather than a dead end.
     */
    public function assertCanAdd(Organization $organization, int $count = 1): void
    {
        if ($this->canAdd($organization, $count)) {
            return;
        }

        $used = $this->usedSeats($organization);
        $max = $this->maxSeats($organization);
        $shortfall = ($used + $count) - $max;

        throw new HttpException(
            422,
            $count === 1
                ? "This workspace has {$used} of {$max} seats in use. Add at least 1 more seat to invite someone else."
                : "Adding {$count} people needs {$shortfall} more seat(s): {$used} of {$max} are already in use."
        );
    }

    /** Seat figures for the billing snapshot. */
    public function summary(Organization $organization): array
    {
        $used = $this->usedSeats($organization);
        $max = $this->maxSeats($organization);

        return [
            'used' => $used,
            'max' => $max,
            'remaining' => $max - $used,
            'is_over_cap' => $max > 0 && $used > $max,
            'over_by' => $max > 0 ? max(0, $used - $max) : 0,
            'min_allowed' => $this->minimumAllowedSeats($organization),
        ];
    }
}
