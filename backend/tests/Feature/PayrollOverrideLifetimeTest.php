<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\PayrollOverride;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * One override lifetime, expressed as a date range.
 *
 * Keka carries three for the same concept — components permanent, statutory
 * date-ranged, PF a boolean that carries forward until switched off. A payroll
 * officer therefore cannot answer "will this still be here next month?" without
 * first knowing which kind they are looking at. Every one of those behaviours
 * is a special case of a range, which is what these tests pin.
 */
class PayrollOverrideLifetimeTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);
    }

    private function override(array $attributes = []): PayrollOverride
    {
        return PayrollOverride::create(array_merge([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'scope' => 'component',
            'target' => 'basic',
            'mode' => 'fixed',
            'value' => 50000,
            'effective_from' => '2026-06-01',
            'effective_to' => null,
            'reason' => 'Correction to an understated component',
            'status' => PayrollOverride::STATUS_APPROVED,
        ], $attributes));
    }

    /** Keka's "permanent": open-ended, and it keeps applying. */
    #[Test]
    public function an_open_ended_override_stays_in_force(): void
    {
        $this->override();

        foreach (['2026-06', '2026-07', '2027-01'] as $month) {
            $this->assertSame(1, PayrollOverride::inForceFor($month)->count(), "should apply in {$month}");
        }
    }

    /** Keka's "PF until cancelled": open-ended, then closed. */
    #[Test]
    public function closing_an_override_stops_it_from_the_next_period(): void
    {
        $override = $this->override();

        $this->assertSame(1, PayrollOverride::inForceFor('2026-08')->count());

        $override->update(['effective_to' => '2026-07-31']);

        $this->assertSame(1, PayrollOverride::inForceFor('2026-07')->count(), 'July was still covered.');
        $this->assertSame(0, PayrollOverride::inForceFor('2026-08')->count(), 'August is past the close.');
    }

    /** "This month only" needs no new concept. */
    #[Test]
    public function a_single_month_override_applies_to_exactly_that_month(): void
    {
        $this->override(['effective_from' => '2026-06-01', 'effective_to' => '2026-06-30']);

        $this->assertSame(0, PayrollOverride::inForceFor('2026-05')->count());
        $this->assertSame(1, PayrollOverride::inForceFor('2026-06')->count());
        $this->assertSame(0, PayrollOverride::inForceFor('2026-07')->count());
    }

    #[Test]
    public function an_override_does_not_apply_before_it_starts(): void
    {
        $this->override(['effective_from' => '2026-09-01']);

        $this->assertSame(0, PayrollOverride::inForceFor('2026-08')->count());
        $this->assertSame(1, PayrollOverride::inForceFor('2026-09')->count());
    }

    /**
     * Only approved overrides move money. A pending one is a request, and
     * applying requests is how an ungoverned override system behaves.
     */
    #[Test]
    public function a_pending_override_is_not_in_force(): void
    {
        $this->override(['status' => PayrollOverride::STATUS_PENDING]);

        $this->assertSame(0, PayrollOverride::inForceFor('2026-06')->count());
    }

    /**
     * Both values kept. The pair is what lets the register say "we paid 50,000
     * where the engine would have paid 40,000" rather than only the first half.
     */
    #[Test]
    public function the_register_reports_what_was_applied_and_what_would_have_been(): void
    {
        $override = $this->override(['value' => 50000, 'computed_value' => 40000]);

        $this->assertSame(10000.0, $override->delta());
    }

    /**
     * An override that has never run has no delta. Reporting zero would read as
     * "this changed nothing" rather than "this has not been applied yet".
     */
    #[Test]
    public function an_unapplied_override_reports_no_delta_rather_than_zero(): void
    {
        $this->assertNull($this->override()->delta());
    }

    /**
     * Dates must survive the round trip as calendar dates. A plain `date` cast
     * serialises as a UTC datetime, so an effective_from of the 1st arrives as
     * the previous month's last day in any timezone ahead of UTC — which for an
     * override boundary means applying a month early.
     */
    #[Test]
    public function effective_dates_survive_as_calendar_dates(): void
    {
        $override = $this->override(['effective_from' => '2026-06-01'])->fresh();

        $this->assertSame('2026-06-01', $override->effective_from->toDateString());
        $this->assertTrue($override->isOpenEnded());
    }
}
