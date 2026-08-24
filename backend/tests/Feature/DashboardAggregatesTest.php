<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\RosterDay;
use App\Models\User;
use App\Services\Attendance\TodaySnapshotService;
use App\Services\Reports\HeadcountSeriesService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The three aggregates the admin dashboard is built on.
 *
 * Each replaces something that either did not exist or cost one query per
 * employee. The properties pinned here are the ones that make the numbers
 * trustworthy rather than merely present: buckets that do not overlap, an off
 * day that is not an absence, and a headcount curve anchored on a figure we
 * actually know.
 */
class DashboardAggregatesTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2026-08-24 10:00:00'));
        $this->org = Organization::factory()->create();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function employee(string $name): User
    {
        return User::create([
            'name' => $name,
            'email' => str($name)->slug().'@aggregates.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->org->id,
            'email_verified_at' => now(),
        ]);
    }

    private function punched(User $user, ?int $lateMinutes = 0): void
    {
        AttendanceRecord::create([
            'organization_id' => $this->org->id,
            'user_id' => $user->id,
            'attendance_date' => '2026-08-24',
            'check_in_at' => now()->setTime(9, $lateMinutes ? 30 : 0),
            'late_minutes' => $lateMinutes,
        ]);
    }

    public function test_the_buckets_do_not_overlap_and_add_up(): void
    {
        $onTime = $this->employee('On Time');
        $late = $this->employee('Late Arrival');
        $onLeave = $this->employee('On Leave');
        $absent = $this->employee('No Show');

        $this->punched($onTime, 0);
        $this->punched($late, 35);

        LeaveRequest::create([
            'organization_id' => $this->org->id,
            'user_id' => $onLeave->id,
            'status' => 'approved',
            'start_date' => '2026-08-24',
            'end_date' => '2026-08-24',
            'leave_type' => 'full_day',
            'leave_category' => 'paid',
            'reason' => 'Family',
        ]);

        foreach ([$onTime, $late, $onLeave, $absent] as $user) {
            RosterDay::create([
                'organization_id' => $this->org->id,
                'user_id' => $user->id,
                'roster_date' => '2026-08-24',
                'shift_id' => null,
                'status' => 'published',
                'source' => 'manual',
            ]);
        }

        // A real shift row: roster_days.shift_id is a foreign key.
        $shiftId = DB::table('shifts')->insertGetId([
            'organization_id' => $this->org->id,
            'name' => 'A-shift',
            'code' => 'A',
            'type' => 'general',
            'start_time' => '09:00',
            'end_time' => '18:00',
            'duration_minutes' => 540,
            'break_duration_minutes' => 60,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        RosterDay::where('organization_id', $this->org->id)->update(['shift_id' => $shiftId]);

        $snap = (new TodaySnapshotService())->forOrganization($this->org->id);

        $this->assertSame(1, $snap['present_on_time']['count']);
        $this->assertSame(1, $snap['late']['count']);
        $this->assertSame(35, $snap['late']['total_minutes']);
        $this->assertSame(1, $snap['on_leave']['count']);

        /*
         * The number nothing produced before: rostered, not on leave, no
         * punch. Exactly one person qualifies — and crucially the leave-taker
         * does NOT, even though they are rostered and have no punch either.
         */
        $this->assertSame(1, $snap['rostered_absent']['count']);
        $this->assertSame([$absent->id], $snap['rostered_absent']['user_ids']);

        // Somebody late is not also counted on time.
        $this->assertNotContains($late->id, $snap['present_on_time']['user_ids']);
    }

    public function test_an_off_day_is_not_an_absence_and_no_roster_is_not_zero(): void
    {
        $resting = $this->employee('Rest Day');
        $unrostered = $this->employee('Not Rostered');

        // A row with a null shift means "rostered, and off" — somebody was
        // told something. No row at all means nobody scheduled them.
        RosterDay::create([
            'organization_id' => $this->org->id,
            'user_id' => $resting->id,
            'roster_date' => '2026-08-24',
            'shift_id' => null,
            'status' => 'published',
            'source' => 'generated',
        ]);

        $snap = (new TodaySnapshotService())->forOrganization($this->org->id);

        $this->assertTrue($snap['roster']['published']);
        $this->assertSame(1, $snap['roster']['rest_day']);
        $this->assertSame(1, $snap['roster']['not_rostered'], 'The unrostered employee is counted separately.');
        $this->assertSame(0, $snap['rostered_absent']['count'], 'Neither a rest day nor an unrostered day is a no-show.');
        $this->assertNotContains($resting->id, $snap['rostered_absent']['user_ids']);
        $this->assertNotContains($unrostered->id, $snap['rostered_absent']['user_ids']);
    }

    public function test_without_a_published_roster_absence_is_unknowable_not_zero(): void
    {
        $this->employee('Nobody Rostered Them');

        $snap = (new TodaySnapshotService())->forOrganization($this->org->id);

        /*
         * published:false is the load-bearing part. The count is 0 either way,
         * but only this flag lets the dashboard say "no roster published"
         * instead of a green "0 absent" that nobody checked.
         */
        $this->assertFalse($snap['roster']['published']);
        $this->assertSame(0, $snap['rostered_absent']['count']);
    }

    public function test_the_snapshot_does_not_fan_out_per_employee(): void
    {
        foreach (range(1, 12) as $i) {
            $this->punched($this->employee("Worker {$i}"), $i % 3 === 0 ? 10 : 0);
        }

        DB::enableQueryLog();
        (new TodaySnapshotService())->forOrganization($this->org->id);
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        /*
         * The whole point. AttendanceService::summary runs one AttendanceRecord
         * query WITH a punches eager-load per user, so twelve employees cost
         * twelve queries and ninety-three cost ninety-three. This is a fixed
         * handful of grouped queries whatever the headcount.
         */
        $this->assertLessThanOrEqual(
            8,
            $queries,
            "The snapshot ran {$queries} queries for 12 employees — it is fanning out per person again."
        );
    }

    public function test_the_headcount_curve_ends_on_the_real_headcount(): void
    {
        foreach (range(1, 5) as $i) {
            $user = $this->employee("Joiner {$i}");
            DB::table('employee_work_infos')->insert([
                'user_id' => $user->id,
                'organization_id' => $this->org->id,
                'joining_date' => Carbon::parse('2026-08-24')->subMonths($i)->toDateString(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $series = (new HeadcountSeriesService())->monthly($this->org->id);
        $months = $series['months'];

        $this->assertCount(12, $months, 'Twelve months by default.');

        /*
         * Anchored, not accumulated. Joining dates do not reach back to the
         * organisation's founding, so counting up from zero gives a curve
         * that is wrong at every point and right only at the end. Walking
         * back from a figure we actually know is wrong only where the data
         * genuinely is.
         */
        $this->assertSame(
            $series['current_headcount'],
            end($months)['headcount'],
            'The last point must equal the headcount every other screen shows.'
        );

        $this->assertSame(5, $series['current_headcount']);
    }

    public function test_pending_counts_come_back_as_one_call_with_a_total(): void
    {
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@aggregates.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $this->org->id,
            'email_verified_at' => now(),
        ]);

        $employee = $this->employee('Requester');

        foreach (['pending', 'pending', 'approved'] as $status) {
            LeaveRequest::create([
                'organization_id' => $this->org->id,
                'user_id' => $employee->id,
                'status' => $status,
                'start_date' => '2026-08-25',
                'end_date' => '2026-08-25',
                'leave_type' => 'full_day',
                'leave_category' => 'paid',
                'reason' => 'x',
            ]);
        }

        $body = $this->actingAs($admin)
            ->getJson('/api/approvals/pending-counts')
            ->assertOk()
            ->json('data');

        // Only the pending ones, and a total that sums what was counted.
        $this->assertSame(2, $body['leave']);
        $this->assertArrayHasKey('total', $body);
        $this->assertGreaterThanOrEqual(2, $body['total']);
    }
}
