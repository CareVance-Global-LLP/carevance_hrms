<?php

namespace Database\Seeders;

use App\Models\PayrollChecklistItem;
use App\Models\FbpComponent;
use Illuminate\Database\Seeder;

class PayrollComplianceSeeder extends Seeder
{
    public function run(): void
    {
        // Seed default checklist items for payroll validation
        $defaultChecks = [
            ['check_code' => 'missing_bank', 'category' => 'bank_details', 'severity' => 'error',
             'label' => 'Missing Bank Accounts', 'description' => 'Employee has no bank account configured for salary transfer',
             'sort_order' => 1, 'is_auto_resolvable' => false],
            ['check_code' => 'missing_pan', 'category' => 'employee_data', 'severity' => 'error',
             'label' => 'Missing PAN Cards', 'description' => 'Employee PAN is required for tax compliance',
             'sort_order' => 2, 'is_auto_resolvable' => false],
            ['check_code' => 'missing_uan', 'category' => 'employee_data', 'severity' => 'warning',
             'label' => 'Missing UAN', 'description' => 'Employee UAN is required for PF compliance',
             'sort_order' => 3, 'is_auto_resolvable' => false],
            ['check_code' => 'missing_template', 'category' => 'employee_data', 'severity' => 'error',
             'label' => 'Missing Payroll Templates', 'description' => 'Employee has no salary template assigned',
             'sort_order' => 4, 'is_auto_resolvable' => false],
            ['check_code' => 'missing_attendance', 'category' => 'attendance', 'severity' => 'warning',
             'label' => 'Missing Attendance Data', 'description' => 'Employee has no attendance records for this period',
             'sort_order' => 5, 'is_auto_resolvable' => true],
            ['check_code' => 'missing_declarations', 'category' => 'declarations', 'severity' => 'warning',
             'label' => 'Missing Tax Declarations', 'description' => 'Employee has not submitted tax declarations',
             'sort_order' => 6, 'is_auto_resolvable' => false],
            ['check_code' => 'zero_net_pay', 'category' => 'compliance', 'severity' => 'warning',
             'label' => 'Zero Net Pay', 'description' => 'Employee net pay is zero or negative',
             'sort_order' => 7, 'is_auto_resolvable' => false],
            ['check_code' => 'esi_eligibility', 'category' => 'compliance', 'severity' => 'error',
             'label' => 'ESI Eligibility Check', 'description' => 'Gross exceeds ESI threshold but ESI is applied',
             'sort_order' => 8, 'is_auto_resolvable' => false],
            ['check_code' => 'pf_wage_cap', 'category' => 'compliance', 'severity' => 'warning',
             'label' => 'PF Wage Cap Verification', 'description' => 'PF wages exceed statutory cap',
             'sort_order' => 9, 'is_auto_resolvable' => false],
        ];

        foreach ($defaultChecks as $check) {
            PayrollChecklistItem::firstOrCreate(
                ['check_code' => $check['check_code']],
                $check
            );
        }

        // Seed default FBP components
        $defaultFbpComponents = [
            ['code' => 'medical_reimbursement', 'name' => 'Medical Reimbursement', 'category' => 'medical',
             'max_exempt_limit' => 15000, 'requires_proof' => true, 'is_taxable' => false],
            ['code' => 'fuel_maintenance', 'name' => 'Fuel & Maintenance', 'category' => 'fuel',
             'max_exempt_limit' => null, 'requires_proof' => true, 'is_taxable' => false],
            ['code' => 'telephone_bill', 'name' => 'Telephone / Mobile Bill', 'category' => 'phone',
             'max_exempt_limit' => null, 'requires_proof' => true, 'is_taxable' => false],
            ['code' => 'internet_bill', 'name' => 'Internet Bill', 'category' => 'internet',
             'max_exempt_limit' => null, 'requires_proof' => true, 'is_taxable' => false],
            ['code' => 'food_coupons', 'name' => 'Food Coupons / Meal Card', 'category' => 'food',
             'max_exempt_limit' => 26400, 'requires_proof' => false, 'is_taxable' => true],
            ['code' => 'gift_vouchers', 'name' => 'Gift Vouchers', 'category' => 'gift',
             'max_exempt_limit' => 5000, 'requires_proof' => false, 'is_taxable' => true],
            ['code' => 'books_periodicals', 'name' => 'Books & Periodicals', 'category' => 'books',
             'max_exempt_limit' => null, 'requires_proof' => true, 'is_taxable' => false],
            ['code' => 'telecom_equipment', 'name' => 'Telecom Equipment', 'category' => 'telecom',
             'max_exempt_limit' => null, 'requires_proof' => true, 'is_taxable' => false],
        ];

        foreach ($defaultFbpComponents as $comp) {
            FbpComponent::firstOrCreate(
                ['code' => $comp['code']],
                $comp
            );
        }
    }
}
