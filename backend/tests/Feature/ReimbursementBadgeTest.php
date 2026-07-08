<?php

namespace Tests\Feature;

use App\Models\EmployeeWorkInfo;
use App\Models\Organization;
use App\Models\Reimbursement;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ReimbursementBadgeTest extends TestCase
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

    private function inboxCount(User $user): array
    {
        return $this->getJson('/api/payroll/reimbursements/inbox-count', $this->apiHeadersFor($user))
            ->assertOk()
            ->json();
    }

    private function summary(User $user): array
    {
        return $this->getJson('/api/payroll/reimbursements/summary', $this->apiHeadersFor($user))
            ->assertOk()
            ->json();
    }

    /**
     * Sidebar badge (inbox-count, UNREAD only) and in-page tab/card badges
     * (getSummary, TOTAL) must stay consistent with the approval workflow and
     * with the mark-as-read action.
     */
    public function test_badges_across_sidebar_and_all_sections(): void
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

        // ── After employee submits (pending_manager) ──────────────
        $submit = $this->postJson('/api/payroll/reimbursements', [
            'amount' => 1000.00,
            'expense_date' => '2026-07-01',
            'description' => 'Travel',
        ], $this->apiHeadersFor($employee))->assertCreated();
        $id = $submit->json('reimbursement.id');

        // Sidebar (manager sees manager_inbox, unread)
        $this->assertSame(1, $this->inboxCount($manager)['manager_inbox']);
        $this->assertSame(0, $this->inboxCount($manager)['admin_inbox']);
        // Employee has no direct reports -> 0
        $this->assertSame(0, $this->inboxCount($employee)['manager_inbox']);
        // Admin sees nothing pending-admin yet
        $this->assertSame(0, $this->inboxCount($admin)['admin_inbox']);

        // In-page tab/card totals (manager scope)
        $this->assertSame(1, $this->summary($manager)['pending_manager_count']);
        $this->assertSame(0, $this->summary($manager)['pending_admin_count']);
        // Admin totals
        $this->assertSame(1, $this->summary($admin)['pending_manager_count']);
        $this->assertSame(0, $this->summary($admin)['pending_admin_count']);

        // Manager inbox listing flags the claim unread
        $mgrInbox = $this->getJson('/api/payroll/reimbursements/inbox/manager', $this->apiHeadersFor($manager))->assertOk()->json();
        $this->assertCount(1, $mgrInbox);
        $this->assertFalse($mgrInbox[0]['is_read']);

        // ── Manager opens the claim -> sidebar badge must decrement ──
        $this->postJson("/api/payroll/reimbursements/{$id}/mark-read", ['role' => 'manager'], $this->apiHeadersFor($manager))->assertOk();
        $this->assertSame(0, $this->inboxCount($manager)['manager_inbox']);

        $mgrInboxAfter = $this->getJson('/api/payroll/reimbursements/inbox/manager', $this->apiHeadersFor($manager))->assertOk()->json();
        $this->assertTrue($mgrInboxAfter[0]['is_read']);

        // Tab/card total is unaffected by read state
        $this->assertSame(1, $this->summary($manager)['pending_manager_count']);

        // ── Manager approves -> admin inbox (unread) should be 1 ────
        $this->postJson("/api/payroll/reimbursements/{$id}/manager-approve", [], $this->apiHeadersFor($manager))->assertOk();

        $this->assertSame(1, $this->inboxCount($admin)['admin_inbox']);   // sidebar admin badge
        $this->assertSame(0, $this->inboxCount($admin)['manager_inbox']);
        $this->assertSame(0, $this->summary($admin)['pending_manager_count']);
        $this->assertSame(1, $this->summary($admin)['pending_admin_count']); // tab/card total

        // Admin inbox listing unread
        $adminInbox = $this->getJson('/api/payroll/reimbursements/inbox/admin', $this->apiHeadersFor($admin))->assertOk()->json();
        $this->assertCount(1, $adminInbox);
        $this->assertFalse($adminInbox[0]['is_read']);

        // ── Admin opens -> admin sidebar badge decrements ──────────
        $this->postJson("/api/payroll/reimbursements/{$id}/mark-read", ['role' => 'admin'], $this->apiHeadersFor($admin))->assertOk();
        $this->assertSame(0, $this->inboxCount($admin)['admin_inbox']);
        $this->assertSame(1, $this->summary($admin)['pending_admin_count']); // total unchanged

        // ── Admin approves -> moves to Pending Payments ────────────
        $this->postJson("/api/payroll/reimbursements/{$id}/approve", [], $this->apiHeadersFor($admin))->assertOk();

        $this->assertSame(0, $this->summary($admin)['pending_admin_count']);
        $this->assertSame(1, $this->summary($admin)['pending_payment_count']);
        $this->assertSame(1, $this->summary($admin)['approved_count']);

        $pending = $this->getJson('/api/payroll/reimbursements/pending-payments', $this->apiHeadersFor($admin))->assertOk()->json();
        $this->assertCount(1, $pending);

        // ── Admin marks paid -> pending payment badge clears ───────
        $this->postJson("/api/payroll/reimbursements/{$id}/mark-paid", [
            'payout_mode' => 'payroll',
            'payment_reference' => 'PAY-1',
        ], $this->apiHeadersFor($admin))->assertOk();

        $this->assertSame(0, $this->summary($admin)['pending_payment_count']);
        $this->assertCount(0, $this->getJson('/api/payroll/reimbursements/pending-payments', $this->apiHeadersFor($admin))->assertOk()->json());
    }
}
