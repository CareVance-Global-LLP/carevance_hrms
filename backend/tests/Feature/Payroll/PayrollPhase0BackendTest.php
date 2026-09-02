<?php

namespace Tests\Feature\Payroll;

use App\Models\AttendanceRecord;
use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Three ways a payroll run paid the wrong people the wrong amount and said so
 * nowhere.
 *
 *  1. The bulk endpoints took ONE working_days and ONE lOP_days for a whole
 *     group, so the only reachable run path in the product sent the first row's
 *     calendar for everybody and the group's total LOP divided by headcount.
 *     The `employees[]` array that fixed it then resolved each field
 *     INDEPENDENTLY — the entry, else the flat body, per field — which re-made
 *     the same defect in both directions inside one 200 OK: a flat lOP_days is
 *     non-null for everybody, so the pair-derivation never fired, an employee
 *     stated present 20 of 26 was paid a full month and an employee stated
 *     present 26 of 26 was docked by the group's figure.
 *  2. Run completeness excluded anyone with no annual_ctc from "expected", so a
 *     new joiner nobody had priced was not missing, missing_count was 0,
 *     is_complete was true, and the run locked and approved clean without them.
 *     Counting them as expected instead made every organisation permanently
 *     partial, because every user gets a 0-CTC template on creation.
 *  3. The salary card answered 'maharashtra' for an unset professional-tax
 *     state, and the operator saves that card back.
 *
 * All three are silent by construction — every row reports success — so these
 * tests assert the per-person figures, the completeness numbers and the stored
 * state directly rather than the response's own success flag, which was never
 * the thing that was wrong.
 */
