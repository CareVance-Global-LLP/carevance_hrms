<?php

namespace Tests\Feature;

use App\Models\EmployeeShift;
use App\Models\Organization;
use App\Models\Shift;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The shift management API.
 *
 * Two things are being pinned here, and they fail in opposite directions:
 *
 *  - Authorisation. Rostering decides what someone is paid for a night shift
 *    and what counts as their overtime, so creating a shift and assigning one
 *    are settings-manage operations. An employee reaching either is a
 *    privilege escalation; an employee unable to read their OWN shift is a
 *    screen that cannot render.
 *  - Tenancy. shifts and employee_shifts both carry organization_id, and both
 *    models use BelongsToOrganization. A shift id from another tenant must be
 *    a 404, never a cross-org edit, and an assignment must never bind one
 *    org's shift to another org's employee.
 */
class ShiftManagementApiTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private Organization $otherOrganization;
    private User $admin;
    private User $manager;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        Carbon::setTestNow('2026-08-19 11:00:00'); // a Wednesday

        $this->organization = Organization::create(['name' => 'Acme', 'slug' => 'acme-shifts']);
        $this->otherOrganization = Organization::create(['name' => 'Rival', 'slug' => 'rival-shifts']);

        $this->admin = $this->makeUser($this->organization, 'shift-admin@example.com', 'admin');
        $this->manager = $this->makeUser($this->organization, 'shift-manager@example.com', 'manager');
        $this->employee = $this->makeUser($this->organization, 'shift-employee@example.com', 'employee');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    private function makeUser(Organization $organization, string $email, string $role): User
    {
        return User::create([
            'name' => ucfirst($role),
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $organization->id,
        ]);
    }

    /** @param array<string, mixed> $attributes */
    private function makeShift(Organization $organization, array $attributes = []): Shift
    {
        return Shift::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $organization->id,
            'name' => 'General',
            'code' => 'GEN',
            'type' => 'general',
            'start_time' => '09:00:00',
            'end_time' => '18:00:00',
            'duration_minutes' => 540,
            'break_duration_minutes' => 60,
            'is_active' => true,
        ], $attributes));
    }

    /** @return array<string, mixed> */
    private function shiftPayload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Night Support',
            'code' => 'NIGHT',
            'type' => 'night',
            'start_time' => '22:00',
            'end_time' => '06:00',
            'break_duration_minutes' => 60,
            'grace_period_minutes' => 15,
            'applicable_days' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        ], $overrides);
    }

    // ---- creation and listing ----------------------------------------------

    public function test_an_admin_can_create_a_shift_and_the_span_rolls_over_midnight(): void
    {
        $response = $this->postJson('/api/shifts', $this->shiftPayload(), $this->apiHeadersFor($this->admin))
            ->assertCreated();

        $shiftId = $response->json('data.id');

        // 22:00 -> 06:00 is eight hours of span, seven once the unpaid hour
        // comes out. Nothing here may quietly become eight hours of work.
        $this->assertSame(480, $response->json('data.span_minutes'));
        $this->assertSame(7 * 3600, $response->json('data.expected_work_seconds'));
        $this->assertTrue($response->json('data.crosses_midnight'));

        $this->assertDatabaseHas('shifts', [
            'id' => $shiftId,
            'organization_id' => $this->organization->id,
            'code' => 'NIGHT',
            'duration_minutes' => 480,
        ]);
    }

    public function test_the_shift_list_is_scoped_to_the_callers_organization(): void
    {
        $mine = $this->makeShift($this->organization, ['code' => 'MINE', 'name' => 'Mine']);
        $theirs = $this->makeShift($this->otherOrganization, ['code' => 'THEIRS', 'name' => 'Theirs']);

        $ids = collect(
            $this->getJson('/api/shifts', $this->apiHeadersFor($this->admin))->assertOk()->json('data')
        )->pluck('id')->all();

        $this->assertContains($mine->id, $ids);
        $this->assertNotContains($theirs->id, $ids);
    }

    public function test_a_duplicate_code_in_the_same_organization_is_rejected(): void
    {
        $this->makeShift($this->organization, ['code' => 'GEN']);

        $this->postJson('/api/shifts', $this->shiftPayload(['code' => 'gen']), $this->apiHeadersFor($this->admin))
            ->assertStatus(422)
            ->assertJsonValidationErrors('code');
    }

    public function test_the_same_code_is_free_in_another_organization(): void
    {
        $this->makeShift($this->otherOrganization, ['code' => 'NIGHT']);

        $this->postJson('/api/shifts', $this->shiftPayload(), $this->apiHeadersFor($this->admin))
            ->assertCreated();
    }

    // ---- update and delete --------------------------------------------------

    public function test_an_admin_can_update_a_shift(): void
    {
        $shift = $this->makeShift($this->organization);

        $this->putJson(
            "/api/shifts/{$shift->id}",
            ['name' => 'General (revised)', 'start_time' => '10:00', 'end_time' => '16:30', 'break_duration_minutes' => 30],
            $this->apiHeadersFor($this->admin)
        )
            ->assertOk()
            ->assertJsonPath('data.name', 'General (revised)')
            ->assertJsonPath('data.expected_work_seconds', 6 * 3600);
    }

    public function test_updating_another_organizations_shift_is_a_404(): void
    {
        $theirs = $this->makeShift($this->otherOrganization, ['code' => 'THEIRS']);

        $this->putJson("/api/shifts/{$theirs->id}", ['name' => 'Hijacked'], $this->apiHeadersFor($this->admin))
            ->assertNotFound();

        $this->assertSame('General', Shift::withoutOrganizationScope()->find($theirs->id)->name);
    }

    public function test_an_unassigned_shift_can_be_deleted(): void
    {
        $shift = $this->makeShift($this->organization);

        $this->deleteJson("/api/shifts/{$shift->id}", [], $this->apiHeadersFor($this->admin))->assertOk();

        $this->assertNull(Shift::withoutOrganizationScope()->find($shift->id));
    }

    public function test_deleting_an_assigned_shift_is_refused_rather_than_cascading(): void
    {
        $shift = $this->makeShift($this->organization);
        $this->assign($this->employee, $shift, '2026-01-01');

        $this->deleteJson("/api/shifts/{$shift->id}", [], $this->apiHeadersFor($this->admin))
            ->assertStatus(409);

        // The FK cascades, so a permitted delete here would silently erase the
        // roster history that a payroll re-run for an earlier month depends on.
        $this->assertNotNull(Shift::withoutOrganizationScope()->find($shift->id));
        $this->assertSame(1, EmployeeShift::withoutOrganizationScope()->where('shift_id', $shift->id)->count());
    }

    // ---- authorisation -------------------------------------------------------

    public function test_an_employee_cannot_create_a_shift(): void
    {
        $this->postJson('/api/shifts', $this->shiftPayload(), $this->apiHeadersFor($this->employee))
            ->assertStatus(403);

        $this->assertSame(0, Shift::withoutOrganizationScope()->count());
    }

    public function test_an_employee_cannot_list_the_shift_catalogue(): void
    {
        $this->makeShift($this->organization);

        $this->getJson('/api/shifts', $this->apiHeadersFor($this->employee))->assertStatus(403);
    }

    public function test_an_employee_cannot_assign_a_shift(): void
    {
        $shift = $this->makeShift($this->organization);

        $this->postJson('/api/shifts/assignments', [
            'user_id' => $this->employee->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-09-01',
        ], $this->apiHeadersFor($this->employee))->assertStatus(403);

        $this->assertSame(0, EmployeeShift::withoutOrganizationScope()->count());
    }

    public function test_a_manager_may_roster(): void
    {
        $shift = $this->makeShift($this->organization);

        $this->postJson('/api/shifts/assignments', [
            'user_id' => $this->employee->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-09-01',
        ], $this->apiHeadersFor($this->manager))->assertCreated();
    }

    // ---- assignment ----------------------------------------------------------

    public function test_assigning_binds_the_shift_to_the_employee_from_a_date(): void
    {
        $shift = $this->makeShift($this->organization);

        $this->postJson('/api/shifts/assignments', [
            'user_id' => $this->employee->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-08-01',
            'effective_to' => '2026-12-31',
        ], $this->apiHeadersFor($this->admin))
            ->assertCreated()
            ->assertJsonPath('data.user_id', $this->employee->id)
            ->assertJsonPath('data.shift_id', $shift->id)
            // date:Y-m-d, not a UTC datetime that reaches an IST client a day early.
            ->assertJsonPath('data.effective_from', '2026-08-01')
            ->assertJsonPath('data.effective_to', '2026-12-31');

        $this->assertDatabaseHas('employee_shifts', [
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'shift_id' => $shift->id,
        ]);
    }

    public function test_an_effective_to_before_the_effective_from_is_rejected(): void
    {
        $shift = $this->makeShift($this->organization);

        $this->postJson('/api/shifts/assignments', [
            'user_id' => $this->employee->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-09-01',
            'effective_to' => '2026-08-01',
        ], $this->apiHeadersFor($this->admin))
            ->assertStatus(422)
            ->assertJsonValidationErrors('effective_to');
    }

    public function test_a_foreign_organizations_shift_cannot_be_assigned(): void
    {
        $theirs = $this->makeShift($this->otherOrganization, ['code' => 'THEIRS']);

        $this->postJson('/api/shifts/assignments', [
            'user_id' => $this->employee->id,
            'shift_id' => $theirs->id,
            'effective_from' => '2026-09-01',
        ], $this->apiHeadersFor($this->admin))
            ->assertStatus(422)
            ->assertJsonValidationErrors('shift_id');

        $this->assertSame(0, EmployeeShift::withoutOrganizationScope()->count());
    }

    public function test_a_foreign_organizations_employee_cannot_be_rostered(): void
    {
        $shift = $this->makeShift($this->organization);
        $outsider = $this->makeUser($this->otherOrganization, 'outsider@example.com', 'employee');

        $this->postJson('/api/shifts/assignments', [
            'user_id' => $outsider->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-09-01',
        ], $this->apiHeadersFor($this->admin))
            ->assertStatus(422)
            ->assertJsonValidationErrors('user_id');

        $this->assertSame(0, EmployeeShift::withoutOrganizationScope()->count());
    }

    public function test_the_assignment_list_is_scoped_to_the_organization(): void
    {
        $mine = $this->makeShift($this->organization);
        $theirs = $this->makeShift($this->otherOrganization, ['code' => 'THEIRS']);
        $outsider = $this->makeUser($this->otherOrganization, 'outsider-list@example.com', 'employee');

        $ours = $this->assign($this->employee, $mine, '2026-01-01');
        $foreign = $this->assign($outsider, $theirs, '2026-01-01', $this->otherOrganization);

        $ids = collect(
            $this->getJson('/api/shifts/assignments', $this->apiHeadersFor($this->admin))->assertOk()->json('data')
        )->pluck('id')->all();

        $this->assertContains($ours->id, $ids);
        $this->assertNotContains($foreign->id, $ids);
    }

    public function test_an_assignment_can_be_removed(): void
    {
        $shift = $this->makeShift($this->organization);
        $assignment = $this->assign($this->employee, $shift, '2026-01-01');

        $this->deleteJson("/api/shifts/assignments/{$assignment->id}", [], $this->apiHeadersFor($this->admin))
            ->assertOk();

        $this->assertNull(EmployeeShift::withoutOrganizationScope()->find($assignment->id));
    }

    public function test_removing_another_organizations_assignment_is_a_404(): void
    {
        $theirs = $this->makeShift($this->otherOrganization, ['code' => 'THEIRS']);
        $outsider = $this->makeUser($this->otherOrganization, 'outsider-delete@example.com', 'employee');
        $foreign = $this->assign($outsider, $theirs, '2026-01-01', $this->otherOrganization);

        $this->deleteJson("/api/shifts/assignments/{$foreign->id}", [], $this->apiHeadersFor($this->admin))
            ->assertNotFound();

        $this->assertNotNull(EmployeeShift::withoutOrganizationScope()->find($foreign->id));
    }

    // ---- what an employee may read ------------------------------------------

    public function test_an_employee_reads_their_own_shift(): void
    {
        $shift = $this->makeShift($this->organization, [
            'code' => 'SIX',
            'name' => 'Six Hour',
            'start_time' => '10:00:00',
            'end_time' => '16:30:00',
            'duration_minutes' => 390,
            'break_duration_minutes' => 30,
        ]);
        $this->assign($this->employee, $shift, '2026-01-01');

        $this->getJson('/api/shifts/my', $this->apiHeadersFor($this->employee))
            ->assertOk()
            ->assertJsonPath('data.shift_name', 'Six Hour')
            ->assertJsonPath('data.source', 'assignment')
            ->assertJsonPath('data.expected_seconds', 6 * 3600)
            ->assertJsonPath('data.crosses_midnight', false);
    }

    public function test_my_shift_is_null_when_nothing_is_rostered(): void
    {
        $this->getJson('/api/shifts/my', $this->apiHeadersFor($this->employee))
            ->assertOk()
            ->assertJsonPath('data', null);
    }

    public function test_my_shift_answers_for_the_date_asked_about_so_a_later_assignment_supersedes(): void
    {
        $day = $this->makeShift($this->organization, ['code' => 'DAY', 'name' => 'Day']);
        $night = $this->makeShift($this->organization, [
            'code' => 'NGT',
            'name' => 'Night',
            'start_time' => '22:00:00',
            'end_time' => '06:00:00',
            'duration_minutes' => 480,
            'break_duration_minutes' => 60,
        ]);

        $this->assign($this->employee, $day, '2026-01-01');
        $this->assign($this->employee, $night, '2026-09-01');

        $headers = $this->apiHeadersFor($this->employee);

        $this->getJson('/api/shifts/my?date=2026-08-19', $headers)
            ->assertOk()
            ->assertJsonPath('data.shift_name', 'Day');

        $this->getJson('/api/shifts/my?date=2026-09-05', $headers)
            ->assertOk()
            ->assertJsonPath('data.shift_name', 'Night')
            ->assertJsonPath('data.crosses_midnight', true)
            // The attendance date stays the day the shift began; only the end
            // instant rolls forward.
            ->assertJsonPath('data.attendance_date', '2026-09-05');
    }

    public function test_an_employee_cannot_read_someone_elses_shift(): void
    {
        $shift = $this->makeShift($this->organization);
        $colleague = $this->makeUser($this->organization, 'colleague@example.com', 'employee');
        $this->assign($colleague, $shift, '2026-01-01');

        $this->getJson("/api/shifts/my?user_id={$colleague->id}", $this->apiHeadersFor($this->employee))
            ->assertStatus(403);
    }

    public function test_a_manager_can_read_a_team_members_shift(): void
    {
        $shift = $this->makeShift($this->organization);
        $this->assign($this->employee, $shift, '2026-01-01');

        $this->getJson("/api/shifts/my?user_id={$this->employee->id}", $this->apiHeadersFor($this->manager))
            ->assertOk()
            ->assertJsonPath('data.shift_name', 'General');
    }

    private function assign(User $user, Shift $shift, string $from, ?Organization $organization = null): EmployeeShift
    {
        return EmployeeShift::withoutOrganizationScope()->create([
            'organization_id' => ($organization ?? $this->organization)->id,
            'user_id' => $user->id,
            'shift_id' => $shift->id,
            'effective_from' => $from,
            'is_active' => true,
        ]);
    }
}
