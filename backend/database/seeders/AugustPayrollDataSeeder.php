<?php

namespace Database\Seeders;

use App\Models\AttendanceRecord;
use App\Models\EmployeeBankAccount;
use App\Models\EmployeeLoan;
use App\Models\Organization;
use App\Models\User;
use App\Support\MonthYear;
use Carbon\CarbonPeriod;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Fills a real month of payroll inputs for an EXISTING organisation.
 *
 * Unlike a demo seeder this adds to people who already exist — it creates no
 * users and deletes none. What it does replace is the target month's attendance
 * for that organisation, because the point is to give each employee a
 * deliberately different shape: sparse, half-filled attendance makes a payroll
 * run impossible to reason about.
 *
 * Existing approved leave is LEFT ALONE and allowed to interact. That is what
 * makes the result a real test rather than a tidy fixture — paid leave has to
 * come out of the attendance summary as payable, and unpaid leave as loss of
 * pay, alongside whatever absences this seeder creates.
 *
 *   php artisan db:seed --class=AugustPayrollDataSeeder
 */
class AugustPayrollDataSeeder extends Seeder
{
    private const ORG_SLUG = 'carevance-test';
    private const MONTH = '2026-08';

    /**
     * How many of the month's working days each person is present for, keyed by
     * position in the CTC-ordered list. Deliberately uneven: a run where
     * everybody is present all month proves nothing.
     *
     * `null` means "present every working day".
     */
    private const SHAPES = [
        0 => [null, 'full month, no absences'],
        1 => [-2,   '2 days absent'],
        2 => [-5,   '5 days absent'],
        3 => [null, 'full month (has approved leave on top)'],
        4 => [-1,   '1 day absent'],
        5 => [-4,   '4 days absent'],
        6 => [null, 'full month, high earner'],
        7 => [-3,   '3 days absent'],
        8 => [-7,   '7 days absent'],
        9 => [-2,   '2 days absent'],
        10 => [null, 'full month'],
        11 => [-6,  '6 days absent'],
    ];

    public function run(): void
    {
        $org = Organization::withoutGlobalScopes()->where('slug', self::ORG_SLUG)->first();

        if (! $org) {
            $this->command->error('Organisation "'.self::ORG_SLUG.'" not found.');

            return;
        }

        $this->command->info("Seeding payroll inputs for {$org->name} — ".self::MONTH);

        $employees = $this->payableEmployees((int) $org->id);

        if ($employees->isEmpty()) {
            $this->command->error('No employees with an annual CTC. Nothing to seed.');

            return;
        }

        $this->fillMissingPayrollSetup($org, $employees);
        $this->seedAttendance($org, $employees);
        $this->seedLoans($org, $employees);
        $this->seedReimbursements($org, $employees);

        $this->report($employees);
    }

    /** Everyone the run will actually price, in a stable order. */
    private function payableEmployees(int $orgId)
    {
        $ids = DB::table('employee_payroll_templates')
            ->where('organization_id', $orgId)
            ->where('annual_ctc', '>', 0)
            ->orderBy('user_id')
            ->pluck('user_id');

        return User::withoutGlobalScopes()->whereIn('id', $ids)->orderBy('id')->get();
    }

    /**
     * A run cannot price somebody with no professional-tax state, and cannot pay
     * somebody with no bank account. Everybody gets both.
     *
     * An earlier version left one person without an account on purpose, to
     * exercise the bank-file exclusion path. That is a useful test and a
     * confusing default — a seeded month should be payable end to end unless
     * somebody deliberately breaks it.
     */
    private function fillMissingPayrollSetup(Organization $org, $employees): void
    {
        foreach ($employees as $user) {
            DB::table('employee_payroll_templates')
                ->where('user_id', $user->id)
                ->whereNull('pt_state')
                ->update(['pt_state' => 'maharashtra']);

            $exists = EmployeeBankAccount::withoutGlobalScopes()
                ->where('user_id', $user->id)->exists();

            if (! $exists) {
                EmployeeBankAccount::create([
                    'organization_id' => $org->id,
                    'user_id' => $user->id,
                    'account_holder_name' => $user->name,
                    'bank_name' => 'HDFC Bank',
                    'account_number' => '5010'.str_pad((string) $user->id, 8, '0', STR_PAD_LEFT),
                    'ifsc_swift' => 'HDFC0001234',
                    'branch' => 'Main',
                    'account_type' => 'savings',
                    'is_default' => true,
                ]);
            }
        }
    }

    /** Every non-weekend day of the month. */
    private function workingDates(): array
    {
        $dates = [];

        foreach (CarbonPeriod::create(MonthYear::start(self::MONTH), MonthYear::end(self::MONTH)) as $date) {
            if (! $date->isWeekend()) {
                $dates[] = $date->copy();
            }
        }

        return $dates;
    }

