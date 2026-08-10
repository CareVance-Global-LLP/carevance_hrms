<?php

namespace App\Services;

use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\EmployeePayrollTemplate;
use App\Models\ArrearPayment;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

class ArrearCalculatorService
{
    protected PayrollCalculatorService $calculator;

    public function __construct(PayrollCalculatorService $calculator)
    {
        $this->calculator = $calculator;
    }

    public function detectCtcChanges(int $userId, int $orgId, string $currentMonthYear): array
    {
        $currentTemplate = EmployeePayrollTemplate::where('user_id', $userId)
            ->where('organization_id', $orgId)
            ->first();

        if (!$currentTemplate) return [];

        $arrears = [];
        $currentCtc = (float) $currentTemplate->annual_ctc;
        $currentMonth = Carbon::createFromFormat('Y-m', $currentMonthYear);

        for ($i = 1; $i <= 6; $i++) {
            $pastMonth = $currentMonth->copy()->subMonths($i);
            $pastMonthYear = $pastMonth->format('Y-m');

            $pastRun = PayrollMonthlyRun::where('organization_id', $orgId)
                ->where('month_year', $pastMonthYear)
                ->whereIn('status', ['locked', 'approved', 'released', 'paid'])
                ->first();

            if (!$pastRun) continue;

            $pastItem = PayrollItem::where('payroll_run_id', $pastRun->id)
                ->where('user_id', $userId)
                ->first();

            if (!$pastItem) continue;

            $pastTemplateSnapshot = $pastItem->template_snapshot;
            $pastCtc = $pastTemplateSnapshot['annual_ctc'] ?? 0;

            if (abs((float) $pastCtc - $currentCtc) > 0.01) {
                $difference = $currentCtc - (float) $pastCtc;
                $monthlyDifference = $difference / 12;

                $calculation = $this->calculator->calculatePayroll(
                    annualCtc: $currentCtc,
                    state: $currentTemplate->pt_state ?: '',
                    isMetro: $currentTemplate->is_metro_city ?? true,
                    taxRegime: $currentTemplate->tax_regime ?? 'new',
                    config: [
                        'basic_percentage' => $currentTemplate->basic_percentage ?? 40,
                        'hra_percentage' => $currentTemplate->hra_percentage ?? 50,
                        'pf_enabled' => $currentTemplate->pf_enabled,
                        'esi_enabled' => $currentTemplate->esi_enabled,
                    ],
                );

                $arrears[] = [
                    'month_year' => $pastMonthYear,
                    'old_ctc' => (float) $pastCtc,
                    'new_ctc' => $currentCtc,
                    'monthly_difference' => $monthlyDifference,
                    'old_gross' => (float) ($pastItem->gross_salary ?? 0),
                    'new_gross' => $calculation['monthly']['total_earnings'] ?? $monthlyDifference,
                    'arrear_amount' => $monthlyDifference,
                    'type' => 'ctc_change',
                ];
            }
        }

        return $arrears;
    }

    public function calculateArrear(int $userId, int $orgId, string $monthYear, float $amount, string $reason, array $breakdown = []): ArrearPayment
    {
        return ArrearPayment::create([
            'organization_id' => $orgId,
            'user_id' => $userId,
            'month_year' => $monthYear,
            'amount' => $amount,
            'reason' => $reason,
            'breakdown' => $breakdown,
            'status' => 'pending',
        ]);
    }

    public function calculateStatutoryArrears(float $basicArrear, bool $pfApplicable, bool $esiApplicable): array
    {
        $result = ['basic' => $basicArrear];

        if ($pfApplicable) {
            $pfWages = min($basicArrear, 15000);
            $result['pf_employee'] = $pfWages * 0.12;
            $result['pf_employer'] = $pfWages * 0.12;
            $result['eps'] = $pfWages * 0.0833;
            $result['epf'] = $pfWages * 0.0367;
        }

        if ($esiApplicable) {
            $result['esi_employee'] = $basicArrear * 0.0075;
            $result['esi_employer'] = $basicArrear * 0.0325;
        }

        $result['total_arrear'] = $basicArrear +
            ($result['pf_employee'] ?? 0) +
            ($result['esi_employee'] ?? 0);

        return $result;
    }
}
