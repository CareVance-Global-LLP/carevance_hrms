<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\EmployeeExit;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * `DELETE /api/users/{user}` must refuse an account that has any history.
 *
 * Postgres reports 101 tables cascading off a `users` row — payslips,
 * payroll_items, form16_documents, full_and_final_settlements and
 * bank_transfer_items among them. Every one of those foreign keys is
 * ON DELETE CASCADE, so a single click destroys the organisation's own
 * evidence that it paid the person, which statute requires it to retain, and
 * the endpoint still answers 200. There is no foreign-key violation to catch
 * it and nothing to undo it.
 *
 * Deletion therefore survives only for an account nothing ever happened to —
 * a mistyped invite nobody used. Everyone else deactivates, which is what the
 * exit process already does.
 */
class EmployeeDeletionIsGuardedTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->org = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-deletion-guard',
        ]);

        $this->admin = $this->member('admin', 'admin');
    }

    private function member(string $name, string $role, ?Organization $org = null): User
    {
        $org ??= $this->org;

        return User::create([
            'name' => ucfirst($name),
            'email' => $name.'-'.$org->id.'@carevance.test',
            'password' => bcrypt('password123'),
            'role' => $role,
            'organization_id' => $org->id,
        ]);
    }

    public function test_an_employee_with_payroll_history_cannot_be_deleted_and_the_refusal_names_the_alternative(): void
    {
        $employee = $this->member('paid-employee', 'employee');

        $run = PayrollMonthlyRun::create([
            'organization_id' => $this->org->id,
            'month_year' => '2026-07',
            'status' => 'draft',
        ]);

        PayrollItem::create([
            'payroll_run_id' => $run->id,
            'organization_id' => $this->org->id,
            'user_id' => $employee->id,
            'gross_salary' => '50000.00',
            'net_pay' => '46000.00',
        ]);

        $response = $this->withHeaders($this->apiHeadersFor($this->admin))
            ->deleteJson("/api/users/{$employee->id}")
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'HAS_HISTORY')
            ->assertJsonPath('history', 'payroll records');

        // A refusal that only says "no" gets worked around. It has to name the
        // thing to do instead, and where to do it.
        $message = $response->json('message');
        $this->assertStringContainsString('Deactivate the account', $message);
        $this->assertStringContainsString('Exits', $message);

        $this->assertDatabaseHas('users', ['id' => $employee->id]);
        $this->assertDatabaseHas('payroll_items', ['user_id' => $employee->id]);
    }

    public function test_an_employee_with_attendance_and_tracked_time_cannot_be_deleted(): void
    {
        $employee = $this->member('worked-employee', 'employee');

        AttendanceRecord::create([
            'organization_id' => $this->org->id,
            'user_id' => $employee->id,
            'attendance_date' => '2026-07-14',
            'worked_seconds' => 28800,
            'status' => 'present',
        ]);

        TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $employee->id,
            'start_time' => '2026-07-14 09:00:00',
            'end_time' => '2026-07-14 17:00:00',
            'duration' => 28800,
        ]);

        $this->withHeaders($this->apiHeadersFor($this->admin))
            ->deleteJson("/api/users/{$employee->id}")
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'HAS_HISTORY')
            ->assertJsonPath('history', 'attendance records');

        $this->assertDatabaseHas('users', ['id' => $employee->id]);
        $this->assertDatabaseHas('attendance_records', ['user_id' => $employee->id]);
        $this->assertDatabaseHas('time_entries', ['user_id' => $employee->id]);
    }

    public function test_an_employee_with_an_exit_record_cannot_be_deleted(): void
    {
        $employee = $this->member('leaver', 'employee');

        EmployeeExit::create([
            'organization_id' => $this->org->id,
            'user_id' => $employee->id,
            'exit_type' => 'resignation',
            'last_working_date' => '2026-07-30',
            'stage' => EmployeeExit::STAGE_CLOSED,
        ]);

        $this->withHeaders($this->apiHeadersFor($this->admin))
            ->deleteJson("/api/users/{$employee->id}")
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'HAS_HISTORY')
            ->assertJsonPath('history', 'an exit record');

        $this->assertDatabaseHas('users', ['id' => $employee->id]);
        $this->assertDatabaseHas('employee_exits', ['user_id' => $employee->id]);
    }

    public function test_a_never_used_account_with_no_history_can_still_be_deleted(): void
    {
        $mistypedInvite = $this->member('typo', 'employee');

        $this->withHeaders($this->apiHeadersFor($this->admin))
            ->deleteJson("/api/users/{$mistypedInvite->id}")
            ->assertOk()
            ->assertJsonPath('message', 'User deleted');

        $this->assertDatabaseMissing('users', ['id' => $mistypedInvite->id]);
    }

    /**
     * The Add User wizard rolls back a half-created account by deleting it, and
     * `POST /users` writes a profile, a work info, a payroll template and an
     * onboarding journey within milliseconds. None of those is history, or
     * every user would be undeletable from birth.
     */
    public function test_an_account_created_through_the_wizard_is_still_deletable_the_moment_after(): void
    {
        $created = $this->withHeaders($this->apiHeadersFor($this->admin))
            ->postJson('/api/users', [
                'name' => 'Fresh Hire',
                'email' => 'fresh-hire@carevance.test',
                'password' => 'Str0ng!Passw0rd#2026',
                'role' => 'employee',
                'joining_date' => '2026-09-01',
            ])
            ->assertSuccessful();

        $newUserId = $created->json('user.id') ?? $created->json('id');
        $this->assertNotNull($newUserId, 'POST /users did not return the created user id.');

        $this->assertDatabaseHas('onboarding_journeys', ['user_id' => $newUserId]);

        $this->withHeaders($this->apiHeadersFor($this->admin))
            ->deleteJson("/api/users/{$newUserId}")
            ->assertOk();

        $this->assertDatabaseMissing('users', ['id' => $newUserId]);
    }

    /**
     * The first probe listed thirteen models by hand and let the other
     * ninety-five cascade away in silence. Each row below is an account whose
     * ONLY record is the one named — every one of them deleted with a 200 and
     * took the row with it, including `form16_documents`, the statutory TDS
     * certificate the probe's own docblock named as the reason deletion is
     * dangerous.
     */
    public function test_a_single_record_in_any_cascading_table_is_enough_to_refuse(): void
    {
        $cases = [
            'form16_documents' => [
                'row' => fn (int $userId) => [
                    'organization_id' => $this->org->id,
                    'user_id' => $userId,
                    'financial_year' => '2025-26',
                    'assessment_year' => '2026-27',
                ],
                'history' => 'a Form 16',
            ],
            'employee_bank_accounts' => [
                'row' => fn (int $userId) => [
                    'organization_id' => $this->org->id,
                    'user_id' => $userId,
                    'account_number' => '000123456789',
                    'ifsc_swift' => 'HDFC0000123',
                    'bank_name' => 'HDFC Bank',
                ],
                'history' => 'a salary bank account',
            ],
            'monitoring_consents' => [
                'row' => fn (int $userId) => [
                    'organization_id' => $this->org->id,
                    'user_id' => $userId,
                    'notice_version' => 1,
                    'capture_types' => json_encode(['activity']),
                    'granted_at' => now(),
                ],
                'history' => 'a monitoring consent',
            ],
        ];

        foreach ($cases as $table => $case) {
            $employee = $this->member('only-'.str_replace('_', '-', $table), 'employee');

            \Illuminate\Support\Facades\DB::table($table)->insert(array_merge(
                ($case['row'])($employee->id),
                ['created_at' => now(), 'updated_at' => now()]
            ));

            $this->withHeaders($this->apiHeadersFor($this->admin))
                ->deleteJson("/api/users/{$employee->id}")
                ->assertStatus(422)
                ->assertJsonPath('error_code', 'HAS_HISTORY')
                ->assertJsonPath('history', $case['history']);

            $this->assertDatabaseHas('users', ['id' => $employee->id]);
            $this->assertSame(
                1,
                \Illuminate\Support\Facades\DB::table($table)->where('user_id', $employee->id)->count(),
                "The only {$table} row for this account was destroyed by the delete."
            );
        }
    }

    /**
     * The other refusal path. `arrear_payments.requested_by` is ON DELETE NO
     * ACTION, so the delete reaches the database and is refused there — and
     * the audit entry was written BEFORE the delete was attempted, leaving
     * `user.deleted` standing against a user who is still there. The existing
     * coverage only exercised the HAS_HISTORY branch, so it passed while the
     * invariant it names was broken on this one.
     */
    public function test_a_delete_refused_by_the_database_writes_no_audit_entry_either(): void
    {
        $hrUser = $this->member('hr-requester', 'admin');
        $employee = $this->member('arrear-subject', 'employee');

        \Illuminate\Support\Facades\DB::table('arrear_payments')->insert([
            'organization_id' => $this->org->id,
            'user_id' => $employee->id,
            'arrear_month' => '2026-06',
            'calculation_month' => '2026-07',
            'net_arrear_amount' => '1200.00',
            'requested_by' => $hrUser->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->withHeaders($this->apiHeadersFor($this->admin))
            ->deleteJson("/api/users/{$hrUser->id}")
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'REFERENCED_ELSEWHERE');

        $this->assertDatabaseHas('users', ['id' => $hrUser->id]);
        $this->assertDatabaseMissing('audit_logs', [
            'action' => 'user.deleted',
            'target_id' => $hrUser->id,
        ]);
    }

    public function test_a_successful_delete_still_writes_its_audit_entry(): void
    {
        $mistypedInvite = $this->member('audited-typo', 'employee');

        $this->withHeaders($this->apiHeadersFor($this->admin))
            ->deleteJson("/api/users/{$mistypedInvite->id}")
            ->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'user.deleted',
            'target_id' => $mistypedInvite->id,
        ]);
    }

    public function test_a_refused_delete_writes_no_audit_entry(): void
    {
        $employee = $this->member('audited', 'employee');

        AttendanceRecord::create([
            'organization_id' => $this->org->id,
            'user_id' => $employee->id,
            'attendance_date' => '2026-07-14',
            'worked_seconds' => 28800,
            'status' => 'present',
        ]);

        $this->withHeaders($this->apiHeadersFor($this->admin))
            ->deleteJson("/api/users/{$employee->id}")
            ->assertStatus(422);

        // `user.deleted` against a user who is still there is a false record,
        // and the audit log is the one place that must not carry one.
        $this->assertDatabaseMissing('audit_logs', [
            'action' => 'user.deleted',
            'target_id' => $employee->id,
        ]);
        $this->assertDatabaseHas('users', ['id' => $employee->id]);
    }

    public function test_a_non_admin_is_still_refused_with_403(): void
    {
        $manager = $this->member('manager', 'manager');
        $employee = $this->member('managed', 'employee');

        $this->withHeaders($this->apiHeadersFor($manager))
            ->deleteJson("/api/users/{$employee->id}")
            ->assertForbidden();

        $this->assertDatabaseHas('users', ['id' => $employee->id]);
    }

    public function test_deleting_your_own_account_is_still_refused_with_422(): void
    {
        $this->withHeaders($this->apiHeadersFor($this->admin))
            ->deleteJson("/api/users/{$this->admin->id}")
            ->assertStatus(422)
            ->assertJsonPath('message', 'You cannot delete your own account from user management.');

        $this->assertDatabaseHas('users', ['id' => $this->admin->id]);
    }

    /**
     * The history probe must never run before the tenant check. `{user}` is not
     * org-scoped, so an admin can address any id in the system; if a stranger
     * with payroll came back 422 "has payroll records" while a stranger without
     * came back 403, the endpoint would be an oracle for what other tenants
     * hold.
     */
    public function test_the_guard_does_not_leak_whether_a_user_in_another_organization_exists(): void
    {
        $otherOrg = Organization::create([
            'name' => 'Rival Ltd',
            'slug' => 'rival-deletion-guard',
        ]);

        $strangerWithHistory = $this->member('stranger-paid', 'employee', $otherOrg);
        $strangerWithout = $this->member('stranger-clean', 'employee', $otherOrg);

        AttendanceRecord::create([
            'organization_id' => $otherOrg->id,
            'user_id' => $strangerWithHistory->id,
            'attendance_date' => '2026-07-14',
            'worked_seconds' => 28800,
            'status' => 'present',
        ]);

        $withHistory = $this->withHeaders($this->apiHeadersFor($this->admin))
            ->deleteJson("/api/users/{$strangerWithHistory->id}")
            ->assertForbidden();

        $without = $this->withHeaders($this->apiHeadersFor($this->admin))
            ->deleteJson("/api/users/{$strangerWithout->id}")
            ->assertForbidden();

        $this->assertSame($without->json(), $withHistory->json());
        $this->assertNull($withHistory->json('history'));
        $this->assertNull($withHistory->json('error_code'));

        $this->assertDatabaseHas('users', ['id' => $strangerWithHistory->id]);
        $this->assertDatabaseHas('users', ['id' => $strangerWithout->id]);
    }

    /**
     * `DELETE /users/{id}/incomplete` is the wizard's cleanup route and shares
     * the same probe. Two delete endpoints with two different rules is how the
     * next person routes around the stricter one.
     */
    public function test_the_incomplete_cleanup_route_refuses_an_account_with_history_too(): void
    {
        $employee = $this->member('incomplete-but-worked', 'employee');

        TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $employee->id,
            'start_time' => '2026-07-14 09:00:00',
            'end_time' => '2026-07-14 17:00:00',
            'duration' => 28800,
        ]);

        $this->withHeaders($this->apiHeadersFor($this->admin))
            ->deleteJson("/api/users/{$employee->id}/incomplete")
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'HAS_HISTORY')
            ->assertJsonPath('history', 'tracked time');

        $this->assertDatabaseHas('users', ['id' => $employee->id]);
    }
}
