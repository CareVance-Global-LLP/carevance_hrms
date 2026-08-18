<?php

namespace Tests\Feature;

use App\Exceptions\ClosedPayrollRunException;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\Payroll\ClosedRunWriteContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Four lock tiers, and the two that matter most are the ones no single lock
 * can express.
 *
 * A 200-person run always has three exceptions. With only a month lock, those
 * three hold the other 197 — which is why Keka's own documentation offers
 * per-employee rollback as the workaround for having one lock. greytHR has the
 * better tier model; this takes it.
 *
 * Tier 4, publication, is deliberately NOT tier 3. Locking is whether a figure
 * can still move; publishing is whether the employee can see it. Tying them
 * forces a choice between publishing figures still under correction and
 * withholding 197 correct payslips because 3 are disputed.
 */
class PayrollLockingTiersTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private PayrollMonthlyRun $run;
    private PayrollItem $settled;
    private PayrollItem $disputed;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();

        $this->run = PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => '2026-06',
            'status' => 'draft',
        ]);

        $this->settled = $this->itemFor('Settled');
        $this->disputed = $this->itemFor('Disputed');
    }

    private function itemFor(string $name): PayrollItem
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
            'name' => $name,
        ]);

        return PayrollItem::create([
            'payroll_run_id' => $this->run->id,
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'month_year' => '2026-06',
            'basic' => 40000,
            'gross_salary' => 100000,
            'total_deductions' => 12000,
            'net_pay' => 88000,
        ]);
    }

    // ------------------------------------------------- Tier 3: per employee

    /**
     * The point of the tier: lock 197, keep working on 3.
     */
    #[Test]
    public function locking_one_employee_leaves_the_rest_editable(): void
    {
        $this->settled->update(['locked_at' => now()]);

        // The disputed employee is still being worked on.
        $this->disputed->update(['net_pay' => 91000]);
        $this->assertSame('91000.00', (string) $this->disputed->fresh()->net_pay);

        // The settled one is not, even though the run is still a draft.
        $this->expectException(ClosedPayrollRunException::class);
        $this->settled->fresh()->update(['net_pay' => 1]);
    }

    #[Test]
    public function a_locked_employees_figures_survive_a_refused_write(): void
    {
        $this->settled->update(['locked_at' => now()]);

        try {
            $this->settled->fresh()->update(['net_pay' => 1]);
        } catch (ClosedPayrollRunException) {
            // expected
        }

        $this->assertSame('88000.00', (string) $this->settled->fresh()->net_pay);
    }

    /**
     * A lock has to be reversible or it is not a lock, it is a deletion of
     * capability. Unlocking reads locked_at from the row as loaded, so clearing
     * it is not itself blocked by it.
     */
    #[Test]
    public function an_employee_can_be_unlocked_and_edited_again(): void
    {
        $this->settled->update(['locked_at' => now()]);
        $this->settled->fresh()->update(['locked_at' => null]);

        $this->settled->fresh()->update(['net_pay' => 92000]);

        $this->assertSame('92000.00', (string) $this->settled->fresh()->net_pay);
    }

    /**
     * The same governed escape hatch that reaches a closed run reaches a locked
     * employee. One sanctioned path, not two.
     */
    #[Test]
    public function a_governed_correction_still_reaches_a_locked_employee(): void
    {
        $this->settled->update(['locked_at' => now()]);

        app(ClosedRunWriteContext::class)->permit(
            'Tribunal-ordered adjustment',
            fn () => $this->settled->fresh()->update(['net_pay' => 80000])
        );

        $this->assertSame('80000.00', (string) $this->settled->fresh()->net_pay);
    }

    /**
     * Locking is not a money column, so locking someone must not itself trip
     * the guard it turns on.
     */
    #[Test]
    public function locking_an_employee_is_not_itself_a_money_write(): void
    {
        $this->settled->update(['locked_at' => now(), 'locked_by' => 1]);

        $this->assertNotNull($this->settled->fresh()->locked_at);
    }

    // ---------------------------------------------------- Tier 4: publishing

    /**
     * Publication is independent of locking in both directions. A payslip can
     * be published for a settled employee while a disputed one stays unseen,
     * and an employee can be locked without their payslip being released.
     */
    #[Test]
    public function publication_is_independent_of_locking(): void
    {
        $this->settled->update(['locked_at' => now(), 'payslip_published_at' => now()]);
        // Locked, but not yet published — the figure is settled and the
        // employee has not been shown it.
        $this->disputed->update(['locked_at' => now()]);

        $this->assertNotNull($this->settled->fresh()->payslip_published_at);
        $this->assertNull($this->disputed->fresh()->payslip_published_at);
        $this->assertNotNull($this->disputed->fresh()->locked_at, 'Locked without being published is a valid state.');
    }

    #[Test]
    public function an_unlocked_employee_can_still_be_left_unpublished(): void
    {
        $this->assertNull($this->settled->fresh()->locked_at);
        $this->assertNull($this->settled->fresh()->payslip_published_at);

        $published = PayrollItem::whereNotNull('payslip_published_at')->count();

        $this->assertSame(0, $published, 'Nothing is published by default; publishing is an act.');
    }

    // ------------------------------------------ Tier 2 still governs tier 3

    /**
     * The tiers compose rather than replace each other: closing the month still
     * closes everyone, whether or not they were individually locked.
     */
    #[Test]
    public function closing_the_month_still_closes_an_unlocked_employee(): void
    {
        $this->run->update(['status' => 'approved']);

        $this->expectException(ClosedPayrollRunException::class);
        $this->disputed->fresh()->update(['net_pay' => 1]);
    }
}
