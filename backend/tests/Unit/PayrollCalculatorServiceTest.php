<?php

namespace Tests\Unit;

use App\Services\Payroll\PayrollCalculatorService;
use PHPUnit\Framework\TestCase;

class PayrollCalculatorServiceTest extends TestCase
{
    public function test_calculates_net_salary_using_expected_formula(): void
    {
        $service = new PayrollCalculatorService();

        $net = $service->calculateNetSalary(
            basicSalary: 50000,
            allowances: 5000,
            bonus: 2000,
            deductions: 1500,
            tax: 3500
        );

        $this->assertSame(52000.0, $net);
    }

    public function test_calculates_fixed_monthly_salary_with_lop(): void
    {
        $service = new PayrollCalculatorService();

        $result = $service->calculateSimplePayroll([
            'salary_type' => 'fixed_monthly',
            'monthly_salary' => 30000,
            'working_days' => 30,
        ], [
            'unpaid_leave_days' => 2,
        ]);

        $this->assertSame(28000.0, $result['base_pay']);
        $this->assertSame(2000.0, $result['lop_deduction']);
        $this->assertSame(28000.0, $result['net_pay']);
    }

    public function test_calculates_hourly_salary_from_approved_hours(): void
    {
        $service = new PayrollCalculatorService();

        $result = $service->calculateSimplePayroll([
            'salary_type' => 'hourly',
            'hourly_rate' => 500,
        ], [
            'approved_worked_hours' => 42.5,
        ]);

        $this->assertSame(21250.0, $result['base_pay']);
        $this->assertSame(21250.0, $result['gross_pay']);
        $this->assertSame(21250.0, $result['net_pay']);
    }

    public function test_calculates_hybrid_salary_with_overtime_and_adjustments(): void
    {
        $service = new PayrollCalculatorService();

        $result = $service->calculateSimplePayroll([
            'salary_type' => 'hybrid',
            'monthly_salary' => 60000,
            'working_days' => 30,
            'overtime_hourly_rate' => 400,
        ], [
            'unpaid_leave_days' => 1,
            'overtime_hours' => 5,
            'bonus' => 1500,
            'reimbursement' => 750,
            'manual_deduction' => 1000,
            'other_deduction' => 250,
        ]);

        $this->assertSame(58000.0, $result['base_pay']);
        $this->assertSame(2000.0, $result['lop_deduction']);
        $this->assertSame(2000.0, $result['overtime']);
        $this->assertSame(64250.0, $result['gross_pay']);
        $this->assertSame(3250.0, $result['deductions']);
        $this->assertSame(61000.0, $result['net_pay']);
    }

    public function test_keeps_productivity_bonus_separate_from_base_salary(): void
    {
        $service = new PayrollCalculatorService();

        $result = $service->calculateSimplePayroll([
            'salary_type' => 'fixed_monthly',
            'monthly_salary' => 30000,
            'working_days' => 30,
            'productivity_bonus_enabled' => true,
            'productivity_bonus_rate' => 100,
        ], [
            'approved_productive_hours' => 12,
        ]);

        $this->assertSame(30000.0, $result['base_pay']);
        $this->assertSame(1200.0, $result['productivity_bonus']);
        $this->assertSame(31200.0, $result['gross_pay']);
        $this->assertSame(31200.0, $result['net_pay']);
    }

    public function test_flags_negative_calculated_pay(): void
    {
        $service = new PayrollCalculatorService();

        $result = $service->calculateSimplePayroll([
            'salary_type' => 'fixed_monthly',
            'monthly_salary' => 1000,
            'working_days' => 30,
        ], [
            'manual_deduction' => 2000,
        ]);

        $this->assertSame(-1000.0, $result['net_pay']);
        $this->assertContains('Negative calculated pay', $result['warnings']);
        $this->assertSame('exception', $result['status']);
    }
}
