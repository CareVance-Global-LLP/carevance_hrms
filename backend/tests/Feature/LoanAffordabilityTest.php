<?php

namespace Tests\Feature;

use App\Models\EmployeeLoan;
use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\User;
use App\Services\Payroll\LoanAffordability;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * No instalment may push total deductions past half of wages.
 *
 * Code on Wages 2019, s.18. The August 2026 run produced three employees with
 * negative net pay because nothing in the loan path had ever compared an EMI to
 * the salary it would be recovered from — the worst was ₹17,089 deducted from
 * ₹8,542 of gross, finishing at −₹8,547.
 */
class LoanAffordabilityTest extends TestCase
{
    use RefreshDatabase;

    private function earner(float $annualCtc): User
    {
        $org = Organization::factory()->create();
        $user = User::factory()->create(['organization_id' => $org->id, 'role' => 'employee']);

        EmployeePayrollTemplate::getOrCreateForUser($user->id, $org->id);
        \DB::table('employee_payroll_templates')
            ->where('user_id', $user->id)
            ->update(['annual_ctc' => $annualCtc, 'is_active' => true]);

        return $user;
    }

    private function giveLoan(User $user, float $emi, float $remaining = 100000): EmployeeLoan
    {
        return EmployeeLoan::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'loan_type' => 'loan',
            'amount' => $remaining,
            'emi_amount' => $emi,
            'total_installments' => 12,
            'paid_installments' => 0,
            'remaining_amount' => $remaining,
            'status' => 'approved',
        ]);
    }

    private function service(): LoanAffordability
    {
        return app(LoanAffordability::class);
    }

    public function test_the_ceiling_is_half_of_monthly_gross(): void
    {
        $user = $this->earner(1200000);
        $a = $this->service()->maxEmiFor($user);

        $this->assertSame(
            round($a['monthly_gross'] * 0.5, 2),
            $a['ceiling'],
            'the statutory ceiling is 50% of wages'
        );
        $this->assertSame(
            round($a['ceiling'] - $a['statutory_deductions'], 2),
            $a['max_emi'],
            'headroom is the ceiling less what is already being deducted'
        );
    }

    public function test_the_real_failure_from_august_is_refused(): void
    {
        // Aayush borwal: ₹98,000 CTC, approved for a ₹15,000 monthly instalment.
        $user = $this->earner(98000);

        $result = $this->service()->check($user, 15000);

        $this->assertFalse($result['allowed']);
        $this->assertStringContainsString('50%', $result['message']);
        $this->assertStringContainsString('Code on Wages', $result['message']);
    }

    public function test_an_affordable_instalment_is_allowed(): void
    {
        $user = $this->earner(1200000);
        $max = $this->service()->maxEmiFor($user)['max_emi'];

        $this->assertTrue($this->service()->check($user, $max)['allowed'], 'exactly at the limit is allowed');
        $this->assertFalse($this->service()->check($user, $max + 1)['allowed'], 'a rupee over is not');
    }

    public function test_an_existing_loan_reduces_the_headroom(): void
    {
        $user = $this->earner(1200000);
        $before = $this->service()->maxEmiFor($user)['max_emi'];

        $this->giveLoan($user, 5000);
        $after = $this->service()->maxEmiFor($user)['max_emi'];

        $this->assertSame(
            round($before - 5000, 2),
            $after,
            'a second commitment competes for the same statutory headroom'
        );
    }

    public function test_a_loan_being_reassessed_is_not_counted_against_itself(): void
    {
        $user = $this->earner(1200000);
        $loan = $this->giveLoan($user, 5000);

        $this->assertSame(
            $this->service()->maxEmiFor($user, $loan->id)['max_emi'],
            $this->service()->maxEmiFor($user)['max_emi'] + 5000,
            're-checking a loan at approval must exclude its own instalment'
        );
    }

    public function test_somebody_already_at_the_ceiling_has_no_headroom_rather_than_negative(): void
    {
        $user = $this->earner(240000);
        $this->giveLoan($user, 999999);

        $a = $this->service()->maxEmiFor($user);

        $this->assertSame(0.0, $a['max_emi'], 'headroom floors at zero, it never goes negative');
        $this->assertNotNull($a['reason']);
        $this->assertFalse($this->service()->check($user, 100)['allowed']);
    }

    public function test_no_salary_structure_says_so_rather_than_refusing_silently(): void
    {
        $org = Organization::factory()->create();
        $user = User::factory()->create(['organization_id' => $org->id, 'role' => 'employee']);

        $a = $this->service()->maxEmiFor($user);

        $this->assertFalse($a['has_salary']);
        $this->assertStringContainsString('no salary structure', strtolower($a['reason']));
    }

    /**
     * Unanswerable must not become a veto.
     *
     * Refusing every loan for anyone whose payroll is not configured yet is a
     * worse behaviour than the unaffordable EMI this guard exists to stop.
     * PayrollSelfServiceAuthorizationTest depends on this: it raises loans for
     * employees who have no salary structure at all.
     */
    public function test_it_defers_rather_than_refusing_when_it_cannot_assess(): void
    {
        $org = Organization::factory()->create();
        $user = User::factory()->create(['organization_id' => $org->id, 'role' => 'employee']);

        $result = $this->service()->check($user, 999999);

        $this->assertTrue($result['allowed'], 'no salary on record means no assessment, not a refusal');
        $this->assertNotNull($result['message'], 'but the reason must still be surfaced');
    }
}