class PayrollPhase0BackendTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $absentee;
    private User $colleague;
    private int $departmentId;
    private string $monthYear = '2026-06';

    /** June 2026 has 22 weekdays; the fixture books no holidays. */
    private const WEEKDAYS_IN_MONTH = 22.0;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create([
            'settings' => ['payroll' => ['pfEnabled' => true, 'esiEnabled' => false, 'ptEnabled' => false]],
        ]);

        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->absentee = $this->onPayrollEmployee(600000);
        $this->colleague = $this->onPayrollEmployee(600000);

        $this->departmentId = (int) DB::table('groups')->insertGetId([
            'organization_id' => $this->organization->id,
            'name' => 'Operations',
            'slug' => 'operations',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        foreach ([$this->absentee, $this->colleague] as $member) {
            DB::table('group_user')->insert([
                'group_id' => $this->departmentId,
                'user_id' => $member->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    /** An employee on payroll, priced unless $annualCtc is null. */
    private function onPayrollEmployee(?float $annualCtc, string $role = 'employee'): User
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => $role,
        ]);

        $this->templateFor($user, $annualCtc);

        return $user;
    }

    private function templateFor(User $user, ?float $annualCtc): EmployeePayrollTemplate
    {
        return EmployeePayrollTemplate::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'annual_ctc' => $annualCtc,
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_allowance' => 1600,
            'is_active' => true,
            'pf_enabled' => true,
            'esi_enabled' => false,
            'pt_enabled' => false,
            'tds_enabled' => false,
            'tax_regime' => 'new',
            'pt_state' => null,
        ]);
    }

    /** @param array<string, mixed> $body */
    private function processSelected(array $body): \Illuminate\Testing\TestResponse
    {
        return $this->postJson(
            "/api/payroll/departments/{$this->departmentId}/process-selected",
            array_merge([
                'month_year' => $this->monthYear,
                'user_ids' => [$this->absentee->id, $this->colleague->id],
            ], $body),
            $this->apiHeadersFor($this->admin)
        );
    }

    private function itemFor(User $user): PayrollItem
    {
        return PayrollItem::where('user_id', $user->id)
            ->where('month_year', $this->monthYear)
            ->firstOrFail();
    }

    /**
     * Marks every working day of the month present for one employee, except the
     * last $skipDays of them — which the attendance summary then reports as that
     * person's own LOP.
     */
    private function markPresentAllMonth(User $user, int $skipDays = 0): int
    {
        $date = Carbon::parse($this->monthYear.'-01')->startOfDay();
        $end = $date->copy()->endOfMonth();
        $workdays = [];

        for (; $date->lessThanOrEqualTo($end); $date->addDay()) {
            if ($date->isWeekend()) {
                continue;
            }
            $workdays[] = $date->copy();
        }

        $present = $skipDays > 0 ? array_slice($workdays, 0, -$skipDays) : $workdays;

        foreach ($present as $day) {
            AttendanceRecord::create([
                'organization_id' => $this->organization->id,
                'user_id' => $user->id,
                'attendance_date' => $day->toDateString(),
                'check_in_at' => $day->copy()->setTime(9, 30),
                'check_out_at' => $day->copy()->setTime(18, 30),
                'worked_seconds' => 8 * 3600,
                'late_minutes' => 0,
                'status' => 'present',
            ]);
        }

        return count($workdays);
    }

    // ───────────────────────── Defect 1: one figure for a whole group

    public function test_per_employee_lop_is_deducted_from_that_employee_only(): void
    {
        $this->processSelected([
            'working_days' => 26,
            'employees' => [
                ['user_id' => $this->absentee->id, 'lOP_days' => 5],
            ],
        ])->assertOk();

        $this->assertSame(
            5.0,
            (float) $this->itemFor($this->absentee)->lOP_days,
            'The employee who took the unpaid days must carry all five of them.'
        );
        $this->assertSame(
            0.0,
            (float) $this->itemFor($this->colleague)->lOP_days,
            'A colleague who was present all month must not be docked for somebody else absence.'
        );
    }

    public function test_a_per_employee_lop_moves_only_that_employees_pay(): void
    {
        $this->processSelected([
            'working_days' => 26,
            'employees' => [
                ['user_id' => $this->absentee->id, 'lOP_days' => 5],
            ],
        ])->assertOk();

        $this->assertLessThan(
            (float) $this->itemFor($this->colleague)->net_pay,
            (float) $this->itemFor($this->absentee)->net_pay,
            'Five unpaid days must cost the absentee money and cost the colleague none.'
        );
    }

    public function test_days_present_and_lop_days_agree_with_the_working_days_they_came_from(): void
    {
        // The flat lOP_days is what a group with no group-wide absence sends,
        // and it is what broke this: resolving each field on its own found a
        // non-null flat 0 for lOP, so the "derive the other half of the pair"
        // rule never fired and an employee stated present 20 of 26 days was paid
        // a FULL MONTH — the reproduced ₹9,447.60 overpayment.
        $this->processSelected([
            'lOP_days' => 0,
            'employees' => [
                ['user_id' => $this->absentee->id, 'working_days' => 26, 'days_present' => 20],
            ],
        ])->assertOk();

        $item = $this->itemFor($this->absentee);

        $this->assertSame(26.0, (float) $item->total_working_days);
        $this->assertSame(20.0, (float) $item->days_present);
        $this->assertSame(6.0, (float) $item->lOP_days, 'Present 20 of 26 must dock six days.');
        $this->assertGreaterThan(0.0, (float) $item->lOP_deduction);
    }

    public function test_a_group_lop_does_not_leak_into_a_per_employee_statement(): void
    {
        // The reproduced defect: because each field fell back to the flat body
        // on its own, an employee stated present for every one of their 26 days
        // still carried the group's 4 and was docked ₹3,149.20 of a ₹50,000
        // gross. The whole point of stating a person's month is that the group's
        // figure stops applying to them.
        $this->processSelected([
            'working_days' => 26,
            'lOP_days' => 4,
            'employees' => [
                ['user_id' => $this->absentee->id, 'working_days' => 26, 'days_present' => 26],
            ],
        ])->assertOk();

        $stated = $this->itemFor($this->absentee);
        $this->assertSame(26.0, (float) $stated->total_working_days);
        $this->assertSame(26.0, (float) $stated->days_present);
        $this->assertSame(0.0, (float) $stated->lOP_days, 'Present every day means nothing is docked.');
        $this->assertSame(0.0, (float) $stated->lOP_deduction);

        // The colleague, who has no entry, still gets the group's statement.
        $grouped = $this->itemFor($this->colleague);
        $this->assertSame(26.0, (float) $grouped->total_working_days);
        $this->assertSame(22.0, (float) $grouped->days_present);
        $this->assertSame(4.0, (float) $grouped->lOP_days);
    }

    public function test_a_per_employee_lop_with_no_flat_calendar_leaves_a_colleague_untouched(): void
    {
        // The other reproduced consequence, and the one the feature's own
        // example claimed: with no flat working_days the untouched colleague
        // came back on lOP 22.0 and a net of ₹11,956.80 instead of unchanged.
        $this->markPresentAllMonth($this->absentee);
        $this->markPresentAllMonth($this->colleague);

        $this->processSelected(['user_ids' => [$this->colleague->id]])->assertOk();
        $untouchedNet = (float) $this->itemFor($this->colleague)->net_pay;
        $this->assertGreaterThan(0.0, $untouchedNet);

        $this->processSelected([
            'employees' => [
                ['user_id' => $this->absentee->id, 'lOP_days' => 5],
            ],
        ])->assertOk();

        $colleague = $this->itemFor($this->colleague);
        $this->assertSame(0.0, (float) $colleague->lOP_days, 'A colleague nobody mentioned is not docked.');
        $this->assertSame(
            $untouchedNet,
            (float) $colleague->net_pay,
            'Naming one person in employees[] must not move anybody else pay by a rupee.'
        );
        $this->assertSame(5.0, (float) $this->itemFor($this->absentee)->lOP_days);
    }

    public function test_an_employee_with_no_entry_and_no_flat_values_falls_back_to_their_own_summary(): void
    {
        $workdays = $this->markPresentAllMonth($this->absentee);
        $this->markPresentAllMonth($this->colleague, skipDays: 2);

        $this->processSelected([
            'employees' => [
                ['user_id' => $this->absentee->id, 'lOP_days' => 5],
            ],
        ])->assertOk();

        $colleague = $this->itemFor($this->colleague);
        $this->assertSame((float) $workdays, (float) $colleague->total_working_days);
        $this->assertSame(self::WEEKDAYS_IN_MONTH - 2, (float) $colleague->days_present);
        $this->assertSame(
            2.0,
            (float) $colleague->lOP_days,
            'With nothing stated for them, the employee own attendance decides — their two absences, not the group figure and not zero.'
        );
    }

    public function test_falling_back_means_their_summary_even_when_their_summary_is_brutal(): void
    {
        // Pins the honest answer against a comfortable one. Making working_days
        // optional opened this path, and the feature was written up claiming an
        // untouched colleague came back "0.0 and unchanged". They do not: an
        // employee with no attendance records at all falls back to a summary
        // that reports every one of the month's 22 working days as LOP, and the
        // reproduction paid them ₹11,956.80.
        //
        // That is the fallback working — nobody stated anything about them, so
        // their own record answers — but it is a number an operator must be able
        // to see coming, and a docblock promising zero is how they would not.
        $this->processSelected([
            'employees' => [
                ['user_id' => $this->absentee->id, 'lOP_days' => 5],
            ],
        ])->assertOk();

        $colleague = $this->itemFor($this->colleague);
        $this->assertSame(self::WEEKDAYS_IN_MONTH, (float) $colleague->total_working_days);
        $this->assertSame(0.0, (float) $colleague->days_present);
        $this->assertSame(self::WEEKDAYS_IN_MONTH, (float) $colleague->lOP_days);
    }

    public function test_an_entry_that_states_nothing_means_that_employees_own_calendar(): void
    {
        // Naming somebody with no attendance fields is how a caller says "this
        // one is not on the group's calendar". Mixing levels would silently fill
        // the gap from the flat body, which is the leak in a quieter form.
        $workdays = $this->markPresentAllMonth($this->absentee);

        $this->processSelected([
            'working_days' => 26,
            'lOP_days' => 3,
            'employees' => [
                ['user_id' => $this->absentee->id],
            ],
        ])->assertOk();

        $own = $this->itemFor($this->absentee);
        $this->assertSame((float) $workdays, (float) $own->total_working_days);
        $this->assertSame(0.0, (float) $own->lOP_days);

        $grouped = $this->itemFor($this->colleague);
        $this->assertSame(26.0, (float) $grouped->total_working_days);
        $this->assertSame(3.0, (float) $grouped->lOP_days);
    }

    public function test_a_flat_request_behaves_exactly_as_it_did_before(): void
    {
        // No `employees` array at all: the shape every existing caller sends.
        $this->processSelected([
            'working_days' => 26,
            'lOP_days' => 2,
        ])->assertOk();

        foreach ([$this->absentee, $this->colleague] as $user) {
            $item = $this->itemFor($user);
            $this->assertSame(26.0, (float) $item->total_working_days);
            $this->assertSame(24.0, (float) $item->days_present);
            $this->assertSame(2.0, (float) $item->lOP_days);
        }
    }

    public function test_a_flat_request_with_no_lop_docks_nobody(): void
    {
        $this->processSelected(['working_days' => 26])->assertOk();

        foreach ([$this->absentee, $this->colleague] as $user) {
            $item = $this->itemFor($user);
            $this->assertSame(26.0, (float) $item->total_working_days);
            $this->assertSame(26.0, (float) $item->days_present);
            $this->assertSame(0.0, (float) $item->lOP_days);
        }
    }

    public function test_working_days_may_be_omitted_so_each_employee_uses_their_own_calendar(): void
    {
        $realWorkingDays = $this->markPresentAllMonth($this->absentee);
        $this->markPresentAllMonth($this->colleague);

        $this->processSelected([])->assertOk();

        $item = $this->itemFor($this->absentee);

        $this->assertSame(
            (float) $realWorkingDays,
            (float) $item->total_working_days,
            'With no stated calendar the employee own attendance must decide, not an invented 26.'
        );
        $this->assertSame(
            0.0,
            (float) $item->lOP_days,
            'An employee present every working day must not be docked.'
        );
    }

    public function test_an_override_for_somebody_outside_the_selection_is_refused(): void
    {
        $stranger = $this->onPayrollEmployee(600000);

        $this->processSelected([
            'working_days' => 26,
            'employees' => [
                ['user_id' => $stranger->id, 'lOP_days' => 5],
            ],
        ])->assertStatus(422)->assertJsonValidationErrors('employees.0.user_id');
    }

    public function test_the_pay_group_endpoint_takes_per_employee_attendance_too(): void
    {
        $payGroupId = (int) DB::table('pay_groups')->insertGetId([
            'organization_id' => $this->organization->id,
            'name' => 'Monthly',
            'code' => 'MONTHLY',
            'pay_frequency' => 'monthly',
            'pay_day_type' => 'specific',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        foreach ([$this->absentee, $this->colleague] as $member) {
            DB::table('pay_group_assignments')->insert([
                'organization_id' => $this->organization->id,
                'pay_group_id' => $payGroupId,
                'user_id' => $member->id,
                'effective_from' => $this->monthYear.'-01',
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $this->postJson("/api/payroll/pay-groups/{$payGroupId}/process-selected", [
            'month_year' => $this->monthYear,
            'user_ids' => [$this->absentee->id, $this->colleague->id],
            'working_days' => 26,
            'lOP_days' => 4,
            'employees' => [
                ['user_id' => $this->absentee->id, 'working_days' => 26, 'days_present' => 26],
            ],
        ], $this->apiHeadersFor($this->admin))->assertOk();

        // Same leak, same endpoint pair: both bulk paths share bulkAttendanceFor
        // and both have to refuse the group figure for a stated person.
        $this->assertSame(0.0, (float) $this->itemFor($this->absentee)->lOP_days);
        $this->assertSame(4.0, (float) $this->itemFor($this->colleague)->lOP_days);
    }

    // ───────────────────────── Defect 2: unpaid, unpriced, and told apart

    private function draftRun(): PayrollMonthlyRun
    {
        return PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => $this->monthYear,
            'status' => 'draft',
            'created_by' => $this->admin->id,
        ]);
    }

    private function processedItemFor(User $user, PayrollMonthlyRun $run): void
    {
        PayrollItem::create([
            'payroll_run_id' => $run->id,
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'month_year' => $this->monthYear,
            'basic' => 20000,
            'gross_salary' => 50000,
            'total_deductions' => 5000,
            'net_pay' => 45000,
        ]);
    }

    /** @return array<string, mixed> */
    private function completeness(PayrollMonthlyRun $run, ?User $as = null): array
    {
        return $this->getJson(
            "/api/payroll/runs/{$run->id}/completeness",
            $this->apiHeadersFor($as ?? $this->admin)
        )->assertOk()->json();
    }

    public function test_an_unpriced_employee_is_named_and_counted_without_making_the_run_partial(): void
    {
        $unpriced = $this->onPayrollEmployee(null);
        $run = $this->draftRun();
        $this->processedItemFor($this->absentee, $run);
        $this->processedItemFor($this->colleague, $run);

        $body = $this->completeness($run);

        // Everyone who could be paid was paid. Calling this partial is what made
        // the warning permanent — every organisation has admin accounts holding
        // the 0-CTC template getOrCreateForUser writes on user creation.
        $this->assertTrue($body['is_complete']);
        $this->assertSame(0, $body['missing_count']);

        // ...and the unpriced joiner is still named, which is the whole point.
        $this->assertSame(1, $body['unpriced_count']);
        $this->assertSame([$unpriced->id], array_column($body['unpriced_employees'], 'id'));
        $this->assertSame($unpriced->name, $body['unpriced_employees'][0]['name']);
    }

    public function test_a_zero_ctc_counts_the_same_as_a_null_one(): void
    {
        $unpriced = $this->onPayrollEmployee(0);
        $run = $this->draftRun();
        $this->processedItemFor($this->absentee, $run);
        $this->processedItemFor($this->colleague, $run);

        $body = $this->completeness($run);

        $this->assertSame([$unpriced->id], array_column($body['unpriced_employees'], 'id'));
        $this->assertTrue($body['is_complete']);
    }

    public function test_a_priced_employee_who_was_not_processed_does_make_the_run_partial(): void
    {
        $unpriced = $this->onPayrollEmployee(null);
        $run = $this->draftRun();
        // The colleague is priced and simply has not been run yet — the only
        // gap a re-run can actually close.
        $this->processedItemFor($this->absentee, $run);

        $body = $this->completeness($run);

        $this->assertFalse($body['is_complete']);
        $this->assertSame([$this->colleague->id], array_column($body['missing_employees'], 'id'));
        $this->assertFalse($body['missing_employees'][0]['needs_ctc']);
        $this->assertSame([$unpriced->id], array_column($body['unpriced_employees'], 'id'));
    }

    public function test_an_org_whose_only_unpriced_person_is_an_admin_locks_clean_and_still_says_so(): void
    {
        // The permanent false-partial, exactly as an operator met it: an HR or
        // admin account nobody pays, holding the template every user gets.
        $this->templateFor($this->admin, null);

        $run = $this->draftRun();
        $this->processedItemFor($this->absentee, $run);
        $this->processedItemFor($this->colleague, $run);

        $body = $this->postJson("/api/payroll/runs/{$run->id}/lock", [], $this->apiHeadersFor($this->admin))
            ->assertOk()
            ->json();

        $this->assertTrue($body['completeness']['is_complete']);
        $this->assertStringNotContainsString('partial', strtolower($body['message']));
        $this->assertStringContainsString('no salary configured', $body['message']);
        $this->assertSame([$this->admin->id], array_column($body['completeness']['unpriced_employees'], 'id'));
        $this->assertStringContainsString('no salary configured', (string) $run->fresh()->lock_reason);
    }

    public function test_the_lock_states_being_partial_and_being_unpriced_as_separate_facts(): void
    {
        $this->onPayrollEmployee(null);
        $run = $this->draftRun();
        // Priced, unprocessed: genuinely partial, and separately somebody is
        // unpriced. One sentence for each, in the message and the audit trail.
        $this->processedItemFor($this->absentee, $run);

        $body = $this->postJson("/api/payroll/runs/{$run->id}/lock", [], $this->apiHeadersFor($this->admin))
            ->assertOk()
            ->json();

        $this->assertSame('locked', $run->fresh()->status);
        $this->assertStringContainsString('(partial). 1 employee(s) not included.', $body['message']);
        $this->assertStringContainsString('1 employee(s) have no salary configured', $body['message']);

        $reason = (string) $run->fresh()->lock_reason;
        $this->assertStringContainsString('Partial run: 1 of 2 employees processed.', $reason);
        $this->assertStringContainsString('no salary configured', $reason);
    }

    public function test_a_complete_run_with_nobody_unpriced_says_neither_thing(): void
    {
        $run = $this->draftRun();
        $this->processedItemFor($this->absentee, $run);
        $this->processedItemFor($this->colleague, $run);

        $body = $this->completeness($run);

        $this->assertTrue($body['is_complete']);
        $this->assertSame(0, $body['missing_count']);
        $this->assertSame(0, $body['unpriced_count']);
        $this->assertSame([], $body['unpriced_employees']);

        $lock = $this->postJson("/api/payroll/runs/{$run->id}/lock", [], $this->apiHeadersFor($this->admin))
            ->assertOk()
            ->json();
        $this->assertSame('Payroll run locked.', $lock['message']);
    }

    public function test_an_unpriced_person_does_not_keep_process_remaining_alive(): void
    {
        // The operator-visible half of the false partial: a button that keeps
        // offering to fix a gap no re-run can close.
        $this->onPayrollEmployee(null);
        $run = $this->draftRun();
        $this->processedItemFor($this->absentee, $run);
        $this->processedItemFor($this->colleague, $run);

        $this->postJson("/api/payroll/runs/{$run->id}/process-remaining", [], $this->apiHeadersFor($this->admin))
            ->assertOk()
            ->assertJson(['message' => 'All expected employees are already processed.']);
    }

    public function test_the_fresh_org_fallback_stamps_the_flags_it_reports(): void
    {
        // The fallback exists so a fresh org does not read as 100% complete.
        // Its rows carry flags, and they have to be computed rather than fall
        // out of an empty set: "no salary set" and "no payroll record at all"
        // are different problems with different fixes.
        $fresh = Organization::factory()->create();
        $freshAdmin = User::factory()->create(['organization_id' => $fresh->id, 'role' => 'admin']);
        $onPayroll = User::factory()->create(['organization_id' => $fresh->id, 'role' => 'employee']);

        EmployeePayrollTemplate::create([
            'organization_id' => $fresh->id,
            'user_id' => $onPayroll->id,
            'annual_ctc' => null,
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_allowance' => 1600,
            'is_active' => true,
            'tax_regime' => 'new',
        ]);

        $run = PayrollMonthlyRun::create([
            'organization_id' => $fresh->id,
            'month_year' => $this->monthYear,
            'status' => 'draft',
            'created_by' => $freshAdmin->id,
        ]);

        $body = $this->completeness($run, $freshAdmin);

        $this->assertFalse($body['is_complete']);
        $this->assertEqualsCanonicalizing(
            [$freshAdmin->id, $onPayroll->id],
            array_column($body['missing_employees'], 'id')
        );

        $rows = collect($body['missing_employees'])->keyBy('id');
        $this->assertTrue($rows[$onPayroll->id]['needs_ctc']);
        $this->assertTrue($rows[$onPayroll->id]['has_template']);
        $this->assertTrue($rows[$freshAdmin->id]['needs_ctc']);
        $this->assertFalse(
            $rows[$freshAdmin->id]['has_template'],
            'Somebody with no payroll template at all is swept in by the fallback, not on payroll — and the row has to say which.'
        );

        // Only the person actually on payroll is reported as unpriced.
        $this->assertSame([$onPayroll->id], array_column($body['unpriced_employees'], 'id'));
    }

    // ───────────────────────── Defect 3: a fabricated professional-tax state

    public function test_an_unset_pt_state_is_read_back_as_unset(): void
    {
        // This card is read then saved back, so a state invented on the way out
        // is a state stored on the way in: ₹200 a month (₹300 in February)
        // deducted from an employee in a state that levies no professional tax.
        $row = collect(
            $this->getJson(
                "/api/payroll/departments/{$this->departmentId}/employees?month_year={$this->monthYear}",
                $this->apiHeadersFor($this->admin)
            )->assertOk()->json('employees')
        )->firstWhere('id', $this->absentee->id);

        $this->assertNull(
            $row['pt_state'],
            'An unset professional tax state must read back as unset, never as Maharashtra.'
        );
        $this->assertArrayHasKey('pt_state', $row, 'The key stays present so the client can tell unset from absent.');
    }

    public function test_reading_a_card_and_saving_it_back_deducts_no_professional_tax(): void
    {
        // The whole defect in one request pair, priced. The card is read, the
        // operator changes the CTC and saves the card back, and a state nobody
        // chose arrives with it: ₹200 a month of Maharashtra professional tax
        // charged to an employee whose state levies none.
        EmployeePayrollTemplate::where('user_id', $this->absentee->id)
            ->update(['pt_enabled' => true, 'pt_state' => null]);

        $card = collect(
            $this->getJson(
                "/api/payroll/departments/{$this->departmentId}/employees?month_year={$this->monthYear}",
                $this->apiHeadersFor($this->admin)
            )->assertOk()->json('employees')
        )->firstWhere('id', $this->absentee->id);

        $this->putJson(
            "/api/payroll/employees/{$this->absentee->id}/template",
            [
                'annual_ctc' => 720000,
                'basic_percentage' => $card['basic_percentage'],
                'hra_percentage' => $card['hra_percentage'],
                'conveyance_allowance' => $card['conveyance_allowance'],
                'pt_enabled' => $card['pt_enabled'],
                'pt_state' => $card['pt_state'],
                'tax_regime' => $card['tax_regime'],
                'is_metro_city' => $card['is_metro_city'],
            ],
            $this->apiHeadersFor($this->admin)
        )->assertOk();

        $this->processSelected(['working_days' => 26])->assertOk();

        $this->assertSame(
            0.00,
            (float) $this->itemFor($this->absentee)->pt,
            'An unset professional tax state must price at ₹0, not at Maharashtra ₹200.'
        );
        $this->assertNull(EmployeePayrollTemplate::where('user_id', $this->absentee->id)->value('pt_state'));
    }

    public function test_saving_a_card_back_cannot_invent_a_state(): void
    {
        $this->putJson(
            "/api/payroll/employees/{$this->absentee->id}/template",
            ['annual_ctc' => 720000, 'pt_state' => null],
            $this->apiHeadersFor($this->admin)
        )->assertOk();

        $template = EmployeePayrollTemplate::where('user_id', $this->absentee->id)->firstOrFail();
        $this->assertNull($template->pt_state);
        $this->assertSame(720000.0, (float) $template->annual_ctc);
    }

    public function test_clearing_the_state_stores_a_null_not_a_blank(): void
    {
        EmployeePayrollTemplate::where('user_id', $this->absentee->id)->update(['pt_state' => 'maharashtra']);

        $this->putJson(
            "/api/payroll/employees/{$this->absentee->id}/template",
            ['pt_state' => ''],
            $this->apiHeadersFor($this->admin)
        )->assertOk();

        // An invariant, not a regression guard: Laravel's global TrimStrings and
        // ConvertEmptyStringsToNull already deliver a blank selection as null,
        // which is why the controller does not re-normalise it. Pinned anyway,
        // because the way this breaks is somebody adding a `?:` or a column
        // default here later — the same move that made the read fabricate a
        // state in the first place.
        $this->assertNull(EmployeePayrollTemplate::where('user_id', $this->absentee->id)->value('pt_state'));
    }

    public function test_a_state_the_operator_actually_chose_is_kept(): void
    {
        $this->putJson(
            "/api/payroll/employees/{$this->absentee->id}/template",
            ['pt_state' => 'karnataka'],
            $this->apiHeadersFor($this->admin)
        )->assertOk();

        $this->assertSame(
            'karnataka',
            EmployeePayrollTemplate::where('user_id', $this->absentee->id)->value('pt_state'),
            'Refusing to invent a state must not turn into refusing to store one.'
        );
    }
}
