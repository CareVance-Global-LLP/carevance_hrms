<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activity;
use App\Models\AppNotification;
use App\Models\AttendanceRecord;
use App\Models\DepartmentTeam;
use App\Models\AttendanceTimeEditRequest;
use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\LeaveRequest;
use App\Models\Payslip;
use App\Models\Project;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\Organization;
use App\Models\User;
use App\Models\OnboardingJourney;
use App\Services\Authorization\OrganizationRoleService;
use App\Services\Audit\AuditLogService;
use App\Services\Lifecycle\OnboardingService;
use App\Services\Reports\TimeBreakdownService;
use App\Services\Reports\UsageProcessingService;
use App\Services\TimeEntries\TimeEntryDurationService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class UserController extends Controller
{
    public function __construct(
        private readonly AuditLogService $auditLogService,
        private readonly TimeBreakdownService $timeBreakdownService,
        private readonly TimeEntryDurationService $timeEntryDurationService,
        private readonly OrganizationRoleService $organizationRoleService,
        private readonly UsageProcessingService $usageProcessingService,
        private readonly \App\Services\Monitoring\MonitoringSettingsResolver $monitoringSettingsResolver,
        private readonly OnboardingService $onboardingService,
    )
    {
    }

    public function index(Request $request)
    {
        $request->validate([
            'period' => 'nullable|in:today,week,all',
            'timezone' => 'nullable|string|max:64',
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date',
            'country' => 'nullable|string|max:64',
            'simple' => 'nullable',
            'directory' => 'nullable',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json([]);
        }

        $simple = $request->boolean('simple');

        // The organization tree is a company-wide directory: everyone from an
        // employee up to an admin sees the whole reporting structure, not just
        // the slice their hierarchy level normally exposes. It is forced onto
        // the `simple` payload so widening the audience can never leak the
        // detailed roster (government IDs, bank accounts, profile completeness)
        // that the unfiltered list carries.
        $directory = $request->boolean('directory');
        if ($directory) {
            $simple = true;
        }

        $users = User::where('organization_id', $currentUser->organization_id)
            ->with([
                'groups:id,name,slug',
                'employeeProfile',
                'employeeWorkInfo.department:id,name,slug',
                'customRole',
                'departmentTeamMemberships:id,name,department_id',
                'departmentTeamManagerships:id,name,department_id',
                // Profile completeness counts PAN, Aadhaar and a bank account
                // among its required fields, so the roster cannot tell who is
                // actually incomplete unless these two ship with the list.
                //
                // Neither carries its number. Completeness asks whether the fact
                // is ON FILE, which the row itself answers, and selecting
                // id_number here did two bad things: it put every employee's PAN
                // and Aadhaar into a list payload, and because the column is
                // `encrypted`, toArray() decrypted all of them — so one row that
                // would not decrypt returned 500 for the ENTIRE employee list
                // rather than degrading. A roster has no business reading PII it
                // only needs to count.
                'employeeGovernmentIds:id,user_id,id_type',
                'employeeBankAccounts:id,user_id',
            ])
            ->when(!$directory && $currentUser->getHierarchyLevel() > Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['admin'] && $currentUser->getHierarchyLevel() < Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['employee'], function ($query) use ($currentUser) {
                $visibleGroupIds = $this->groupIdsForUser($currentUser);
                $userLevel = $currentUser->getHierarchyLevel();

                return $query->where(function ($scopedQuery) use ($currentUser, $visibleGroupIds, $userLevel) {
                    $scopedQuery->where('id', $currentUser->id)
                        ->orWhere(function ($employeeQuery) use ($visibleGroupIds, $userLevel) {
                            $employeeQuery->where(function ($q) use ($userLevel) {
                                $q->whereHas('customRole', fn ($cr) => $cr->where('hierarchy_level', '>', $userLevel))
                                    ->orWhere(function ($q2) use ($userLevel) {
                                        $q2->whereNull('role_id')
                                            ->whereRaw("CASE role WHEN 'admin' THEN ? WHEN 'manager' THEN ? WHEN 'employee' THEN ? ELSE 999 END > ?", [
                                            Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['admin'],
                                            Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['manager'],
                                            Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['employee'],
                                            $userLevel
                                        ]);
                                    });
                            })->whereHas('groups', fn ($groupQuery) => $groupQuery->whereIn('groups.id', $visibleGroupIds));
                        });
                });
            })
            ->when(!$directory && $currentUser->getHierarchyLevel() >= Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['employee'], fn ($query) => $query->where('id', $currentUser->id))
            ->orderBy('created_at', 'desc')
            ->get();

        if ($simple) {
            return response()->json($users->map(function (User $user) {
                $departmentName = (string) (
                    $user->employeeWorkInfo?->department?->name
                    ?? $user->groups->first()?->name
                    ?? ''
                );

                return [
                    'id' => (int) $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'role' => $user->role,
                    'role_id' => $user->role_id,
                    'role_name' => $user->customRole?->name ?? ucfirst($user->role ?? 'employee'),
                    'role_color' => $user->customRole?->color ?? 'slate',
                    'hierarchy_level' => $user->customRole?->hierarchy_level ?? match ($user->role) {
                        'admin' => 10,
                        'manager' => 50,
                        'employee' => 100,
                        default => 100,
                    },
                    'reporting_manager_id' => $user->employeeWorkInfo?->reporting_manager_id
                        ? (int) $user->employeeWorkInfo->reporting_manager_id
                        : null,
                    'department' => trim($departmentName),
                    'department_id' => $user->employeeWorkInfo?->department?->id
                        ? (int) $user->employeeWorkInfo->department->id
                        : ($user->groups->first()?->id ? (int) $user->groups->first()->id : null),
                    'team' => $this->resolveOrgChartTeam($user),
                    'created_at' => $user->created_at?->toIsoString() ?? null,
                    'groups' => collect($user->groups)->map(fn ($group) => [
                        'id' => (int) $group->id,
                        'name' => $group->name,
                        'slug' => $group->slug,
                    ])->values(),
                ];
            })->values());
        }

        $period = $request->get('period', 'all');
        $timezone = (string) $request->get('timezone', config('app.timezone'));
        if (!in_array($timezone, timezone_identifiers_list(), true)) {
            $timezone = config('app.timezone');
        }

        $payload = $users->map(function (User $user) use ($timezone) {
            $departmentName = (string) (
                $user->employeeWorkInfo?->department?->name
                ?? $user->groups->first()?->name
                ?? ''
            );

            return array_merge($user->toArray(), [
                'department' => trim($departmentName),
                'timezone' => $timezone,
                'role_name' => $user->customRole?->name ?? ucfirst($user->role ?? 'employee'),
                'role_color' => $user->customRole?->color ?? 'slate',
                'hierarchy_level' => $user->customRole?->hierarchy_level ?? match ($user->role) {
                    'admin' => 10,
                    'manager' => 50,
                    'employee' => 100,
                    default => 100,
                },
            ]);
        });

        return response()->json($payload);
    }

    /**
     * A temporary password that would itself pass the policy it hands over.
     *
     * `Str::random(12)` was alphanumeric, and being minted after validation it
     * bypassed the rules entirely — so the credential an admin reads out to a
     * new joiner could not have been typed into the very form that accepts it.
     * That asymmetry is its own support question.
     *
     * Built by construction rather than by generate-and-check: one character
     * drawn from each required class, the remainder from the full set, then
     * shuffled so the guaranteed characters are not always in the same
     * positions. `random_int` throughout, because `rand()` is not suitable for
     * anything somebody logs in with.
     */
    private static function generateTemporaryPassword(int $length = 16): string
    {
        $lower = 'abcdefghijkmnpqrstuvwxyz';
        $upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        // No 0/O/1/l/I anywhere above or here: this gets read aloud or typed
        // from a note, and a password nobody can transcribe is a reset request.
        $digits = '23456789';
        $symbols = '!@#$%^&*?-_';

        $pool = $lower.$upper.$digits.$symbols;

        $characters = [
            $lower[random_int(0, strlen($lower) - 1)],
            $upper[random_int(0, strlen($upper) - 1)],
            $digits[random_int(0, strlen($digits) - 1)],
            $symbols[random_int(0, strlen($symbols) - 1)],
        ];

        for ($i = count($characters); $i < $length; $i++) {
            $characters[] = $pool[random_int(0, strlen($pool) - 1)];
        }

        for ($i = count($characters) - 1; $i > 0; $i--) {
            $j = random_int(0, $i);
            [$characters[$i], $characters[$j]] = [$characters[$j], $characters[$i]];
        }

        return implode('', $characters);
    }

    public function store(Request $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if ($request->exists('department_ids')) {
            $departmentIds = $request->input('department_ids');

            if (! $request->exists('group_ids')) {
                $request->merge([
                    'group_ids' => $departmentIds,
                ]);
            } elseif (is_array($request->input('group_ids')) && is_array($departmentIds)) {
                $request->merge([
                    'group_ids' => array_values(array_unique(array_merge($request->input('group_ids'), $departmentIds))),
                ]);
            }
        }

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|string|email|max:255|unique:users,email',
            'phone' => 'nullable|string|max:64',
            'role' => 'nullable|in:admin,manager,employee,client',
            /*
             * The same policy the rest of the app enforces.
             *
             * This was a hardcoded `min:8`, which quietly made the admin-set
             * temporary password the weakest credential the system accepts: an
             * invited joiner setting their own password goes through
             * Password::defaults() — in production 12 characters, mixed case,
             * numbers, symbols and a breach check — while an admin creating the
             * same person here could set eight lowercase letters. A password
             * handed over by a third party should be held to a higher bar than
             * one the owner chooses, not a lower one.
             */
            'password' => ['nullable', 'string', Password::defaults()],
            'settings' => 'nullable|array',
            /*
             * Derived from config, never restated. A literal list here is how a
             * value the resolver will not honour reaches storage: it validates,
             * saves, reads back into the admin UI, and is then silently dropped
             * at capture time in favour of the inherited interval.
             */
            'settings.monitoring_interval_minutes' => ['nullable', 'integer', Rule::in($this->monitoringSettingsResolver->allowedIntervals())],
            'settings.can_edit_time' => 'nullable|boolean',
            'settings.attendance_monitoring' => 'nullable|boolean',
            'settings.payroll_visibility' => 'nullable|boolean',
            'settings.task_assignment_access' => 'nullable|boolean',
            'group_ids' => 'nullable|array',
            'group_ids.*' => 'integer',
            // Onboarding context. Optional, because a user can be created by
            // routes that know nothing about hiring, but supplying the joining
            // date is what lets the checklist anchor on the right day rather
            // than on whenever the record happened to be typed in.
            'joining_date' => 'nullable|date',
            'designation' => 'nullable|string|max:255',
            'manager_id' => 'nullable|integer|exists:users,id',
            'buddy_id' => 'nullable|integer|exists:users,id',
            'skip_onboarding_journey' => 'nullable|boolean',
        ]);

        $selectedRole = $validated['role'] ?? 'employee';
        $this->organizationRoleService->assertCanAssignRole($currentUser, $selectedRole);

        // The seat cap, enforced. It existed as a column and a price for a long
        // time without anything checking it before creating a user, which is how
        // workspaces ended up well past what they pay for. Enforcement is
        // forward-only: nobody already here is affected.
        app(\App\Services\Billing\SeatGuard::class)
            ->assertCanAdd($currentUser->organization, 1);

        $normalizedSettings = array_key_exists('settings', $validated)
            ? $this->normalizeUserSettings($validated['settings'] ?? [], $selectedRole)
            : null;

        // An admin creating a user directly has typed the address and set the
        // password, and hands both to the joiner. Treat the address as verified
        // so those credentials actually work.
        //
        // Without this the account is created unverified and login is refused
        // with EMAIL_NOT_VERIFIED, and nothing on this path ever sends a
        // verification mail — so the only way in used to be the legacy invite
        // email, which has been removed. An admin-created user with no password
        // and no verified address cannot sign in at all.
        //
        // Invited users are not covered by this: they verify through the
        // invitation they accepted, which is what proves they hold the address.
        $suppliedPassword = $validated['password'] ?? null;

        $user = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'phone' => $validated['phone'] ?? null,
            'password' => Hash::make($suppliedPassword ?? self::generateTemporaryPassword()),
            'role' => $selectedRole,
            'organization_id' => $currentUser->organization_id,
            'settings' => $normalizedSettings,
            'email_verified_at' => $suppliedPassword !== null ? now() : null,
        ]);

        // Auto-create EmployeeProfile so work-info endpoint works
        $user->employeeProfile()->create([
            'organization_id' => $currentUser->organization_id,
        ]);

        if (array_key_exists('group_ids', $validated)) {
            $groupIds = Group::where('organization_id', $currentUser->organization_id)
                ->whereIn('id', $validated['group_ids'] ?? [])
                ->pluck('id')
                ->all();

            $this->assertSingleGroupMembershipLimit($selectedRole, $groupIds);
            $user->groups()->sync($groupIds);
            $this->syncPrimaryGroup($user, $groupIds, []);
        }

        // Eagerly create payroll template with default salary structure
        \App\Models\EmployeePayrollTemplate::getOrCreateForUser(
            $user->id,
            $currentUser->organization_id,
            $currentUser->id
        );

        $journey = $this->openOnboardingJourney($user, $currentUser, $validated);

        $this->auditLogService->log(
            action: 'user.created',
            actor: $currentUser,
            target: $user,
            metadata: [
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role,
                'onboarding_journey_id' => $journey?->id,
            ],
            request: $request
        );

        $payload = $user->load('groups:id,name,slug')->toArray();
        $payload['onboarding_journey_id'] = $journey?->id;

        return response()->json($payload, 201);
    }

    /**
     * Start the new joiner's onboarding checklist.
     *
     * Hiring someone is the event that should open their journey — the document
     * collection and equipment provisioning that decide whether Day 1 works are
     * scheduled relative to the joining date, several of them before it. Doing
     * this here rather than in the client means every route that creates an
     * employee gets a journey, not just the one wizard that remembers to ask.
     *
     * Never allowed to fail the hire: an employee who exists without a checklist
     * is recoverable, a checklist without an employee is not.
     */
    private function openOnboardingJourney(User $user, User $creator, array $validated): ?OnboardingJourney
    {
        if ($validated['skip_onboarding_journey'] ?? false) {
            return null;
        }

        // Clients are not employees and have nothing to onboard.
        if (($user->role ?? 'employee') === 'client') {
            return null;
        }

        try {
            // Shared with the invite, link and CSV paths. Idempotency lives in
            // ensureForUser(), so a second call for the same person cannot
            // produce a second checklist.
            return $this->onboardingService->ensureForUser(
                user: $user,
                creator: $creator,
                attributes: [
                    'job_title' => $validated['designation'] ?? null,
                    'group_id' => $user->groups()->first()?->id,
                    'manager_id' => $validated['manager_id'] ?? $user->employeeWorkInfo?->reporting_manager_id,
                    'buddy_id' => $validated['buddy_id'] ?? null,
                ],
                joiningDate: Carbon::parse($validated['joining_date'] ?? now()),
            );
        } catch (\Throwable $e) {
            Log::error('Could not open onboarding journey for new hire', [
                'user_id' => $user->id,
                'organization_id' => $user->organization_id,
                'exception' => $e->getMessage(),
            ]);

            return null;
        }
    }

    public function export(Request $request)
    {
        $request->validate([
            'user_ids' => 'nullable|array',
            'user_ids.*' => 'integer',
            'department' => 'nullable|string|max:255',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        // Reuse same query logic as index() — scope to org, eager load relations
        $query = User::where('organization_id', $currentUser->organization_id)
            ->with([
                'groups:id,name,slug',
                'employeeProfile',
                'employeeWorkInfo.department:id,name,slug',
                'customRole',
            ]);

        // Filter by specific user IDs if provided
        if ($request->filled('user_ids')) {
            $query->whereIn('id', $request->input('user_ids'));
        }

        // Filter by department name if provided
        $departmentFilter = $request->input('department');
        if ($departmentFilter && $departmentFilter !== 'All departments') {
            /*
             * The two whereHas clauses must be wrapped. Left unwrapped, the
             * orWhereHas ORs against the whole builder — including the
             * organization_id constraint above — so filtering by a department
             * name returned matching users from *other* organizations.
             */
            $query->where(function ($outer) use ($departmentFilter) {
                $outer->whereHas('employeeWorkInfo.department', function ($q) use ($departmentFilter) {
                    $q->where('name', $departmentFilter);
                })->orWhereHas('groups', function ($q) use ($departmentFilter) {
                    $q->where('name', $departmentFilter);
                });
            });
        }

        $users = $query->orderBy('name', 'asc')->get();

        // Build CSV
        $headers = [
            'Employee Code',
            'Name',
            'Email',
            'Role',
            'Department',
            'Timezone',
            'Phone',
            'Designation',
            'Employment Type',
            'Joining Date',
            'Employment Status',
            'Work Location',
        ];

        $callback = function () use ($users, $headers) {
            $file = fopen('php://output', 'w');
            fputcsv($file, $headers);

            foreach ($users as $user) {
                $employeeCode = $user->employeeWorkInfo?->employee_code ?? '';
                $roleName = $user->customRole?->name ?? ucfirst($user->role ?? 'employee');
                $department = trim((string) (
                    $user->employeeWorkInfo?->department?->name
                    ?? $user->groups->first()?->name
                    ?? ''
                ));
                $timezone = ($user->settings['timezone'] ?? null)
                    ? $user->settings['timezone']
                    : config('app.timezone');
                $phone = $user->employeeProfile?->phone ?? '';
                $designation = $user->employeeWorkInfo?->designation ?? '';
                $employmentType = $user->employeeWorkInfo?->employment_type ?? '';
                $joiningDate = $user->employeeWorkInfo?->joining_date
                    ? $user->employeeWorkInfo->joining_date->format('Y-m-d')
                    : '';
                $employmentStatus = $user->employeeWorkInfo?->employment_status ?? '';
                $workLocation = $user->employeeWorkInfo?->work_location ?? '';

                fputcsv($file, [
                    $employeeCode,
                    $user->name,
                    $user->email,
                    $roleName,
                    $department,
                    $timezone,
                    $phone,
                    $designation,
                    $employmentType,
                    $joiningDate,
                    $employmentStatus,
                    $workLocation,
                ]);
            }

            fclose($file);
        };

        $fileName = 'employees-' . now()->format('Y-m-d') . '.csv';

        return response()->stream($callback, 200, [
            'Content-Type' => 'text/csv',
            'Content-Disposition' => 'attachment; filename="' . $fileName . '"',
            'Cache-Control' => 'no-cache, no-store, must-revalidate',
            'Pragma' => 'no-cache',
            'Expires' => '0',
        ]);
    }

    public function show(Request $request, User $user)
    {
        if (!$this->canAccessUser($request, $user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $user->load(['groups:id,name,slug', 'employeeWorkInfo']);

        $workInfo = $user->employeeWorkInfo;

        return response()->json(array_merge(
            $user->toArray(),
            [
                'phone' => $user->phone,
                'employee_code' => $workInfo?->employee_code,
                'designation' => $workInfo?->designation,
                'joining_date' => $workInfo?->joining_date,
                'work_location' => $workInfo?->work_location ?? $workInfo?->work_mode,
                'department_ids' => $user->groups->pluck('id')->toArray(),
            ]
        ));
    }

    public function update(Request $request, User $user)
    {
        if (!$this->canAccessUser($request, $user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        if ($request->exists('department_ids')) {
            $departmentIds = $request->input('department_ids');

            if (! $request->exists('group_ids')) {
                $request->merge([
                    'group_ids' => $departmentIds,
                ]);
            } elseif (is_array($request->input('group_ids')) && is_array($departmentIds)) {
                $request->merge([
                    'group_ids' => array_values(array_unique(array_merge($request->input('group_ids'), $departmentIds))),
                ]);
            }
        }

        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'email' => 'sometimes|string|email|max:255|unique:users,email,' . $user->id,
            'role' => 'sometimes|in:admin,manager,employee,client',
            'role_id' => 'nullable|integer|exists:roles,id',
            'settings' => 'nullable|array',
            /*
             * Derived from config, never restated. A literal list here is how a
             * value the resolver will not honour reaches storage: it validates,
             * saves, reads back into the admin UI, and is then silently dropped
             * at capture time in favour of the inherited interval.
             */
            'settings.monitoring_interval_minutes' => ['nullable', 'integer', Rule::in($this->monitoringSettingsResolver->allowedIntervals())],
            'settings.can_edit_time' => 'nullable|boolean',
            'settings.attendance_monitoring' => 'nullable|boolean',
            'settings.payroll_visibility' => 'nullable|boolean',
            'settings.task_assignment_access' => 'nullable|boolean',
            'employee_work_info' => 'nullable|array',
            'employee_work_info.expected_start_time' => 'nullable|date_format:H:i',
            'employee_work_info.expected_timezone' => 'nullable|string|max:255|timezone',
            'group_ids' => 'nullable|array',
            'group_ids.*' => 'integer',
        ]);

        if (array_key_exists('role', $validated)) {
            $actor = $request->user();
            $isSelfRoleChange = $actor && (int) $actor->id === (int) $user->id;

            // When assigning a default string role, clear any custom role_id
            $validated['role_id'] = null;

            if ($actor?->getHierarchyLevel() > Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['admin'] && $actor?->getHierarchyLevel() < Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['employee']) {
                throw ValidationException::withMessages([
                    'role' => ['Managers are not allowed to change user roles.'],
                ]);
            }

            if ($isSelfRoleChange && $actor->getHierarchyLevel() <= Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['admin'] && $validated['role'] !== 'admin') {
                throw ValidationException::withMessages([
                    'role' => ['Admin users cannot demote themselves.'],
                ]);
            }

            $this->organizationRoleService->assertCanAssignRole($actor, $validated['role']);
        }

        $originalRole = $user->role;
        $originalAttributes = $user->only(['name', 'email', 'role', 'settings']);

        $nextRole = $validated['role'] ?? $user->role;
        if (array_key_exists('settings', $validated)) {
            $validated['settings'] = $this->normalizeUserSettings(
                array_merge($user->settings ?? [], $validated['settings'] ?? []),
                $nextRole
            );
        } elseif (array_key_exists('role', $validated)) {
            $validated['settings'] = $this->normalizeUserSettings($user->settings ?? [], $nextRole);
        }

        $updatable = collect($validated)
            ->except(['group_ids', 'employee_work_info'])
            ->all();
        $user->update($updatable);

        if (array_key_exists('employee_work_info', $validated)) {
            $workInfoData = $validated['employee_work_info'];
            $user->employeeWorkInfo()->updateOrCreate(
                ['user_id' => $user->id],
                $workInfoData
            );
        }

        if (array_key_exists('group_ids', $validated)) {
            $this->organizationRoleService->assertCanAssignRole($request->user(), $user->role, 'group_ids');

            $groupIds = Group::where('organization_id', $user->organization_id)
                ->whereIn('id', $validated['group_ids'] ?? [])
                ->pluck('id')
                ->all();

            $this->assertSingleGroupMembershipLimit($user->role, $groupIds);
            $previousGroupIds = $user->groups()->pluck('groups.id')->map(fn ($id) => (int) $id)->all();
            $user->groups()->sync($groupIds);
            $this->syncPrimaryGroup($user, $groupIds, $previousGroupIds);
        }

        $this->auditLogService->log(
            action: 'user.updated',
            actor: $request->user(),
            target: $user,
            metadata: [
                'changed_fields' => array_keys($validated),
                'before' => $originalAttributes,
                'after' => $user->only(['name', 'email', 'role', 'settings']),
            ],
            request: $request
        );

        if (array_key_exists('role', $validated) && $validated['role'] !== $originalRole) {
            $this->auditLogService->log(
                action: 'user.role_changed',
                actor: $request->user(),
                target: $user,
                metadata: [
                    'from' => $originalRole,
                    'to' => $validated['role'],
                ],
                request: $request
            );
        }

        return response()->json($user->load('groups:id,name,slug'));
    }

    public function destroy(Request $request, User $user)
    {
        if (!$this->canDeleteUsers($request->user()) || !$this->canAccessUser($request, $user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if ($request->user()?->id === $user->id) {
            return response()->json(['message' => 'You cannot delete your own account from user management.'], 422);
        }

        $deletedUserSnapshot = $user->only(['name', 'email', 'role']);
        $this->auditLogService->log(
            action: 'user.deleted',
            actor: $request->user(),
            target: $user,
            metadata: $deletedUserSnapshot,
            request: $request
        );

        $user->delete();
        return response()->json(['message' => 'User deleted']);
    }

    public function stats(Request $request, int $id)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $user = User::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$user) {
            return response()->json(['message' => 'User not found'], 404);
        }
        if (!$this->canAccessUser($request, $user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $query = TimeEntry::where('user_id', $user->id);
        if ($request->start_date) {
            $query->whereDate('start_time', '>=', $request->start_date);
        }
        if ($request->end_date) {
            $query->whereDate('start_time', '<=', $request->end_date);
        }

        $entries = $query->get();
        $resolvedNow = now();
        $activityQuery = Activity::where('user_id', $user->id);
        if ($request->start_date) {
            $activityQuery->whereDate('recorded_at', '>=', $request->start_date);
        }
        if ($request->end_date) {
            $activityQuery->whereDate('recorded_at', '<=', $request->end_date);
        }

        $activities = $activityQuery->get(['id', 'user_id', 'time_entry_id', 'type', 'name', 'duration', 'recorded_at']);
        $activityTotalDuration = (int) $activities->sum('duration');
        $manualAdjustmentDuration = (int) AttendanceRecord::query()
            ->where('user_id', $user->id)
            ->when($request->start_date, fn ($query, $startDate) => $query->whereDate('attendance_date', '>=', $startDate))
            ->when($request->end_date, fn ($query, $endDate) => $query->whereDate('attendance_date', '<=', $endDate))
            ->sum('manual_adjustment_seconds');
        $timeBreakdown = $this->timeBreakdownService->build(
            $this->timeEntryDurationService->sumEffectiveDuration($entries, $resolvedNow) + $manualAdjustmentDuration,
            $this->usageProcessingService->calculateIdleTime($activities),
            $activityTotalDuration,
        );

        return response()->json([
            'user_id' => $user->id,
            'entries_count' => $entries->count(),
            'total_hours' => round($timeBreakdown['total_duration'] / 3600, 2),
        ] + $timeBreakdown);
    }

    public function profile360(Request $request, int $id)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $user = User::query()
            ->where('organization_id', $currentUser->organization_id)
            ->with([
                'groups:id,name,slug',
                'employeeWorkInfo.department:id,name',
                'employeeWorkInfo.reportingManager:id,name,email',
            ])
            ->find($id);
        if (!$user) {
            return response()->json(['message' => 'User not found'], 404);
        }
        if (!$this->canAccessUser($request, $user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $startDate = $request->filled('start_date')
            ? Carbon::parse((string) $request->start_date)->startOfDay()
            : now()->startOfMonth();
        $endDate = $request->filled('end_date')
            ? Carbon::parse((string) $request->end_date)->endOfDay()
            : now()->endOfDay();
        if ($startDate->greaterThan($endDate)) {
            [$startDate, $endDate] = [$endDate->copy()->startOfDay(), $startDate->copy()->endOfDay()];
        }

        $entries = TimeEntry::with(['project:id,name,status,deadline', 'task:id,title,project_id'])
            ->where('user_id', $user->id)
            ->whereBetween('start_time', [$startDate, $endDate])
            ->orderByDesc('start_time')
            ->get();
        $resolvedNow = now();
        $entries->transform(function (TimeEntry $entry) use ($resolvedNow) {
            $entry->duration = $this->timeEntryDurationService->effectiveDuration($entry, $resolvedNow);

            return $entry;
        });

        $groupMembershipModels = $user->groups;
        $groupMemberships = $groupMembershipModels
            ->map(fn ($group) => [
                'id' => (int) $group->id,
                'name' => $group->name,
                'slug' => $group->slug,
            ])
            ->values();

        $workInfo = $user->employeeWorkInfo;
        $fallbackReportingManager = User::query()
            ->where('organization_id', $currentUser->organization_id)
            ->where(function ($q) {
                $q->whereHas('customRole', fn ($cr) => $cr->where('hierarchy_level', '<', 100)->where('hierarchy_level', '>', 10))
                    ->orWhere('role', 'manager');
            })
            ->whereHas('groups', fn ($query) => $query->whereIn('groups.id', $groupMembershipModels->pluck('id')))
            ->orderBy('name')
            ->first(['id', 'name', 'email']);
        $resolvedReportingManager = $workInfo?->reportingManager ?: $fallbackReportingManager;
        $assignedProjectIds = Task::query()
            ->where('assignee_id', $user->id)
            ->whereNotNull('project_id')
            ->distinct()
            ->pluck('project_id')
            ->map(fn ($projectId) => (int) $projectId)
            ->all();
        $trackedProjectIds = $entries
            ->map(function (TimeEntry $entry) {
                return (int) ($entry->project_id ?: $entry->task?->project_id ?: 0);
            })
            ->filter(fn (int $projectId) => $projectId > 0)
            ->unique()
            ->values()
            ->all();
        $allRelevantProjectIds = collect(array_merge($assignedProjectIds, $trackedProjectIds))
            ->filter(fn (int $projectId) => $projectId > 0)
            ->unique()
            ->values();
        $projectsById = Project::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereIn('id', $allRelevantProjectIds)
            ->get(['id', 'name', 'status', 'deadline'])
            ->keyBy('id');

        $projectBreakdown = $entries
            ->groupBy(function (TimeEntry $entry) {
                return (int) ($entry->project_id ?: $entry->task?->project_id ?: 0);
            })
            ->filter(fn ($groupedEntries, $projectId) => (int) $projectId > 0)
            ->map(function ($groupedEntries, $projectId) use ($projectsById) {
                $project = $projectsById->get((int) $projectId);
                if (!$project) {
                    return null;
                }

                $trackedDuration = (int) $groupedEntries->sum(fn (TimeEntry $entry) => (int) ($entry->duration ?? 0));
                $billableDuration = (int) $groupedEntries
                    ->filter(fn (TimeEntry $entry) => (bool) $entry->billable)
                    ->sum(fn (TimeEntry $entry) => (int) ($entry->duration ?? 0));

                return [
                    'project' => [
                        'id' => (int) $project->id,
                        'name' => $project->name,
                        'status' => $project->status,
                        'deadline' => optional($project->deadline)?->toDateString(),
                    ],
                    'entries_count' => $groupedEntries->count(),
                    'tracked_duration' => $trackedDuration,
                    'billable_duration' => $billableDuration,
                    'non_billable_duration' => max(0, $trackedDuration - $billableDuration),
                    'last_tracked_at' => optional($groupedEntries->sortByDesc('start_time')->first()?->start_time)?->toISOString(),
                ];
            })
            ->filter()
            ->sortByDesc('tracked_duration')
            ->values();

        $assignedProjects = $allRelevantProjectIds
            ->map(fn (int $projectId) => $projectsById->get($projectId))
            ->filter()
            ->map(fn (Project $project) => [
                'id' => (int) $project->id,
                'name' => $project->name,
                'status' => $project->status,
                'deadline' => optional($project->deadline)?->toDateString(),
            ])
            ->values();

        $attendanceSummaryRecords = AttendanceRecord::query()
            ->where('user_id', $user->id)
            ->whereDate('attendance_date', '>=', $startDate->toDateString())
            ->whereDate('attendance_date', '<=', $endDate->toDateString())
            ->orderByDesc('attendance_date')
            ->get();
        $attendanceRecords = $attendanceSummaryRecords->take(14)->values();

        $leaveRequests = LeaveRequest::query()
            ->with(['reviewer:id,name,email', 'revokeReviewer:id,name,email'])
            ->where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->limit(8)
            ->get();
        $approvedLeaveRequestsInRange = LeaveRequest::query()
            ->where('user_id', $user->id)
            ->where('status', 'approved')
            ->whereDate('end_date', '>=', $startDate->toDateString())
            ->whereDate('start_date', '<=', $endDate->toDateString())
            ->get(['start_date', 'end_date', 'leave_type']);

        $timeEditRequests = AttendanceTimeEditRequest::query()
            ->with('reviewer:id,name,email')
            ->where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->limit(8)
            ->get();
        $approvedTimeEditsSeconds = (int) AttendanceTimeEditRequest::query()
            ->where('user_id', $user->id)
            ->where('status', 'approved')
            ->whereDate('attendance_date', '>=', $startDate->toDateString())
            ->whereDate('attendance_date', '<=', $endDate->toDateString())
            ->sum('extra_seconds');

        $payslips = Payslip::query()
            ->where('user_id', $user->id)
            ->orderByDesc('period_month')
            ->limit(6)
            ->get();
        $payslipsCount = (int) Payslip::query()
            ->where('user_id', $user->id)
            ->whereBetween('period_month', [$startDate->format('Y-m'), $endDate->format('Y-m')])
            ->count();

        $latestNotification = AppNotification::query()
            ->where('organization_id', $currentUser->organization_id)
            ->where('user_id', $user->id)
            ->latest('created_at')
            ->first(['id', 'type', 'title', 'message', 'created_at', 'is_read']);

        $activities = Activity::query()
            ->where('user_id', $user->id)
            ->whereBetween('recorded_at', [$startDate, $endDate])
            ->get(['id', 'user_id', 'time_entry_id', 'type', 'name', 'duration', 'recorded_at']);
        $activityTotalDuration = (int) $activities->sum('duration');
        $manualAdjustmentDuration = (int) $attendanceSummaryRecords->sum(fn (AttendanceRecord $record) => (int) ($record->manual_adjustment_seconds ?? 0));
        $timeBreakdown = $this->timeBreakdownService->build(
            $this->timeEntryDurationService->sumEffectiveDuration($entries, $resolvedNow) + $manualAdjustmentDuration,
            $this->usageProcessingService->calculateIdleTime($activities),
            $activityTotalDuration,
        );
        $presentAttendanceDays = (int) $attendanceSummaryRecords
            ->filter(fn (AttendanceRecord $record) => !empty($record->check_in_at) || (int) ($record->worked_seconds ?? 0) > 0 || (int) ($record->manual_adjustment_seconds ?? 0) > 0)
            ->count();
        $absentAttendanceDays = (int) $attendanceSummaryRecords
            ->filter(fn (AttendanceRecord $record) => ($record->status ?? null) === 'absent')
            ->count();
        $lateAttendanceDays = (int) $attendanceSummaryRecords
            ->filter(fn (AttendanceRecord $record) => (int) ($record->late_minutes ?? 0) > 0)
            ->count();
        $approvedLeaveDays = round(
            (float) $approvedLeaveRequestsInRange
                ->sum(fn (LeaveRequest $leaveRequest) => $leaveRequest->effectiveUnitsInRange($startDate, $endDate)),
            2
        );

        $latestAttendance = $attendanceRecords->first();
        $activeEntry = TimeEntry::query()
            ->with(['project:id,name', 'task:id,title,project_id', 'task.project:id,name'])
            ->where('user_id', $user->id)
            ->whereNull('end_time')
            ->latest('start_time')
            ->first();

        return response()->json([
            'user' => $user,
            'range' => [
                'start_date' => $startDate->toDateString(),
                'end_date' => $endDate->toDateString(),
            ],
            'assignments' => [
                'groups' => $groupMemberships,
                'primary_group' => $workInfo?->department
                    ? [
                        'id' => (int) $workInfo->department->id,
                        'name' => $workInfo->department->name,
                    ]
                    : null,
                'reporting_manager' => $resolvedReportingManager
                    ? [
                        'id' => (int) $resolvedReportingManager->id,
                        'name' => $resolvedReportingManager->name,
                        'email' => $resolvedReportingManager->email,
                    ]
                    : null,
                'assigned_projects' => $assignedProjects,
            ],
            'summary' => [
                'entries_count' => $entries->count(),
                'attendance_days' => $attendanceSummaryRecords->count(),
                'present_days' => $presentAttendanceDays,
                'absent_days' => $absentAttendanceDays,
                'late_days' => $lateAttendanceDays,
                'approved_leave_days' => $approvedLeaveDays,
                'approved_time_edit_seconds' => $approvedTimeEditsSeconds,
                'payslips_count' => $payslipsCount,
            ] + $timeBreakdown,
            'status' => [
                'is_working' => (bool) $activeEntry,
                'current_task' => $activeEntry?->task?->title,
                'current_project' => $this->resolveCurrentProjectLabel($activeEntry),
                'current_timer_started_at' => $activeEntry?->start_time,
                'last_seen_at' => $user->last_seen_at,
                'latest_attendance' => $latestAttendance,
                'latest_notification' => $latestNotification,
            ],
            'recent_time_entries' => $entries->take(8)->values(),
            'project_breakdown' => $projectBreakdown,
            'attendance_records' => $attendanceRecords,
            'leave_requests' => $leaveRequests,
            'time_edit_requests' => $timeEditRequests,
            'payslips' => $payslips,
        ]);
    }

    public function groups(Request $request, User $user)
    {
        if (!$this->canAccessUser($request, $user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json([
            'data' => $user->groups()->orderBy('name')->get(['groups.id', 'groups.name', 'groups.slug']),
        ]);
    }

    private function canAccessUser(Request $request, User $user): bool
    {
        $currentUser = $request->user();
        if (!$currentUser || $currentUser->organization_id !== $user->organization_id) {
            return false;
        }

        if ($currentUser->getHierarchyLevel() <= Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['admin']) {
            return true;
        }

        if ($currentUser->id === $user->id) {
            return true;
        }

        if ($currentUser->getHierarchyLevel() < Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['employee']) {
            return $user->getHierarchyLevel() > $currentUser->getHierarchyLevel() && $this->usersShareAGroup($currentUser, $user);
        }

        return false;
    }

    private function canManageUsers(User $user): bool
    {
        return $user->getHierarchyLevel() < Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['employee'];
    }

    private function canDeleteUsers(?User $user): bool
    {
        return $user?->getHierarchyLevel() <= Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['admin'];
    }

    /**
     * @param array<string, mixed> $settings
     * @return array<string, mixed>
     */
    private function normalizeUserSettings(array $settings, string $role): array
    {
        // The monitoring interval is now an OVERRIDE, not a stamped value.
        // Absence of the key means "inherit the organization default", and this
        // method used to make that state unreachable by forcing a concrete
        // number on every single save.
        $settings = $this->monitoringSettingsResolver->normalizeUserOverride($settings);

        return array_merge($settings, [
            'attendance_monitoring' => array_key_exists('attendance_monitoring', $settings)
                ? filter_var($settings['attendance_monitoring'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false
                : true,
            'can_edit_time' => array_key_exists('can_edit_time', $settings)
                ? filter_var($settings['can_edit_time'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false
                : true,
            'payroll_visibility' => $role !== 'admin' && $role !== 'manager'
                ? false
                : (
                    array_key_exists('payroll_visibility', $settings)
                        ? filter_var($settings['payroll_visibility'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false
                        : true
                ),
            'task_assignment_access' => array_key_exists('task_assignment_access', $settings)
                ? filter_var($settings['task_assignment_access'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false
                : true,
        ]);
    }

    private function syncPrimaryGroup(User $user, array $groupIds, array $previousGroupIds = []): void
    {
        $primaryGroupId = $groupIds[0] ?? null;
        $resolver = app(\App\Services\Organization\ReportingManagerResolver::class);

        if ($user->getHierarchyLevel() >= Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['employee']) {
            // Derived only — and only when nobody has set the line by hand.
            $resolver->applyDerivedManager((int) $user->organization_id, (int) $user->id, $primaryGroupId);
        } else {
            // Managers and admins carry no reporting line from group membership.
            EmployeeWorkInfo::query()->updateOrCreate(
                ['organization_id' => $user->organization_id, 'user_id' => $user->id],
                ['report_group_id' => $primaryGroupId],
            );
        }

        if ($user->getHierarchyLevel() < Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['employee']) {
            collect(array_merge($previousGroupIds, $groupIds))
                ->filter(fn ($groupId) => (int) $groupId > 0)
                ->unique()
                ->each(fn ($groupId) => $this->syncEmployeesForGroup((int) $user->organization_id, (int) $groupId));
        }
    }

    private function assertSingleGroupMembershipLimit(string $role, array $groupIds): void
    {
        if ($role !== 'admin' && count($groupIds) > 1) {
            throw ValidationException::withMessages([
                'group_ids' => ['Managers and employees can belong to only one department at a time.'],
            ]);
        }
    }

    private function groupIdsForUser(User $user): array
    {
        return $user->groups()
            ->pluck('groups.id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    private function usersShareAGroup(User $leftUser, User $rightUser): bool
    {
        $leftGroupIds = $this->groupIdsForUser($leftUser);

        if (empty($leftGroupIds)) {
            return false;
        }

        return $rightUser->groups()
            ->whereIn('groups.id', $leftGroupIds)
            ->exists();
    }

    private function resolveGroupManagerId(?int $organizationId, ?int $groupId): ?int
    {
        // Shared with ReportGroupController — the two used to be separate
        // implementations that disagreed about whether an admin could be a
        // reporting manager.
        return app(\App\Services\Organization\ReportingManagerResolver::class)
            ->forGroup($organizationId, $groupId);
    }

    private function syncEmployeesForGroup(int $organizationId, int $groupId): void
    {
        $resolver = app(\App\Services\Organization\ReportingManagerResolver::class);
        $managerId = $resolver->forGroup($organizationId, $groupId);
        $employeeIds = $resolver->reportingMemberIds($organizationId, $groupId);

        foreach ($employeeIds as $employeeId) {
            EmployeeWorkInfo::query()->updateOrCreate(
                [
                    'organization_id' => $organizationId,
                    'user_id' => (int) $employeeId,
                ],
                [
                    'report_group_id' => $groupId,
                    'reporting_manager_id' => $managerId,
                ]
            );
        }
    }

    private function resolvePeriodRange(string $period, string $timezone, ?string $startDate = null, ?string $endDate = null): ?array
    {
        if ($startDate || $endDate) {
            $start = $startDate
                ? Carbon::parse($startDate, $timezone)->startOfDay()
                : now($timezone)->startOfDay();
            $end = $endDate
                ? Carbon::parse($endDate, $timezone)->endOfDay()
                : now($timezone)->endOfDay();

            if ($start->greaterThan($end)) {
                [$start, $end] = [$end->copy()->startOfDay(), $start->copy()->endOfDay()];
            }

            return [
                'start' => $start->clone()->utc(),
                'end' => $end->clone()->utc(),
            ];
        }

        $now = now($timezone);

        return match ($period) {
            'today' => [
                'start' => $now->copy()->startOfDay()->utc(),
                'end' => $now->copy()->endOfDay()->utc(),
            ],
            'week' => [
                'start' => $now->copy()->startOfWeek()->utc(),
                'end' => $now->copy()->endOfWeek()->utc(),
            ],
            default => null,
        };
    }

    /**
     * Check if an email belongs to an incomplete user (created but no profile)
     *
     * GET /api/users/check-incomplete?email=xxx
     */
    public function checkIncomplete(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
        ]);

        $email = strtolower(trim($request->email));

        $user = User::where('organization_id', $request->user()->organization_id)
            ->whereRaw('LOWER(email) = ?', [$email])
            ->first();

        if (! $user) {
            return response()->json([
                'exists' => false,
                'incomplete' => false,
            ]);
        }

        // Check completion status
        $hasProfile = false;

        try {
            $hasProfile = method_exists($user, 'employeeProfile')
                && $user->employeeProfile()->exists();
        } catch (\Exception $e) {}

        // Incomplete = no employee profile (Step 3 never completed)
        // Password and work_info can exist from Steps 1-2
        $incomplete = ! $hasProfile;

        return response()->json([
            'exists' => true,
            'incomplete' => $incomplete,
            'userId' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
        ]);
    }

    /**
     * Delete an incomplete/orphan user (no profile, no work info)
     *
     * DELETE /api/users/{id}/incomplete
     */
    public function deleteIncomplete(Request $request, $id)
    {
        // This method previously took only $id and had no route middleware, so
        // it could not check who was calling or which tenant they belonged to.
        // `User` is deliberately outside the organisation global scope, which
        // made `User::find($id)` a cross-tenant lookup — any authenticated user
        // could enumerate ids and delete accounts in other organisations.
        $currentUser = $request->user();

        if (! $currentUser) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $user = User::where('organization_id', $currentUser->organization_id)->find($id);

        if (! $user) {
            return response()->json(['message' => 'User not found'], 404);
        }

        // Only delete if incomplete (match checkIncomplete logic).
        //
        // The profile lookup is org-scoped by BelongsToOrganization, so for a
        // user in another tenant it used to return nothing, leaving $hasProfile
        // false and letting the delete proceed. Scoping the lookup above closes
        // that; the exception is no longer swallowed, because "we could not tell
        // whether this user has a profile" must never read as "safe to delete".
        $hasProfile = $user->employeeProfile()->exists();

        if ($hasProfile) {
            return response()->json([
                'message' => 'Cannot delete user with completed profile. Please contact support.',
            ], 400);
        }

        // Delete orphan work_info records too
        if ($user->employeeWorkInfo) {
            $user->employeeWorkInfo()->delete();
        }

        // Delete the orphan user
        $user->delete();

        return response()->json([
            'message' => 'Incomplete user removed. You can now try again.',
            'deleted' => true,
        ]);
    }

    private function resolveCurrentProjectLabel(?TimeEntry $entry): ?string
    {
        if (!$entry) {
            return null;
        }

        if ($entry->task && $entry->task->project) {
            return $entry->task->project->name;
        }

        if ($entry->project) {
            return $entry->project->name;
        }

        return null;
    }

    /**
     * Resolve a single org-chart team for a user.
     *
     * A user may belong to multiple teams via the members / managers pivot
     * tables. We pick deterministically: prefer a team whose department_id
     * equals the user's department_id; tie-break by manager over member,
     * then by lowest team id.
     */
    private function resolveOrgChartTeam(User $user): ?array
    {
        $departmentId = $user->employeeWorkInfo?->department?->id
            ? (int) $user->employeeWorkInfo->department->id
            : ($user->groups->first()?->id ? (int) $user->groups->first()->id : null);

        $candidates = collect();

        if ($user->relationLoaded('departmentTeamManagerships')) {
            foreach ($user->departmentTeamManagerships as $team) {
                $candidates->push([
                    'team' => $team,
                    'is_manager' => true,
                    'same_department' => $departmentId !== null && (int) $team->department_id === $departmentId,
                ]);
            }
        }

        if ($user->relationLoaded('departmentTeamMemberships')) {
            foreach ($user->departmentTeamMemberships as $team) {
                $candidates->push([
                    'team' => $team,
                    'is_manager' => false,
                    'same_department' => $departmentId !== null && (int) $team->department_id === $departmentId,
                ]);
            }
        }

        if ($candidates->isEmpty()) {
            return null;
        }

        $chosen = $candidates
            ->sort(function (array $a, array $b) {
                if ($a['same_department'] !== $b['same_department']) {
                    return $a['same_department'] ? -1 : 1;
                }
                if ($a['is_manager'] !== $b['is_manager']) {
                    return $a['is_manager'] ? -1 : 1;
                }
                return ($a['team']->id ?? 0) <=> ($b['team']->id ?? 0);
            })
            ->first();

        $team = $chosen['team'];

        return [
            'id' => (int) $team->id,
            'name' => (string) $team->name,
            'is_manager' => (bool) $chosen['is_manager'],
        ];
    }
}
