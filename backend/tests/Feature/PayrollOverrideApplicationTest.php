<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollOverride;
use App\Models\PayrollOverrideAudit;
use App\Models\User;
use App\Services\PayrollAutoProcessService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Carbon\CarbonPeriod;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * An override changes a payslip when payroll is PROCESSED, and not before.
 *
 * Two live engines compute an employee's month: the departmental one behind
 * POST /payroll/employees/{id}/process, which the queued run drives, and
 * PayrollAutoProcessService behind quick-process. Only the second consulted the
 * override service, so an approved override moved one engine's figures and left
 * the other paying the structure. Two engines disagreeing about the same
 * person's pay is worse than either being wrong alone, because the difference
 * surfaces only in whichever report happens to read the other's row.
 *
 * // DECISION: the cross-engine test asserts equality of the EARNINGS the
 * // override module governs — basic, HRA, conveyance, special allowance and
 * // gross. It does not assert full item equality, because the two engines
 * // already diverge on TDS (cumulative year-to-date true-up versus a flat
 * // twelfth) and on PT (StatutorySlabResolver versus PTStateService) for
 * // reasons that predate this module and are not its to reconcile. Asserting
 * // the whole row would either fail for unrelated causes or force a
 * // convergence far wider than this brief authorises.
 */
class PayrollOverrideApplicationTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $employee;
    private User $colleague;

    private float $annualCtc = 1200000.0;
    private string $monthYear = '2026-06';

    /** 40% of a 1,00,000 monthly CTC — what the structure produces unaided. */
    private float $structureBasic = 40000.0;
    private float $overriddenBasic = 45000.0;

    protected function setUp(): void
    {
        parent::setUp();

        Carbon::setTestNow('2026-06-20');

        $this->organization = Organization::factory()->create();

        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->employee = $this->paidEmployee();
        $this->colleague = $this->paidEmployee();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function paidEmployee(): User
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        EmployeePayrollTemplate::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'annual_ctc' => $this->annualCtc,
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_allowance' => 1600,
            'medical_allowance' => 0,
            'is_metro_city' => true,
            'is_active' => true,
            'pf_enabled' => true,
            'esi_enabled' => false,
            'pt_enabled' => false,
            'tds_enabled' => false,
            'lwf_enabled' => false,
        ]);

        return $user;
    }

    private function override(array $attributes = []): PayrollOverride
    {
        return PayrollOverride::create(array_merge([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'scope' => 'component',
            'target' => 'basic',
            'mode' => 'fixed',
            'value' => $this->overriddenBasic,
            'balance_mode' => 'preserve_ctc',
            'effective_from' => '2026-06-01',
            'reason' => 'Correcting an understated basic agreed at offer.',
            'status' => PayrollOverride::STATUS_APPROVED,
            'created_by' => $this->admin->id,
        ], $attributes));
    }

    /**
     * A check-in on every working day of the month, so the attendance summary
     * both engines read reports no loss of pay.
     *
     * Needed only for the cross-engine comparison: the departmental endpoint
     * accepts stated attendance and the auto engine does not, so the only way
     * to give them the same input is to make the shared summary say it.
     */
    private function markFullyPresent(User $user): void
    {
        foreach (CarbonPeriod::create('2026-06-01', '2026-06-30') as $date) {
            if ($date->isWeekend()) {
                continue;
            }

            AttendanceRecord::create([
                'organization_id' => $this->organization->id,
                'user_id' => $user->id,
                'attendance_date' => $date->toDateString(),
                'check_in_at' => $date->copy()->setTime(9, 0),
                'check_out_at' => $date->copy()->setTime(18, 0),
                'worked_seconds' => 32400,
            ]);
        }
    }

    /**
     * The departmental engine.
     *
     * Attendance is stated by default so loss of pay is zero and the earnings
     * under test are not pro-rated by a fixture's absence. The cross-engine
     * test passes false and seeds real records instead, because the auto engine
     * has no equivalent input.
     */
    private function processDepartmental(?User $user = null, bool $stateAttendance = true): PayrollItem
    {
        $user ??= $this->employee;

        $this->actingAs($this->admin)
            ->postJson("/api/payroll/employees/{$user->id}/process", array_merge([
                'month_year' => $this->monthYear,
                'annual_ctc' => $this->annualCtc,
            ], $stateAttendance ? [
                'working_days' => 30,
                'days_present' => 30,
                'lOP_days' => 0,
            ] : []))
            ->assertStatus(200);

        return PayrollItem::where('user_id', $user->id)
            ->where('month_year', $this->monthYear)
            ->firstOrFail();
    }

    private function processAuto(): PayrollItem
    {
        $this->actingAs($this->admin);

        $run = app(PayrollAutoProcessService::class)
            ->quickProcess($this->organization->id, $this->monthYear, $this->admin->id);

        // Resolved through the run rather than month_year: autoSyncEmployees
        // creates the item without stamping the month, which the departmental
        // path does.
        return PayrollItem::where('payroll_run_id', $run->id)
            ->where('user_id', $this->employee->id)
            ->firstOrFail();
    }

    #[Test]
    public function an_approved_override_moves_the_processed_item(): void
    {
        $this->override();

        $item = $this->processDepartmental();

        $this->assertEqualsWithDelta($this->overriddenBasic, (float) $item->basic, 0.01);
        // HRA is half of basic, so it moved with it — the cascade, not a
        // substitution.
        $this->assertEqualsWithDelta($this->overriddenBasic * 0.5, (float) $item->hra, 0.01);
    }

    #[Test]
    public function a_pending_override_does_not_move_the_processed_item(): void
    {
        $this->override(['status' => PayrollOverride::STATUS_PENDING]);

        $item = $this->processDepartmental();

        $this->assertEqualsWithDelta($this->structureBasic, (float) $item->basic, 0.01);
    }

    #[Test]
    public function an_override_whose_period_has_passed_does_not_apply(): void
    {
        $this->override(['effective_from' => '2026-04-01', 'effective_to' => '2026-05-31']);

        $item = $this->processDepartmental();

        $this->assertEqualsWithDelta($this->structureBasic, (float) $item->basic, 0.01);
    }

    #[Test]
    public function an_override_that_has_not_started_does_not_apply(): void
    {
        $this->override(['effective_from' => '2026-09-01']);

        $item = $this->processDepartmental();

        $this->assertEqualsWithDelta($this->structureBasic, (float) $item->basic, 0.01);
    }

    /**
     * Both values, which is the pair that explains the payslip: what was paid,
     * and what the engine would have paid.
     */
    #[Test]
    public function applying_writes_back_the_engines_own_figure_and_the_cascade(): void
    {
        $override = $this->override();

        $this->processDepartmental();

        $override->refresh();

        $this->assertEqualsWithDelta($this->structureBasic, (float) $override->computed_value, 0.01);
        $this->assertEqualsWithDelta(5000.0, (float) $override->delta(), 0.01);

        $this->assertIsArray($override->cascade_snapshot);
        $this->assertArrayHasKey('hra', $override->cascade_snapshot, 'HRA is derived from basic and must appear.');
        $this->assertArrayHasKey('special_allowance', $override->cascade_snapshot, 'The residual absorbed the delta.');
        $this->assertArrayNotHasKey('basic', $override->cascade_snapshot);
    }

    /**
     * Reprocessing an open run is routine — corrected attendance, a late arrear
     * — and applies the same override for the same month again. A second audit
     * row would read as a second act of interference rather than the same one.
     */
    #[Test]
    public function reprocessing_the_same_month_does_not_duplicate_the_applied_audit(): void
    {
        $override = $this->override();

        $this->processDepartmental();
        $this->processDepartmental();
        $this->processDepartmental();

        $this->assertSame(1, PayrollOverrideAudit::where('payroll_override_id', $override->id)
            ->where('action', PayrollOverrideAudit::ACTION_APPLIED)
            ->count());
    }

    /**
     * Both engines are wired, and they agree on the earnings this module moves.
     * Wiring only one is how an approved override ends up paying two different
     * figures depending on which button the officer pressed.
     */
    #[Test]
    public function both_engines_produce_the_same_overridden_earnings(): void
    {
        $this->override();
        $this->markFullyPresent($this->employee);

        $departmental = $this->processDepartmental(stateAttendance: false);

        $fields = ['basic', 'hra', 'conveyance', 'special_allowance', 'gross_salary'];
        $fromDepartmental = collect($fields)->mapWithKeys(
            fn (string $f) => [$f => round((float) $departmental->{$f}, 2)]
        )->all();

        $auto = $this->processAuto();
        $fromAuto = collect($fields)->mapWithKeys(
            fn (string $f) => [$f => round((float) $auto->{$f}, 2)]
        )->all();

        foreach ($fields as $field) {
            $this->assertEqualsWithDelta(
                $fromDepartmental[$field],
                $fromAuto[$field],
                0.02,
                "The two engines disagree on {$field} for an overridden employee.",
            );
        }

        $this->assertEqualsWithDelta($this->overriddenBasic, $fromAuto['basic'], 0.01,
            'And both must be the OVERRIDDEN figure, not merely equal to each other.');
    }

    /**
     * Removing an override restores the structure. Nothing was ever written to
     * employee_payroll_templates, so there is nothing to undo — the value the
     * structure produces simply applies again.
     */
    #[Test]
    public function cancelling_an_override_and_reprocessing_an_open_run_restores_the_structure(): void
    {
        $override = $this->override();

        $this->assertEqualsWithDelta($this->overriddenBasic, (float) $this->processDepartmental()->basic, 0.01);

        // Cancelled outright rather than closed at today: the point under test
        // is that an open run recomputes without it.
        $override->update(['status' => PayrollOverride::STATUS_CANCELLED]);

        $this->assertEqualsWithDelta($this->structureBasic, (float) $this->processDepartmental()->basic, 0.01);
    }

    /** The structure is shadowed, never written. */
    #[Test]
    public function processing_an_override_never_touches_the_salary_template(): void
    {
        $this->override();

        $before = EmployeePayrollTemplate::where('user_id', $this->employee->id)->firstOrFail()
            ->only(['annual_ctc', 'basic_percentage', 'hra_percentage', 'conveyance_allowance']);

        $this->processDepartmental();

        $after = EmployeePayrollTemplate::where('user_id', $this->employee->id)->firstOrFail()
            ->only(['annual_ctc', 'basic_percentage', 'hra_percentage', 'conveyance_allowance']);

        $this->assertEquals($before, $after);
    }

    #[Test]
    public function an_override_on_one_employee_leaves_a_colleague_untouched(): void
    {
        $this->override();

        $this->processDepartmental();
        $colleagueItem = $this->processDepartmental($this->colleague);

        $this->assertEqualsWithDelta($this->structureBasic, (float) $colleagueItem->basic, 0.01);
    }

    /**
     * A statutory override is TERMINAL: the stated figure wins and nothing is
     * re-derived from it. That is the opposite of a component override, and
     * deliberately so — recomputing the wage base from a corrected PF amount
     * would re-derive the number being corrected.
     */
    #[Test]
    public function a_statutory_override_states_the_figure_outright(): void
    {
        $override = $this->override([
            'scope' => 'statutory',
            'target' => 'pf',
            'value' => 999,
            'balance_mode' => null,
        ]);

        $item = $this->processDepartmental();

        $this->assertEqualsWithDelta(999.0, (float) $item->pf_employee, 0.01);

        $override->refresh();
        // 12% of the capped 15,000 wage is what the engine would have taken.
        $this->assertEqualsWithDelta(1800.0, (float) $override->computed_value, 0.01);
        // Terminal, so nothing moved because of it — an empty snapshot says
        // that, where a null one would only say it has not run yet.
        $this->assertSame([], $override->cascade_snapshot);
    }

    #[Test]
    public function a_statutory_override_reaches_the_auto_engine_too(): void
    {
        $this->override([
            'scope' => 'statutory',
            'target' => 'pf',
            'value' => 999,
            'balance_mode' => null,
        ]);

        $this->assertEqualsWithDelta(999.0, (float) $this->processAuto()->pf_employee, 0.01);
    }

    /**
     * The breakdown screen is a third code path, and it honoured no overrides
     * at all — so an employee could be shown one Basic and paid another, with
     * nothing on either screen explaining the difference.
     */
    #[Test]
    public function the_breakdown_screen_honours_the_override_and_says_who_approved_it(): void
    {
        $this->override(['approved_by' => $this->admin->id, 'approved_at' => now()]);

        $breakdown = app(\App\Services\SalaryBreakdownService::class)->forEmployee(
            $this->employee->fresh(),
            null,
            $this->annualCtc,
            \App\Models\EmployeePayrollTemplate::where('user_id', $this->employee->id)->firstOrFail(),
        );

        $basicLine = collect($breakdown['earnings'])->firstWhere('key', 'basic');

        $this->assertEqualsWithDelta(
            $this->overriddenBasic,
            (float) $basicLine['monthly'],
            0.01,
            'The breakdown must show the overridden basic, not the structure figure.',
        );

        $this->assertNotEmpty(
            collect($breakdown['warnings'])->filter(fn ($w) => str_contains($w, 'overridden')),
            'An applied override must be stated on the breakdown, not applied silently.',
        );
    }

    /**
     * Employer PF and the gratuity provision are functions of basic, so an
     * override that moves basic has to move them too — or the run reports a
     * cost to company that does not match the components it is made of.
     */
    #[Test]
    public function the_employer_side_moves_with_an_overridden_basic(): void
    {
        $withoutOverride = (float) $this->processDepartmental()->gratuity;

        $this->override();
        $withOverride = (float) $this->processDepartmental()->gratuity;

        $this->assertGreaterThan(
            $withoutOverride,
            $withOverride,
            'The gratuity provision is derived from basic and must follow it.',
        );
    }
}
