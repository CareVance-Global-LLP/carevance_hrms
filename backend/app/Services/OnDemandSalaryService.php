<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\TimeTracking;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * On-Demand Salary / Earned Wage Access (EWA) Service
 *
 * Allows employees to withdraw a portion of their earned but unpaid salary
 * at any time during the month. Common in gig and blue-collar workforces,
 * increasingly popular in corporate India post-COVID.
 *
 * Calculation:
 *   max_withdrawable = (days_worked / total_days) * monthly_net
 *                     - already_withdrawn
 *                     - 5% buffer (held back for safety)
 */
class OnDemandSalaryService
{
    const WITHDRAWAL_FEE_PCT = 0.005;  // 0.5% convenience fee
    const SAFETY_BUFFER_PCT = 0.05;
    const MAX_WITHDRAWALS_PER_MONTH = 3;

    /**
     * Calculate how much the employee can currently withdraw.
     */
    public function maxWithdrawable(int $userId, string $month = null, string $year = null): array
    {
        $month = $month ?? (string) Carbon::now()->month;
        $year = $year ?? (string) Carbon::now()->year;
        $employee = Employee::where('user_id', $userId)->firstOrFail();
        $monthlyNet = (float) $employee->current_ctc / 12 * 0.80; // approx net
        $totalDays = Carbon::createFromDate($year, $month, 1)->daysInMonth;
        $daysWorked = TimeTracking::where('user_id', $userId)
            ->whereMonth('date', $month)->whereYear('date', $year)
            ->where('active_seconds', '>', 0)
            ->distinct('date')->count('date');
        $alreadyWithdrawn = (float) DB::table('ewa_transactions')
            ->where('user_id', $userId)
            ->whereYear('requested_at', $year)->whereMonth('requested_at', $month)
            ->where('status', 'disbursed')->sum('amount');
        $proRated = ($daysWorked / $totalDays) * $monthlyNet;
        $maxAvailable = ($proRated * (1 - self::SAFETY_BUFFER_PCT)) - $alreadyWithdrawn;

        $usage = DB::table('ewa_transactions')
            ->where('user_id', $userId)
            ->whereYear('requested_at', $year)->whereMonth('requested_at', $month)
            ->where('status', 'disbursed')->count();

        return [
            'monthly_net' => round($monthlyNet, 2),
            'days_worked' => $daysWorked,
            'total_days' => $totalDays,
            'pro_rated' => round($proRated, 2),
            'already_withdrawn' => round($alreadyWithdrawn, 2),
            'max_withdrawable' => round(max(0, $maxAvailable), 2),
            'withdrawals_used' => $usage,
            'withdrawals_remaining' => max(0, self::MAX_WITHDRAWALS_PER_MONTH - $usage),
            'fee_pct' => self::WITHDRAWAL_FEE_PCT * 100,
        ];
    }

    public function requestWithdrawal(int $userId, float $amount): array
    {
        $max = $this->maxWithdrawable($userId);
        if ($amount > $max['max_withdrawable']) {
            return ['status' => 'rejected', 'reason' => 'amount_exceeds_max', 'max' => $max['max_withdrawable']];
        }
        if ($max['withdrawals_remaining'] <= 0) {
            return ['status' => 'rejected', 'reason' => 'withdrawal_limit_reached'];
        }
        $fee = round($amount * self::WITHDRAWAL_FEE_PCT, 2);
        $id = DB::table('ewa_transactions')->insertGetId([
            'user_id' => $userId,
            'amount' => $amount,
            'fee' => $fee,
            'net_disbursed' => $amount - $fee,
            'requested_at' => now(),
            'status' => 'pending',
        ]);
        return [
            'status' => 'pending',
            'transaction_id' => $id,
            'amount' => $amount,
            'fee' => $fee,
            'net_disbursed' => $amount - $fee,
        ];
    }

    public function history(int $userId, int $limit = 10): array
    {
        return DB::table('ewa_transactions')
            ->where('user_id', $userId)
            ->orderByDesc('requested_at')->limit($limit)
            ->get(['id', 'amount', 'fee', 'net_disbursed', 'status', 'requested_at', 'disbursed_at'])
            ->map(fn($r) => (array) $r)->toArray();
    }
}
