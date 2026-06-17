<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayrollFiling;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PayrollOnboardingController extends Controller
{
    /**
     * The 9 setup steps tracked individually. The first 4 are auto-detected;
     * the latter 5 are explicitly completed via markSetupStep.
     */
    public const SETUP_STEPS = [
        'welcome',
        'defaults',
        'departments',
        'employees',
        'compliance',
        'statutory',
        'pay_schedule',
        'bank',
        'test_run',
    ];

    public const SETUP_STEP_LABELS = [
        'welcome' => 'Welcome',
        'defaults' => 'Organization Defaults',
        'departments' => 'Department Templates',
        'employees' => 'Employees & CTC',
        'compliance' => 'Compliance Toggles',
        'statutory' => 'Statutory Details',
        'pay_schedule' => 'Pay Schedule',
        'bank' => 'Bank & Payout',
        'test_run' => 'Test Run',
    ];

    /**
     * Get the payroll onboarding status for the current organization.
     * Drives the "Next Steps" card and the page-based setup flow.
     */
    public function status(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $org = Organization::find($organizationId);
        $payrollSettings = $org?->settings['payroll'] ?? [];

        $onboarded = (bool) ($payrollSettings['onboarded'] ?? false);
        $dismissedAt = $payrollSettings['onboarding_dismissed_at'] ?? null;
        $firstRunAt = $payrollSettings['first_run_completed_at'] ?? null;
        $firstFilingAt = $payrollSettings['first_filing_generated_at'] ?? null;

        // Count employees with valid CTC templates
        $totalEmployees = User::where('organization_id', $organizationId)
            ->whereIn('role', ['employee', 'manager', 'admin'])
            ->count();

        $employeesWithCtc = EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->where('annual_ctc', '>', 0)
            ->count();

        // Has any payroll run been processed?
        $hasRuns = PayrollMonthlyRun::where('organization_id', $organizationId)->exists();

        // Defaults configured
        $defaultsConfigured = ($payrollSettings['defaults_configured'] ?? false) === true;

        // Per-step completion state
        $completedSteps = $payrollSettings['setup_completed_steps'] ?? [];
        if (!is_array($completedSteps)) {
            $completedSteps = [];
        }

        // Compute per-step status
        $steps = [];
        foreach (self::SETUP_STEPS as $step) {
            $steps[$step] = $this->isStepDone(
                $step,
                $completedSteps,
                $payrollSettings,
                $defaultsConfigured,
                $employeesWithCtc,
                $totalEmployees,
                (bool) $firstRunAt
            );
        }

        // Next action (priority order)
        $nextAction = $this->resolveNextAction($steps, $totalEmployees);

        // Counts
        $completedCount = count(array_filter($steps, fn ($v) => $v === true));
        $totalCount = count(self::SETUP_STEPS);
        $completionPercentage = $totalCount > 0
            ? (int) round(($completedCount / $totalCount) * 100)
            : 0;

        return response()->json([
            'onboarded' => $onboarded,
            'dismissed_at' => $dismissedAt,
            'first_run_at' => $firstRunAt,
            'first_filing_at' => $firstFilingAt,
            'steps' => $steps,
            'completed_steps' => $completedSteps,
            'next_action' => $nextAction,
            'completion_percentage' => $completionPercentage,
            'completed_count' => $completedCount,
            'total_count' => $totalCount,
            'has_payroll_run' => $hasRuns,
            'has_filings' => !empty($firstFilingAt),
            'employees_with_ctc' => $employeesWithCtc,
            'employees_total' => $totalEmployees,
            'step_labels' => self::SETUP_STEP_LABELS,
        ]);
    }

    /**
     * Mark a setup step as complete (called when user clicks "Save & Continue" on a step page).
     */
    public function markSetupStep(Request $request): JsonResponse
    {
        $data = $request->validate([
            'step' => 'required|string|in:' . implode(',', self::SETUP_STEPS),
        ]);

        $organizationId = $request->user()->organization_id;
        $org = Organization::find($organizationId);
        if (!$org) {
            return response()->json(['message' => 'Organization not found'], 404);
        }

        $this->applyMarkSetupStep($org, $data['step']);

        return response()->json([
            'success' => true,
            'message' => "Step '{$data['step']}' marked complete",
            'completed_steps' => ($org->fresh()->settings['payroll']['setup_completed_steps'] ?? []),
        ]);
    }

    /**
     * Uncheck a setup step (used when user wants to redo a step).
     */
    public function unmarkSetupStep(Request $request): JsonResponse
    {
        $data = $request->validate([
            'step' => 'required|string|in:' . implode(',', self::SETUP_STEPS),
        ]);

        $organizationId = $request->user()->organization_id;
        $org = Organization::find($organizationId);
        if (!$org) {
            return response()->json(['message' => 'Organization not found'], 404);
        }

        $settings = $org->settings ?? [];
        $payroll = $settings['payroll'] ?? [];
        $completedSteps = $payroll['setup_completed_steps'] ?? [];
        $completedSteps = is_array($completedSteps) ? $completedSteps : [];
        $completedSteps = array_values(array_diff($completedSteps, [$data['step']]));
        $payroll['setup_completed_steps'] = $completedSteps;

        // Re-opening setup if test_run is unchecked
        if ($data['step'] === 'test_run') {
            $payroll['onboarded'] = false;
        }

        $settings['payroll'] = $payroll;
        $org->settings = $settings;
        $org->save();

        return response()->json([
            'success' => true,
            'message' => "Step '{$data['step']}' unmarked",
            'completed_steps' => $completedSteps,
        ]);
    }

    /**
     * Mark the org-level defaults as configured (legacy endpoint, still used by some flows).
     */
    public function markDefaultsConfigured(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $org = Organization::find($organizationId);
        if (!$org) {
            return response()->json(['message' => 'Organization not found'], 404);
        }

        $settings = $org->settings ?? [];
        $settings['payroll'] = array_merge($settings['payroll'] ?? [], [
            'defaults_configured' => true,
            'defaults_configured_at' => now()->toIso8601String(),
        ]);
        $org->settings = $settings;
        $org->save();

        return response()->json(['success' => true, 'message' => 'Defaults marked as configured']);
    }

    /**
     * Dismiss the onboarding (user chose to skip).
     */
    public function dismiss(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $org = Organization::find($organizationId);
        if (!$org) {
            return response()->json(['message' => 'Organization not found'], 404);
        }

        $settings = $org->settings ?? [];
        $settings['payroll'] = array_merge($settings['payroll'] ?? [], [
            'onboarded' => true,
            'onboarding_dismissed_at' => now()->toIso8601String(),
        ]);
        $org->settings = $settings;
        $org->save();

        return response()->json(['success' => true, 'message' => 'Onboarding dismissed']);
    }

    /**
     * Re-open the onboarding (user wants to redo setup).
     */
    public function reopen(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $org = Organization::find($organizationId);
        if (!$org) {
            return response()->json(['message' => 'Organization not found'], 404);
        }

        $settings = $org->settings ?? [];
        $settings['payroll'] = array_merge($settings['payroll'] ?? [], [
            'onboarded' => false,
            'onboarding_dismissed_at' => null,
        ]);
        $org->settings = $settings;
        $org->save();

        return response()->json(['success' => true, 'message' => 'Onboarding re-opened']);
    }

    /**
     * Legacy endpoint for the old 3-step wizard.
     */
    public function completeStep(Request $request): JsonResponse
    {
        $data = $request->validate([
            'step' => 'required|in:welcome,defaults,first_employee,test_calculation,completed',
        ]);

        $organizationId = $request->user()->organization_id;
        $org = Organization::find($organizationId);
        if (!$org) {
            return response()->json(['message' => 'Organization not found'], 404);
        }

        // Map old wizard steps to new setup steps
        $stepMapping = [
            'welcome' => 'welcome',
            'defaults' => 'defaults',
            'first_employee' => 'employees',
            'test_calculation' => 'test_run',
            'completed' => 'test_run',
        ];

        return $this->applyMarkSetupStep($org, $stepMapping[$data['step']] ?? 'welcome');
    }

    /**
     * Internal helper that marks a setup step on an org and saves.
     */
    private function applyMarkSetupStep(Organization $org, string $step): JsonResponse
    {
        $settings = $org->settings ?? [];
        $payroll = $settings['payroll'] ?? [];
        $completedSteps = $payroll['setup_completed_steps'] ?? [];
        if (!is_array($completedSteps)) {
            $completedSteps = [];
        }
        if (!in_array($step, $completedSteps, true)) {
            $completedSteps[] = $step;
        }
        $payroll['setup_completed_steps'] = $completedSteps;

        if ($step === 'test_run') {
            $payroll['onboarded'] = true;
            $payroll['onboarded_at'] = now()->toIso8601String();
        }

        $settings['payroll'] = $payroll;
        $org->settings = $settings;
        $org->save();

        return response()->json([
            'success' => true,
            'message' => "Step '{$step}' marked complete",
            'completed_steps' => $completedSteps,
        ]);
    }

    /**
     * Mark welcome as seen (called when user opens setup for the first time).
     */
    public function markWelcomeSeen(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $org = Organization::find($organizationId);
        if (!$org) {
            return response()->json(['message' => 'Organization not found'], 404);
        }

        $settings = $org->settings ?? [];
        $payroll = $settings['payroll'] ?? [];
        if (empty($payroll['welcome_seen_at'])) {
            $payroll['welcome_seen_at'] = now()->toIso8601String();
        }
        $settings['payroll'] = $payroll;
        $org->settings = $settings;
        $org->save();

        return response()->json(['success' => true, 'message' => 'Welcome marked as seen']);
    }

    /**
     * Determine if a step is done.
     */
    private function isStepDone(
        string $step,
        array $completedSteps,
        array $payrollSettings,
        bool $defaultsConfigured,
        int $employeesWithCtc,
        int $totalEmployees,
        bool $firstRunCompleted
    ): bool {
        // Steps that are explicitly tracked via completed_steps
        if (in_array($step, $completedSteps, true)) {
            return true;
        }

        // Auto-detected steps
        switch ($step) {
            case 'welcome':
                // Welcome is done once user opens the setup at all
                return !empty($payrollSettings['welcome_seen_at'] ?? null);
            case 'defaults':
                return $defaultsConfigured;
            case 'employees':
                return $totalEmployees > 0 && $employeesWithCtc >= $totalEmployees;
            case 'test_run':
                return $firstRunCompleted;
            default:
                return false;
        }
    }

    /**
     * Decide what the user should do next based on the current state.
     */
    private function resolveNextAction(array $steps, int $totalEmployees): string
    {
        $order = ['welcome', 'defaults', 'departments', 'employees', 'compliance', 'statutory', 'pay_schedule', 'bank', 'test_run'];
        foreach ($order as $step) {
            if (!($steps[$step] ?? false)) {
                return $step;
            }
        }
        return 'all_done';
    }
}