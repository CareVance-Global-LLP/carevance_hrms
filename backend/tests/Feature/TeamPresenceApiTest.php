<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class TeamPresenceApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_employee_sees_only_their_own_department(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);

        $engineering = $this->createGroup($organization, 'Engineering');
        $finance = $this->createGroup($organization, 'Finance');

        $employee = $this->createUser($organization, 'Dept Employee', 'dept.employee@carevance.test');
        $teammate = $this->createUser($organization, 'Eng Teammate', 'eng.teammate@carevance.test');
        $outsider = $this->createUser($organization, 'Finance Outsider', 'fin.outsider@carevance.test');

        // The employee belongs to BOTH groups in the pivot, but their department
        // is Engineering. Group membership is a peer relationship, not a team —
        // the pivot must not widen what they can see.
        $employee->groups()->attach([$engineering->id, $finance->id]);
        $teammate->groups()->attach($engineering->id);
        $outsider->groups()->attach($finance->id);

        $this->assignDepartment($organization, $employee, $engineering);
        $this->assignDepartment($organization, $teammate, $engineering);
        $this->assignDepartment($organization, $outsider, $finance);

        $response = $this->getJson('/api/attendance/team-presence', $this->apiHeadersFor($employee))
            ->assertOk();

        $names = collect($response->json('people'))->pluck('name')->all();

        sort($names);
        $this->assertSame(['Dept Employee', 'Eng Teammate'], $names);
    }

    public function test_checked_in_teammate_reads_as_in_with_their_check_in_time(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);
        $engineering = $this->createGroup($organization, 'Engineering');

        $viewer = $this->createUser($organization, 'Viewer', 'viewer@carevance.test');
        $teammate = $this->createUser($organization, 'Present Teammate', 'present@carevance.test');
        $absentee = $this->createUser($organization, 'Absent Teammate', 'absent@carevance.test');

        foreach ([$viewer, $teammate, $absentee] as $person) {
            $this->assignDepartment($organization, $person, $engineering);
        }

        AttendanceRecord::create([
            'organization_id' => $organization->id,
            'user_id' => $teammate->id,
            'attendance_date' => Carbon::today()->toDateString(),
            'check_in_at' => Carbon::today()->setTime(9, 42),
        ]);

        $people = collect(
            $this->getJson('/api/attendance/team-presence', $this->apiHeadersFor($viewer))
                ->assertOk()
                ->json('people')
        )->keyBy('name');

        $this->assertSame('in', $people['Present Teammate']['status']);
        $this->assertNotNull($people['Present Teammate']['checked_in_at']);

        $this->assertSame('not_in', $people['Absent Teammate']['status']);
        $this->assertNull($people['Absent Teammate']['checked_in_at']);
    }

    public function test_approved_leave_today_outranks_an_attendance_record(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);
        $engineering = $this->createGroup($organization, 'Engineering');

        $viewer = $this->createUser($organization, 'Viewer', 'viewer@carevance.test');
        $onLeave = $this->createUser($organization, 'Leave Taker', 'leave@carevance.test');

        $this->assignDepartment($organization, $viewer, $engineering);
        $this->assignDepartment($organization, $onLeave, $engineering);

        // A stale check-in must not make someone look present while they are
        // on approved leave — the leave is the truthful answer.
        AttendanceRecord::create([
            'organization_id' => $organization->id,
            'user_id' => $onLeave->id,
            'attendance_date' => Carbon::today()->toDateString(),
            'check_in_at' => Carbon::today()->setTime(9, 0),
        ]);

        LeaveRequest::create([
            'organization_id' => $organization->id,
            'user_id' => $onLeave->id,
            'start_date' => Carbon::today()->subDay()->toDateString(),
            'end_date' => Carbon::today()->addDays(2)->toDateString(),
            'leave_type' => 'paid',
            'status' => 'approved',
        ]);

        $people = collect(
            $this->getJson('/api/attendance/team-presence', $this->apiHeadersFor($viewer))
                ->assertOk()
                ->json('people')
        )->keyBy('name');

        $this->assertSame('on_leave', $people['Leave Taker']['status']);
    }

    public function test_pending_leave_does_not_mark_anyone_as_on_leave(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);
        $engineering = $this->createGroup($organization, 'Engineering');

        $viewer = $this->createUser($organization, 'Viewer', 'viewer@carevance.test');
        $hopeful = $this->createUser($organization, 'Hopeful Applicant', 'hopeful@carevance.test');

        $this->assignDepartment($organization, $viewer, $engineering);
        $this->assignDepartment($organization, $hopeful, $engineering);

        LeaveRequest::create([
            'organization_id' => $organization->id,
            'user_id' => $hopeful->id,
            'start_date' => Carbon::today()->toDateString(),
            'end_date' => Carbon::today()->toDateString(),
            'leave_type' => 'paid',
            'status' => 'pending',
        ]);

        $people = collect(
            $this->getJson('/api/attendance/team-presence', $this->apiHeadersFor($viewer))
                ->assertOk()
                ->json('people')
        )->keyBy('name');

        $this->assertSame('not_in', $people['Hopeful Applicant']['status']);
    }

    public function test_off_soon_lists_upcoming_leave_and_ignores_leave_beyond_the_window(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);
        $engineering = $this->createGroup($organization, 'Engineering');

        $viewer = $this->createUser($organization, 'Viewer', 'viewer@carevance.test');
        $soon = $this->createUser($organization, 'Off Soon', 'soon@carevance.test');
        $later = $this->createUser($organization, 'Off Much Later', 'later@carevance.test');
        $currently = $this->createUser($organization, 'Off Right Now', 'now@carevance.test');

        foreach ([$viewer, $soon, $later, $currently] as $person) {
            $this->assignDepartment($organization, $person, $engineering);
        }

        $this->approveLeave($organization, $soon, Carbon::today()->addDays(3), Carbon::today()->addDays(5));
        $this->approveLeave($organization, $later, Carbon::today()->addDays(40), Carbon::today()->addDays(42));

        // Leave that started yesterday and runs on is still "off" — the strip
        // answers "who is away", not "whose leave begins inside the window".
        $this->approveLeave($organization, $currently, Carbon::today()->subDay(), Carbon::today()->addDay());

        $offSoon = collect(
            $this->getJson('/api/attendance/team-presence', $this->apiHeadersFor($viewer))
                ->assertOk()
                ->json('off_soon')
        );

        $names = $offSoon->pluck('name')->sort()->values()->all();

        $this->assertSame(['Off Right Now', 'Off Soon'], $names);
        $this->assertSame(
            Carbon::today()->addDays(3)->toDateString(),
            $offSoon->firstWhere('name', 'Off Soon')['from']
        );
    }

    public function test_presence_payload_carries_no_attendance_analytics(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);
        $engineering = $this->createGroup($organization, 'Engineering');

        $viewer = $this->createUser($organization, 'Viewer', 'viewer@carevance.test');
        $teammate = $this->createUser($organization, 'Teammate', 'teammate@carevance.test');

        $this->assignDepartment($organization, $viewer, $engineering);
        $this->assignDepartment($organization, $teammate, $engineering);

        AttendanceRecord::create([
            'organization_id' => $organization->id,
            'user_id' => $teammate->id,
            'attendance_date' => Carbon::today()->toDateString(),
            'check_in_at' => Carbon::today()->setTime(9, 42),
            'worked_seconds' => 27000,
            'late_minutes' => 42,
        ]);

        $people = $this->getJson('/api/attendance/team-presence', $this->apiHeadersFor($viewer))
            ->assertOk()
            ->json('people');

        // Presence-only has to mean presence-only on the wire. If these ever
        // appear here, an employee can rank colleagues by reading the response.
        $forbidden = [
            'attendance_rate', 'worked_seconds', 'worked_hours', 'idle_seconds',
            'idle_time', 'late_minutes', 'present_dates', 'absent_dates',
            'leave_dates', 'days_present', 'email',
        ];

        foreach ($people as $person) {
            foreach ($forbidden as $key) {
                $this->assertArrayNotHasKey($key, $person, "Presence payload leaked '{$key}'");
            }
        }
    }

    public function test_response_names_the_department_it_is_showing(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);
        $engineering = $this->createGroup($organization, 'Engineering');

        $viewer = $this->createUser($organization, 'Viewer', 'viewer@carevance.test');
        $this->assignDepartment($organization, $viewer, $engineering);

        $this->getJson('/api/attendance/team-presence', $this->apiHeadersFor($viewer))
            ->assertOk()
            ->assertJsonPath('department', 'Engineering');
    }

    public function test_employee_with_no_department_sees_nobody_rather_than_everybody(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);
        $engineering = $this->createGroup($organization, 'Engineering');

        $orphan = $this->createUser($organization, 'No Department', 'orphan@carevance.test');
        $teammate = $this->createUser($organization, 'Has Department', 'has@carevance.test');

        $this->assignDepartment($organization, $teammate, $engineering);

        $this->getJson('/api/attendance/team-presence', $this->apiHeadersFor($orphan))
            ->assertOk()
            ->assertJsonCount(0, 'people');
    }

    public function test_attendance_report_gives_a_plain_employee_only_their_own_row(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);
        $engineering = $this->createGroup($organization, 'Engineering');

        $employee = $this->createUser($organization, 'Plain Employee', 'plain@carevance.test');
        $teammate = $this->createUser($organization, 'Same Group Teammate', 'same@carevance.test');

        $employee->groups()->attach($engineering->id);
        $teammate->groups()->attach($engineering->id);

        $this->assignDepartment($organization, $employee, $engineering);
        $this->assignDepartment($organization, $teammate, $engineering);

        // The analytics roster carries attendance rates and per-day absence
        // history. Employees get the presence board instead; if this endpoint
        // still answers for colleagues, moving the UI only hid the data.
        $rows = $this->getJson(
            '/api/reports/attendance?start_date='.Carbon::today()->toDateString()
                .'&end_date='.Carbon::today()->toDateString(),
            $this->apiHeadersFor($employee)
        )->assertOk()->json('data');

        $this->assertCount(1, $rows);
        $this->assertSame('Plain Employee', $rows[0]['user']['name']);
    }

    private function approveLeave(Organization $organization, User $user, Carbon $from, Carbon $to): void
    {
        LeaveRequest::create([
            'organization_id' => $organization->id,
            'user_id' => $user->id,
            'start_date' => $from->toDateString(),
            'end_date' => $to->toDateString(),
            'leave_type' => 'paid',
            'status' => 'approved',
        ]);
    }

    private function createUser(Organization $organization, string $name, string $email): User
    {
        return User::create([
            'name' => $name,
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);
    }

    private function createGroup(Organization $organization, string $name): Group
    {
        return Group::create([
            'organization_id' => $organization->id,
            'name' => $name,
            'slug' => str($name)->slug()->toString(),
            'is_active' => true,
        ]);
    }

    private function assignDepartment(Organization $organization, User $user, Group $group): void
    {
        EmployeeWorkInfo::create([
            'organization_id' => $organization->id,
            'user_id' => $user->id,
            'report_group_id' => $group->id,
        ]);
    }
}
