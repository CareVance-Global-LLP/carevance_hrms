<?php

namespace App\Services;

use App\Models\PerquisiteRecord;
use App\Models\User;
use App\Models\EmployeePayrollTemplate;
use Carbon\Carbon;

class PerquisiteCalculator
{
    public function calculateCarPerquisite(float $engineCapacity, float $employeeContribution = 0): float
    {
        if ($engineCapacity <= 1600) {
            return max(0, 1800 - $employeeContribution);
        }
        return max(0, 2400 - $employeeContribution);
    }

    public function calculateAccommodationPerquisite(float rentPaid, float salary, bool isMetro = true): float
    {
        $percentage = $isMetro ? 0.15 : 0.10;
        return max(0, ($salary * $percentage) - $rentPaid);
    }

    public function calculateEsopPerquisite(float $fmv, float $exercisePrice, int $shares): float
    {
        return ($fmv - $exercisePrice) * $shares;
    }

    public function calculateSweeperGardenerPerquisite(float $monthlyCost): float
    {
        return $monthlyCost;
    }

    public function calculateGasElectricityPerquisite(float $amountPaidByEmployer, float $amountPaidByEmployee): float
    {
        return max(0, $amountPaidByEmployer - $amountPaidByEmployee);
    }

    public function calculateFreeFoodPerquisite(float $monthlyValue, float $exemptLimit = 50): float
    {
        return max(0, $monthlyValue - ($exemptLimit * Carbon::daysInMonth(now()->year, now()->month)));
    }

    public function createPerquisiteRecord(int $userId, int $orgId, string $type, float $monthlyValue, array $details = []): PerquisiteRecord
    {
        $annualValue = $monthlyValue * 12;
        $taxableValue = $annualValue;

        $record = PerquisiteRecord::create([
            'organization_id' => $orgId,
            'user_id' => $userId,
            'type' => $type,
            'description' => $details['description'] ?? '',
            'monthly_value' => $monthlyValue,
            'annual_value' => $annualValue,
            'taxable_value' => $taxableValue,
            'employee_contribution' => $details['employee_contribution'] ?? 0,
            'from_date' => $details['from_date'] ?? null,
            'to_date' => $details['to_date'] ?? null,
            'details' => $details,
            'is_active' => true,
        ]);

        return $record;
    }

    public function getUserPerquisites(int $userId, int $orgId, bool $activeOnly = true): array
    {
        $query = PerquisiteRecord::where('user_id', $userId)
            ->where('organization_id', $orgId);

        if ($activeOnly) {
            $query->where('is_active', true);
        }

        return $query->get()->toArray();
    }

    public function getTotalMonthlyPerquisite(int $userId, int $orgId): float
    {
        return (float) PerquisiteRecord::where('user_id', $userId)
            ->where('organization_id', $orgId)
            ->where('is_active', true)
            ->sum('monthly_value');
    }

    public function getTotalAnnualPerquisite(int $userId, int $orgId): float
    {
        return (float) PerquisiteRecord::where('user_id', $userId)
            ->where('organization_id', $orgId)
            ->where('is_active', true)
            ->sum('annual_value');
    }

    public function calculateAllPerquisites(int $userId, int $orgId): array
    {
        $perquisites = $this->getUserPerquisites($userId, $orgId);
        $total = 0;
        $breakdown = [];

        foreach ($perquisites as $p) {
            $total += $p['monthly_value'];
            $breakdown[] = $p;
        }

        return [
            'total_monthly' => $total,
            'total_annual' => $total * 12,
            'breakdown' => $breakdown,
        ];
    }
}
