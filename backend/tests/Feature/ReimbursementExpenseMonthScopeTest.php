<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Reimbursement;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A claim belongs to the month the expense happened, not the month it was filed.
 *
 * `scopeForMonth` filtered on `created_at`, while the payroll engine pays
 * approved claims by `expense_date` (PayrollDepartmentController's
 * `whereMonth('expense_date', ...)`). The two disagreed for any claim submitted
 * after the month it belonged to — which is most of them, since people file
 * receipts late. In this database 56 of 176 rows straddle that boundary.
 *
 * The visible symptom was the payroll wizard's Reimbursements step showing ₹0
 * for everybody while the run would have paid them: the screen an admin checks
 * before approving disagreed with what processing actually does.
 *
 * `expense_date` is the correct basis. A taxi taken on 28 August belongs to
 * August whether the receipt is filed on the 29th or in September.
 */
class ReimbursementExpenseMonthScopeTest extends TestCase
{
    use RefreshDatabase;

    private function claim(User $user, string $expenseDate, string $createdAt, float $amount = 2400): Reimbursement
    {
        $r = Reimbursement::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'title' => 'Client travel',
            'description' => 'Taxi',
            'expense_date' => $expenseDate,
            'amount' => $amount,
            'status' => 'approved',
        ]);

        // created_at is normally "now"; force it so the two dates diverge the
        // way a late-filed receipt does.
        Reimbursement::withoutGlobalScopes()->where('id', $r->id)
            ->update(['created_at' => $createdAt]);

        return $r->fresh();
    }

    private function employee(): User
    {
        $org = Organization::factory()->create();

        return User::factory()->create(['organization_id' => $org->id, 'role' => 'employee']);
    }

    public function test_a_claim_filed_late_still_belongs_to_the_month_it_was_incurred(): void
    {
        $user = $this->employee();
        $claim = $this->claim($user, '2026-08-28', '2026-09-01 10:00:00');

        $august = Reimbursement::query()->forExpenseMonth('2026-08')->pluck('id');

        $this->assertContains(
            $claim->id,
            $august->all(),
            'a receipt for 28 August belongs to August however late it was submitted'
        );
    }

    public function test_it_does_not_leak_into_the_month_it_was_filed(): void
    {
        $user = $this->employee();
        $claim = $this->claim($user, '2026-08-28', '2026-09-01 10:00:00');

        $september = Reimbursement::query()->forExpenseMonth('2026-09')->pluck('id');

        $this->assertNotContains(
            $claim->id,
            $september->all(),
            'filing a claim in September must not make it a September expense'
        );
    }

    public function test_the_listing_agrees_with_what_payroll_would_pay(): void
    {
        $user = $this->employee();
        $this->claim($user, '2026-08-10', '2026-09-01 10:00:00', 2400);
        $this->claim($user, '2026-08-20', '2026-08-21 10:00:00', 600);

        // What the review screen shows for August…
        $listed = (float) Reimbursement::query()->forExpenseMonth('2026-08')->sum('amount');

        // …and what the payroll run would pick up for the same month.
        $payable = (float) Reimbursement::query()
            ->where('user_id', $user->id)
            ->where('status', 'approved')
            ->whereMonth('expense_date', 8)
            ->whereYear('expense_date', 2026)
            ->sum('amount');

        $this->assertSame(
            $payable,
            $listed,
            'the review screen and the payroll engine must count the same claims'
        );
        $this->assertSame(3000.0, $listed);
    }

    public function test_a_claim_with_no_expense_date_falls_back_to_when_it_was_filed(): void
    {
        $user = $this->employee();

        $r = Reimbursement::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'title' => 'Undated',
            'amount' => 500,
            'status' => 'approved',
        ]);
        Reimbursement::withoutGlobalScopes()->where('id', $r->id)
            ->update(['created_at' => '2026-08-15 10:00:00', 'expense_date' => null]);

        $this->assertContains(
            $r->id,
            Reimbursement::query()->forExpenseMonth('2026-08')->pluck('id')->all(),
            'the column is nullable, so an undated claim must still be findable'
        );
    }
}
