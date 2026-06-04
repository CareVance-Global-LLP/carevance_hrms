<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\EmployeeBankAccount;
use App\Models\EmployeeProfile;
use App\Models\EmployeeTaxDeclaration;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class PayrollDashboardController extends Controller
{
    /**
     * Get comprehensive dashboard data for the new payroll dashboard
     */
    public function getDashboardData(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $monthYear = $request->get('month_year', now()->format('Y-m'));

        return response()->json([
            'success' => true,
            'data' => [
                'alerts' => $this->getActionableAlerts($organizationId, $monthYear),
                'stats' => $this->getEnhancedStats($organizationId, $monthYear),
                'workflow_status' => $this->getWorkflowStatus($organizationId, $monthYear),
                'compliance_calendar' => $this->getComplianceCalendar($organizationId, $monthYear),
                'trends' => $this->getTrendsData($organizationId),
                'department_comparison' => $this->getDepartmentComparison($organizationId, $monthYear),
                'health_score' => $this->getEmployeeHealthScore($organizationId),
                'recent_activity' => $this->getRecentActivity($organizationId),
            ],
        ]);
    }

    /**
     * Get actionable alerts for the dashboard
     */
    private function getActionableAlerts(int $organizationId, string $monthYear): array
    {
        $alerts = [];

        // Check for employees missing bank details
        $missingBankDetails = DB::table('users')
            ->leftJoin('employee_bank_accounts', 'users.id', '=', 'employee_bank_accounts.user_id')
            ->where('users.organization_id', $organizationId)
            ->whereIn('users.role', ['employee', 'manager', 'admin'])
            ->whereNull('employee_bank_accounts.id')
            ->count();

        if ($missingBankDetails > 0) {
            $alerts[] = [
                'id' => 'missing_bank_' . time(),
                'type' => 'critical',
                'title' => 'Missing Bank Details',
                'message' => "{$missingBankDetails} employee(s) missing bank account information",
                'action' => 'View Employees',
                'action_url' => '/employees?filter=missing_bank',
                'count' => $missingBankDetails,
            ];
        }

        // Check for pending tax declarations
        $pendingTaxDeclarations = EmployeeTaxDeclaration::where('organization_id', $organizationId)
            ->where('status', 'submitted')
            ->count();

        if ($pendingTaxDeclarations > 0) {
            $alerts[] = [
                'id' => 'pending_tax_' . time(),
                'type' => 'warning',
                'title' => 'Pending Tax Declarations',
                'message' => "{$pendingTaxDeclarations} tax declaration(s) awaiting approval",
                'action' => 'Review Declarations',
                'action_url' => '/tax-declarations?status=submitted',
                'count' => $pendingTaxDeclarations,
            ];
        }

        // Check if payroll needs to be processed
        $totalEmployees = DB::table('users')
            ->where('organization_id', $organizationId)
            ->whereIn('role', ['employee', 'manager', 'admin'])
            ->count();

        $processedCount = PayrollItem::where('organization_id', $organizationId)
            ->whereHas('payrollRun', function ($q) use ($monthYear) {
                $q->where('month_year', $monthYear);
            })
            ->count();

        if ($processedCount < $totalEmployees) {
            $pendingCount = $totalEmployees - $processedCount;
            $alerts[] = [
                'id' => 'pending_payroll_' . time(),
                'type' => 'info',
                'title' => 'Payroll Ready to Process',
                'message' => "{$pendingCount} employee(s) pending for {$monthYear}",
                'action' => 'Run Payroll',
                'action_url' => '/payroll?action=run&month=' . $monthYear,
                'count' => $pendingCount,
            ];
        }

        // Check for missing PAN numbers
        $missingPAN = EmployeeProfile::whereHas('user', function ($q) use ($organizationId) {
            $q->where('organization_id', $organizationId);
        })
        ->whereNull('pan_number')
        ->orWhere('pan_number', '')
        ->count();

        if ($missingPAN > 0) {
            $alerts[] = [
                'id' => 'missing_pan_' . time(),
                'type' => 'warning',
                'title' => 'Missing PAN Numbers',
                'message' => "{$missingPAN} employee(s) without PAN details",
                'action' => 'Update Profiles',
                'action_url' => '/employees?filter=missing_pan',
                'count' => $missingPAN,
            ];
        }

        // Check for upcoming compliance deadlines
        $complianceAlerts = $this->getUpcomingComplianceAlerts($monthYear);
        $alerts = array_merge($alerts, $complianceAlerts);

        return $alerts;
    }

    /**
     * Get enhanced stats for the dashboard
     */
    private function getEnhancedStats(int $organizationId, string $monthYear): array
    {
        $currentRun = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $monthYear)
            ->first();

        $previousMonth = Carbon::createFromFormat('Y-m', $monthYear)->subMonth()->format('Y-m');
        $previousRun = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $previousMonth)
            ->first();

        // Calculate trends
        $netPayTrend = $this->calculateTrend(
            $currentRun?->total_net_pay ?? 0,
            $previousRun?->total_net_pay ?? 0
        );

        $grossTrend = $this->calculateTrend(
            $currentRun?->total_gross ?? 0,
            $previousRun?->total_gross ?? 0
        );

        $employeeTrend = $this->calculateTrend(
            $currentRun?->total_employees ?? 0,
            $previousRun?->total_employees ?? 0
        );

        // Get total employees in organization
        $totalEmployees = DB::table('users')
            ->where('organization_id', $organizationId)
            ->whereIn('role', ['employee', 'manager', 'admin'])
            ->count();

        return [
            'total_net_pay' => [
                'value' => $currentRun?->total_net_pay ?? 0,
                'trend' => $netPayTrend,
                'formatted' => '₹' . number_format($currentRun?->total_net_pay ?? 0, 0),
            ],
            'total_gross' => [
                'value' => $currentRun?->total_gross ?? 0,
                'trend' => $grossTrend,
                'formatted' => '₹' . number_format($currentRun?->total_gross ?? 0, 0),
            ],
            'total_deductions' => [
                'value' => $currentRun?->total_deductions ?? 0,
                'formatted' => '₹' . number_format($currentRun?->total_deductions ?? 0, 0),
            ],
            'total_employees' => [
                'value' => $totalEmployees,
                'trend' => $employeeTrend,
                'processed' => $currentRun?->total_employees ?? 0,
            ],
            'compliance_score' => $this->calculateComplianceScore($organizationId, $monthYear),
            'pending_approvals' => $this->getPendingApprovalsCount($organizationId),
        ];
    }

    /**
     * Calculate trend percentage
     */
    private function calculateTrend(float $current, float $previous): array
    {
        if ($previous == 0) {
            return ['percentage' => 0, 'direction' => 'neutral'];
        }

        $change = (($current - $previous) / $previous) * 100;
        
        return [
            'percentage' => round(abs($change), 1),
            'direction' => $change > 0 ? 'up' : ($change < 0 ? 'down' : 'neutral'),
            'is_positive' => $change > 0,
        ];
    }

    /**
     * Get workflow status
     */
    private function getWorkflowStatus(int $organizationId, string $monthYear): array
    {
        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $monthYear)
            ->first();

        $steps = [
            ['id' => 'input', 'label' => 'Input', 'status' => 'completed'],
            ['id' => 'process', 'label' => 'Process', 'status' => 'pending'],
            ['id' => 'review', 'label' => 'Review', 'status' => 'pending'],
            ['id' => 'approve', 'label' => 'Approve', 'status' => 'pending'],
            ['id' => 'release', 'label' => 'Release', 'status' => 'pending'],
            ['id' => 'pay', 'label' => 'Pay', 'status' => 'pending'],
        ];

        if (!$run) {
            return [
                'current_step' => 'input',
                'status' => 'not_started',
                'steps' => $steps,
                'progress_percentage' => 0,
            ];
        }

        // Map run status to workflow steps
        $statusMap = [
            'draft' => ['current_step' => 'process', 'progress' => 16],
            'processing' => ['current_step' => 'process', 'progress' => 33],
            'processed' => ['current_step' => 'review', 'progress' => 50],
            'locked' => ['current_step' => 'review', 'progress' => 50],
            'approved' => ['current_step' => 'approve', 'progress' => 66],
            'released' => ['current_step' => 'release', 'progress' => 83],
            'paid' => ['current_step' => 'pay', 'progress' => 100],
        ];

        $mapped = $statusMap[$run->status] ?? ['current_step' => 'input', 'progress' => 0];

        // Update step statuses
        $currentStepIndex = array_search($mapped['current_step'], array_column($steps, 'id'));
        foreach ($steps as $index => &$step) {
            if ($index < $currentStepIndex) {
                $step['status'] = 'completed';
            } elseif ($index === $currentStepIndex) {
                $step['status'] = 'current';
            }
        }

        return [
            'current_step' => $mapped['current_step'],
            'status' => $run->status,
            'steps' => $steps,
            'progress_percentage' => $mapped['progress'],
            'can_process' => in_array($run->status, ['draft', 'processing']),
            'can_approve' => $run->status === 'locked',
            'can_release' => in_array($run->status, ['approved', 'locked']),
            'can_pay' => $run->status === 'released',
        ];
    }

    /**
     * Get compliance calendar
     */
    private function getComplianceCalendar(int $organizationId, string $monthYear): array
    {
        $now = Carbon::now();
        $currentMonth = Carbon::createFromFormat('Y-m', $monthYear);
        
        $deadlines = [
            [
                'id' => 'pf_' . $monthYear,
                'title' => 'PF Payment Due',
                'date' => $currentMonth->copy()->setDay(15)->format('Y-m-d'),
                'type' => 'pf',
                'description' => 'Employee PF contribution payment',
            ],
            [
                'id' => 'esi_' . $monthYear,
                'title' => 'ESI Payment Due',
                'date' => $currentMonth->copy()->setDay(15)->format('Y-m-d'),
                'type' => 'esi',
                'description' => 'Employee ESI contribution payment',
            ],
            [
                'id' => 'pt_' . $monthYear,
                'title' => 'Professional Tax Payment',
                'date' => $currentMonth->copy()->setDay(20)->format('Y-m-d'),
                'type' => 'pt',
                'description' => 'State professional tax payment',
            ],
            [
                'id' => 'tds_' . $monthYear,
                'title' => 'TDS Payment Due',
                'date' => $currentMonth->copy()->addMonth()->setDay(7)->format('Y-m-d'),
                'type' => 'tds',
                'description' => 'Income tax TDS deposit',
            ],
        ];

        // Add urgency status
        foreach ($deadlines as &$deadline) {
            $deadlineDate = Carbon::parse($deadline['date']);
            $daysRemaining = (int) round($now->diffInDays($deadlineDate, false));

            if ($daysRemaining < 0) {
                $deadline['urgency'] = 'overdue';
                $deadline['urgency_label'] = 'Overdue';
            } elseif ($daysRemaining === 0) {
                $deadline['urgency'] = 'critical';
                $deadline['urgency_label'] = 'Due today';
            } elseif ($daysRemaining === 1) {
                $deadline['urgency'] = 'critical';
                $deadline['urgency_label'] = '1 day left';
            } elseif ($daysRemaining <= 3) {
                $deadline['urgency'] = 'critical';
                $deadline['urgency_label'] = $daysRemaining . ' days left';
            } elseif ($daysRemaining <= 7) {
                $deadline['urgency'] = 'warning';
                $deadline['urgency_label'] = $daysRemaining . ' days left';
            } else {
                $deadline['urgency'] = 'normal';
                $deadline['urgency_label'] = $daysRemaining . ' days left';
            }

            $deadline['days_remaining'] = $daysRemaining;
        }

        // Sort by urgency and date
        usort($deadlines, function ($a, $b) {
            $urgencyOrder = ['overdue' => 0, 'critical' => 1, 'warning' => 2, 'normal' => 3];
            return $urgencyOrder[$a['urgency']] <=> $urgencyOrder[$b['urgency']];
        });

        return $deadlines;
    }

    /**
     * Get trends data
     */
    private function getTrendsData(int $organizationId): array
    {
        // Get last 6 months of payroll data
        $months = [];
        $netPayData = [];
        $grossPayData = [];
        $employeeCountData = [];
        $deductionsData = [];

        for ($i = 5; $i >= 0; $i--) {
            $month = now()->subMonths($i);
            $monthYear = $month->format('Y-m');
            $monthLabel = $month->format('M Y');

            $run = PayrollMonthlyRun::where('organization_id', $organizationId)
                ->where('month_year', $monthYear)
                ->first();

            $months[] = $monthLabel;
            $netPayData[] = $run?->total_net_pay ?? 0;
            $grossPayData[] = $run?->total_gross ?? 0;
            $deductionsData[] = $run?->total_deductions ?? 0;
            $employeeCountData[] = $run?->total_employees ?? 0;
        }

        return [
            'months' => $months,
            'net_pay' => $netPayData,
            'gross_pay' => $grossPayData,
            'deductions' => $deductionsData,
            'employee_count' => $employeeCountData,
        ];
    }

    /**
     * Get department comparison
     */
    private function getDepartmentComparison(int $organizationId, string $monthYear): array
    {
        $departments = DB::table('groups')
            ->where('organization_id', $organizationId)
            ->where('is_active', true)
            ->get();

        $comparison = [];

        foreach ($departments as $dept) {
            $employeeCount = DB::table('group_user')
                ->join('users', 'group_user.user_id', '=', 'users.id')
                ->where('group_user.group_id', $dept->id)
                ->where('users.organization_id', $organizationId)
                ->count();

            $payrollData = PayrollItem::where('organization_id', $organizationId)
                ->where('department_id', $dept->id)
                ->whereHas('payrollRun', function ($q) use ($monthYear) {
                    $q->where('month_year', $monthYear);
                })
                ->select(
                    DB::raw('COUNT(*) as processed_count'),
                    DB::raw('SUM(gross_salary) as total_gross'),
                    DB::raw('SUM(net_pay) as total_net_pay'),
                    DB::raw('AVG(net_pay) as avg_salary')
                )
                ->first();

            $comparison[] = [
                'id' => $dept->id,
                'name' => $dept->name,
                'employee_count' => $employeeCount,
                'processed_count' => $payrollData?->processed_count ?? 0,
                'total_gross' => $payrollData?->total_gross ?? 0,
                'total_net_pay' => $payrollData?->total_net_pay ?? 0,
                'avg_salary' => round($payrollData?->avg_salary ?? 0, 0),
                'status' => ($payrollData?->processed_count ?? 0) >= $employeeCount ? 'complete' : 'pending',
            ];
        }

        // Sort by total gross pay
        usort($comparison, fn($a, $b) => $b['total_net_pay'] <=> $a['total_net_pay']);

        return $comparison;
    }

    /**
     * Get employee health score
     */
    private function getEmployeeHealthScore(int $organizationId): array
    {
        $totalEmployees = DB::table('users')
            ->where('organization_id', $organizationId)
            ->whereIn('role', ['employee', 'manager', 'admin'])
            ->count();

        if ($totalEmployees === 0) {
            return [
                'overall_score' => 0,
                'metrics' => [],
            ];
        }

        // Bank details completeness
        $withBankDetails = DB::table('users')
            ->join('employee_bank_accounts', 'users.id', '=', 'employee_bank_accounts.user_id')
            ->where('users.organization_id', $organizationId)
            ->whereIn('users.role', ['employee', 'manager', 'admin'])
            ->whereNotNull('employee_bank_accounts.account_number')
            ->whereNotNull('employee_bank_accounts.ifsc_swift')
            ->distinct('users.id')
            ->count('users.id');

        // PAN details completeness
        $withPAN = EmployeeProfile::whereHas('user', function ($q) use ($organizationId) {
            $q->where('organization_id', $organizationId);
        })
        ->whereNotNull('pan_number')
        ->where('pan_number', '!=', '')
        ->count();

        // UAN details completeness
        $withUAN = EmployeeProfile::whereHas('user', function ($q) use ($organizationId) {
            $q->where('organization_id', $organizationId);
        })
        ->whereNotNull('uan_number')
        ->where('uan_number', '!=', '')
        ->count();

        // Tax declaration completeness
        $financialYear = $this->getCurrentFinancialYear();
        $withTaxDeclaration = EmployeeTaxDeclaration::where('organization_id', $organizationId)
            ->where('financial_year', $financialYear)
            ->whereIn('status', ['submitted', 'approved'])
            ->count();

        // Salary structure completeness (employees with payroll templates)
        $withSalaryStructure = DB::table('employee_payroll_templates')
            ->join('users', 'employee_payroll_templates.user_id', '=', 'users.id')
            ->where('users.organization_id', $organizationId)
            ->whereNotNull('employee_payroll_templates.annual_ctc')
            ->distinct('users.id')
            ->count('users.id');

        $metrics = [
            [
                'name' => 'Bank Details',
                'key' => 'bank_details',
                'completed' => $withBankDetails,
                'total' => $totalEmployees,
                'percentage' => round(($withBankDetails / $totalEmployees) * 100, 1),
            ],
            [
                'name' => 'PAN Numbers',
                'key' => 'pan_numbers',
                'completed' => $withPAN,
                'total' => $totalEmployees,
                'percentage' => round(($withPAN / $totalEmployees) * 100, 1),
            ],
            [
                'name' => 'UAN Numbers',
                'key' => 'uan_numbers',
                'completed' => $withUAN,
                'total' => $totalEmployees,
                'percentage' => round(($withUAN / $totalEmployees) * 100, 1),
            ],
            [
                'name' => 'Tax Declarations',
                'key' => 'tax_declarations',
                'completed' => $withTaxDeclaration,
                'total' => $totalEmployees,
                'percentage' => round(($withTaxDeclaration / $totalEmployees) * 100, 1),
            ],
            [
                'name' => 'Salary Structure',
                'key' => 'salary_structure',
                'completed' => $withSalaryStructure,
                'total' => $totalEmployees,
                'percentage' => round(($withSalaryStructure / $totalEmployees) * 100, 1),
            ],
        ];

        // Calculate overall score
        $overallScore = round(array_sum(array_column($metrics, 'percentage')) / count($metrics), 1);

        return [
            'overall_score' => $overallScore,
            'total_employees' => $totalEmployees,
            'metrics' => $metrics,
            'status' => $overallScore >= 90 ? 'excellent' : ($overallScore >= 70 ? 'good' : ($overallScore >= 50 ? 'fair' : 'poor')),
        ];
    }

    /**
     * Get recent activity
     */
    private function getRecentActivity(int $organizationId): array
    {
        $activities = [];

        // Recent payroll runs
        $recentRuns = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->with(['createdBy:id,name'])
            ->orderBy('updated_at', 'desc')
            ->limit(5)
            ->get();

        foreach ($recentRuns as $run) {
            $activities[] = [
                'id' => 'run_' . $run->id,
                'type' => 'payroll_run',
                'title' => "Payroll {$run->status} for {$run->month_year}",
                'description' => "{$run->total_employees} employees processed",
                'user' => $run->createdBy?->name ?? 'System',
                'timestamp' => $run->updated_at->toISOString(),
                'time_ago' => $run->updated_at->diffForHumans(),
            ];
        }

        // Recent tax declaration approvals
        $recentDeclarations = EmployeeTaxDeclaration::where('organization_id', $organizationId)
            ->with(['user:id,name', 'approvedBy:id,name'])
            ->whereNotNull('approved_at')
            ->orderBy('approved_at', 'desc')
            ->limit(3)
            ->get();

        foreach ($recentDeclarations as $decl) {
            $activities[] = [
                'id' => 'decl_' . $decl->id,
                'type' => 'tax_declaration',
                'title' => "Tax declaration approved for {$decl->user?->name}",
                'description' => "Financial year {$decl->financial_year}",
                'user' => $decl->approvedBy?->name ?? 'System',
                'timestamp' => $decl->approved_at->toISOString(),
                'time_ago' => $decl->approved_at->diffForHumans(),
            ];
        }

        // Sort by timestamp
        usort($activities, fn($a, $b) => strtotime($b['timestamp']) <=> strtotime($a['timestamp']));

        return array_slice($activities, 0, 8);
    }

    /**
     * Get upcoming compliance alerts
     */
    private function getUpcomingComplianceAlerts(string $monthYear): array
    {
        $alerts = [];
        $now = Carbon::now();
        $currentMonth = Carbon::createFromFormat('Y-m', $monthYear);

        $deadlines = [
            ['day' => 15, 'type' => 'critical', 'title' => 'PF Payment Due Soon'],
            ['day' => 15, 'type' => 'critical', 'title' => 'ESI Payment Due Soon'],
            ['day' => 20, 'type' => 'warning', 'title' => 'PT Payment Due Soon'],
        ];

        foreach ($deadlines as $deadline) {
            $deadlineDate = $currentMonth->copy()->setDay($deadline['day']);
            $daysRemaining = $now->diffInDays($deadlineDate, false);

            if ($daysRemaining >= 0 && $daysRemaining <= 7) {
                $alerts[] = [
                    'id' => 'compliance_' . $deadline['day'] . time(),
                    'type' => $deadline['type'],
                    'title' => $deadline['title'],
                    'message' => "Due in {$daysRemaining} days",
                    'action' => 'View Details',
                    'action_url' => '/compliance',
                    'count' => 1,
                ];
            }
        }

        return $alerts;
    }

    /**
     * Calculate compliance score
     */
    private function calculateComplianceScore(int $organizationId, string $monthYear): int
    {
        // Simplified scoring based on payroll run status
        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $monthYear)
            ->first();

        if (!$run) {
            return 0;
        }

        $scores = [
            'draft' => 20,
            'processing' => 40,
            'processed' => 60,
            'locked' => 70,
            'approved' => 85,
            'released' => 95,
            'paid' => 100,
        ];

        return $scores[$run->status] ?? 0;
    }

    /**
     * Get pending approvals count
     */
    private function getPendingApprovalsCount(int $organizationId): int
    {
        $taxDeclarations = EmployeeTaxDeclaration::where('organization_id', $organizationId)
            ->where('status', 'submitted')
            ->count();

        $loans = \App\Models\EmployeeLoan::where('organization_id', $organizationId)
            ->where('status', 'pending')
            ->count();

        return $taxDeclarations + $loans;
    }

    /**
     * Get current financial year
     */
    private function getCurrentFinancialYear(): string
    {
        $year = now()->year;
        $month = now()->month;
        if ($month < 4) {
            return ($year - 1) . '-' . substr($year, -2);
        }
        return $year . '-' . substr($year + 1, -2);
    }
}
