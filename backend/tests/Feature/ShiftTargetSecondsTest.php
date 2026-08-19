<?php

namespace Tests\Feature;

use App\Models\EmployeeShift;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\Shift;
use App\Models\User;
use App\Services\Attendance\AttendanceService;
use App\Services\Reports\WorkedTimeService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * shift_target_seconds is what the countdown, the "remaining" figure and the
 * overtime threshold are all derived from. It was a single global constant —
 * eight hours for everybody, in every organization — which is wrong the moment
 * an org runs anything but a nine-to-six.
 *
 * These tests pin the contract: an assigned shift decides the target, and the
 * eight-hour constant survives only as the last resort for an organization that
 * has configured no shifts at all.
 */
class ShiftTargetSecondsTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        Carbon::setTestNow('2026-08-19 11:00:00'); // a Wednesday

        $this->organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $this->user = User::create([
            'name' => 'Employee',
            'email' => 'employee@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    /** @param array<string, mixed> $attributes */
    private function assignShift(array $attributes = []): Shift
    {
        $shift = Shift::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $this->organization->id,
            'name' => 'Six Hour',
            'code' => 'SIX',
            'type' => 'general',
            'start_time' => '10:00:00',
            'end_time' => '16:30:00',
            'duration_minutes' => 390,
            'break_duration_minutes' => 30,
            'is_active' => true,
        ], $attributes));

        EmployeeShift::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->user->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);

        return $shift;
    }

    public function test_today_payload_falls_back_to_eight_hours_when_no_shift_is_configured(): void
    {
        $this->actingAs($this->user);

        $payload = app(AttendanceService::class)->todayPayload($this->user);

        $this->assertSame(8 * 3600, $payload['shift_target_seconds']);
    }

    public function test_today_payload_uses_the_assigned_shift(): void
    {
        $this->assignShift();
        $this->actingAs($this->user);

        $payload = app(AttendanceService::class)->todayPayload($this->user);

        $this->assertSame(6 * 3600, $payload['shift_target_seconds']);
    }

    public function test_the_api_reports_the_assigned_shift_target(): void
    {
        $this->assignShift();

        $this->getJson('/api/attendance/today', $this->apiHeadersFor($this->user))
            ->assertOk()
            ->assertJsonPath('shift_target_seconds', 6 * 3600);
    }

    public function test_a_half_day_leave_halves_the_assigned_shift_not_the_global_default(): void
    {
        $this->assignShift();

        LeaveRequest::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->user->id,
            'start_date' => '2026-08-19',
            'end_date' => '2026-08-19',
            'leave_type' => 'half_day',
            'status' => 'approved',
            'reason' => 'Half day',
        ]);

        $this->actingAs($this->user);

        $payload = app(AttendanceService::class)->todayPayload($this->user);

        $this->assertSame(3 * 3600, $payload['shift_target_seconds']);
    }

    public function test_worked_time_service_reads_the_same_target(): void
    {
        $this->assignShift();
        $this->actingAs($this->user);

        $this->assertSame(
            6 * 3600,
            app(WorkedTimeService::class)->shiftTargetSecondsFor($this->user, Carbon::parse('2026-08-19')),
        );
    }

    public function test_the_target_follows_the_date_across_an_effective_dated_change(): void
    {
        $this->assignShift();

        $newShift = Shift::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'name' => 'Nine Hour',
            'code' => 'NINE',
            'type' => 'general',
            'start_time' => '09:00:00',
            'end_time' => '19:00:00',
            'duration_minutes' => 600,
            'break_duration_minutes' => 60,
            'is_active' => true,
        ]);
        EmployeeShift::withoutOrganizationScope()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->user->id,
            'shift_id' => $newShift->id,
            'effective_from' => '2026-08-18',
            'is_active' => true,
        ]);

        $this->actingAs($this->user);
        $service = app(WorkedTimeService::class);

        $this->assertSame(6 * 3600, $service->shiftTargetSecondsFor($this->user, Carbon::parse('2026-08-17')));
        $this->assertSame(9 * 3600, $service->shiftTargetSecondsFor($this->user, Carbon::parse('2026-08-19')));
    }
}
