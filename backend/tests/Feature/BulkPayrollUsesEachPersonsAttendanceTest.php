<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayGroup;
use App\Models\PayGroupAssignment;
use App\Models\PayrollItem;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A bulk run pays each person for the days THEY worked.
 *
 * The pay-group processor derived attendance arithmetically instead of reading
 * it. The screen sent one `working_days` for the whole group — the first row's
 * value, or a hardcoded 26 — plus `lOP_days` computed as the group AVERAGE, and
 * the controller then did `days_present = working_days - lOP_days`.
 *
 * Three separate failures came out of that one line:
 *
 *   1. Real attendance was discarded. Nobody was paid against their own record.
 *   2. The average redistributed pay between colleagues. Someone with no
 *      absences was docked the group mean; someone with eight was docked less
 *      than they took. On the August 2026 group the mean was 1.78 days, so a
 *      fully present employee lost about ₹2,700.
 *   3. The average is fractional, `days_present` is validated as an integer,
 *      and so the whole run died with "The days present field must be an
 *      integer." for all nine employees — which is the only reason anybody
 *      noticed the first two.
 *
 * The job that processes a run already had this right and says so in a comment:
 * send nothing, and let processEmployeePayroll fall through to
 * monthlyAttendanceSummary per employee.
 */
class BulkPayrollUsesEachPersonsAttendanceTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;
    private User $admin;
    private PayGroup $payGroup;
    private string $monthYear = '2026-08';

    protected function setUp(): void
    {
        parent::setUp();

        $this->org = Organization::factory()->create();
        $this->admin = User::factory()->create(['organization_id' => $this->org->id, 'role' => 'admin']);
        $this->payGroup = PayGroup::create([
            'organization_id' => $this->org->id,
            'name' => 'CareTeam',
            'code' => 'CARETEAM',
        ]);
    }

    /** @param array<int, string> $absentDates Working days this person did not attend. */
    private function member(array $absentDates = []): User
    {
        $user = User::factory()->create(['organization_id' => $this->org->id, 'role' => 'employee']);

        EmployeePayrollTemplate::create([
            'organization_id' => $this->org->id,
            'user_id' => $user->id,
            'annual_ctc' => 600000,
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'pf_enabled' => false,
            'esi_enabled' => false,
            'pt_enabled' => false,
            'tds_enabled' => false,
            'pt_state' => '',
        ]);

        PayGroupAssignment::create([
            'organization_id' => $this->org->id,
            'pay_group_id' => $this->payGroup->id,
            'user_id' => $user->id,
            'effective_from' => '2026-01-01',
            'is_active' => true,
        ]);

        $cursor = Carbon::parse($this->monthYear.'-01')->startOfDay();
        $end = $cursor->copy()->endOfMonth();
        for (; $cursor->lessThanOrEqualTo($end); $cursor->addDay()) {
            if ($cursor->isWeekend() || in_array($cursor->toDateString(), $absentDates, true)) {
                continue;
            }

            AttendanceRecord::create([
                'organization_id' => $this->org->id,
                'user_id' => $user->id,
                'attendance_date' => $cursor->toDateString(),
                'check_in_at' => $cursor->copy()->setTime(9, 30),
                'check_out_at' => $cursor->copy()->setTime(18, 30),
                'worked_seconds' => 8 * 3600,
                'late_minutes' => 0,
                'status' => 'present',
            ]);
        }

        return $user;
    }

    /** The first four working days of the month. */
    private function firstWorkingDays(int $count): array
    {
        $dates = [];
        $cursor = Carbon::parse($this->monthYear.'-01')->startOfDay();
        while (count($dates) < $count) {
            if (! $cursor->isWeekend()) {
                $dates[] = $cursor->toDateString();
            }
            $cursor->addDay();
        }

        return $dates;
    }

    private function process(array $userIds, array $extra = []): \Illuminate\Testing\TestResponse
    {
        return $this->postJson(
            "/api/payroll/pay-groups/{$this->payGroup->id}/process-selected",
            array_merge([
                'month_year' => $this->monthYear,
                'user_ids' => $userIds,
            ], $extra),
            $this->apiHeadersFor($this->admin)
        );
    }

    private function itemFor(User $user): PayrollItem
    {
        return PayrollItem::withoutGlobalScopes()
            ->where('user_id', $user->id)
            ->where('month_year', $this->monthYear)
            ->firstOrFail();
    }

    public function test_the_run_does_not_need_a_group_wide_working_day_count(): void
    {
        $present = $this->member();

        // The screen has no business asserting a working-day count on anybody's
        // behalf; omitting it is what makes each person's own attendance win.
        $this->process([$present->id])->assertOk();

        $this->assertSame(0.0, (float) $this->itemFor($present)->lOP_days);
    }

    public function test_each_employee_is_docked_their_own_absences_not_the_group_average(): void
    {
        $present = $this->member();
        $absentFour = $this->member($this->firstWorkingDays(4));

        $this->process([$present->id, $absentFour->id])->assertOk();

        $this->assertSame(
            0.0,
            (float) $this->itemFor($present)->lOP_days,
            'somebody who worked every day must not be docked because a colleague was absent'
        );
        $this->assertSame(
            4.0,
            (float) $this->itemFor($absentFour)->lOP_days,
            'and somebody who missed four days must be docked four, not the mean of two'
        );
    }

    public function test_pay_is_not_redistributed_between_colleagues(): void
    {
        $present = $this->member();
        $absentFour = $this->member($this->firstWorkingDays(4));

        $this->process([$present->id, $absentFour->id])->assertOk();

        $this->assertGreaterThan(
            (float) $this->itemFor($absentFour)->net_pay,
            (float) $this->itemFor($present)->net_pay,
            'the fully present employee must take home more than the one who missed four days'
        );
    }

    /**
     * The exact request the screen was sending, which killed the whole run.
     *
     * The average of one absence across two people is 0.5, and `days_present`
     * was `working_days - lOP_days`. Whatever else is true, a fractional
     * attendance figure must not 422 nine employees out of a payroll run.
     */
    public function test_a_fractional_loss_of_pay_does_not_kill_the_run(): void
    {
        $a = $this->member();
        $b = $this->member($this->firstWorkingDays(1));

        $response = $this->process([$a->id, $b->id], [
            'working_days' => 26,
            'lOP_days' => 0.5,
        ]);

        $response->assertOk();
        $this->assertSame([], $response->json('failed'), 'no employee may fail on the shape of a number');
    }

    /**
     * An explicit override still wins.
     *
     * The wizard exists so somebody can state attendance the records do not
     * have — a new joiner mid-month, a correction agreed with the employee.
     * Removing the group-wide default must not take that away.
     */
    public function test_an_explicitly_stated_loss_of_pay_is_still_honoured(): void
    {
        $user = $this->member();

        $this->process([$user->id], ['working_days' => 22, 'lOP_days' => 3])->assertOk();

        $this->assertSame(3.0, (float) $this->itemFor($user)->lOP_days);
    }
}
