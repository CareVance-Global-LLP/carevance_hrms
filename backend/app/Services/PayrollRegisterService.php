<?php

namespace App\Services;

use App\Models\PayrollMonthlyRun;
use App\Models\PayrollItem;
use Illuminate\Support\Facades\DB;

class PayrollRegisterService
{
    public function getPayrollRegister(int $orgId, string $monthYear, array $filters = [], int $perPage = 0, int $page = 1): array
    {
        $baseQuery = PayrollItem::with(['user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeBankAccounts', 'department'])
            ->where('organization_id', $orgId)
            ->whereHas('payrollRun', fn($q) => $q->where('month_year', $monthYear));

        if (!empty($filters['department_id'])) {
            $baseQuery->where('department_id', $filters['department_id']);
        }
        if (!empty($filters['user_id'])) {
            $baseQuery->where('user_id', $filters['user_id']);
        }
        if (!empty($filters['payment_status'])) {
            $baseQuery->where('payment_status', $filters['payment_status']);
        }

        if ($perPage > 0) {
            $paginator = $baseQuery->paginate($perPage, ['*'], 'page', $page);
            $items = $paginator->items();
            $paginationMeta = [
                'total' => $paginator->total(),
                'per_page' => $paginator->perPage(),
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
            ];
        } else {
            $items = $baseQuery->get();
            $paginationMeta = null;
        }

        $register = [];
        foreach ($items as $item) {
            $register[] = [
                'employee_code' => $item->user->employeeWorkInfo->employee_code ?? '',
                'employee_name' => $item->user->name,
                'department' => $item->department?->name ?? '',
                'designation' => $item->user->employeeWorkInfo->designation ?? '',
                'pan' => $item->user->employeeProfile->pan_number ?? '',
                'uan' => $item->user->employeeProfile->uan_number ?? '',
                'bank_account' => $item->user->employeeBankAccounts->first()?->account_number ?? '',
                'ifsc' => $item->user->employeeBankAccounts->first()?->ifsc_code ?? '',
                'working_days' => $item->total_working_days ?? 0,
                'days_present' => $item->days_present ?? 0,
                'days_absent' => $item->days_absent ?? 0,
                'lop_days' => $item->lOP_days ?? 0,

                'basic' => (float) ($item->basic ?? 0),
                'hra' => (float) ($item->hra ?? 0),
                'conveyance' => (float) ($item->conveyance ?? 0),
                'medical' => (float) ($item->medical ?? 0),
                'special_allowance' => (float) ($item->special_allowance ?? 0),
                'overtime_pay' => (float) ($item->overtime_pay ?? 0),
                'custom_earnings' => (float) ($item->custom_earnings ?? 0),
                'gross_salary' => (float) ($item->gross_salary ?? 0),

                'pf_employee' => (float) ($item->pf_employee ?? 0),
                'esi_employee' => (float) ($item->esi_employee ?? 0),
                'pt' => (float) ($item->pt ?? 0),
                'tds' => (float) ($item->tds ?? 0),
                'lop_deduction' => (float) ($item->lOP_deduction ?? 0),
                'custom_deductions' => (float) ($item->custom_deductions ?? 0),
                'total_deductions' => (float) ($item->total_deductions ?? 0),

                'pf_employer' => (float) ($item->pf_employer ?? 0),
                'eps' => (float) ($item->eps ?? 0),
                'epf' => (float) ($item->epf ?? 0),
                'esi_employer' => (float) ($item->esi_employer ?? 0),
                'gratuity' => (float) ($item->gratuity ?? 0),
                'total_employer_contributions' => (float) ($item->total_employer_contributions ?? 0),

                'net_pay' => (float) ($item->net_pay ?? 0),
                'payment_status' => $item->payment_status ?? 'pending',
                'payment_method' => $item->payment_method ?? '',
            ];
        }

        $summary = [
            'total_employees' => count($register),
            'total_gross' => collect($register)->sum('gross_salary'),
            'total_deductions' => collect($register)->sum('total_deductions'),
            'total_net_pay' => collect($register)->sum('net_pay'),
            'total_pf_employee' => collect($register)->sum('pf_employee'),
            'total_pf_employer' => collect($register)->sum('pf_employer'),
            'total_esi_employee' => collect($register)->sum('esi_employee'),
            'total_esi_employer' => collect($register)->sum('esi_employer'),
            'total_pt' => collect($register)->sum('pt'),
            'total_tds' => collect($register)->sum('tds'),
            'total_gratuity' => collect($register)->sum('gratuity'),
            'total_employer_contributions' => collect($register)->sum('total_employer_contributions'),
        ];

        $result = [
            'register' => $register,
            'summary' => $summary,
            'month_year' => $monthYear,
        ];

        if ($paginationMeta) {
            $result['pagination'] = $paginationMeta;
        }

        return $result;
    }

    public function getStatutoryRegister(int $orgId, string $monthYear, string $type, int $perPage = 0, int $page = 1): array
    {
        $baseQuery = PayrollItem::with(['user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentId'])
            ->where('organization_id', $orgId)
            ->whereHas('payrollRun', fn($q) => $q->where('month_year', $monthYear));

        if ($perPage > 0) {
            $paginator = $baseQuery->paginate($perPage, ['*'], 'page', $page);
            $items = $paginator->items();
            $paginationMeta = [
                'total' => $paginator->total(),
                'per_page' => $paginator->perPage(),
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
            ];
        } else {
            $items = $baseQuery->get();
            $paginationMeta = null;
        }

        $result = match ($type) {
            'pf' => $this->buildPfRegister($items),
            'esi' => $this->buildEsiRegister($items),
            'pt' => $this->buildPtRegister($items),
            'tds' => $this->buildTdsRegister($items),
            default => [],
        };

        if ($paginationMeta) {
            $result['pagination'] = $paginationMeta;
        }

        return $result;
    }

