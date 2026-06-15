<?php

namespace App\Services;

use App\Models\VariablePayRule;
use App\Models\VariablePayAssignment;
use App\Models\PayrollItem;

class VariablePayEngine
{
    public function calculateVariablePay(int $userId, int $orgId, PayrollItem $payrollItem, ?string $monthYear = null): float
    {
        $assignments = VariablePayAssignment::with('rule')
            ->where('user_id', $userId)
            ->where('organization_id', $orgId)
            ->where(function ($q) use ($monthYear) {
                $q->whereNull('month_year')
                    ->orWhere('month_year', $monthYear ?? now()->format('Y-m'));
            })
            ->where('is_active', true)
            ->get();

        $totalVariablePay = 0;

        foreach ($assignments as $assignment) {
            $rule = $assignment->rule;
            if (!$rule || !$rule->is_active) continue;

            $totalVariablePay += $this->applyRule($rule, $assignment, $payrollItem);
        }

        return $totalVariablePay;
    }

    private function applyRule(VariablePayRule $rule, VariablePayAssignment $assignment, PayrollItem $item): float
    {
        $percentage = $assignment->percentage ?? $rule->default_percentage ?? 0;
        $basic = (float) ($item->basic ?? 0);
        $gross = (float) ($item->gross_salary ?? 0);

        return match ($rule->calculation_type) {
            'percentage' => $basic * ($percentage / 100),
            'slab' => $this->calculateSlabPayout($rule, $basic, $gross),
            'fixed' => $assignment->fixed_amount ?? 0,
            default => 0,
        };
    }

    private function calculateSlabPayout(VariablePayRule $rule, float $basic, float $gross): float
    {
        $slabs = $rule->slabs ?? [];
        if (empty($slabs)) return 0;

        $baseValue = ($rule->applicable_on ?? 'basic') === 'gross' ? $gross : $basic;

        foreach ($slabs as $slab) {
            $min = $slab['min'] ?? 0;
            $max = $slab['max'] ?? PHP_FLOAT_MAX;
            if ($baseValue >= $min && $baseValue <= $max) {
                return $slab['amount'] ?? ($baseValue * ($slab['percentage'] ?? 0) / 100);
            }
        }

        return 0;
    }

    public function calculatePerformanceBased(int $userId, int $orgId, PayrollItem $item, float $performanceScore): float
    {
        $assignments = VariablePayAssignment::with('rule')
            ->where('user_id', $userId)
            ->where('organization_id', $orgId)
            ->whereHas('rule', fn($q) => $q->where('is_performance_based', true))
            ->where('is_active', true)
            ->get();

        $total = 0;
        foreach ($assignments as $assignment) {
            $rule = $assignment->rule;
            if (!$rule) continue;

            $maxPct = $rule->max_percentage ?? $rule->default_percentage ?? 0;
            $payoutPct = ($performanceScore / 100) * $maxPct;
            $total += (float) ($item->basic ?? 0) * ($payoutPct / 100);
        }

        return $total;
    }
}
