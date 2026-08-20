<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\AttendanceTimeEditRequest;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\User;
use App\Services\Ai\AiToolRegistry;
use App\Services\Leave\LeavePolicyService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The assistant's tools are what make it worth having and what make it
 * dangerous: a chatbot that states a wrong leave balance confidently is worse
 * than no chatbot. Every tool here must agree with the service that owns the
 * number, and must hand back the route where a human can go verify it.
 */
class AiChatToolTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private AiToolRegistry $registry;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $this->admin = $this->makeUser('admin', 'admin');
        $this->registry = app(AiToolRegistry::class);
    }

    private function makeUser(string $name, string $role, bool $deactivated = false): User
    {
        $user = User::create([
            'name' => ucfirst($name),
            'email' => $name.'-tools@org.test',
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $this->organization->id,
        ]);

        // deactivated_at is cast but not fillable — it is written by the exit
        // flow, not by mass assignment — so create() silently drops it.
        if ($deactivated) {
            $user->forceFill(['deactivated_at' => now()])->save();
        }

        return $user;
    }

    /**
     * The headcount denominator used to be every row in `users`, so a
     * deactivated leaver kept inflating it — and every percentage derived from
     * it (attendance coverage, payroll processed) read low forever.
     */
    public function test_headcount_excludes_deactivated_people(): void
    {
        $this->makeUser('active-one', 'employee');
        $this->makeUser('departed', 'employee', deactivated: true);

        $result = $this->registry->execute('getHeadcountSummary', [], $this->admin);

        // admin + active-one. The deactivated user must not appear.
        $this->assertSame(2, $result->data['active_headcount']);
    }

    public function test_today_attendance_summary_counts_only_active_people(): void
    {
        $this->makeUser('present', 'employee');
        $this->makeUser('departed', 'employee', deactivated: true);

        $result = $this->registry->execute('getTodayAttendanceSummary', [], $this->admin);

        $this->assertSame(2, $result->data['total_employees']);
    }

    /**
     * getLeaveBalance used to count approved leave REQUESTS and label the
     * number a balance. Two half-days and a fortnight both counted as "1".
     * LeavePolicyService owns this figure; the tool must not compute its own.
     */
    public function test_leave_balance_matches_the_leave_policy_service(): void
    {
        $employee = $this->makeUser('balance-subject', 'employee');

        $policyService = app(LeavePolicyService::class);
        $expected = $policyService->buildBalanceSnapshotForUser(
            $employee,
            $policyService->resolvePolicyCategories($this->organization)
        );

        $result = $this->registry->execute('getLeaveBalance', ['employee_id' => $employee->id], $this->admin);

        $this->assertSame($expected['totals'], $result->data['totals']);
        $this->assertSame($expected['categories'], $result->data['categories']);
    }

    /**
     * The tool description has always promised "leave and time-edit requests".
     * It only ever counted leave, so an admin was told 3 when 5 were waiting.
     */
    public function test_pending_approvals_counts_time_edit_requests_as_well_as_leave(): void
    {
        $employee = $this->makeUser('requester', 'employee');

        LeaveRequest::create([
            'organization_id' => $this->organization->id,
            'user_id' => $employee->id,
            'start_date' => Carbon::tomorrow()->toDateString(),
            'end_date' => Carbon::tomorrow()->toDateString(),
            'reason' => 'Family function',
            'status' => 'pending',
        ]);

        AttendanceTimeEditRequest::create([
            'organization_id' => $this->organization->id,
            'user_id' => $employee->id,
            'attendance_date' => Carbon::yesterday()->toDateString(),
            'extra_seconds' => 1800,
            'message' => 'Forgot to stop the timer',
            'status' => 'pending',
        ]);

        $result = $this->registry->execute('getPendingApprovals', [], $this->admin);

        $this->assertSame(1, $result->data['pending_leave_requests']);
        $this->assertSame(1, $result->data['pending_time_edit_requests']);
        $this->assertSame(2, $result->data['total']);
    }

    public function test_who_is_out_today_lists_people_on_approved_leave(): void
    {
        $employee = $this->makeUser('on-leave', 'employee');

        LeaveRequest::create([
            'organization_id' => $this->organization->id,
            'user_id' => $employee->id,
            'start_date' => Carbon::today()->toDateString(),
            'end_date' => Carbon::today()->toDateString(),
            'reason' => 'Medical',
            'status' => 'approved',
        ]);

        $result = $this->registry->execute('getWhoIsOutToday', [], $this->admin);

        $this->assertSame(1, $result->data['count']);
        $this->assertSame(['On-leave'], array_column($result->data['people'], 'name'));
    }

    /**
     * The citation contract. Every number the assistant states must come with
     * somewhere a human can go and see the record for themselves — that is the
     * whole reason to trust it. A tool with no source is a tool whose answer
     * cannot be checked.
     */
    public function test_every_tool_returns_a_verifiable_source_route(): void
    {
        $names = array_map(
            fn (array $definition) => $definition['function']['name'],
            $this->registry->definitionsFor($this->admin)
        );

        $this->assertNotEmpty($names, 'An admin should have tools available.');

        foreach ($names as $name) {
            $result = $this->registry->execute($name, [], $this->admin);

            $this->assertNotEmpty($result->sources, "Tool {$name} returned no source.");

            foreach ($result->sources as $source) {
                $this->assertArrayHasKey('label', $source, "Tool {$name} source has no label.");
                $this->assertArrayHasKey('route', $source, "Tool {$name} source has no route.");
                $this->assertStringStartsWith('/', $source['route'], "Tool {$name} source route is not an app path.");
            }
        }
    }

    public function test_an_unknown_tool_reports_an_error_rather_than_throwing(): void
    {
        $result = $this->registry->execute('getSomethingInvented', [], $this->admin);

        $this->assertArrayHasKey('error', $result->data);
        $this->assertSame([], $result->sources);
    }

    /**
     * Tools read organisation-wide data, so the registry must never hand them
     * to someone the controller would have turned away. Defence in depth: the
     * gate is in the controller, but a future caller might not go through it.
     */
    public function test_a_non_admin_is_offered_no_tools(): void
    {
        $employee = $this->makeUser('toolless', 'employee');

        $this->assertSame([], $this->registry->definitionsFor($employee));
    }

    public function test_a_non_admin_executing_a_tool_directly_is_refused(): void
    {
        $employee = $this->makeUser('sneaky', 'employee');

        $result = $this->registry->execute('getTodayAttendanceSummary', [], $employee);

        $this->assertArrayHasKey('error', $result->data);
        $this->assertArrayNotHasKey('total_employees', $result->data);
    }
}
