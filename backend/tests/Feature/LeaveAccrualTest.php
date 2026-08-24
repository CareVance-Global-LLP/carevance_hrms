<?php

namespace Tests\Feature;

use App\Models\EmployeeWorkInfo;
use App\Models\LeaveLedgerEntry;
use App\Models\LeaveType;
use App\Models\Organization;
use App\Models\User;
use App\Services\Leave\LeaveAccrualService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Leave is earned over time, not handed over on day one.
 *
 * The behaviour this replaces: a flat `annual_quota` granted whole at the start
 * of the year, so somebody joining in November received a full year of
 * entitlement and somebody leaving in February had none to encash. Every
 * customer has mid-year joiners, so this was not an edge case.
 */
class LeaveAccrualTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-leave']);
    }

    private function leaveType(array $overrides = []): LeaveType
    {
        return LeaveType::query()->create(array_merge([
            'organization_id' => $this->organization->id,
            'code' => 'paid',
            'name' => 'Paid Leave',
            'annual_quota' => 12,
            'accrual_frequency' => 'monthly',
            'pro_rate_on_join' => true,
            'joining_cutoff_day' => 15,
            'is_active' => true,
        ], $overrides));
    }

    /**
     * The joining date lives on `employee_work_infos`, not on the user — this
     * schema keeps employment detail off the users table, and setting
     * `joining_date` on User silently does nothing.
     */
    private function employee(string $joinedOn, string $email = 'e@carevance.test'): User
    {
        $user = User::create([
            'name' => 'Employee',
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        EmployeeWorkInfo::query()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'joining_date' => $joinedOn,
        ]);

        return $user->fresh();
    }

    private function accrue(User $user, string $asOf): int
    {
        return app(LeaveAccrualService::class)->accrueForUser($user, Carbon::parse($asOf));
    }

    private function balance(User $user, LeaveType $type, string $asOf): float
    {
        return app(LeaveAccrualService::class)->balanceFor($user, $type, Carbon::parse($asOf));
    }

    public function test_a_full_year_employee_accrues_the_whole_quota(): void
    {
        $type = $this->leaveType(['annual_quota' => 12]);
        $user = $this->employee('2026-01-01');

        $this->accrue($user, '2026-12-31');

        $this->assertSame(12.0, $this->balance($user, $type, '2026-12-31'));
    }

    public function test_accrual_is_credited_month_by_month_not_up_front(): void
    {
        // The point of the whole change: in March you have three months' worth,
        // not a year's.
        $type = $this->leaveType(['annual_quota' => 12]);
        $user = $this->employee('2026-01-01');

        $this->accrue($user, '2026-03-15');

        $this->assertSame(3.0, $this->balance($user, $type, '2026-03-15'));
    }

    public function test_a_november_joiner_does_not_receive_a_full_year(): void
    {
        /*
         * The reported behaviour, stated as a test. Joining 1 November on a
         * 12-day annual policy earns two months — November and December — not
         * twelve.
         */
        $type = $this->leaveType(['annual_quota' => 12]);
        $user = $this->employee('2026-11-01');

        $this->accrue($user, '2026-12-31');

        $this->assertSame(2.0, $this->balance($user, $type, '2026-12-31'));
    }

    public function test_joining_on_the_cutoff_day_earns_that_month(): void
    {
        // On or before the cutoff accrues in full — the boundary itself, which
        // is where an off-by-one in a date rule actually lives.
        $type = $this->leaveType(['annual_quota' => 12, 'joining_cutoff_day' => 15]);
        $user = $this->employee('2026-06-15');

        $this->accrue($user, '2026-06-30');

        $this->assertSame(1.0, $this->balance($user, $type, '2026-06-30'));
    }

    public function test_joining_after_the_cutoff_day_earns_nothing_that_month(): void
    {
        $type = $this->leaveType(['annual_quota' => 12, 'joining_cutoff_day' => 15]);
        $user = $this->employee('2026-06-16');

        $this->accrue($user, '2026-06-30');

        $this->assertSame(0.0, $this->balance($user, $type, '2026-06-30'));
    }

    public function test_the_cutoff_penalty_applies_only_to_the_joining_month(): void
    {
        /*
         * A late-month joiner loses that month and nothing more. Applying the
         * cutoff to every period would quietly halve their entitlement for the
         * rest of their employment.
         */
        $type = $this->leaveType(['annual_quota' => 12, 'joining_cutoff_day' => 15]);
        $user = $this->employee('2026-06-20');

        $this->accrue($user, '2026-08-31');

        // June nothing, July and August one each.
        $this->assertSame(2.0, $this->balance($user, $type, '2026-08-31'));
    }

    public function test_pro_rating_can_be_turned_off(): void
    {
        // Some policies grant the joining month regardless. That is a setting,
        // not a hardcoded kindness.
        $type = $this->leaveType(['annual_quota' => 12, 'pro_rate_on_join' => false, 'joining_cutoff_day' => 15]);
        $user = $this->employee('2026-06-25');

        $this->accrue($user, '2026-06-30');

        $this->assertSame(1.0, $this->balance($user, $type, '2026-06-30'));
    }

    public function test_annual_frequency_still_grants_up_front(): void
    {
        // The behaviour every existing organization is on today, and what the
        // migration backfilled them to. This must not change under them.
        $type = $this->leaveType(['annual_quota' => 21, 'accrual_frequency' => 'annual']);
        $user = $this->employee('2026-01-01');

        $this->accrue($user, '2026-01-05');

        $this->assertSame(21.0, $this->balance($user, $type, '2026-01-05'));
    }

    public function test_quarterly_accrues_four_times_a_year(): void
    {
        $type = $this->leaveType(['annual_quota' => 12, 'accrual_frequency' => 'quarterly']);
        $user = $this->employee('2026-01-01');

        $this->accrue($user, '2026-07-01');

        // Q1, Q2 and Q3 have started by 1 July.
        $this->assertSame(9.0, $this->balance($user, $type, '2026-07-01'));
    }

    public function test_running_the_accrual_twice_does_not_double_anybody(): void
    {
        /*
         * The one that matters operationally. The accrual job WILL be re-run —
         * after a crash, after a policy edit, by a nervous admin — and a double
         * credit is invisible until somebody takes leave they never earned.
         */
        $type = $this->leaveType(['annual_quota' => 12]);
        $user = $this->employee('2026-01-01');

        $first = $this->accrue($user, '2026-06-30');
        $second = $this->accrue($user, '2026-06-30');

        $this->assertSame(6, $first);
        $this->assertSame(0, $second, 'the second run wrote new rows');
        $this->assertSame(6.0, $this->balance($user, $type, '2026-06-30'));
    }

    public function test_probation_accrues_at_its_own_rate(): void
    {
        $this->organization->update(['settings' => ['probation_months' => 3]]);

        $type = $this->leaveType([
            'annual_quota' => 12,
            'probation_annual_quota' => 6,
        ]);
        $user = $this->employee('2026-01-01');

        $this->accrue($user, '2026-06-30');

        // Three months at 0.5, three at 1.0.
        $this->assertSame(4.5, $this->balance($user, $type, '2026-06-30'));
    }

    public function test_an_unset_probation_quota_means_the_normal_rate(): void
    {
        // Treating "unset" as zero would silently stop accrual for every new
        // joiner the moment the column existed.
        $this->organization->update(['settings' => ['probation_months' => 6]]);

        $type = $this->leaveType(['annual_quota' => 12, 'probation_annual_quota' => null]);
        $user = $this->employee('2026-01-01');

        $this->accrue($user, '2026-03-31');

        $this->assertSame(3.0, $this->balance($user, $type, '2026-03-31'));
    }

    public function test_nothing_accrues_before_somebody_joins(): void
    {
        $type = $this->leaveType(['annual_quota' => 12]);
        $user = $this->employee('2026-09-01');

        $this->accrue($user, '2026-08-31');

        $this->assertSame(0.0, $this->balance($user, $type, '2026-08-31'));
    }

    public function test_the_balance_can_be_explained_line_by_line(): void
    {
        /*
         * The reason this is a ledger and not a counter. HR does not ask "what
         * is my balance", they ask "why is it that" — and a number nobody can
         * expand into dated rows is a number you argue about with a customer's
         * HR team holding a spreadsheet.
         */
        $type = $this->leaveType(['annual_quota' => 12]);
        $user = $this->employee('2026-01-01');

        $this->accrue($user, '2026-03-31');

        LeaveLedgerEntry::query()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'leave_type_id' => $type->id,
            'kind' => 'consumption',
            'units' => -2,
            'effective_on' => '2026-03-10',
            'cycle_start' => '2026-01-01',
            'cycle_end' => '2026-12-31',
            'source' => 'leave_request',
        ]);

        $rows = LeaveLedgerEntry::query()
            ->where('user_id', $user->id)
            ->orderBy('effective_on')
            ->get();

        $this->assertCount(4, $rows, 'three accruals and one consumption');
        $this->assertSame(1.0, $this->balance($user, $type, '2026-03-31'));
        $this->assertSame(
            1.0,
            (float) $rows->sum(fn (LeaveLedgerEntry $row) => (float) $row->units),
            'the rows shown do not add up to the balance reported',
        );
    }

    public function test_leave_types_do_not_leak_across_organizations(): void
    {
        $type = $this->leaveType(['annual_quota' => 12]);
        $user = $this->employee('2026-01-01');
        $this->accrue($user, '2026-06-30');

        $otherOrg = Organization::create(['name' => 'Other', 'slug' => 'other-leave']);
        $otherUser = User::create([
            'name' => 'Other',
            'email' => 'other@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $otherOrg->id,
            'joining_date' => '2026-01-01',
        ]);

        // No leave types configured for the other organization: nothing accrues,
        // and certainly not against this one's policy.
        $this->assertSame(0, $this->accrue($otherUser, '2026-06-30'));
        $this->assertSame(0.0, $this->balance($otherUser, $type, '2026-06-30'));
    }
}
