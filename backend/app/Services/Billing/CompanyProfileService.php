<?php

namespace App\Services\Billing;

use App\Models\Organization;

/**
 * The company profile — and the two places it has to matter.
 *
 * These eleven columns used to be collected on the signup form and read by
 * nothing: no controller, service, report or invoice touched them again, and no
 * screen in the product could show or edit them. They are now gathered inside
 * the workspace, which is only defensible if they do real work once they are
 * there. They do two things:
 *
 *  - `size` seeds the seat count we suggest at conversion. Without it a trial
 *    converts on its 5-seat trial cap, so a company of forty silently buys five.
 *  - the address block is what an invoice needs. `missingBillingFields()` is
 *    checked before an order is created, so we never charge someone and then
 *    discover we cannot bill them properly.
 */
class CompanyProfileService
{
    /** Everything the company profile covers, in form order. */
    public const PROFILE_FIELDS = [
        'description', 'website', 'industry', 'size', 'phone', 'email',
        'address_line', 'city', 'state', 'postal_code', 'country',
    ];

    /**
     * The subset an invoice cannot be raised without. Deliberately narrower than
     * PROFILE_FIELDS — we block payment on a billing address, never on whether
     * somebody filled in their industry.
     */
    public const BILLING_FIELDS = [
        'address_line', 'city', 'state', 'postal_code', 'country',
    ];

    public const FIELD_LABELS = [
        'description' => 'Description',
        'website' => 'Website',
        'industry' => 'Industry',
        'size' => 'Company size',
        'phone' => 'Phone number',
        'email' => 'Organization email',
        'address_line' => 'Address',
        'city' => 'City',
        'state' => 'State',
        'postal_code' => 'Postal code',
        'country' => 'Country',
    ];

    /**
     * Headcount bucket -> the seat count we suggest.
     *
     * The low end of each band, floored at the plan minimum by the caller. We
     * suggest the bottom of the range rather than the top: a workspace that
     * needs more seats can add them in one click, whereas over-selling seats at
     * conversion is the kind of surprise that gets refunded.
     */
    private const SIZE_TO_SEATS = [
        '1-10' => 10,
        '11-50' => 25,
        '51-200' => 75,
        '201-500' => 250,
        '500+' => 500,
    ];

    /** Which billing fields are still blank. Empty array means invoiceable. */
    public function missingBillingFields(Organization $organization): array
    {
        return array_values(array_filter(
            self::BILLING_FIELDS,
            fn (string $field) => trim((string) ($organization->{$field} ?? '')) === ''
        ));
    }

    public function hasBillingProfile(Organization $organization): bool
    {
        return $this->missingBillingFields($organization) === [];
    }

    /** Human-readable names for the blank fields, for an error message. */
    public function missingBillingLabels(Organization $organization): array
    {
        return array_map(
            fn (string $field) => self::FIELD_LABELS[$field] ?? $field,
            $this->missingBillingFields($organization)
        );
    }

    /**
     * True once enough of the profile is filled in for the checklist step to
     * count as done. The address plus a headcount — the two things downstream
     * code actually consumes.
     */
    public function isComplete(Organization $organization): bool
    {
        return $this->hasBillingProfile($organization)
            && trim((string) ($organization->size ?? '')) !== '';
    }

    /** Seats implied by the recorded headcount, or null when none is recorded. */
    public function seatsFromSize(?string $size): ?int
    {
        $size = trim((string) $size);

        return $size === '' ? null : (self::SIZE_TO_SEATS[$size] ?? null);
    }

    /**
     * What to put in the seat box at conversion.
     *
     * Never below the plan floor and never below the people already in the
     * workspace — converting on a number smaller than the current headcount
     * would buy a plan that cannot hold the team it is being bought for.
     *
     * `$usedSeats` means people still holding access, the figure the billing
     * page shows. Never pass a count that includes leavers: this number is
     * prefilled into the seat box and posted straight back to be priced, so
     * anything the customer cannot see on the page gets charged for silently.
     */
    public function suggestedSeats(Organization $organization, int $floor, int $usedSeats): int
    {
        return max($floor, $usedSeats, $this->seatsFromSize($organization->size) ?? 0);
    }

    /** The profile block for the billing snapshot and the checklist. */
    public function summary(Organization $organization, int $floor, int $usedSeats): array
    {
        $missing = $this->missingBillingFields($organization);

        return [
            'size' => $organization->size,
            'is_complete' => $this->isComplete($organization),
            'billing_ready' => $missing === [],
            'missing_billing_fields' => $missing,
            'missing_billing_labels' => $this->missingBillingLabels($organization),
            'seats_from_size' => $this->seatsFromSize($organization->size),
            'suggested_seats' => $this->suggestedSeats($organization, $floor, $usedSeats),
        ];
    }
}
