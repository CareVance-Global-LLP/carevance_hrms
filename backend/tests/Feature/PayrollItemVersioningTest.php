<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollItemVersion;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\Payroll\ClosedRunWriteContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * A correction supersedes; it does not erase.
 *
 * Keka's answer to a wrong month is an irreversible Rollback that clears
 * payslips and bank statements and regenerates them — their own documentation
 * says it "cannot be undone", and that it pulls in every change made since
 * finalization, so a rollback meant to fix one LOP day can silently restate the
 * whole month.
 *
 * We diverge: the replaced figure is retained, with the reason and the actor.
 * That is the only way "every figure traceable back to the work that earned it,
 * and every hand that touched it" is true rather than aspirational.
 */
class PayrollItemVersioningTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $actor;
    private PayrollMonthlyRun $run;
    private PayrollItem $item;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->actor = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->run = PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => '2026-06',
            'status' => 'draft',
        ]);

        $this->item = PayrollItem::create([
            'payroll_run_id' => $this->run->id,
            'organization_id' => $this->organization->id,
            'user_id' => $this->actor->id,
            'month_year' => '2026-06',
            'basic' => 40000,
            'gross_salary' => 100000,
            'total_deductions' => 12000,
            'net_pay' => 88000,
        ]);

        $this->run->update(['status' => 'approved']);
    }

    private function correct(string $reason, array $changes): void
    {
        app(ClosedRunWriteContext::class)->permit(
            $reason,
            fn () => $this->item->update($changes)
        );
    }

    #[Test]
    public function a_governed_correction_retains_the_figure_it_replaced(): void
    {
        $this->correct('LOP day reversed after appeal', ['net_pay' => 91000]);

        $version = PayrollItemVersion::where('payroll_item_id', $this->item->id)->firstOrFail();

        $this->assertSame(88000.0, $version->money()['net_pay'], 'The version records what was paid, not what replaced it.');
        $this->assertSame(91000.0, (float) $this->item->fresh()->net_pay);
    }

    #[Test]
    public function the_reason_and_the_actor_are_recorded(): void
    {
        $this->actingAs($this->actor);

        $this->correct('Court-ordered recovery', ['net_pay' => 80000]);

        $version = PayrollItemVersion::where('payroll_item_id', $this->item->id)->firstOrFail();

        $this->assertSame('Court-ordered recovery', $version->reason);
        $this->assertSame($this->actor->id, $version->superseded_by);
        $this->assertNotNull($version->superseded_at);
    }

    /**
     * Each correction stacks rather than replacing the last. Two corrections
     * must leave two retained figures, in order — otherwise only the most
     * recent mistake is explainable.
     */
    #[Test]
    public function successive_corrections_each_retain_their_own_figure(): void
    {
        $this->correct('First correction', ['net_pay' => 91000]);
        $this->correct('Second correction', ['net_pay' => 85000]);

        $versions = PayrollItemVersion::where('payroll_item_id', $this->item->id)
            ->orderBy('version_no')
            ->get();

        $this->assertCount(2, $versions);
        $this->assertSame(88000.0, $versions[0]->money()['net_pay']);
        $this->assertSame(91000.0, $versions[1]->money()['net_pay']);
        $this->assertSame(1, $versions[0]->version_no);
        $this->assertSame(2, $versions[1]->version_no);
        $this->assertSame(3, (int) $this->item->fresh()->current_version_no);
    }

    /**
     * The snapshot covers every money column, not just the one that moved. A
     * version that only records the changed field cannot answer "what did this
     * payslip say" — which is the question a dispute actually asks.
     */
    #[Test]
    public function the_snapshot_captures_the_whole_money_picture(): void
    {
        $this->correct('Recompute', ['net_pay' => 91000]);

        $money = PayrollItemVersion::where('payroll_item_id', $this->item->id)->firstOrFail()->money();

        $this->assertSame(40000.0, $money['basic']);
        $this->assertSame(100000.0, $money['gross_salary']);
        $this->assertSame(12000.0, $money['total_deductions']);
        $this->assertSame(88000.0, $money['net_pay']);
    }

    /**
     * Ordinary processing on an open run is not a correction. Versioning every
     * draft edit would bury the corrections that matter under the noise of
     * building the run in the first place.
     */
    #[Test]
    public function ordinary_edits_on_an_open_run_are_not_versioned(): void
    {
        $this->run->update(['status' => 'draft']);

        $this->item->update(['net_pay' => 91000]);

        $this->assertSame(0, PayrollItemVersion::where('payroll_item_id', $this->item->id)->count());
        $this->assertSame(1, (int) $this->item->fresh()->current_version_no);
    }

    /**
     * The guard still holds. Versioning is what makes a correction auditable,
     * not what makes it permissible — an ungoverned write to a closed run is
     * still refused, and leaves no version behind.
     */
    #[Test]
    public function an_ungoverned_write_is_still_refused_and_records_nothing(): void
    {
        try {
            $this->item->update(['net_pay' => 1]);
            $this->fail('A closed run must refuse an ungoverned money write.');
        } catch (\App\Exceptions\ClosedPayrollRunException) {
            // expected
        }

        $this->assertSame(0, PayrollItemVersion::where('payroll_item_id', $this->item->id)->count());
        $this->assertSame(88000.0, (float) $this->item->fresh()->net_pay);
    }

    /**
     * A version outlives the item it describes. An audit trail that disappears
     * with the thing it audits is not one.
     */
    #[Test]
    public function a_version_survives_its_item_being_deleted(): void
    {
        $this->correct('Correction before removal', ['net_pay' => 91000]);

        app(ClosedRunWriteContext::class)->permit(
            'Employee removed from the run',
            fn () => $this->item->delete()
        );

        $version = PayrollItemVersion::where('user_id', $this->actor->id)->firstOrFail();

        $this->assertSame($this->organization->id, $version->organization_id);
        $this->assertSame('2026-06', $version->month_year);
        $this->assertSame(88000.0, $version->money()['net_pay']);
    }
}
