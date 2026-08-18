<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\Payroll\ClosedRunWriteContext;
use App\Services\PayrollPdfService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * A payslip is a statement of fact on a date, and it says which one.
 *
 * There are two payslip paths with different mechanics: one renders fresh on
 * every request, the other serves a pre-generated file from disk. The second is
 * the dangerous one — without a version in the path it keeps serving the
 * pre-correction PDF forever, so the figure is corrected, the versions are
 * retained, and the document the employee downloads is still wrong.
 */
class PayslipVersionBindingTest extends TestCase
{
    use RefreshDatabase;

    private PayrollItem $item;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $organization = Organization::factory()->create();
        $this->employee = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'employee',
        ]);

        $run = PayrollMonthlyRun::create([
            'organization_id' => $organization->id,
            'month_year' => '2026-06',
            'status' => 'draft',
        ]);

        $this->item = PayrollItem::create([
            'payroll_run_id' => $run->id,
            'organization_id' => $organization->id,
            'user_id' => $this->employee->id,
            'month_year' => '2026-06',
            'basic' => 40000,
            'gross_salary' => 100000,
            'total_deductions' => 12000,
            'net_pay' => 88000,
        ]);

        // current_version_no is a database default, so the in-memory instance
        // returned by create() does not carry it until reloaded.
        $this->item->refresh();

        $run->update(['status' => 'approved']);
    }

    /**
     * Every PDF already on disk was written before versioning existed and is by
     * definition version 1. Giving version 1 a new name would strand all of
     * them behind a bulk rename that can half-fail.
     */
    #[Test]
    public function version_one_keeps_the_legacy_unversioned_path(): void
    {
        $this->assertSame(
            'payslips/7/2026-06.pdf',
            PayrollPdfService::storagePathFor(7, '2026-06', 1)
        );

        $this->assertSame(
            'payslips/7/2026-06.pdf',
            PayrollPdfService::storagePathFor(7, '2026-06'),
            'The default must match version 1, or the writer and reader disagree.'
        );
    }

    #[Test]
    public function a_corrected_payslip_gets_its_own_path(): void
    {
        $this->assertSame(
            'payslips/7/2026-06-v2.pdf',
            PayrollPdfService::storagePathFor(7, '2026-06', 2)
        );
    }

    /**
     * The superseded PDF is not overwritten. Keka's rollback "clears and
     * regenerates" the documents; retaining the issued one is the divergence,
     * and it only holds if the paths differ.
     */
    #[Test]
    public function a_correction_does_not_collide_with_the_issued_payslip(): void
    {
        $this->assertNotSame(
            PayrollPdfService::storagePathFor($this->employee->id, '2026-06', 1),
            PayrollPdfService::storagePathFor($this->employee->id, '2026-06', 2),
        );
    }

    /**
     * The rendered path states the version, so two PDFs showing different net
     * pay for the same month can be told apart rather than both reading as
     * authoritative.
     */
    #[Test]
    public function the_rendered_payslip_reports_which_version_it_is(): void
    {
        $this->assertSame(1, (int) $this->item->current_version_no);
        $this->assertFalse((bool) ($this->item->current_version_no > 1));

        app(ClosedRunWriteContext::class)->permit(
            'LOP day reversed after appeal',
            fn () => $this->item->update(['net_pay' => 91000])
        );

        $corrected = $this->item->fresh();

        $this->assertSame(2, (int) $corrected->current_version_no);
        $this->assertTrue($corrected->current_version_no > 1, 'A corrected month must be distinguishable from a first issue.');
    }

    /**
     * The stored path follows the correction. If it did not, the pre-generated
     * file would keep being served after the figure moved.
     */
    #[Test]
    public function the_served_path_moves_when_the_figure_is_corrected(): void
    {
        $before = PayrollPdfService::storagePathFor(
            $this->employee->id,
            '2026-06',
            (int) $this->item->current_version_no
        );

        app(ClosedRunWriteContext::class)->permit(
            'Recompute after attendance correction',
            fn () => $this->item->update(['net_pay' => 85000])
        );

        $after = PayrollPdfService::storagePathFor(
            $this->employee->id,
            '2026-06',
            (int) $this->item->fresh()->current_version_no
        );

        $this->assertNotSame($before, $after);
        $this->assertStringEndsWith('-v2.pdf', $after);
    }
}