    private function seedAttendance(Organization $org, $employees): void
    {
        $dates = $this->workingDates();

        // Only this organisation, only this month. Everything outside the target
        // month is somebody's real record and is not touched.
        AttendanceRecord::withoutGlobalScopes()
            ->where('organization_id', $org->id)
            ->whereBetween('attendance_date', [
                MonthYear::start(self::MONTH)->toDateString(),
                MonthYear::end(self::MONTH)->toDateString(),
            ])
            ->delete();

        foreach ($employees->values() as $i => $user) {
            [$offset] = self::SHAPES[$i] ?? [null, ''];

            // Absences are taken from the START of the month, so they never
            // collide with a mid-month leave request in a way that hides one.
            $present = $offset === null ? $dates : array_slice($dates, abs($offset));

            foreach ($present as $date) {
                AttendanceRecord::create([
                    'organization_id' => $org->id,
                    'user_id' => $user->id,
                    'attendance_date' => $date->toDateString(),
                    'status' => 'present',
                    'check_in_at' => $date->copy()->setTime(9, 32),
                    'check_out_at' => $date->copy()->setTime(18, 34),
                    'worked_seconds' => 9 * 3600,
                    'late_minutes' => 2,
                ]);
            }
        }
    }

    /**
     * Loans and advances, including one person carrying BOTH — the case that
     * proves every active commitment is recovered, not just the first found.
     */
    private function seedLoans(Organization $org, $employees): void
    {
        $list = $employees->values();

        $plan = [
            // index => [type, amount, emi, instalments, already paid]
            1 => ['loan', 120000, 10000, 12, 5],
            4 => ['advance', 30000, 7500, 4, 1],
            6 => ['loan', 240000, 20000, 12, 2],
            7 => ['loan', 60000, 5000, 12, 11],   // final instalment: must close
        ];

        foreach ($plan as $i => [$type, $amount, $emi, $total, $paid]) {
            $user = $list->get($i);
            if (! $user) {
                continue;
            }

            $this->giveLoan($org, $user, $type, $amount, $emi, $total, $paid);
        }

        // The multi-commitment case: index 1 already has a loan above.
        if ($user = $list->get(1)) {
            $this->giveLoan($org, $user, 'advance', 24000, 6000, 4, 0);
        }
    }

    private function giveLoan(Organization $org, User $user, string $type, float $amount, float $emi, int $total, int $paid): void
    {
        $already = EmployeeLoan::withoutGlobalScopes()
            ->where('user_id', $user->id)
            ->where('loan_type', $type)
            ->where('status', 'approved')
            ->where('remaining_amount', '>', 0)
            ->exists();

        if ($already) {
            return;
        }

        EmployeeLoan::create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'loan_type' => $type,
            'amount' => $amount,
            'emi_amount' => $emi,
            'total_installments' => $total,
            'paid_installments' => $paid,
            'remaining_amount' => $amount - ($emi * $paid),
            'purpose' => ucfirst($type).' — seeded for the August run',
            'status' => 'approved',
            'approved_at' => now(),
            'disbursed_at' => now(),
        ]);
    }

    /** A few claims in the target month, at different points of the chain. */
    private function seedReimbursements(Organization $org, $employees): void
    {
        if (! \Illuminate\Support\Facades\Schema::hasTable('reimbursements')) {
            return;
        }

        $columns = \Illuminate\Support\Facades\Schema::getColumnListing('reimbursements');
        $list = $employees->values();

        $claims = [
            [0, 2400.00, 'approved', 'Client travel — taxi'],
            [2, 1250.50, 'pending', 'Team lunch'],
            [3, 8600.00, 'approved', 'Laptop accessories'],
            [6, 15000.00, 'pending', 'Conference ticket'],
        ];

        foreach ($claims as [$i, $amount, $status, $description]) {
            $user = $list->get($i);
            if (! $user) {
                continue;
            }

            $row = [
                'organization_id' => $org->id,
                'user_id' => $user->id,
                'amount' => $amount,
                'status' => $status,
                'created_at' => now(),
                'updated_at' => now(),
            ];

            // The table has drifted before, so only write columns that exist.
            foreach ([
                'description' => $description,
                'title' => $description,
                'category' => 'travel',
                'expense_date' => MonthYear::start(self::MONTH)->addDays(9)->toDateString(),
            ] as $col => $value) {
                if (in_array($col, $columns, true)) {
                    $row[$col] = $value;
                }
            }

            DB::table('reimbursements')->insert($row);
        }
    }

    private function report($employees): void
    {
        $service = app(\App\Services\Attendance\AttendanceService::class);
        $rows = [];

        foreach ($employees->values() as $i => $user) {
            $s = $service->monthlyAttendanceSummary($user->fresh(), self::MONTH);
            [, $note] = self::SHAPES[$i] ?? [null, ''];

            $loans = EmployeeLoan::withoutGlobalScopes()
                ->where('user_id', $user->id)->where('status', 'approved')
                ->where('remaining_amount', '>', 0)->count();

            $rows[] = [
                $user->id,
                substr((string) $user->name, 0, 20),
                (string) $s['working_days'],
                (string) $s['present_days'],
                (string) $s['paid_leave_days'],
                (string) $s['total_lop_days'],
                $loans ?: '-',
                $note,
            ];
        }

        $this->command->newLine();
        $this->command->table(
            ['id', 'name', 'wdays', 'present', 'paid lv', 'LOP', 'loans', 'shape'],
            $rows
        );
    }
}
