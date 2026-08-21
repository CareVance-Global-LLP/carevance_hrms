<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\EmployeePayrollTemplate;
use App\Models\EmployeeShift;
use App\Models\LegalEntity;
use App\Models\Organization;
use App\Models\OvertimePolicy;
use App\Models\OvertimePolicyScope;
use App\Models\Shift;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The overtime register, and who may read it.
 *
 * The register is the document handed to an inspector, so the two things worth
 * holding down are that it does not quietly under-report — an unpriced row must
 * be visible as unpriced rather than as zero owed — and that it is not readable
 * by everybody, because it carries what every colleague earns per hour.
 */
class OvertimeRegisterTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $employee;
    private LegalEntity $entity;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-ot-register']);

        $this->entity = LegalEntity::query()->create([
            'organization_id' => $this->organization->id,
            'name' => 'CareVance Manufacturing',
            'state' => 'Karnataka',
            'establishment_type' => 'factory',
            'is_primary' => true,
            'is_active' => true,
        ]);

        $this->admin = $this->makeUser('admin@carevance.test', 'admin');
        $this->employee = $this->makeUser('ramesh@carevance.test', 'employee');

        $shift = Shift::query()->create([
            'organization_id' => $this->organization->id,
            'name' => 'General',
            'code' => 'GEN-REGISTER',
            'start_time' => '09:00',
            'end_time' => '17:00',
            'duration_minutes' => 8 * 60,
            'break_duration_minutes' => 0,
            'is_active' => true,
        ]);

        EmployeeShift::query()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);

        $policy = OvertimePolicy::query()->create([
            'organization_id' => $this->organization->id,
            'name' => 'Standard',
            'hours_basis' => OvertimePolicy::BASIS_GROSS,
            'is_default' => true,
            'is_active' => true,
        ]);

        OvertimePolicyScope::query()->create([
            'organization_id' => $this->organization->id,
            'overtime_policy_id' => $policy->id,
            'scope' => OvertimePolicyScope::SCOPE_WORKING_DAY,
            'treatment' => OvertimePolicyScope::TREATMENT_PAY,
            'multiplier' => '2.00',
            'applies_after_minutes' => 0,
        ]);

        // A Wednesday, so it is a plain working day.
        AttendanceRecord::query()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'attendance_date' => '2026-06-10',
            'check_in_at' => '2026-06-10 09:00:00',
            'check_out_at' => '2026-06-10 19:00:00',
            'worked_seconds' => 10 * 3600,
            'status' => 'present',
        ]);
    }

    private function makeUser(string $email, string $role): User
    {
        return User::create([
            'name' => explode('@', $email)[0],
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $this->organization->id,
            'legal_entity_id' => $this->entity->id,
        ]);
    }

    private function register(): \Illuminate\Testing\TestResponse
    {
        return $this->getJson('/api/statutory/overtime-register?from=2026-06-08&to=2026-06-14');
    }

    public function test_it_reports_overtime_hours_with_no_rate_as_unpriced_rather_than_free(): void
    {
        $this->actingAs($this->admin);

        $response = $this->register()->assertOk();

        $row = collect($response->json('rows'))->firstWhere('user_id', $this->employee->id);

        $this->assertNotNull($row);
        $this->assertSame(120, $row['overtime_minutes']);

        /*
         * No payroll template, so there is no ordinary rate for the overtime to
         * be twice OF. Null, never 0.00 - a register showing zero reads as
         * "overtime worked, nothing owed", which is the opposite of true.
         */
        $this->assertNull($row['amount']);
        $this->assertNull($row['hourly_rate']);
        $this->assertSame(1, $response->json('totals.rows_without_a_rate'));
    }

    public function test_it_prices_overtime_once_the_employee_has_an_annual_ctc(): void
    {
        EmployeePayrollTemplate::query()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'annual_ctc' => 624000,
        ]);

        $this->actingAs($this->admin);

        $row = collect($this->register()->assertOk()->json('rows'))
            ->firstWhere('user_id', $this->employee->id);

        // 624000 a year is 52000 a month; over 26 days and 8 hours that is an
        // ordinary rate of 250 an hour. Two hours at twice the rate is 1000.
        $this->assertSame('1000.00', $row['amount']);
        $this->assertSame(0, $this->register()->json('totals.rows_without_a_rate'));
    }

    public function test_the_register_carries_the_statutory_floor_alongside_what_was_configured(): void
    {
        OvertimePolicyScope::query()->where('organization_id', $this->organization->id)
            ->update(['multiplier' => '1.50']);

        $this->actingAs($this->admin);

        $row = collect($this->register()->assertOk()->json('rows'))
            ->firstWhere('user_id', $this->employee->id);

        // Both numbers, on the row an inspector reads. A register that showed
        // only the configured rate would be evidence of the underpayment
        // without ever naming it.
        $this->assertSame('1.50', $row['configured_multiplier']);
        $this->assertSame('2.00', $row['statutory_multiplier_floor']);
        $this->assertTrue($row['is_below_statutory_floor']);
    }

    public function test_an_employee_cannot_read_the_register(): void
    {
        $this->actingAs($this->employee);

        // It carries every colleague's hourly rate.
        $this->register()->assertForbidden();
        $this->getJson('/api/statutory/breaches?from=2026-06-08&to=2026-06-14')->assertForbidden();
    }

    public function test_anybody_may_read_what_the_law_requires_of_their_own_workplace(): void
    {
        $this->actingAs($this->employee);

        $response = $this->getJson('/api/statutory/limits')->assertOk();

        // The rate your own overtime is owed at should not require asking the
        // person who sets it.
        $this->assertSame('2.00', $response->json('data.overtime_multiplier_floor'));
        $this->assertSame('factory', $response->json('data.establishment_type'));
        $this->assertSame('Factories Act 1948, s.59', $response->json('data.citations.overtime_multiplier_floor'));
    }

    public function test_it_refuses_a_range_too_large_to_walk(): void
    {
        $this->actingAs($this->admin);

        // Refused clearly rather than served slowly: this assesses every
        // attendance row for every employee against a policy.
        $this->getJson('/api/statutory/overtime-register?from=2025-01-01&to=2026-12-31')
            ->assertStatus(422);
    }
}
