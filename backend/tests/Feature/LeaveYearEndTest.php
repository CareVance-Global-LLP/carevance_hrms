<?php

namespace Tests\Feature;

use App\Models\EmployeeWorkInfo;
use App\Models\LeaveLedgerEntry;
use App\Models\LeaveType;
use App\Models\Organization;
use App\Models\User;
use App\Services\Leave\LeaveAccrualService;
use App\Services\Leave\LeaveYearEndService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Closing a leave year.
 *
 * The moment a customer's HR team scrutinises hardest, because it is when
 * balances visibly change. Three things must hold or the ledger stops being an
 * explanation:
 *
 *   1. Every outcome is a dated row. "Where did my 8 days go" has to expand.
 *   2. Carry-and-expire is two rows, not one net row.
 *   3. Running the close twice changes nothing.
 */
class LeaveYearEndTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-year-end']);

        $this->employee = User::create([
            'name' => 'Kajal',
            'email' => 'kajal@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        EmployeeWorkInfo::query()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'joining_date' => '2020-01-01',
        ]);
    }

    /** @param array<string, mixed> $overrides */
    private function type(array $overrides = []): LeaveType
    {
        return LeaveType::query()->create(array_merge([
            'organization_id' => $this->organization->id,
            'code' => 'paid',
            'name' => 'Paid Leave',
            'annual_quota' => 15,
            'accrual_frequency' => 'annual',
            'carry_forward_cap' => 0,
            'is_active' => true,
            'is_paid' => true,
        ], $overrides));
    }

    private function close(): array
    {
        return app(LeaveYearEndService::class)
            ->closeYearForUser($this->employee->fresh(), Carbon::parse('2026-12-31'));
    }

    /** @return \Illuminate\Support\Collection<int, LeaveLedgerEntry> */
    private function rows(string $kind)
    {
        return LeaveLedgerEntry::query()
            ->where('user_id', $this->employee->id)
            ->where('kind', $kind)
            ->get();
    }

    private function accrue(): void
    {
        app(LeaveAccrualService::class)->accrueForUser($this->employee->fresh(), Carbon::parse('2026-06-30'));
    }

    public function test_carry_forward_splits_into_what_moved_and_what_expired(): void
    {
        $this->type(['carry_forward_cap' => 10, 'year_end_action' => 'carry_forward']);
        $this->accrue();

        $result = $this->close();

        // 15 earned, 10 carried, 5 expired.
        $this->assertSame(10.0, $result['types']['paid']['carried']);
        $this->assertSame(5.0, $result['types']['paid']['expired']);

        /*
         * Two rows, not one net row for -5. "You had 15, 10 carried and 5
         * expired" is the sentence somebody needs, and a single row cannot say
         * it.
         */
        $this->assertSame(1, $this->rows('expiry')->count());
        $this->assertSame(2, $this->rows('carry_forward')->count(), 'the carry did not land on both sides of the year boundary');
    }

    public function test_the_carried_days_open_the_next_year(): void
    {
        $this->type(['carry_forward_cap' => 10, 'year_end_action' => 'carry_forward']);
        $this->accrue();
        $this->close();

        // effective_on casts to Carbon, so it is compared as a date string
        // rather than against the raw column value.
        $opening = $this->rows('carry_forward')
            ->first(fn ($row) => $row->effective_on->toDateString() === '2027-01-01');

        // Without the opening row the new year starts at zero and the days are
        // simply gone, which is the bug this pair of rows exists to prevent.
        $this->assertNotNull($opening, 'nothing was credited into the new leave year');
        $this->assertSame('10.00', (string) $opening->units);
    }

    public function test_reset_expires_the_whole_balance(): void
    {
        $this->type(['carry_forward_cap' => 10, 'year_end_action' => 'reset']);
        $this->accrue();

        $result = $this->close();

        // The cap is ignored on purpose: reset means reset, and honouring a
        // stale cap would carry days the policy says are gone.
        $this->assertSame('reset', $result['types']['paid']['action']);
        $this->assertSame(15.0, $result['types']['paid']['expired']);
        $this->assertSame(0, $this->rows('carry_forward')->count());
    }

    public function test_encashment_is_recorded_as_money_owed_not_as_an_expiry(): void
    {
        $this->type(['year_end_action' => 'encash', 'is_encashable' => true]);
        $this->accrue();

        $result = $this->close();

        // A settlement run has to be able to find this. Filed as an expiry it
        // would be indistinguishable from days nobody owes anything for.
        $this->assertSame('encash', $result['types']['paid']['action']);
        $this->assertSame(1, $this->rows('encashment')->count());
        $this->assertSame(0, $this->rows('expiry')->count());
    }

    public function test_a_type_that_cannot_be_encashed_expires_instead(): void
    {
        $this->type(['year_end_action' => 'encash', 'is_encashable' => false]);
        $this->accrue();

        $result = $this->close();

        // A contradiction somebody configured. The type-level flag wins rather
        // than quietly creating a payroll liability nobody agreed to.
        $this->assertSame('reset', $result['types']['paid']['action']);
        $this->assertSame(0, $this->rows('encashment')->count());
        $this->assertSame(1, $this->rows('expiry')->count());
    }

    public function test_closing_the_year_twice_changes_nothing(): void
    {
        $this->type(['carry_forward_cap' => 10, 'year_end_action' => 'carry_forward']);
        $this->accrue();

        $this->close();
        $before = LeaveLedgerEntry::query()->where('user_id', $this->employee->id)->count();

        $this->close();

        // The close is a scheduled job. It WILL be re-run after a failure or by
        // a nervous admin, and a doubled carry-forward is invisible until
        // somebody takes leave they never earned.
        $this->assertSame($before, LeaveLedgerEntry::query()->where('user_id', $this->employee->id)->count());
    }

    public function test_an_overdrawn_balance_is_left_alone_rather_than_erased(): void
    {
        $type = $this->type(['carry_forward_cap' => 10]);
        $this->accrue();

        // Taken more than earned, which back-dated approvals and adjustments do
        // produce.
        LeaveLedgerEntry::query()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'leave_type_id' => $type->id,
            'kind' => 'consumption',
            'units' => -20,
            'effective_on' => '2026-07-01',
            'cycle_start' => '2026-01-01',
            'cycle_end' => '2026-12-31',
        ]);

        $result = $this->close();

        // Zeroing it at year end would hide an overdraft payroll may still need
        // to recover.
        $this->assertArrayNotHasKey('paid', $result['types']);
        $this->assertSame(0, $this->rows('expiry')->count());
        $this->assertSame(0, $this->rows('carry_forward')->count());
    }

    public function test_a_period_end_policy_credits_only_once_the_period_has_closed(): void
    {
        $type = $this->type([
            'accrual_frequency' => 'monthly',
            'accrual_timing' => 'period_end',
            'annual_quota' => 12,
        ]);

        // Mid-January. The month has begun but has not closed, so a period_end
        // policy owes nothing yet — getting this backwards hands out a year of
        // leave nobody has earned.
        app(LeaveAccrualService::class)->accrueForUser($this->employee->fresh(), Carbon::parse('2026-01-15'));
        $this->assertSame(0, $this->rows('accrual')->count());

        app(LeaveAccrualService::class)->accrueForUser($this->employee->fresh(), Carbon::parse('2026-01-31'));
        $this->assertSame(1, $this->rows('accrual')->count());

        // And dated when it LANDED, not when its period opened.
        $this->assertSame(
            '2026-01-31',
            $this->rows('accrual')->first()->effective_on->toDateString(),
        );
    }

    public function test_a_period_start_policy_credits_the_moment_the_period_opens(): void
    {
        $this->type([
            'accrual_frequency' => 'monthly',
            'accrual_timing' => 'period_start',
            'annual_quota' => 12,
        ]);

        // The default, and what "you get a day a month" means to the person
        // receiving it.
        app(LeaveAccrualService::class)->accrueForUser($this->employee->fresh(), Carbon::parse('2026-01-01'));

        $this->assertSame(1, $this->rows('accrual')->count());
        $this->assertSame('2026-01-01', $this->rows('accrual')->first()->effective_on->toDateString());
    }

    public function test_somebody_serving_notice_accrues_at_the_notice_rate(): void
    {
        $this->type([
            'accrual_frequency' => 'monthly',
            'annual_quota' => 12,
            'notice_period_annual_quota' => 0,
        ]);

        DB::table('employee_exits')->insert([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'notice_start_date' => '2026-03-01',
            'last_working_date' => '2026-05-31',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        app(LeaveAccrualService::class)->accrueForUser($this->employee->fresh(), Carbon::parse('2026-05-01'));

        /*
         * January and February at the normal rate; March onward at zero. An
         * employer sets a notice rate precisely to stop leave being run down on
         * the way out, so the months after resignation must not accrue.
         */
        $this->assertSame(2, $this->rows('accrual')->count());
    }

    public function test_an_unset_notice_rate_means_the_normal_rate_not_zero(): void
    {
        $this->type([
            'accrual_frequency' => 'monthly',
            'annual_quota' => 12,
            'notice_period_annual_quota' => null,
        ]);

        DB::table('employee_exits')->insert([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'notice_start_date' => '2026-01-01',
            'last_working_date' => '2026-03-31',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        app(LeaveAccrualService::class)->accrueForUser($this->employee->fresh(), Carbon::parse('2026-03-01'));

        // Treating unset as zero would silently stop accrual for everybody on
        // notice the moment the column existed.
        $this->assertSame(3, $this->rows('accrual')->count());
    }
}
