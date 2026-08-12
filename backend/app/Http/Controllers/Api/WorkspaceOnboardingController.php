<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithApiResponses;
use App\Http\Controllers\Controller;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Billing\CompanyProfileService;
use App\Services\Billing\PlanService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The workspace setup checklist a new owner lands on.
 *
 * Modelled on PayrollOnboardingController, which already works and has the
 * right shape. Two things carried over deliberately:
 *
 *  - completion is *derived* from real data wherever it can be. A step that
 *    depends on somebody remembering to tick a box is a step that reads as
 *    incomplete forever, which is worse than not having the checklist.
 *  - state lives in the organization's settings JSON under its own key, exactly
 *    parallel to settings['payroll'], so nothing new is needed in the schema.
 *
 * When the plan grants payroll, the payroll setup steps are appended by reusing
 * PayrollOnboardingController's own step list. That is what finally makes the
 * nine-page /payroll/setup wizard reachable — until now nothing in the app
 * linked to it.
 */
class WorkspaceOnboardingController extends Controller
{
    use InteractsWithApiResponses;

    private const SETTINGS_KEY = 'workspace_setup';

    /** Steps every workspace gets, in the order they should be done. */
    public const SETUP_STEPS = [
        'complete_profile',
        'complete_company_profile',
        'invite_team',
        'install_tracker',
        'working_hours',
        'leave_policy',
        'first_timesheet',
    ];

    public const SETUP_STEP_LABELS = [
        'complete_profile' => 'Complete your profile',
        'complete_company_profile' => 'Complete your company profile',
        'invite_team' => 'Invite your team',
        'install_tracker' => 'Install the desktop tracker',
        'working_hours' => 'Set your working hours',
        'leave_policy' => 'Set your leave policy',
        'first_timesheet' => 'Approve your first timesheet',
    ];

    /** Where each step sends the user. */
    public const SETUP_STEP_ROUTES = [
        'complete_profile' => '/onboarding/profile',
        'complete_company_profile' => '/settings?pane=organization',
        'invite_team' => '/employees/add',
        'install_tracker' => '/settings?pane=browser-tracking',
        'working_hours' => '/settings?pane=organization',
        'leave_policy' => '/settings?pane=organization',
        'first_timesheet' => '/attendance',
    ];

    /**
     * The personal-profile fields that count as "complete".
     *
     * The same list ProtectedRoute used to enforce as a redirect gate. It is
     * still the definition of a finished profile — it just asks now instead of
     * blocking.
     */
    private const PROFILE_FIELDS = [
        'first_name', 'last_name', 'display_name', 'gender', 'date_of_birth',
        'phone', 'personal_email', 'address_line', 'city', 'state',
        'postal_code', 'emergency_contact_name', 'emergency_contact_number',
        'emergency_contact_relationship',
    ];

    public function __construct(
        private readonly CompanyProfileService $companyProfile,
    ) {
    }

    public function status(Request $request): JsonResponse
    {
        $user = $request->user();
        $organization = $user?->organization;

        if (!$organization) {
            return $this->errorResponse('No organization found.', 404);
        }

        $state = $this->state($organization);
        $completedSteps = $state['completed_steps'];

        $steps = [];
        foreach (self::SETUP_STEPS as $step) {
            $steps[$step] = $this->isStepDone($step, $organization, $user, $completedSteps);
        }

        $labels = self::SETUP_STEP_LABELS;
        $routes = self::SETUP_STEP_ROUTES;

        // Payroll setup is part of getting the workspace ready, but only for a
        // plan that grants payroll — a Tracker trial has no use for a pay
        // schedule and would just see six steps it can never finish.
        $includesPayroll = PlanService::hasFeature($organization, 'payroll');
        if ($includesPayroll) {
            $payrollSettings = is_array($organization->settings['payroll'] ?? null)
                ? $organization->settings['payroll']
                : [];
            $payrollDone = is_array($payrollSettings['setup_completed_steps'] ?? null)
                ? $payrollSettings['setup_completed_steps']
                : [];
            $payrollOnboarded = (bool) ($payrollSettings['onboarded'] ?? false);

            foreach (PayrollOnboardingController::SETUP_STEPS as $payrollStep) {
                if ($payrollStep === 'welcome') {
                    continue;
                }

                $key = 'payroll_' . $payrollStep;
                $steps[$key] = $payrollOnboarded || in_array($payrollStep, $payrollDone, true);
                $labels[$key] = 'Payroll: ' . (PayrollOnboardingController::SETUP_STEP_LABELS[$payrollStep] ?? $payrollStep);
                $routes[$key] = '/payroll/setup/' . str_replace('_', '-', $payrollStep);
            }
        }

        $completedCount = count(array_filter($steps));
        $totalCount = count($steps);

        return response()->json([
            'onboarded' => $completedCount === $totalCount,
            'dismissed_at' => $state['dismissed_at'],
            'tour_seen_at' => $state['tour_seen_at'],
            'steps' => $steps,
            'completed_steps' => $completedSteps,
            'step_labels' => $labels,
            'step_routes' => $routes,
            'includes_payroll' => $includesPayroll,
            'next_action' => $this->resolveNextAction($steps),
            'completed_count' => $completedCount,
            'total_count' => $totalCount,
            'completion_percentage' => $totalCount > 0
                ? (int) round(($completedCount / $totalCount) * 100)
                : 0,
        ]);
    }

