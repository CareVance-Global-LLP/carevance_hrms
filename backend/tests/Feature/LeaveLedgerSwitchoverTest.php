<?php

namespace Tests\Feature;

use App\Models\EmployeeWorkInfo;
use App\Models\LeaveLedgerEntry;
use App\Models\LeaveRequest;
use App\Models\LeaveType;
use App\Models\Organization;
use App\Models\User;
use App\Services\Leave\LeaveAccrualService;
use App\Services\Leave\LeaveConsumptionSync;
use App\Services\Leave\LeavePolicyService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Moving to the ledger must not move anybody's balance.
 *
 * This is the dangerous moment in the whole leave change. The ledger becoming
 * authoritative is a switchover on live entitlement data: get it wrong and every
 * employee's balance changes overnight, which is the one leave bug a customer
 * notices immediately and never forgets.
 *
 * The safety comes from the migration backfilling every existing type to the
 * `annual` schedule. On that schedule "accrued so far" and "the annual quota"
 * are the same number, so the ledger reproduces the old figures exactly. These
 * tests hold that property down.
 */
class LeaveLedgerSwitchoverTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-switchover',
            'settings' => [
                'leave_policy' => [
                    'categories' => [
                        ['code' => 'paid', 'name' => 'Paid Leave', 'annual_quota' => 21],
                        ['code' => 'sick', 'name' => 'Sick Leave', 'annual_quota' => 12],
                    ],
                ],
            ],
        ]);

        $this->employee = User::create([
            'name' => 'Employee',
            'email' => 'employee@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        EmployeeWorkInfo::query()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'joining_date' => now()->copy()->startOfYear()->toDateString(),
        ]);

        // What the migration does for a real organization.
        foreach ([['paid', 'Paid Leave', 21], ['sick', 'Sick Leave', 12]] as [$code, $name, $quota]) {
            LeaveType::query()->create([
                'organization_id' => $this->organization->id,
                'code' => $code,
                'name' => $name,
                'annual_quota' => $quota,
                'accrual_frequency' => 'annual',
                'is_active' => true,
            ]);
        }
    }

    private function approveLeave(string $start, string $end, string $category): LeaveRequest
    {
        return LeaveRequest::query()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'start_date' => $start,
            'end_date' => $end,
            'status' => 'approved',
            'leave_category' => $category,
            'reason' => 'Test',
        ]);
    }

    private function runLedger(): void
    {
        app(LeaveAccrualService::class)->accrueForUser($this->employee, now());
        app(LeaveConsumptionSync::class)->syncForUser($this->employee);
    }

    private function snapshots(): array
    {
        $service = app(LeavePolicyService::class);
        $categories = $service->resolvePolicyCategories($this->organization);

        return [
            $service->buildBalanceSnapshotForUser($this->employee, $categories),
            $service->buildLedgerBalanceSnapshotForUser($this->employee, $categories),
        ];
    }

    public function test_the_ledger_reports_the_same_balance_as_the_quota_did(): void
    {
        $this->runLedger();

        [$quota, $ledger] = $this->snapshots();

        $this->assertSame(
            $quota['totals'],
            $ledger['totals'],
            'switching to the ledger changed the reported balance',
        );
    }

    public function test_it_still_matches_after_leave_has_been_taken(): void
    {
        // Balance-neutral has to hold with consumption in play, not just on an
        // untouched account.
        $start = now()->copy()->startOfYear()->addMonths(2);
        $this->approveLeave($start->toDateString(), $start->copy()->addDays(2)->toDateString(), 'paid');

        $this->runLedger();

        [$quota, $ledger] = $this->snapshots();

        $this->assertSame($quota['totals']['quota'], $ledger['totals']['quota']);
        $this->assertSame($quota['totals']['used'], $ledger['totals']['used'], 'consumption disagrees between the two');
        $this->assertSame($quota['totals']['remaining'], $ledger['totals']['remaining']);
    }

    public function test_every_category_matches_individually_not_just_the_total(): void
    {
        // Two errors that cancel out across categories would pass a totals-only
        // assertion while showing every individual balance wrong.
        $start = now()->copy()->startOfYear()->addMonths(3);
        $this->approveLeave($start->toDateString(), $start->toDateString(), 'sick');

        $this->runLedger();

        [$quota, $ledger] = $this->snapshots();

        $byCode = fn (array $snapshot) => collect($snapshot['categories'])->keyBy('code')->map(
            fn ($row) => [$row['annual_quota'], $row['used'], $row['remaining']]
        )->all();

        $this->assertSame($byCode($quota), $byCode($ledger));
    }

    public function test_an_organization_without_leave_types_falls_back_to_the_quota(): void
    {
        /*
         * The switchover has to be safe mid-flight: an organization whose types
         * have not been created yet must keep working exactly as before, not
         * see zeros.
         */
        LeaveType::query()->where('organization_id', $this->organization->id)->delete();

        [$quota, $ledger] = $this->snapshots();

        $this->assertSame($quota, $ledger, 'an unmigrated organization did not fall back');
        $this->assertSame(33.0, $ledger['totals']['quota']);
    }

    public function test_running_the_sync_twice_does_not_double_consumption(): void
    {
        $start = now()->copy()->startOfYear()->addMonths(2);
        $this->approveLeave($start->toDateString(), $start->copy()->addDay()->toDateString(), 'paid');

        $this->runLedger();
        $firstUsed = $this->snapshots()[1]['totals']['used'];

        $this->runLedger();
        $secondUsed = $this->snapshots()[1]['totals']['used'];

        $this->assertSame($firstUsed, $secondUsed, 'a second sync double-counted leave already taken');
    }

    public function test_a_shortened_leave_request_corrects_itself(): void
    {
        /*
         * Consumption is keyed on the request, so an amended request updates its
         * row rather than adding a second one. Appending instead would leave the
         * person permanently short by the original length.
         */
        $start = now()->copy()->startOfYear()->addMonths(2);
        $leave = $this->approveLeave($start->toDateString(), $start->copy()->addDays(4)->toDateString(), 'paid');

        $this->runLedger();
        $before = $this->snapshots()[1]['totals']['used'];
        $this->assertGreaterThan(0, $before);

        $leave->update(['end_date' => $start->copy()->addDay()->toDateString()]);
        $this->runLedger();

        $after = $this->snapshots()[1]['totals']['used'];

        $this->assertLessThan($before, $after, 'shortening the request did not reduce the leave consumed');
        $this->assertSame(
            1,
            LeaveLedgerEntry::query()->where('source_id', $leave->id)->where('kind', 'consumption')->count(),
            'the amendment appended a row instead of correcting one',
        );
    }
}
