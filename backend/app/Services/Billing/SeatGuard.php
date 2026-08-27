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
    /**
     * People still holding access. Every login counts, admins included.
     *
     * This is the ONLY seat count in the product. The cap reads it, the billing
     * page displays it, and every price is quoted on it — so the number a
     * customer is charged for is the number they can see, and a quote they
     * cannot reconcile against the seat meter is a bug rather than a footnote.
     *
     * A leaver's row survives — `User` has no SoftDeletes and is deliberately
     * not gaining any — so the seat is released by `deactivated_at`, which
     * `ExitService::revokeAccess` stamps on the day after the last working day.
     * It used to be every row, which meant a leaver held a paid seat forever
     * and deleting the person was the only way to free one: that destroys their
     * payslips, attendance and leave ledger, which the organization is obliged
     * to keep.
     *
     * There was briefly a second count here — `billableHeadcount()`, every row
     * the organization had ever had — kept so no invoice moved when the release
     * landed. It priced a workspace of five active people with thirty leavers
     * at thirty-five seats while the same page read "5 of 10", and the customer
     * had nothing on screen to argue with. Charging for people who left is an
     * overcharge; it is gone, and nothing may reintroduce it.
     */
    public function usedSeats(Organization $organization): int
    {
        return $organization->users()->stillHoldingAccess()->count();
    }

    public function maxSeats(Organization $organization): int
    {
        return (int) ($organization->max_seats ?? 0);
    }

    /**
     * The lowest cap this organization may REDUCE to. Going below the people
     * already in the workspace is not a saving, it is an inconsistency.
     *
     * The plan floor now lives in `config/carevance.php` under `min_seats`.
     * The key was absent from every plan, so the `?? 50` / `?? 10` below were
     * the real numbers and nobody reading the config could find them. They are
     * unchanged — see the note above `plans` for the two commercial
     * disagreements in this area that still need a human to settle.
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

    /**
     * The cap a NEW person is admitted against.
     *
     * Normally the paid cap. When a smaller one has already been agreed and is
     * waiting to land — a scheduled seat reduction, or an upgrade quote the
     * customer is about to pay — it is that smaller number instead, because
     * seat enforcement is forward-only: anybody let in above the incoming cap
     * stays there and the workspace never has to buy the seat. A rejoin, a
     * SCIM reactivation and an accepted invitation all arrive through
     * `assertCanAdd`, and all three used to be waved through on a cap that was
     * minutes away from being replaced.
     *
     * A LARGER pending number is ignored: seats being bought are not seats
     * paid for, and admitting against them would let a workspace fill a cap it
     * then abandons at checkout.
     */
    public function admissionCap(Organization $organization): int
    {
        $max = $this->maxSeats($organization);
        $pending = (int) ($organization->pending_seats ?? 0);

        return ($pending > 0 && $max > 0 && $pending < $max) ? $pending : $max;
    }

    /** True when `$count` more people would fit inside the cap. */
    public function canAdd(Organization $organization, int $count = 1): bool
    {
        $cap = $this->admissionCap($organization);

        // A cap of zero or less has never been configured for this workspace;
        // treat it as unset rather than as "nobody may join", which would lock
        // out organizations created before seats existed.
        if ($cap <= 0) {
            return true;
        }

        return $this->usedSeats($organization) + $count <= $cap;
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
        $max = $this->admissionCap($organization);
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
            // `used` is also what every quote is priced on. There is no second
            // figure beside it any more: two seat numbers on one screen is what
            // let a 35-seat invoice sit next to a meter reading 5.
            'used' => $used,
            'max' => $max,
            'remaining' => $max - $used,
            'is_over_cap' => $max > 0 && $used > $max,
            'over_by' => $max > 0 ? max(0, $used - $max) : 0,
            'min_allowed' => $this->minimumAllowedSeats($organization),
        ];
    }
}
