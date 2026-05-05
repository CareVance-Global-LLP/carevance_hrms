<?php

namespace Tests\Unit;

use App\Models\Payroll;
use App\Services\Payroll\MockPayrollPayoutService;
use PHPUnit\Framework\TestCase;

class MockPayrollPayoutServiceTest extends TestCase
{
    public function test_mock_payout_can_simulate_success_failed_and_pending(): void
    {
        $service = new MockPayrollPayoutService();
        $payroll = new Payroll(['id' => 1001, 'net_salary' => 12000]);

        $success = $service->payout($payroll, 'success');
        $failed = $service->payout($payroll, 'failed');
        $pending = $service->payout($payroll, 'pending');

        $this->assertSame('mock', $success['provider']);
        $this->assertSame('success', $success['status']);
        $this->assertSame('failed', $failed['status']);
        $this->assertSame('pending', $pending['status']);
        $this->assertNotEmpty($success['transaction_id']);
    }
}

