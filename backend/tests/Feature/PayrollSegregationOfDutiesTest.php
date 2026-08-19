<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Maker-checker across the whole payroll chain.
 *
 * lock → approve and approve → release already refused to let one person take
 * both sides. release → disburse did not, so a single admin could release a run
 * and then, in the very next request, declare every employee paid. That is the
 * one step that asserts money actually moved, and the first thing an internal
 * auditor asks about.
 */
class PayrollSegregationOfDutiesTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $releaser;
    private User $otherAdmin;
    private PayrollMonthlyRun $run;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();

        $this->releaser = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
            'email' => 'releaser@company.test',
        ]);

        $this->otherAdmin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
            'email' => 'checker@company.test',
        ]);
    }

    /**
     * Turn the control on explicitly rather than relying on the admin-count
     * heuristic, so the test states what it is testing.
     */
    private function requireSecondApprover(bool $required): void
    {
        $this->organization->forceFill([
            'settings' => array_merge($this->organization->settings ?? [], [
                'payroll' => array_merge($this->organization->settings['payroll'] ?? [], [
                    'requireSecondApprover' => $required,
                ]),
            ]),
        ])->saveQuietly();
    }

    private function buildReleasedRun(User $releasedBy): void
    {
        $this->run = PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => '2026-06',
            'status' => 'draft',
            'created_by' => $this->releaser->id,
        ]);

        $employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        \App\Models\EmployeeBankAccount::create([
            'organization_id' => $this->organization->id,
            'user_id' => $employee->id,
            'account_holder_name' => $employee->name,
            'account_number' => '1234567890',
            'ifsc_swift' => 'HDFC0001234',
            'bank_name' => 'HDFC',
            'is_default' => true,
        ]);

        PayrollItem::create([
            'payroll_run_id' => $this->run->id,
            'organization_id' => $this->organization->id,
            'user_id' => $employee->id,
            'month_year' => '2026-06',
            'gross_salary' => 50000,
            'total_deductions' => 10000,
            'net_pay' => 40000,
            'payment_status' => 'pending',
        ]);

        // Items must be written while the run is open — PayrollItemObserver
        // refuses writes into a closed run, which is what it is for.
        $this->run->update([
            'status' => 'released',
            'released_by' => $releasedBy->id,
            'released_at' => now(),
        ]);
    }

    private function disburseAs(User $actor)
    {
        return $this->postJson(
            '/api/payroll/runs/'.$this->run->id.'/disburse',
            [],
            $this->apiHeadersFor($actor)
        );
    }

    public function test_the_admin_who_released_a_run_cannot_also_disburse_it(): void
    {
        $this->requireSecondApprover(true);
        $this->buildReleasedRun($this->releaser);

        $this->disburseAs($this->releaser)
            ->assertStatus(422)
            ->assertJsonPath('message', 'A different admin must record this run as disbursed.');

        $this->assertSame('released', $this->run->fresh()->status, 'The run must not advance.');

        $this->assertSame(
            'pending',
            PayrollItem::where('payroll_run_id', $this->run->id)->value('payment_status'),
            'Nobody may be recorded as paid by a refused disbursement.'
        );
    }

    public function test_a_different_admin_may_disburse_it(): void
    {
        $this->requireSecondApprover(true);
        $this->buildReleasedRun($this->releaser);

        $this->disburseAs($this->otherAdmin)->assertOk();

        $this->assertSame('disbursed', $this->run->fresh()->status);
    }

    /**
     * A one- or two-admin organisation is not blocked.
     *
     * Segregation of duties needs two people to exist. Enforcing it where they
     * do not simply stops payroll, so the existing setting — and the admin-count
     * heuristic behind it — governs this step exactly as it governs the two
     * before it. No existing tenant's behaviour changes on deploy.
     */
    public function test_a_small_organisation_is_not_blocked_from_paying_its_people(): void
    {
        $this->requireSecondApprover(false);
        $this->buildReleasedRun($this->releaser);

        $this->disburseAs($this->releaser)->assertOk();

        $this->assertSame('disbursed', $this->run->fresh()->status);
    }

    public function test_the_chain_is_complete_at_every_step(): void
    {
        $source = file_get_contents(
            base_path('app/Http/Controllers/Api/PayrollDepartmentController.php')
        );

        foreach ([
            'A different admin must approve this run.',
            'A different admin must release this run.',
            'A different admin must record this run as disbursed.',
        ] as $guard) {
            $this->assertStringContainsString(
                $guard,
                $source,
                "Maker-checker is missing a step: {$guard}"
            );
        }
    }
}
