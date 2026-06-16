<?php

namespace App\Services;

use App\Models\Payroll;
use App\Models\CostCentre;
use App\Models\Employee;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Cost-Centre Allocation Service
 *
 * Splits each employee's salary across multiple cost centres based on
 * allocation percentages (e.g., 70% to "Engineering", 30% to "Customer
 * Success"). Used for P&L reporting by business unit.
 *
 * Allocation rules can be:
 *  - Static: a fixed % split per employee
 *  - Project-based: time entries dictate the split
 *  - Department-based: full allocation to the employee's department
 */
class CostCentreService
{
    /**
     * Compute the cost-centre breakdown for one payroll.
     */
    public function breakdown(int $payrollId): array
    {
        $payroll = Payroll::with('user')->findOrFail($payrollId);
        $allocations = DB::table('cost_centre_allocations')
            ->where('user_id', $payroll->user_id)
            ->where(function ($q) use ($payroll) {
                $q->whereNull('effective_to')->orWhere('effective_to', '>=', $payroll->payroll_period);
            })->where('effective_from', '<=', $payroll->payroll_period)
            ->get();
        if ($allocations->isEmpty()) {
            // Fallback: 100% to user's primary cost centre
            $user = User::find($payroll->user_id);
            $primary = $user->cost_centre_id ?? DB::table('cost_centres')->where('is_default', true)->value('id');
            $allocations = collect([['cost_centre_id' => $primary, 'allocation_pct' => 100]]);
        }
        $result = [];
        $totalPct = 0;
        foreach ($allocations as $a) {
            $pct = (float) $a->allocation_pct;
            $totalPct += $pct;
            $result[] = [
                'cost_centre_id' => $a->cost_centre_id,
                'cost_centre' => DB::table('cost_centres')->where('id', $a->cost_centre_id)->value('name'),
                'allocation_pct' => $pct,
                'gross' => round((float) $payroll->gross_earnings * $pct / 100, 2),
                'net' => round((float) $payroll->net_pay * $pct / 100, 2),
                'pf_er' => round((float) $payroll->pf_employer * $pct / 100, 2),
                'total_ctc' => round(((float) $payroll->gross_earnings + (float) $payroll->pf_employer) * $pct / 100, 2),
            ];
        }
        return [
            'payroll_id' => $payrollId,
            'user_id' => $payroll->user_id,
            'allocations' => $result,
            'total_pct' => $totalPct,
            'status' => abs($totalPct - 100) < 0.01 ? 'balanced' : 'unbalanced',
        ];
    }

    /**
     * Period-level cost-centre P&L.
     */
    public function periodReport(int $organizationId, string $from, string $to): array
    {
        $payrolls = Payroll::where('organization_id', $organizationId)
            ->whereBetween('payroll_period', [$from, $to])
            ->get();
        $byCostCentre = [];
        foreach ($payrolls as $p) {
            $breakdown = $this->breakdown($p->id)['allocations'];
            foreach ($breakdown as $a) {
                $key = $a['cost_centre_id'] ?? 'unallocated';
                $byCostCentre[$key] = $byCostCentre[$key] ?? [
                    'cost_centre_id' => $key,
                    'name' => $a['cost_centre'] ?? 'Unallocated',
                    'total_gross' => 0,
                    'total_net' => 0,
                    'total_ctc' => 0,
                    'headcount' => 0,
                ];
                $byCostCentre[$key]['total_gross'] += $a['gross'];
                $byCostCentre[$key]['total_net'] += $a['net'];
                $byCostCentre[$key]['total_ctc'] += $a['total_ctc'];
            }
        }
        return array_values($byCostCentre);
    }

    public function setAllocation(int $userId, array $allocations): void
    {
        DB::table('cost_centre_allocations')->where('user_id', $userId)->delete();
        foreach ($allocations as $a) {
            DB::table('cost_centre_allocations')->insert([
                'user_id' => $userId,
                'cost_centre_id' => $a['cost_centre_id'],
                'allocation_pct' => $a['allocation_pct'],
                'effective_from' => $a['effective_from'] ?? now(),
                'effective_to' => $a['effective_to'] ?? null,
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }
}
