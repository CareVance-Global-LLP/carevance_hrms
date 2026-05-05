<?php

namespace App\Services\Payroll;

use App\Models\Payroll;
use App\Models\PayrollStructure;
use App\Models\Payslip;
use App\Models\User;
use App\Services\AppNotificationService;
use Carbon\Carbon;
use Illuminate\Http\Request;

class PayrollDomainService
{
    public function __construct(
        private readonly AppNotificationService $notificationService,
    ) {
    }

    public function resolvePayrollStructure(int $organizationId, int $userId, Carbon $periodStart, ?int $structureId): ?PayrollStructure
    {
        $query = PayrollStructure::with(['allowances', 'deductions'])
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId);

        if ($structureId) {
            return $query->where('id', $structureId)->first();
        }

        return $query
            ->whereDate('effective_from', '<=', $periodStart->toDateString())
            ->where(function ($q) use ($periodStart) {
                $q->whereNull('effective_to')->orWhereDate('effective_to', '>=', $periodStart->toDateString());
            })
            ->orderByDesc('effective_from')
            ->first();
    }

    public function computeComponents(array $items, float $basicSalary): array
    {
        $rows = [];
        $total = 0.0;

        foreach ($items as $item) {
            $type = (string) ($item['calculation_type'] ?? 'fixed');
            $amount = (float) ($item['amount'] ?? 0);
            $computed = $type === 'percentage'
                ? round(($basicSalary * $amount) / 100, 2)
                : round($amount, 2);

            $rows[] = [
                'name' => (string) ($item['name'] ?? 'Component'),
                'calculation_type' => $type,
                'value' => $amount,
                'computed_amount' => $computed,
            ];
            $total += $computed;
        }

        return [$rows, round($total, 2)];
    }

    public function findPayslip(Request $request, int $id): ?Payslip
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return null;
        }

        $query = Payslip::where('organization_id', $currentUser->organization_id)->where('id', $id);
        if (!$this->canManagePayroll($currentUser)) {
            $query->where('user_id', $currentUser->id);
        }

        return $query->first();
    }

    public function findPayrollRecord(Request $request, int $id): ?Payroll
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id || !$this->canManagePayroll($currentUser)) {
            return null;
        }

        return Payroll::where('organization_id', $currentUser->organization_id)
            ->where('id', $id)
            ->first();
    }

    public function canManagePayroll(User $user): bool
    {
        return in_array($user->role, ['admin', 'manager'], true);
    }

    public function sendPayrollPaidNotification(Payroll $payroll, ?int $senderId = null): void
    {
        if (!$payroll->organization_id || !$payroll->user_id) {
            return;
        }

        $currency = (string) config('payroll.default_currency', 'INR');
        $amount = round((float) $payroll->net_salary, 2);
        $period = (string) $payroll->payroll_month;

        $this->notificationService->sendToUsers(
            organizationId: (int) $payroll->organization_id,
            userIds: collect([(int) $payroll->user_id]),
            senderId: $senderId,
            type: 'salary_credited',
            title: 'Salary Credited',
            message: "Your salary of {$currency} {$amount} was paid today for {$period}.",
            meta: [
                'payroll_id' => $payroll->id,
                'period_month' => $period,
                'currency' => $currency,
                'amount' => $amount,
                'paid_at' => optional($payroll->paid_at)->toIso8601String(),
            ]
        );
    }
}