    public function markStep(Request $request): JsonResponse
    {
        $data = $request->validate([
            'step' => 'required|string|in:' . implode(',', self::SETUP_STEPS),
        ]);

        $organization = $request->user()?->organization;
        if (!$organization) {
            return $this->errorResponse('No organization found.', 404);
        }

        $state = $this->state($organization);
        if (!in_array($data['step'], $state['completed_steps'], true)) {
            $state['completed_steps'][] = $data['step'];
        }

        $this->persist($organization, $state);

        return $this->successResponse([
            'completed_steps' => $state['completed_steps'],
        ], "Step '{$data['step']}' marked complete.");
    }

    public function dismiss(Request $request): JsonResponse
    {
        $organization = $request->user()?->organization;
        if (!$organization) {
            return $this->errorResponse('No organization found.', 404);
        }

        $state = $this->state($organization);
        $state['dismissed_at'] = now()->toIso8601String();
        $this->persist($organization, $state);

        return $this->successResponse([
            'dismissed_at' => $state['dismissed_at'],
        ], 'Setup checklist hidden. You can bring it back from Settings.');
    }

    public function reopen(Request $request): JsonResponse
    {
        $organization = $request->user()?->organization;
        if (!$organization) {
            return $this->errorResponse('No organization found.', 404);
        }

        $state = $this->state($organization);
        $state['dismissed_at'] = null;
        $this->persist($organization, $state);

        return $this->successResponse(['dismissed_at' => null], 'Setup checklist restored.');
    }

    /**
     * Record that the guided tour has been seen.
     *
     * Written on finish *and* on skip: someone who dismissed the tour has made a
     * decision, and re-opening it on their next login would be the same as not
     * having listened. It stays available from the checklist card.
     */
    public function markTourSeen(Request $request): JsonResponse
    {
        $organization = $request->user()?->organization;
        if (!$organization) {
            return $this->errorResponse('No organization found.', 404);
        }

        $state = $this->state($organization);
        $state['tour_seen_at'] = now()->toIso8601String();
        $this->persist($organization, $state);

        return $this->successResponse(['tour_seen_at' => $state['tour_seen_at']]);
    }

    private function isStepDone(string $step, Organization $organization, User $user, array $completedSteps): bool
    {
        // A manual tick always counts. Everything below is the derivation that
        // lets a step complete itself when the underlying thing is actually true.
        if (in_array($step, $completedSteps, true)) {
            return true;
        }

        return match ($step) {
            'complete_profile' => $this->hasCompleteProfile($user),
            'complete_company_profile' => $this->companyProfile->isComplete($organization),
            'invite_team' => User::where('organization_id', $organization->id)->count() > 1,
            'install_tracker' => $this->orgTimeEntries($organization)->exists(),
            'working_hours' => filled($organization->settings['attendance']['office_start_time'] ?? null),
            'leave_policy' => !empty($organization->settings['leave_policy']['categories'] ?? []),
            // A finished entry, not just a started timer — the step is about
            // having a timesheet worth looking at, not about the clock running.
            'first_timesheet' => $this->orgTimeEntries($organization)->whereNotNull('end_time')->exists(),
            default => false,
        };
    }

    /**
     * time_entries carries no organization_id — it is scoped through the user it
     * belongs to, the same way ReportController does it.
     */
    private function orgTimeEntries(Organization $organization)
    {
        return TimeEntry::whereIn(
            'user_id',
            User::where('organization_id', $organization->id)->select('id')
        );
    }

    private function hasCompleteProfile(User $user): bool
    {
        $profile = $user->employeeProfile;
        if (!$profile) {
            return false;
        }

        foreach (self::PROFILE_FIELDS as $field) {
            if (trim((string) ($profile->{$field} ?? '')) === '') {
                return false;
            }
        }

        return true;
    }

    private function resolveNextAction(array $steps): ?string
    {
        foreach ($steps as $step => $done) {
            if (!$done) {
                return $step;
            }
        }

        return null;
    }

    /** @return array{completed_steps: array<int, string>, dismissed_at: ?string, tour_seen_at: ?string} */
    private function state(Organization $organization): array
    {
        $stored = is_array($organization->settings[self::SETTINGS_KEY] ?? null)
            ? $organization->settings[self::SETTINGS_KEY]
            : [];

        return [
            'completed_steps' => is_array($stored['completed_steps'] ?? null)
                ? array_values($stored['completed_steps'])
                : [],
            'dismissed_at' => $stored['dismissed_at'] ?? null,
            'tour_seen_at' => $stored['tour_seen_at'] ?? null,
        ];
    }

    private function persist(Organization $organization, array $state): void
    {
        $settings = is_array($organization->settings) ? $organization->settings : [];
        $settings[self::SETTINGS_KEY] = $state;

        $organization->update(['settings' => $settings]);
    }
}
