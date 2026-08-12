<?php

namespace Tests\Feature;

use App\Models\PayrollMonthlyRun;
use App\Services\PayrollAutoProcessService;
use App\Services\PayrollValidationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Tests\Concerns\BuildsPayrollFixture;
use Tests\TestCase;

/**
 * A month that has been disbursed is a closed month.
 *
 * Four call sites each carried their own copy of the "closed" status list, and
 * every one read ['locked', 'approved', 'released', 'paid']. 'paid' is not a
 * status this model ever takes, and 'disbursed' — the terminal state every
 * completed run reaches — was absent. So the moment a month was genuinely
 * finished, it became invisible to all four.
 *
 * The consequence that matters is the last one: month-over-month variance is
 * the standard control for catching a payroll error before it is paid, and it
 * silently reported "nothing to compare against" from the second month on.
 */
class PayrollClosedMonthVisibilityTest extends TestCase
{
    use RefreshDatabase;
    use BuildsPayrollFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->buildPayrollFixture();
        $this->giveCtc($this->employee, 1200000);
        Auth::setUser($this->admin);
    }

    private function runFor(string $monthYear, string $status): PayrollMonthlyRun
    {
        $run = app(PayrollAutoProcessService::class)
            ->processForUsers($this->organization->id, $monthYear, null, $this->admin->id);

        $run->update(['status' => $status]);

        return $run->fresh();
    }

    public function test_the_closed_status_list_matches_the_lifecycle(): void
    {
        // 'paid' never occurs; 'disbursed' is where every completed run ends up.
        $this->assertContains('disbursed', PayrollMonthlyRun::CLOSED_STATUSES);
        $this->assertNotContains('paid', PayrollMonthlyRun::CLOSED_STATUSES);
    }

    public function test_a_disbursed_previous_month_is_found_for_comparison(): void
    {
        $this->runFor('2026-04', 'disbursed');
        $current = $this->runFor('2026-05', 'draft');

        $diff = app(PayrollAutoProcessService::class)->getPayrollDiff($current);

        $this->assertTrue(
            $diff['has_prev'],
            'A month that was actually disbursed must count as the previous month. Reporting '
            . '"No previous month data" disables month-over-month variance entirely.'
        );
        $this->assertSame('2026-04', $diff['prev_month']);
    }

    public function test_detect_changes_does_not_call_everyone_a_new_joiner(): void
    {
        $this->runFor('2026-04', 'disbursed');

        $changes = app(PayrollAutoProcessService::class)
            ->detectChanges($this->organization->id, '2026-05');

        // With April invisible, every employee looked new every month.
        $this->assertArrayNotHasKey(
            'new_joiners',
            $changes,
            'Nobody joined between April and May, so no new joiners should be reported.'
        );
    }

    public function test_pre_run_checks_refuse_a_month_that_was_already_disbursed(): void
    {
        $this->runFor('2026-04', 'disbursed');

        $checks = app(PayrollValidationService::class)
            ->preRunChecks($this->organization->id, '2026-04');

        $this->assertFalse(
            $checks['checks']['existing_run']['passed'],
            'A month whose money has already left the bank must not report "No existing locked run".'
        );
    }

    public function test_an_open_month_still_reads_as_open(): void
    {
        $this->runFor('2026-04', 'draft');

        $checks = app(PayrollValidationService::class)
            ->preRunChecks($this->organization->id, '2026-04');

        $this->assertTrue(
            $checks['checks']['existing_run']['passed'],
            'A draft run is still open and must not block reprocessing.'
        );
    }
}