    private function buildPfRegister($items): array
    {
        $entries = [];
        foreach ($items as $item) {
            if ($item->pf_employee > 0 || $item->pf_employer > 0) {
                $entries[] = [
                    'employee_code' => $item->user->employeeWorkInfo->employee_code ?? '',
                    'name' => $item->user->name,
                    'uan' => $item->user->employeeProfile->uan_number ?? '',
                    'member_id' => $item->user->employeeGovernmentId->pf_member_id ?? '',
                    'pf_wages' => min((float) ($item->basic ?? 0), 15000),
                    'epf_employee' => (float) ($item->pf_employee ?? 0),
                    'eps' => (float) ($item->eps ?? 0),
                    'epf_employer' => (float) ($item->epf ?? 0),
                    'pf_admin_charges' => min((float) ($item->basic ?? 0), 15000) * 0.005,
                    'edli_charges' => min((float) ($item->basic ?? 0), 15000) * 0.0017,
                    'total' => (float) ($item->pf_employee ?? 0) + (float) ($item->pf_employer ?? 0),
                ];
            }
        }

        return [
            'type' => 'PF Register',
            'month_year' => $items->first()?->payrollRun?->month_year ?? '',
            'entries' => $entries,
            'summary' => [
                'total_members' => count($entries),
                'total_epf_ee' => collect($entries)->sum('epf_employee'),
                'total_eps' => collect($entries)->sum('eps'),
                'total_epf_er' => collect($entries)->sum('epf_employer'),
            ],
        ];
    }

    private function buildEsiRegister($items): array
    {
        $entries = [];
        foreach ($items as $item) {
            if ($item->esi_employee > 0 || $item->esi_employer > 0) {
                $entries[] = [
                    'employee_code' => $item->user->employeeWorkInfo->employee_code ?? '',
                    'name' => $item->user->name,
                    'esi_ip_number' => $item->user->employeeProfile->esi_ip_number ?? '',
                    'gross_wages' => (float) ($item->gross_salary ?? 0),
                    'employee_esi' => (float) ($item->esi_employee ?? 0),
                    'employer_esi' => (float) ($item->esi_employer ?? 0),
                    'total' => (float) ($item->esi_employee ?? 0) + (float) ($item->esi_employer ?? 0),
                ];
            }
        }

        return [
            'type' => 'ESI Register',
            'entries' => $entries,
            'summary' => [
                'total_employees' => count($entries),
                'total_ee_esi' => collect($entries)->sum('employee_esi'),
                'total_er_esi' => collect($entries)->sum('employer_esi'),
            ],
        ];
    }

    private function buildPtRegister($items): array
    {
        $entries = [];
        foreach ($items as $item) {
            if ($item->pt > 0) {
                $entries[] = [
                    'employee_code' => $item->user->employeeWorkInfo->employee_code ?? '',
                    'name' => $item->user->name,
                    'gross' => (float) ($item->gross_salary ?? 0),
                    'pt_amount' => (float) ($item->pt ?? 0),
                ];
            }
        }

        return [
            'type' => 'PT Register',
            'entries' => $entries,
            'summary' => ['total_pt' => collect($entries)->sum('pt_amount')],
        ];
    }

    private function buildTdsRegister($items): array
    {
        $entries = [];
        foreach ($items as $item) {
            if ($item->tds > 0) {
                $entries[] = [
                    'employee_code' => $item->user->employeeWorkInfo->employee_code ?? '',
                    'name' => $item->user->name,
                    'pan' => $item->user->employeeProfile->pan_number ?? '',
                    'gross' => (float) ($item->gross_salary ?? 0),
                    'tds' => (float) ($item->tds ?? 0),
                ];
            }
        }

        return [
            'type' => 'TDS Register',
            'entries' => $entries,
            'summary' => ['total_tds' => collect($entries)->sum('tds')],
        ];
    }

    public function getBankReconciliation(int $orgId, string $monthYear): array
    {
        $items = PayrollItem::with('user.employeeBankAccounts')
            ->where('organization_id', $orgId)
            ->whereHas('payrollRun', fn($q) => $q->where('month_year', $monthYear))
            ->get();

        $reconciliation = [];
        foreach ($items as $item) {
            $bank = $item->user->employeeBankAccounts->first();
            $reconciliation[] = [
                'employee_name' => $item->user->name,
                'account_number' => $bank->account_number ?? '',
                'ifsc' => $bank->ifsc_code ?? '',
                'payslip_amount' => (float) ($item->net_pay ?? 0),
                'payment_status' => $item->payment_status ?? 'pending',
                'payment_method' => $item->payment_method ?? '',
                'payment_reference' => $item->payment_reference ?? '',
            ];
        }

        return [
            'month_year' => $monthYear,
            'total_employees' => count($reconciliation),
            'total_payslip' => collect($reconciliation)->sum('payslip_amount'),
            'total_paid' => collect($reconciliation)->where('payment_status', 'paid')->sum('payslip_amount'),
            'total_pending' => collect($reconciliation)->where('payment_status', '!=', 'paid')->sum('payslip_amount'),
            'entries' => $reconciliation,
        ];
    }
}
