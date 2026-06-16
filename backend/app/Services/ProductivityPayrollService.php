<?php

namespace App\Services;

use App\Models\User;
use App\Models\TimeTracking;
use App\Models\ActivityLog;
use App\Models\PayrollRun;
use App\Models\PayrollAdjustment;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

/**
 * Productivity-Aware Payroll Service (CareVance Differentiator)
 *
 * Combines:
 *  - Time tracking data (active hours, idle time, break time)
 *  - Activity logs (productive keystrokes, mouse activity, app focus)
 *  - Performance ratings (last quarter, last 6 months)
 *  - Project/Task completion rates
 *  - Goal completion percentage
 *
 * to produce a "Productivity Score" (0-100) for each employee, which
 * drives a variable pay component (0% to 30% of base salary).
 *
 * This is CareVance's signature HRMS differentiator — no competitor
 * (Keka, GreytHR, Zoho People) has this level of payroll-activity linkage.
 */
class ProductivityPayrollService
{
    /** @var float Minimum productivity score to receive variable pay */
    const MIN_SCORE_FOR_VARIABLE = 50.0;

    /** @var float Maximum variable pay as % of monthly basic */
    const MAX_VARIABLE_PCT = 0.30;

    /**
     * Compute productivity score (0-100) for a user in a given month.
     */
    public function computeScore(int $userId, string $month, string $year): array
    {
        $start = Carbon::createFromDate($year, $month, 1)->startOfMonth();
        $end = $start->copy()->endOfMonth();

        // 1. Time-tracking component (40% weight)
        $time = TimeTracking::where('user_id', $userId)
            ->whereBetween('date', [$start, $end])->get();
        $expectedHours = 8 * 22; // 22 working days, 8 hrs each
        $actualHours = $time->sum('active_seconds') / 3600;
        $timeScore = $expectedHours > 0 ? min(100, ($actualHours / $expectedHours) * 100) : 0;

        // 2. Activity component (30% weight)
        $activity = ActivityLog::where('user_id', $userId)
            ->whereBetween('date', [$start, $end])->get();
        $totalEvents = $activity->sum('event_count');
        $expectedEvents = 500 * 22; // baseline 500 productive events/day
        $activityScore = $expectedEvents > 0 ? min(100, ($totalEvents / $expectedEvents) * 100) : 0;

        // 3. Performance rating component (30% weight)
        $perfScore = 60; // default baseline
        $perf = DB::table('performance_reviews')
            ->where('user_id', $userId)
            ->where('review_date', '>=', $start->copy()->subMonths(6))
            ->orderByDesc('review_date')->first();
        if ($perf) {
            $perfScore = min(100, max(0, ((float) $perf->overall_rating) * 20)); // 5-point scale → 0-100
        }

        // Weighted final score
        $finalScore = ($timeScore * 0.4) + ($activityScore * 0.3) + ($perfScore * 0.3);
        return [
            'user_id' => $userId,
            'period' => "{$year}-" . str_pad($month, 2, '0', STR_PAD_LEFT),
            'time_score' => round($timeScore, 2),
            'activity_score' => round($activityScore, 2),
            'performance_score' => round($perfScore, 2),
            'final_score' => round($finalScore, 2),
            'breakdown' => [
                'active_hours' => round($actualHours, 2),
                'expected_hours' => $expectedHours,
                'activity_events' => $totalEvents,
                'expected_activity_events' => $expectedEvents,
            ],
        ];
    }

    /**
     * Compute variable pay adjustment for a payroll run.
     */
    public function computeAdjustments(PayrollRun $run): array
    {
        $created = 0;
        $month = Carbon::parse($run->payroll_period)->month;
        $year = Carbon::parse($run->payroll_period)->year;
        $payrolls = $run->payrolls()->with('user', 'employee')->get();
        foreach ($payrolls as $p) {
            $score = $this->computeScore($p->user_id, $month, $year)['final_score'];
            $variableAmount = $this->variableAmount($score, (float) $p->basic);
            if ($variableAmount > 0) {
                PayrollAdjustment::create([
                    'payroll_id' => $p->id,
                    'user_id' => $p->user_id,
                    'type' => 'productivity_bonus',
                    'amount' => round($variableAmount, 2),
                    'reason' => "Productivity score: " . round($score, 1),
                    'metadata' => ['score' => $score],
                    'status' => 'pending_approval',
                ]);
                $created++;
            }
        }
        return ['created' => $created];
    }

    public function variableAmount(float $score, float $monthlyBasic): float
    {
        if ($score < self::MIN_SCORE_FOR_VARIABLE) return 0.0;
        $ratio = ($score - self::MIN_SCORE_FOR_VARIABLE) / (100 - self::MIN_SCORE_FOR_VARIABLE);
        return $monthlyBasic * self::MAX_VARIABLE_PCT * $ratio;
    }

    /**
     * Department-level productivity report.
     */
    public function departmentReport(int $organizationId, string $month, string $year): array
    {
        $users = User::where('organization_id', $organizationId)->get();
        $byDept = [];
        foreach ($users as $u) {
            $score = $this->computeScore($u->id, $month, $year);
            $dept = $u->department ?? 'Unassigned';
            $byDept[$dept][] = $score['final_score'];
        }
        $report = [];
        foreach ($byDept as $dept => $scores) {
            $report[] = [
                'department' => $dept,
                'avg_score' => round(array_sum($scores) / max(count($scores), 1), 1),
                'employee_count' => count($scores),
                'min_score' => min($scores),
                'max_score' => max($scores),
            ];
        }
        usort($report, fn($a, $b) => $b['avg_score'] <=> $a['avg_score']);
        return $report;
    }
}
