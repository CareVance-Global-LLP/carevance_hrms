<?php

namespace App\Services;

use App\Models\Garnishment;
use App\Models\Payroll;
use App\Models\Employee;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Garnishment / Court-Order Deduction Service
 *
 * Manages legally-mandated deductions from employee salaries:
 *  - Court-ordered child support
 *  - Bank loan recovery
 *  - Tax recovery notices
 *  - Employee advance recovery
 *
 * Calculates the per-month deduction based on the order, applies it
 * across future payrolls, and tracks the running total.
 */
class GarnishmentService
{
    /**
     * Maximum allowed garnishment under Indian labour law:
     * 50% of disposable salary for ordinary debts; up to 75% for
     * maintenance/alimony.
     */
    const MAX_DEDUCTION_PCT_DEFAULT = 0.50;
    const MAX_DEDUCTION_PCT_MAINTENANCE = 0.75;

    /**
     * Register a new garnishment order against an employee.
     */
    public function register(array $data): Garnishment
    {
        $employee = Employee::findOrFail($data['employee_id']);
        $monthlyGross = (float) $employee->current_ctc / 12;
        $type = $data['type'] ?? 'loan_recovery';
        $cap = $type === 'maintenance' ? self::MAX_DEDUCTION_PCT_MAINTENANCE : self::MAX_DEDUCTION_PCT_DEFAULT;
        $maxAllowed = $monthlyGross * $cap;
        $monthlyAmount = min((float) ($data['monthly_amount'] ?? $maxAllowed), $maxAllowed);

        return Garnishment::create([
            'employee_id' => $employee->id,
            'user_id' => $employee->user_id,
            'type' => $type,
            'order_number' => $data['order_number'] ?? null,
            'issuing_authority' => $data['issuing_authority'] ?? null,
            'start_date' => $data['start_date'] ?? now(),
            'end_date' => $data['end_date'] ?? null,
            'total_amount' => $data['total_amount'] ?? null,
            'monthly_amount' => $monthlyAmount,
            'cumulative_recovered' => 0,
            'status' => 'active',
            'documents' => $data['documents'] ?? null,
        ]);
    }

    /**
     * Apply active garnishments to a payroll.
     * Returns the total deduction amount and a breakdown.
     */
    public function applyToPayroll(Payroll $payroll): array
    {
        $garnishments = Garnishment::where('user_id', $payroll->user_id)
            ->where('status', 'active')
            ->where('start_date', '<=', $payroll->payroll_period)
            ->where(function ($q) use ($payroll) {
                $q->whereNull('end_date')->orWhere('end_date', '>=', $payroll->payroll_period);
            })->get();

        $total = 0;
        $details = [];
        foreach ($garnishments as $g) {
            $amount = $this->calculateMonthlyDeduction($g, (float) $payroll->gross_earnings);
            $g->update(['cumulative_recovered' => $g->cumulative_recovered + $amount]);
            if ($g->total_amount && $g->cumulative_recovered >= $g->total_amount) {
                $g->update(['status' => 'completed']);
            }
            $details[] = ['id' => $g->id, 'type' => $g->type, 'amount' => $amount];
            $total += $amount;
        }
        return ['total' => $total, 'breakdown' => $details];
    }

    public function calculateMonthlyDeduction(Garnishment $g, float $monthlyGross): float
    {
        $cap = $g->type === 'maintenance' ? self::MAX_DEDUCTION_PCT_MAINTENANCE : self::MAX_DEDUCTION_PCT_DEFAULT;
        $maxAllowed = $monthlyGross * $cap;
        if ($g->total_amount && $g->cumulative_recovered < $g->total_amount) {
            $remaining = $g->total_amount - $g->cumulative_recovered;
            return round(min((float) $g->monthly_amount, $remaining, $maxAllowed), 2);
        }
        return round(min((float) $g->monthly_amount, $maxAllowed), 2);
    }

    public function statusFor(int $userId): array
    {
        $garnishments = Garnishment::where('user_id', $userId)->get();
        return $garnishments->map(fn($g) => [
            'id' => $g->id,
            'type' => $g->type,
            'order_number' => $g->order_number,
            'start_date' => $g->start_date,
            'end_date' => $g->end_date,
            'total_amount' => (float) $g->total_amount,
            'monthly_amount' => (float) $g->monthly_amount,
            'recovered' => (float) $g->cumulative_recovered,
            'remaining' => $g->total_amount ? round((float) $g->total_amount - (float) $g->cumulative_recovered, 2) : null,
            'status' => $g->status,
        ])->toArray();
    }
}
