<?php

namespace Tests\Feature;

use App\Models\EmployeePayrollTemplate;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\PayrollAutoProcessService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Tests\Concerns\BuildsPayrollFixture;
use Tests\TestCase;

/**
 * An employee with no annual CTC must be excluded from a run, not paid ₹0.
 *
 * calculateAllItems() computed $annualCtc / 12 with no guard, so an unset CTC
 * produced zeroes all the way down and the run stored a ₹0 gross, ₹0 net and
 * a ₹0 payslip as a successful result. SalaryCalculationService — the engine
 * behind the payslip an employee actually sees — throws for the same person,
 * so the two disagreed about whether the employee could be paid at all.
 *
 * On a live pay group, 11 of 15 members were in this state. Every ₹0 on the
 * payroll dashboard traced back to it.
 */
class PayrollUnconfiguredEmployeeTest extends TestCase
{
    use RefreshDatabase;
    use BuildsPayrollFixture;

    private const MONTH = '2026-05';

    protected function setUp(): void
    {
        parent::setUp();
        $this->buildPayrollFixture();
    }

    /** A template with no CTC at all — the state 11 of 15 live members were in. */
    private function giveTemplateWithoutCtc(User $user): void
    {
        EmployeePayrollTemplate::getOrCreateForUser($user->id, $this->organization->id);

        \DB::table('employee_payroll_templates')
            ->where('user_id', $user->id)
            ->update(['annual_ctc' => null]);
    }

    private function process(): PayrollMonthlyRun
    {
        Auth::setUser($this->admin);

        return app(PayrollAutoProcessService::class)
            ->processForUsers($this->organization->id, self::MONTH, null, $this->admin->id);
    }

    private function itemFor(PayrollMonthlyRun $run, User $user): ?PayrollItem
    {
        return PayrollItem::where('payroll_run_id', $run->id)
            ->where('user_id', $user->id)
            ->first();
    }

    public function test_an_employee_with_no_ctc_is_excluded_rather_than_paid_zero(): void
    {
        $this->giveCtc($this->employee, 600000);
        $this->giveTemplateWithoutCtc($this->manager);

        $run = $this->process();

        $this->assertNull(
            $this->itemFor($run, $this->manager),
            'An employee with no annual CTC must not carry a payroll item — a ₹0 item reaches '
            . 'both the payslip and the bank file.'
        );

        $paid = $this->itemFor($run, $this->employee);
        $this->assertNotNull($paid, 'The configured employee should still have been processed.');
        $this->assertGreaterThan(0, (float) $paid->net_pay);
    }

    public function test_a_zero_ctc_is_treated_the_same_as_an_unset_one(): void
    {
        $this->giveCtc($this->employee, 600000);
        $this->giveCtc($this->manager, 0);

        $run = $this->process();

        $this->assertNull(
            $this->itemFor($run, $this->manager),
            'A CTC of exactly 0 is as unpayable as a missing one.'
        );
    }

    public function test_the_run_names_who_it_excluded_and_why(): void
    {
        $this->giveCtc($this->employee, 600000);
        $this->giveTemplateWithoutCtc($this->manager);

        $run = $this->process()->fresh();

        // Unpayable people are reported, never silently dropped.
        $this->assertStringContainsString($this->manager->name, (string) $run->processing_message);
        $this->assertStringContainsString('no annual CTC', (string) $run->processing_message);
    }

    public function test_total_employees_counts_only_people_who_were_paid(): void
    {
        $this->giveCtc($this->employee, 600000);
        $this->giveTemplateWithoutCtc($this->manager);
        $this->giveCtc($this->hr, 0);

        $run = $this->process()->fresh();

        $this->assertSame(
            1,
            (int) $run->total_employees,
            'total_employees is the number of people this run paid, not the number it was asked about.'
        );
    }

    public function test_the_checklist_flags_a_missing_ctc_as_an_error(): void
    {
        // The engine excludes them; the checklist is what tells HR who to fix.
        // Checking only that a template exists let an unset CTC through.
        $this->giveCtc($this->employee, 600000);
        $this->giveTemplateWithoutCtc($this->manager);

        $run = $this->process();

        $flagged = \DB::table('payroll_run_checklists as c')
            ->join('payroll_checklist_items as i', 'i.id', '=', 'c.checklist_item_id')
            ->where('c.payroll_run_id', $run->id)
            ->where('i.check_code', 'missing_ctc')
            ->where('c.status', 'failed')
            ->exists();

        $this->assertTrue($flagged, 'The checklist should raise missing_ctc for an employee with no CTC.');
    }
}
