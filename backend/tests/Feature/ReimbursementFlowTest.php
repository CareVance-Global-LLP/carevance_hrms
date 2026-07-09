<?php

namespace Tests\Feature;

use App\Models\EmployeeWorkInfo;
use App\Models\Organization;
use App\Models\Reimbursement;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ReimbursementFlowTest extends TestCase
{
    use RefreshDatabase;

    private function makeOrg(): Organization
    {
        return Organization::create([
            'name' => 'Test Org',
            'slug' => 'test-org',
            'plan_code' => 'basic_payroll',
            'subscription_status' => 'active',
        ]);
    }

    private function makeUser(Organization $org, string $role): User
    {
        return User::create([
            'name' => ucfirst($role).' User',
            'email' => $role.'@example.com',
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $org->id,
        ]);
    }

    public function test_full_reimbursement_approval_flow(): void
    {
        $org = $this->makeOrg();
        $admin = $this->makeUser($org, 'admin');
        $manager = $this->makeUser($org, 'manager');
        $employee = $this->makeUser($org, 'employee');

        EmployeeWorkInfo::create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'reporting_manager_id' => $manager->id,
        ]);

        // 1. Employee submits a claim -> pending_manager
        $submit = $this->postJson('/api/payroll/reimbursements', [
            'amount' => 1500.00,
            'currency' => 'INR',
            'expense_date' => '2026-07-01',
            'description' => 'Client travel',
            'title' => 'Travel',
        ], $this->apiHeadersFor($employee));

        $submit->assertCreated();
        $id = $submit->json('reimbursement.id');
        $this->assertSame('pending_manager', $submit->json('reimbursement.approval_level'));

        // 2. Manager approves -> forwards to admin (pending_admin)
        $mgrApprove = $this->postJson("/api/payroll/reimbursements/{$id}/manager-approve", [], $this->apiHeadersFor($manager));
        $mgrApprove->assertOk();
        $this->assertSame('pending_admin', $mgrApprove->json('reimbursement.approval_level'));

        // 3. Claim now appears in admin inbox
        $adminInbox = $this->getJson('/api/payroll/reimbursements/inbox/admin', $this->apiHeadersFor($admin));
        $adminInbox->assertOk();
        $adminInbox->assertJsonFragment(['id' => $id]);

        // 4. Admin final approval -> approved
        $adminApprove = $this->postJson("/api/payroll/reimbursements/{$id}/approve", [], $this->apiHeadersFor($admin));
        $adminApprove->assertOk();
        $this->assertSame('approved', $adminApprove->json('reimbursement.approval_level'));
        $this->assertSame('approved', $adminApprove->json('reimbursement.status'));

        // 5. Appears in Pending Payments
        $pending = $this->getJson('/api/payroll/reimbursements/pending-payments', $this->apiHeadersFor($admin));
        $pending->assertOk();
        $pending->assertJsonFragment(['id' => $id]);

        // 6. Mark paid (outside payroll + reference) -> paid_at set
        $markPaid = $this->postJson("/api/payroll/reimbursements/{$id}/mark-paid", [
            'payout_mode' => 'outside_payroll',
            'payment_reference' => 'REF-998877',
        ], $this->apiHeadersFor($admin));
        $markPaid->assertOk();
        $this->assertNotNull($markPaid->json('reimbursement.paid_at'));

        // 7. No longer in Pending Payments
        $pendingAfter = $this->getJson('/api/payroll/reimbursements/pending-payments', $this->apiHeadersFor($admin));
        $pendingAfter->assertOk();
        $pendingAfter->assertJsonMissing(['id' => $id]);

        // Sanity: DB row reflects the full lifecycle
        $r = Reimbursement::find($id);
        $this->assertSame('approved', $r->approval_level);
        $this->assertSame('approved', $r->status);
        $this->assertSame('outside_payroll', $r->payout_mode);
        $this->assertSame('REF-998877', $r->payment_reference);
        $this->assertNotNull($r->paid_at);
        $this->assertNotNull($r->manager_approved_at);
        $this->assertNotNull($r->approved_at);
    }

    /**
     * Verifies the badge counts that drive the sidebar ("Reimbursements"
     * item) and the in-page tabs/summary cards, including the unread
     * semantics of inbox-count and the mark-as-read decrement.
     *
     * Sidebar  -> inbox-count (manager_inbox for non-admins, admin_inbox for strict admin), UNREAD only
     * Tabs/Cards -> getSummary totals (pending_manager_count / pending_admin_count / pending_payment_count)
     */
    public function test_reimbursement_badges_across_sections_and_sidebar(): void
    {
        $org = $this->makeOrg();
        $admin = $this->makeUser($org, 'admin');
        $manager = $this->makeUser($org, 'manager');
        $employee = $this->makeUser($org, 'employee');

        EmployeeWorkInfo::create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'reporting_manager_id' => $manager->id,
        ]);

        $mHeaders = $this->apiHeadersFor($manager);
        $aHeaders = $this->apiHeadersFor($admin);

        $inboxCount = fn (array $h) => $this->getJson('/api/payroll/reimbursements/inbox-count', $h)->json();
        $summary = fn (array $h) => $this->getJson('/api/payroll/reimbursements/summary', $h)->json();

        // ── Step 1: employee submits ───────────────────────────────
        $id = $this->postJson('/api/payroll/reimbursements', [
            'amount' => 1200.00, 'currency' => 'INR',
            'expense_date' => '2026-07-02', 'description' => 'Taxi', 'title' => 'Taxi',
        ], $this->apiHeadersFor($employee))->json('reimbursement.id');

        // Sidebar (manager) shows 1 unread manager-inbox claim
        $this->assertSame(1, $inboxCount($mHeaders)['manager_inbox']);
        $this->assertSame(0, $inboxCount($mHeaders)['admin_inbox']);
        // Sidebar (admin) shows 0 (claim not yet at admin level)
        $this->assertSame(0, $inboxCount($aHeaders)['admin_inbox']);

        // Manager Inbox tab total (summary card) = 1 pending_manager
        $this->assertSame(1, $summary($mHeaders)['pending_manager_count']);
        $this->assertSame(0, $summary($mHeaders)['pending_admin_count']);

        // Manager inbox listing includes the claim, marked unread
        $mgrInbox = $this->getJson('/api/payroll/reimbursements/inbox/manager', $mHeaders)->json();
        $this->assertCount(1, $mgrInbox);
        $this->assertFalse($mgrInbox[0]['is_read']);

        // ── Step 2: manager opens the claim (mark read) ────────────
        $this->postJson("/api/payroll/reimbursements/{$id}/mark-read", ['role' => 'manager'], $mHeaders)->assertOk();

        // Sidebar manager badge decrements to 0 (read state)
        $this->assertSame(0, $inboxCount($mHeaders)['manager_inbox']);
        // Manager Inbox tab total is UNCHANGED (still pending_manager)
        $this->assertSame(1, $summary($mHeaders)['pending_manager_count']);
        // Listing now reports is_read = true
        $mgrInbox = $this->getJson('/api/payroll/reimbursements/inbox/manager', $mHeaders)->json();
        $this->assertTrue($mgrInbox[0]['is_read']);

        // ── Step 3: manager approves -> admin level ───────────────
        $this->postJson("/api/payroll/reimbursements/{$id}/manager-approve", [], $mHeaders)->assertOk();

        // Manager sidebar badge stays 0 (no longer pending_manager)
        $this->assertSame(0, $inboxCount($mHeaders)['manager_inbox']);
        // Admin sidebar badge = 1 unread pending_admin
        $this->assertSame(1, $inboxCount($aHeaders)['admin_inbox']);
        // Admin Inbox tab total = 1 pending_admin
        $this->assertSame(1, $summary($aHeaders)['pending_admin_count']);

        $adminInbox = $this->getJson('/api/payroll/reimbursements/inbox/admin', $aHeaders)->json();
        $this->assertCount(1, $adminInbox);
        $this->assertFalse($adminInbox[0]['is_read']);

        // ── Step 4: admin opens the claim (mark read) ──────────────
        $this->postJson("/api/payroll/reimbursements/{$id}/mark-read", ['role' => 'admin'], $aHeaders)->assertOk();

        $this->assertSame(0, $inboxCount($aHeaders)['admin_inbox']);
        $this->assertSame(1, $summary($aHeaders)['pending_admin_count']);
        $adminInbox = $this->getJson('/api/payroll/reimbursements/inbox/admin', $aHeaders)->json();
        $this->assertTrue($adminInbox[0]['is_read']);

        // ── Step 5: admin approves -> approved/pending payment ────
        $this->postJson("/api/payroll/reimbursements/{$id}/approve", [], $aHeaders)->assertOk();

        // Admin sidebar badge stays 0 (no longer pending_admin)
        $this->assertSame(0, $inboxCount($aHeaders)['admin_inbox']);
        // Pending Payments tab total (summary card) = 1
        $this->assertSame(1, $summary($aHeaders)['pending_payment_count']);
        // Pending Payments endpoint returns the claim
        $pending = $this->getJson('/api/payroll/reimbursements/pending-payments', $aHeaders)->json();
        $this->assertCount(1, $pending);

        // ── Step 6: admin marks paid ───────────────────────────────
        $this->postJson("/api/payroll/reimbursements/{$id}/mark-paid", [
            'payout_mode' => 'outside_payroll', 'payment_reference' => 'R-1',
        ], $aHeaders)->assertOk();

        // Pending Payments tab total drops to 0, endpoint no longer returns it
        $this->assertSame(0, $summary($aHeaders)['pending_payment_count']);
        $pending = $this->getJson('/api/payroll/reimbursements/pending-payments', $aHeaders)->json();
        $this->assertCount(0, $pending);
    }

    /**
     * The month_year filter must scope every list and summary endpoint by the
     * SUBMITTED date (created_at), not the expense date. A claim submitted in
     * July with a June expense date must appear under "July".
     */
    public function test_month_year_filters_by_submitted_date(): void
    {
        $org = $this->makeOrg();
        $admin = $this->makeUser($org, 'admin');
        $manager = $this->makeUser($org, 'manager');
        $employee = $this->makeUser($org, 'employee');

        EmployeeWorkInfo::create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'reporting_manager_id' => $manager->id,
        ]);

        $eHeaders = $this->apiHeadersFor($employee);

        // Create a claim and force its submitted date (created_at) so the
        // month filter is deterministic regardless of the test run time.
        $create = function (string $expenseDate, string $createdAt) use ($eHeaders) {
            $id = $this->postJson('/api/payroll/reimbursements', [
                'amount' => 500.00, 'expense_date' => $expenseDate, 'description' => 'Expense',
            ], $eHeaders)->json('reimbursement.id');
            Reimbursement::where('id', $id)->update(['created_at' => $createdAt]);
            return $id;
        };

        // $jul   : expense July,   submitted July
        // $jun   : expense June,   submitted June
        // $cross : expense June,   submitted July  (proves submitted-date filtering)
        $jul = $create('2026-07-15', '2026-07-10 10:00:00');
        $jun = $create('2026-06-15', '2026-06-10 10:00:00');
        $cross = $create('2026-06-15', '2026-07-20 10:00:00');

        $aHeaders = $this->apiHeadersFor($admin);
        $mHeaders = $this->apiHeadersFor($manager);

        $idsIn = fn (array $list) => array_column($list, 'id');

        // list (index) — admin sees all org
        $this->assertCount(3, $this->getJson('/api/payroll/reimbursements', $aHeaders)->json());
        $julList = $this->getJson('/api/payroll/reimbursements?month_year=2026-07', $aHeaders)->json();
        $this->assertEqualsCanonicalizing([$jul, $cross], $idsIn($julList)); // submitted in July
        $junList = $this->getJson('/api/payroll/reimbursements?month_year=2026-06', $aHeaders)->json();
        $this->assertSame([$jun], $idsIn($junList)); // submitted in June

        // my submissions (employee)
        $this->assertCount(2, $this->getJson('/api/payroll/reimbursements/mine?month_year=2026-07', $eHeaders)->json());
        $this->assertCount(3, $this->getJson('/api/payroll/reimbursements/mine', $eHeaders)->json());

        // summary counts respect the submitted month
        $this->assertSame(3, $this->getJson('/api/payroll/reimbursements/summary', $aHeaders)->json()['total_count']);
        $this->assertSame(2, $this->getJson('/api/payroll/reimbursements/summary?month_year=2026-07', $aHeaders)->json()['total_count']);
        $this->assertSame(1, $this->getJson('/api/payroll/reimbursements/summary?month_year=2026-06', $aHeaders)->json()['total_count']);

        // pending payments — after all approved, month filter (submitted) applies
        foreach ([$jul, $jun, $cross] as $id) {
            $this->postJson("/api/payroll/reimbursements/{$id}/manager-approve", [], $mHeaders)->assertOk();
            $this->postJson("/api/payroll/reimbursements/{$id}/approve", [], $aHeaders)->assertOk();
        }

        $this->assertCount(3, $this->getJson('/api/payroll/reimbursements/pending-payments', $aHeaders)->json());
        $this->assertCount(2, $this->getJson('/api/payroll/reimbursements/pending-payments?month_year=2026-07', $aHeaders)->json());
        $this->assertCount(1, $this->getJson('/api/payroll/reimbursements/pending-payments?month_year=2026-06', $aHeaders)->json());
    }
}
