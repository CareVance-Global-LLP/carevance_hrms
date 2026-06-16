<?php

namespace App\Services;

use App\Models\OffCyclePayroll;
use App\Models\Payroll;
use App\Models\Employee;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Off-Cycle Payroll Service (Bonus, Incentive, Lumpsum, FNF settlements)
 *
 * Handles payouts outside the normal monthly payroll cycle.
 * Common use cases: joining bonus, performance bonus, referral bonus,
 * incentive payout, ex-gratia, full-and-final settlement.
 *
 * Integrates with the regular tax/TDS calculation to withhold
 * the right amount of tax on the additional payment.
 */
class OffCyclePayrollService
{
    public function create(array $data): OffCyclePayroll
    {
        return DB::transaction(function () use ($data) {
            $batch = OffCyclePayroll::create([
                'organization_id' => $data['organization_id'],
                'payroll_period' => $data['pay_date'] ?? now(),
                'type' => $data['type'] ?? 'bonus',
                'description' => $data['description'] ?? null,
                'status' => 'draft',
                'created_by' => $data['created_by'] ?? null,
            ]);
            foreach ($data['items'] as $item) {
                $employee = Employee::with('user')->findOrFail($item['employee_id']);
                $tds = $this->computeTds($employee, (float) $item['gross_amount']);
                $batch->items()->create([
                    'employee_id' => $item['employee_id'],
                    'user_id' => $employee->user_id,
                    'gross_amount' => (float) $item['gross_amount'],
                    'tds' => $tds,
                    'net_amount' => (float) $item['gross_amount'] - $tds,
                    'metadata' => $item['metadata'] ?? null,
                ]);
            }
            return $batch;
        });
    }

    public function approve(int $batchId, int $userId): OffCyclePayroll
    {
        $batch = OffCyclePayroll::findOrFail($batchId);
        $batch->update(['status' => 'approved', 'approved_by' => $userId, 'approved_at' => now()]);
        return $batch;
    }

    public function disburse(int $batchId): array
    {
        $batch = OffCyclePayroll::findOrFail($batchId);
        if ($batch->status !== 'approved') return ['status' => 'not_approved'];
        $batch->update(['status' => 'disbursed', 'disbursed_at' => now()]);
        return ['status' => 'disbursed', 'total' => (float) $batch->items()->sum('net_amount')];
    }

    protected function computeTds(Employee $employee, float $amount): float
    {
        // Off-cycle payments are taxed at marginal rate (existing income + this amount)
        $annualIncome = (float) ($employee->current_ctc ?? 0);
        $calc = app(PayrollCalculatorService::class);
        $existingTax = $calc->calculateMonthlyTDS($annualIncome, 'new', [])['annual_tax']['total_tax'];
        $combinedTax = $calc->calculateMonthlyTDS($annualIncome + $amount, 'new', [])['annual_tax']['total_tax'];
        return round(max(0, $combinedTax - $existingTax) * (12 - Carbon::now()->month + 1) / 12, 2);
    }
}
