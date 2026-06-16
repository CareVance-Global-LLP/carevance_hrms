<?php

namespace App\Services;

use App\Models\PayGroup;
use App\Models\PayCalendar;
use App\Models\PayrollRun;
use App\Models\Employee;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Multi-Pay-Group & Pay Calendar Service
 *
 * Lets an organisation define multiple pay groups, each with its own
 * pay cycle (e.g., Engineering: month-end, Sales: 5th of next month,
 * Daily-wage: weekly every Friday). Each pay group can have its own
 * approval workflow and bank file.
 */
class MultiPayGroupService
{
    /**
     * Create a new pay group with a custom calendar.
     */
    public function createGroup(array $data): PayGroup
    {
        return DB::transaction(function () use ($data) {
            $group = PayGroup::create([
                'organization_id' => $data['organization_id'],
                'name' => $data['name'],
                'description' => $data['description'] ?? null,
                'cycle_type' => $data['cycle_type'] ?? 'monthly', // monthly, weekly, biweekly
                'cutoff_day' => $data['cutoff_day'] ?? null,
                'payment_day' => $data['payment_day'] ?? null,
                'week_start_day' => $data['week_start_day'] ?? null,
                'approval_workflow_id' => $data['approval_workflow_id'] ?? null,
            ]);
            return $group;
        });
    }

    /**
     * Add employees to a pay group.
     */
    public function assignEmployees(int $groupId, array $userIds): int
    {
        $count = 0;
        foreach ($userIds as $uid) {
            DB::table('pay_group_members')->updateOrInsert(
                ['pay_group_id' => $groupId, 'user_id' => $uid],
                ['created_at' => now(), 'updated_at' => now()]
            );
            $count++;
        }
        return $count;
    }

    /**
     * Compute the payroll period start and end dates for a given pay date.
     */
    public function getPayPeriod(PayGroup $group, string $payDate): array
    {
        $payDate = Carbon::parse($payDate);
        return match ($group->cycle_type) {
            'monthly' => [
                'start' => $payDate->copy()->subMonth()->day(($group->cutoff_day ?? 1) + 1)->format('Y-m-d'),
                'end' => $payDate->copy()->day($group->cutoff_day ?? $payDate->daysInMonth)->format('Y-m-d'),
            ],
            'weekly' => [
                'start' => $payDate->copy()->subWeek()->startOfWeek($group->week_start_day ?? Carbon::MONDAY)->format('Y-m-d'),
                'end' => $payDate->copy()->subWeek()->endOfWeek($group->week_start_day ?? Carbon::FRIDAY)->format('Y-m-d'),
            ],
            'biweekly' => [
                'start' => $payDate->copy()->subWeeks(2)->startOfWeek($group->week_start_day ?? Carbon::MONDAY)->format('Y-m-d'),
                'end' => $payDate->copy()->subWeeks(2)->endOfWeek($group->week_start_day ?? Carbon::FRIDAY)->format('Y-m-d'),
            ],
            default => [
                'start' => $payDate->copy()->startOfMonth()->format('Y-m-d'),
                'end' => $payDate->copy()->endOfMonth()->format('Y-m-d'),
            ],
        };
    }

    /**
     * List upcoming pay dates for the next N months.
     */
    public function upcomingPayDates(PayGroup $group, int $months = 3): array
    {
        $dates = [];
        $now = Carbon::now();
        for ($i = 0; $i < $months; $i++) {
            $date = $now->copy()->addMonths($i);
            $payDate = $date->copy()->day($group->payment_day ?? 1);
            $period = $this->getPayPeriod($group, $payDate->format('Y-m-d'));
            $dates[] = [
                'pay_date' => $payDate->format('Y-m-d'),
                'period_start' => $period['start'],
                'period_end' => $period['end'],
            ];
        }
        return $dates;
    }

    /**
     * List pay groups in an organization.
     */
    public function list(int $organizationId): array
    {
        return PayGroup::where('organization_id', $organizationId)->get()->toArray();
    }
}
