<?php

namespace Database\Seeders;

use App\Models\EmployeeBankAccount;
use App\Models\EmployeePayrollTemplate;
use App\Models\EmployeeProfile;
use App\Models\EmployeeWorkInfo;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class PayslipTestDataSeeder extends Seeder
{
    public function run(): void
    {
        $org = Organization::where('slug', 'carevance-test-irbaz')->first();

        if (!$org) {
            $this->command->error('Organization "carevance-test-irbaz" not found. Run CreateIrbazTestUsersSeeder first.');
            return;
        }

        // Update organization with address
        $org->update([
            'address_line' => '123 Business Park, Andheri East',
            'city' => 'Mumbai',
            'state' => 'Maharashtra',
            'postal_code' => '400069',
            'country' => 'India',
        ]);
        $this->command->info('Updated organization address: ' . $org->name);

        $admin = User::where('email', 'irbaz@test.com')->first();
        if (!$admin) {
            $this->command->error('Admin user irbaz@test.com not found.');
            return;
        }
        // Ensure admin belongs to the correct org
        if ($admin->organization_id != $org->id) {
            $admin->update(['organization_id' => $org->id]);
            $this->command->info('  - Moved admin to org: ' . $org->name);
        }

        $adi = User::where('email', 'adi@test.com')->first();
        if (!$adi) {
            $this->command->error('User adi@test.com not found.');
            return;
        }
        // Ensure adi belongs to the correct org
        if ($adi->organization_id != $org->id) {
            $adi->update(['organization_id' => $org->id]);
            $this->command->info('  - Moved adi to org: ' . $org->name);
        }

        $this->command->info('Setting up payroll for: ' . $adi->name . ' (ID: ' . $adi->id . ')');

        $dmGroupId = DB::table('groups')
            ->where('organization_id', $org->id)
            ->where('name', 'Digital Marketing')
            ->value('id');

        // --- Employee Work Info ---
        EmployeeWorkInfo::updateOrCreate(
            ['user_id' => $adi->id],
            [
                'organization_id' => $org->id,
                'employee_code' => 'EMP0004',
                'designation' => 'Digital Marketing Manager',
                'joining_date' => '2023-06-15',
                'report_group_id' => $dmGroupId,
            ]
        );
        $this->command->info('  - Employee Work Info created');

        // --- Employee Profile ---
        EmployeeProfile::updateOrCreate(
            ['user_id' => $adi->id],
            [
                'organization_id' => $org->id,
                'pan_number' => 'ABCDE1004F',
                'uan_number' => '100000000003',
                'esi_ip_number' => '12345678901234567',
                'tax_regime' => 'new',
                'is_metro_city' => true,
                'pt_state' => 'maharashtra',
            ]
        );
        $this->command->info('  - Employee Profile created');

        // --- Bank Account ---
        EmployeeBankAccount::updateOrCreate(
            ['user_id' => $adi->id, 'is_default' => true],
            [
                'organization_id' => $org->id,
                'bank_name' => 'HDFC Bank',
                'account_number' => '50100012345678',
                'ifsc_swift' => 'HDFC0001234',
                'account_type' => 'savings',
                'branch' => 'Andheri East',
            ]
        );
        $this->command->info('  - Bank Account created');

        // --- Payroll Template (CTC ₹8,00,000/year) ---
        EmployeePayrollTemplate::updateOrCreate(
            ['user_id' => $adi->id],
            [
                'organization_id' => $org->id,
                'annual_ctc' => 800000,
                'basic_percentage' => 40,
                'hra_percentage' => 50,
                'conveyance_allowance' => 1600,
                'medical_allowance' => 0,
                'da_percentage' => 0,
                'cca_amount' => 0,
                'pf_enabled' => true,
                'esi_enabled' => true,
                'pt_enabled' => true,
                'tds_enabled' => true,
                'lwf_enabled' => false,
                'nps_enabled' => false,
                'vpf_enabled' => false,
                'pf_employee_percentage' => 12,
                'pf_employer_percentage' => 12,
                'pf_wage_cap' => 15000,
                'esi_employee_percentage' => 0.75,
                'esi_employer_percentage' => 3.25,
                'esi_threshold' => 21000,
                'is_active' => true,
            ]
        );
        $this->command->info('  - Payroll Template created (CTC: ₹8,00,000)');

        // --- Payroll Monthly Run for May 2026 ---
        $run = PayrollMonthlyRun::updateOrCreate(
            [
                'organization_id' => $org->id,
                'month_year' => '2026-05',
            ],
            [
                'status' => 'released',
                'pay_date' => '2026-05-30',
                'total_employees' => 1,
                'total_gross' => 52267,
                'total_deductions' => 5450,
                'total_net_pay' => 46817,
                'total_pf_employee' => 5250,
                'total_pf_employer' => 5250,
                'total_esi_employee' => 0,
                'total_esi_employer' => 0,
                'total_pt' => 200,
                'total_tds' => 0,
                'total_employer_contributions' => 6533,
                'created_by' => $admin->id,
                'approved_by' => $admin->id,
                'approved_at' => now(),
            ]
        );
        $this->command->info('  - Payroll Run created: May 2026 (status: released)');

        // --- Payroll Item for Adi ---
        // CTC: ₹8,00,000/yr = ₹66,667/mo
        // Employer PF: min(26667, 15000) * 12% = ₹1,800
        // Gratuity: 26667 * 4.81% = ₹1,283
        // Gross = 66667 - 1800 - 1283 = ₹63,584
        // But we use simpler: gross = basic + hra + conveyance + special = 52,267

        PayrollItem::updateOrCreate(
            [
                'payroll_run_id' => $run->id,
                'user_id' => $adi->id,
            ],
            [
                'month_year' => '2026-05',
                'organization_id' => $org->id,
                'department_id' => DB::table('groups')
                    ->where('organization_id', $org->id)
                    ->where('name', 'Digital Marketing')
                    ->value('id'),

                // Attendance
                'total_working_days' => 31,
                'days_present' => 31,
                'days_absent' => 0,
                'days_leave' => 0,
                'lOP_days' => 0,
                'total_worked_seconds' => 0,
                'total_productive_seconds' => 0,
                'total_idle_seconds' => 0,
                'total_unproductive_seconds' => 0,
                'activity_percentage' => 0,
                'productivity_score' => 0,
                'overtime_seconds' => 0,

                // Earnings
                'basic' => 26667,
                'hra' => 13333,
                'conveyance' => 1600,
                'medical' => 0,
                'special_allowance' => 0,
                'da' => 0,
                'cca' => 0,
                'education' => 4000,
                'hostel' => 0,
                'internet' => 0,
                'meal' => 0,
                'transport' => 0,
                'uniform' => 0,
                'books_periodicals_amount' => 0,
                'fuel_maintenance' => 0,
                'variable_pay' => 0,
                'performance_bonus' => 0,
                'retention_bonus' => 0,
                'arrears' => 0,
                'arrears_pf' => 0,
                'leave_encashment' => 0,
                'encashed_leave_days' => 0,
                'notice_pay_recovery' => 0,
                'notice_pay_addition' => 0,
                'custom_earnings' => 6667,
                'overtime_pay' => 0,
                'shift_differential' => 0,
                'gross_salary' => 52267,

                // Employee Deductions
                'pf_employee' => 5250,
                'esi_employee' => 0,
                'pt' => 200,
                'tds' => 0,
                'nps_employee' => 0,
                'vpf_employee' => 0,
                'lwf' => 0,
                'medical_insurance' => 0,
                'life_insurance' => 0,
                'lOP_deduction' => 0,
                'custom_deductions' => 0,
                'total_deductions' => 5450,

                // Employer Contributions
                'pf_employer' => 5250,
                'eps' => 3749,
                'epf' => 1501,
                'esi_employer' => 0,
                'gratuity' => 1283,
                'nps_employer' => 0,
                'superannuation' => 0,
                'medical_insurance_employer' => 0,
                'total_employer_contributions' => 6533,

                // Net Pay
                'net_pay' => 46817,

                // Payment
                'payment_status' => 'paid',
                'paid_at' => '2026-05-30',
                'payment_method' => 'bank_transfer',
            ]
        );
        $this->command->info('  - Payroll Item created for May 2026');

        // --- Also create April 2026 for YTD ---
        $runApril = PayrollMonthlyRun::updateOrCreate(
            [
                'organization_id' => $org->id,
                'month_year' => '2026-04',
            ],
            [
                'status' => 'paid',
                'pay_date' => '2026-04-30',
                'total_employees' => 1,
                'total_gross' => 52267,
                'total_deductions' => 5450,
                'total_net_pay' => 46817,
                'total_pf_employee' => 5250,
                'total_pf_employer' => 5250,
                'total_esi_employee' => 0,
                'total_esi_employer' => 0,
                'total_pt' => 200,
                'total_tds' => 0,
                'total_employer_contributions' => 6533,
                'created_by' => $admin->id,
                'approved_by' => $admin->id,
                'approved_at' => now(),
            ]
        );

        PayrollItem::updateOrCreate(
            [
                'payroll_run_id' => $runApril->id,
                'user_id' => $adi->id,
            ],
            [
                'month_year' => '2026-04',
                'organization_id' => $org->id,
                'department_id' => DB::table('groups')
                    ->where('organization_id', $org->id)
                    ->where('name', 'Digital Marketing')
                    ->value('id'),
                'total_working_days' => 30,
                'days_present' => 30,
                'days_absent' => 0,
                'days_leave' => 0,
                'lOP_days' => 0,
                'total_worked_seconds' => 0,
                'total_productive_seconds' => 0,
                'total_idle_seconds' => 0,
                'total_unproductive_seconds' => 0,
                'activity_percentage' => 0,
                'productivity_score' => 0,
                'overtime_seconds' => 0,
                'basic' => 26667,
                'hra' => 13333,
                'conveyance' => 1600,
                'medical' => 0,
                'special_allowance' => 0,
                'da' => 0,
                'cca' => 0,
                'education' => 4000,
                'hostel' => 0,
                'internet' => 0,
                'meal' => 0,
                'transport' => 0,
                'uniform' => 0,
                'books_periodicals_amount' => 0,
                'fuel_maintenance' => 0,
                'variable_pay' => 0,
                'performance_bonus' => 0,
                'retention_bonus' => 0,
                'arrears' => 0,
                'arrears_pf' => 0,
                'leave_encashment' => 0,
                'encashed_leave_days' => 0,
                'notice_pay_recovery' => 0,
                'notice_pay_addition' => 0,
                'custom_earnings' => 6667,
                'overtime_pay' => 0,
                'shift_differential' => 0,
                'gross_salary' => 52267,
                'pf_employee' => 5250,
                'esi_employee' => 0,
                'pt' => 200,
                'tds' => 0,
                'nps_employee' => 0,
                'vpf_employee' => 0,
                'lwf' => 0,
                'medical_insurance' => 0,
                'life_insurance' => 0,
                'lOP_deduction' => 0,
                'custom_deductions' => 0,
                'total_deductions' => 5450,
                'pf_employer' => 5250,
                'eps' => 3749,
                'epf' => 1501,
                'esi_employer' => 0,
                'gratuity' => 1283,
                'nps_employer' => 0,
                'superannuation' => 0,
                'medical_insurance_employer' => 0,
                'total_employer_contributions' => 6533,
                'net_pay' => 46817,
                'payment_status' => 'paid',
                'paid_at' => '2026-04-30',
                'payment_method' => 'bank_transfer',
            ]
        );
        $this->command->info('  - Payroll Item created for April 2026 (YTD)');

        $this->command->info('');
        $this->command->info('========================================');
        $this->command->info('Payroll Test Data Created Successfully!');
        $this->command->info('========================================');
        $this->command->info('Employee: Adi (' . $adi->email . ')');
        $this->command->info('Pay Period: May 2026');
        $this->command->info('Gross: ₹52,267.00');
        $this->command->info('Deductions: ₹5,450.00');
        $this->command->info('Net Pay: ₹46,817.00');
        $this->command->info('');
        $this->command->info('Download PDF:');
        $this->command->info('  GET /api/payroll/payslip/' . $adi->id . '/2026-05/download');
        $this->command->info('========================================');
    }
}
