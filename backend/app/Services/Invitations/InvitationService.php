<?php

namespace App\Services\Invitations;

use App\Jobs\SendInvitationMail;
use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Services\Authorization\OrganizationRoleService;
use App\Services\Lifecycle\OnboardingService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class InvitationService
{
    public function __construct(
        private readonly OrganizationRoleService $organizationRoleService,
        private readonly InvitationUrlService $invitationUrlService,
        private readonly \App\Services\Monitoring\MonitoringSettingsResolver $monitoringSettingsResolver,
        private readonly OnboardingService $onboardingService,
    ) {
    }

    /**
     * Why an employee code cannot be used, or null when it is free.
     *
     * The code is the organisation's own identifier — it predates this system,
     * so it is never generated, only recorded. That makes uniqueness the only
     * guarantee worth enforcing, and it has to span two places: people already
     * in the system, and people invited but not yet through the door. Checking
     * only `employee_work_infos` lets two pending invitations claim the same
     * code and hands the collision to whoever accepts second.
     */
    public function employeeCodeConflict(
        int $organizationId,
        ?string $code,
        ?int $ignoreUserId = null,
        ?int $ignoreInvitationId = null
    ): ?string
    {
        $code = trim((string) $code);

        if ($code === '') {
            return null;
        }

        $takenByUser = EmployeeWorkInfo::query()
            ->where('organization_id', $organizationId)
            ->whereRaw('LOWER(employee_code) = ?', [mb_strtolower($code)])
            ->when($ignoreUserId, fn ($query) => $query->where('user_id', '!=', $ignoreUserId))
            ->exists();

        if ($takenByUser) {
            return "Employee code '{$code}' is already assigned to another employee.";
        }

        /*
         * The invitation being accepted is excluded, because it is still
         * `pending` at the point acceptance re-checks the code — without this
         * every invited code collides with its own reservation and is dropped.
         */
        $claimedByInvite = Invitation::query()
            ->where('organization_id', $organizationId)
            ->where('status', 'pending')
            ->where('metadata->employee_code', $code)
            ->when($ignoreInvitationId, fn ($query) => $query->where('id', '!=', $ignoreInvitationId))
            ->exists();

        if ($claimedByInvite) {
            return "Employee code '{$code}' is already reserved by a pending invitation.";
        }

        return null;
    }

    /**
     * The custom role for this organisation, or null.
     *
     * Admin-defined roles refine the hierarchy (a "Team Lead" at level 60 sits
     * between manager and employee) but they do not replace the base role —
     * middleware still authorises on `users.role`. Both therefore travel
     * together, and the base one is DERIVED here rather than taken from the
     * client, so a request cannot pair a low-privilege custom role with
     * `role: admin` and be believed.
     */
    private function resolveCustomRole(Organization $organization, mixed $roleId): ?\App\Models\Role
    {
        if (blank($roleId)) {
            return null;
        }

        return \App\Models\Role::query()
            ->where('organization_id', $organization->id)
            ->where('is_active', true)
            ->find((int) $roleId);
    }

    /** The base role a custom role's hierarchy level corresponds to. */
    private function baseRoleForLevel(int $level): string
    {
        return match (true) {
            $level <= 10 => 'admin',
            $level < 100 => 'manager',
            default => 'employee',
        };
    }

    public function createBatch(User $actor, Organization $organization, array $payload): array
    {
        $customRole = $this->resolveCustomRole($organization, $payload['role_id'] ?? null);

        if ($customRole) {
            $payload['role'] = $this->baseRoleForLevel((int) $customRole->hierarchy_level);
            $payload['role_id'] = $customRole->id;
        } else {
            unset($payload['role_id']);
        }

        $this->organizationRoleService->assertCanAssignRole($actor, $payload['role']);

        $emails = collect($payload['emails'] ?? [])
            ->push($payload['email'] ?? null)
            ->filter(fn ($email) => filled($email))
            ->map(fn ($email) => mb_strtolower(trim((string) $email)))
            ->unique()
            ->values();

        $created = [];
        $failed = [];

        /*
         * Employee codes are per-person and unique, so the scalar `employee_code`
         * is only honoured for a single-recipient invite. Applying one code to a
         * batch would guarantee a collision for everyone after the first, which
         * is worse than ignoring it.
         */
        $codesByEmail = collect($payload['employee_codes'] ?? [])
            ->mapWithKeys(fn ($code, $key) => [mb_strtolower(trim((string) $key)) => trim((string) $code)])
            ->all();

        if ($emails->count() === 1 && filled($payload['employee_code'] ?? null)) {
            $codesByEmail[$emails->first()] = trim((string) $payload['employee_code']);
        }

        $claimedCodes = [];

        foreach ($emails as $email) {
            $failure = $this->validateRecipient($actor, $organization, $email);

            if ($failure !== null) {
                $failed[] = [
                    'email' => $email,
                    'message' => $failure,
                ];
                continue;
            }

            $employeeCode = $codesByEmail[$email] ?? null;

            if (filled($employeeCode)) {
                // Two recipients in the same submission cannot share a code, and
                // neither can a recipient and someone already in the system.
                $conflict = isset($claimedCodes[mb_strtolower($employeeCode)])
                    ? "Employee code '{$employeeCode}' is used more than once in this invitation."
                    : $this->employeeCodeConflict((int) $organization->id, $employeeCode);

                if ($conflict !== null) {
                    $failed[] = [
                        'email' => $email,
                        'message' => $conflict,
                    ];
                    continue;
                }

                $claimedCodes[mb_strtolower($employeeCode)] = true;
            }

            $invitation = $this->createSingle($actor, $organization, $email, [
                ...$payload,
                'employee_code' => $employeeCode,
            ]);
            $created[] = $invitation;

            if (($invitation['mail_delivery'] ?? null) === 'failed') {
                $failed[] = [
                    'email' => $email,
                    'message' => 'Invitation created, but email delivery failed. Check SMTP settings.',
                ];
            }
        }

        return [
            'created' => $created,
            'failed' => $failed,
        ];
    }

    public function createBulk(User $actor, Organization $organization, array $rows, array $defaults = []): array
    {
        $created = [];
        $failed = [];
        $seenEmails = [];
        $seenCodes = [];

        foreach ($rows as $index => $row) {
            $email = mb_strtolower(trim((string) ($row['email'] ?? '')));
            $role = (string) ($row['role'] ?? '');

            if ($email === '') {
                $failed[] = [
                    'email' => '',
                    'message' => 'Email is required.',
                    'row' => $index + 1,
                ];
                continue;
            }

            if (isset($seenEmails[$email])) {
                $failed[] = [
                    'email' => $email,
                    'message' => 'Duplicate email found in CSV upload.',
                    'row' => $index + 1,
                ];
                continue;
            }

            $seenEmails[$email] = true;

            try {
                $this->organizationRoleService->assertCanAssignRole($actor, $role, "rows.{$index}.role");
            } catch (ValidationException $exception) {
                $failed[] = [
                    'email' => $email,
                    'message' => collect($exception->errors())->flatten()->first() ?: 'You are not allowed to assign this role.',
                    'row' => $index + 1,
                ];
                continue;
            }

            $failure = $this->validateRecipient($actor, $organization, $email);

            if ($failure !== null) {
                $failed[] = [
                    'email' => $email,
                    'message' => $failure,
                    'row' => $index + 1,
                ];
                continue;
            }

            // Checked inside the file as well as against the system, exactly as
            // the email column above is — a CSV that repeats a code is the most
            // likely way one gets duplicated.
            $employeeCode = trim((string) ($row['employee_code'] ?? ''));

            if ($employeeCode !== '') {
                $codeKey = mb_strtolower($employeeCode);
                $conflict = isset($seenCodes[$codeKey])
                    ? "Duplicate employee code '{$employeeCode}' found in CSV upload."
                    : $this->employeeCodeConflict((int) $organization->id, $employeeCode);

                if ($conflict !== null) {
                    $failed[] = [
                        'email' => $email,
                        'message' => $conflict,
                        'row' => $index + 1,
                    ];
                    continue;
                }

                $seenCodes[$codeKey] = true;
            }

            $invitation = $this->createSingle($actor, $organization, $email, [
                'employee_code' => $employeeCode !== '' ? $employeeCode : null,
                'role' => $role,
                'delivery' => 'email',
                'expires_in_hours' => $defaults['expires_in_hours'] ?? null,
                'group_ids' => $this->mergeNumericIds(
                    $defaults['group_ids'] ?? [],
                    $row['group_ids'] ?? []
                ),
                'project_ids' => $this->mergeNumericIds(
                    $defaults['project_ids'] ?? [],
                    $row['project_ids'] ?? []
                ),
                'settings' => $this->mergeSettings(
                    $defaults['settings'] ?? null,
                    $row['settings'] ?? null
                ),
                'job_title' => isset($row['job_title']) ? trim((string) $row['job_title']) : null,
                // Per row, falling back to the batch default, so one CSV can
                // carry staggered start dates.
                'joining_date' => $row['joining_date'] ?? ($defaults['joining_date'] ?? null),
            ]);
            $created[] = $invitation;

            if (($invitation['mail_delivery'] ?? null) === 'failed') {
                $failed[] = [
                    'email' => $email,
                    'message' => 'Invitation created, but email delivery failed. Check SMTP settings.',
                    'row' => $index + 1,
                ];
            }
        }

        return [
            'created' => $created,
            'failed' => $failed,
        ];
    }

    /**
     * Issue a fresh token for an existing invitation and send it again.
     *
     * A resend has to rotate the token rather than repeat the old one: only the
     * hash is stored, so the original URL is unrecoverable by design. Rotating
     * also makes this the regenerate action for link invites, whose URL is
     * shown exactly once and is otherwise lost the moment the panel closes.
     *
     * The returned payload carries `invite_url` for link deliveries so the
     * caller can show the new link immediately.
     */
    public function resend(User $actor, Invitation $invitation): array
    {
        $invitation->markExpiredIfNeeded();

        if ($invitation->status === 'accepted') {
            throw new HttpException(422, 'This invitation has already been accepted.');
        }

        if ($invitation->status === 'revoked') {
            throw new HttpException(422, 'This invitation was revoked. Send a new one instead.');
        }

        $failure = $this->validateRecipient($actor, $invitation->organization, $invitation->email);

        if ($failure !== null) {
            throw new HttpException(422, $failure);
        }

        $token = Invitation::generatePublicToken();

        $invitation->forceFill([
            'token_hash' => Invitation::hashPublicToken($token),
            'status' => 'pending',
            'expires_at' => now()->addHours((int) config('carevance.invitation_expiration_hours', 72)),
            'email_sent_at' => null,
        ])->save();

        $mailDelivery = 'not_requested';
        if ($invitation->delivery_method === 'email') {
            $mailDelivery = $this->sendInvitationMail($invitation, $token) ? 'queued' : 'failed';
        }

        return [
            ...$this->serialize($invitation->fresh(['organization', 'inviter']), $token),
            'mail_delivery' => $mailDelivery,
        ];
    }

    /**
     * Withdraw a pending invitation so its link stops working.
     *
     * Revoking rather than deleting keeps the audit trail: who was invited, by
     * whom, and that it was called back before anyone used it.
     */
    public function revoke(Invitation $invitation): Invitation
    {
        $invitation->markExpiredIfNeeded();

        if ($invitation->status === 'accepted') {
            throw new HttpException(422, 'This invitation has already been accepted and cannot be revoked.');
        }

        if ($invitation->status === 'revoked') {
            return $invitation;
        }

        $invitation->forceFill(['status' => 'revoked'])->save();

        return $invitation->fresh(['organization', 'inviter']);
    }

    public function resolveByToken(string $token): Invitation
    {
        $invitation = Invitation::query()
            ->with(['organization', 'inviter'])
            ->where('token_hash', Invitation::hashPublicToken($token))
            ->first();

        if (! $invitation) {
            throw new HttpException(404, 'This invitation is no longer available.');
        }

        $invitation->markExpiredIfNeeded();

        return $invitation->fresh(['organization', 'inviter']);
    }

    public function serialize(Invitation $invitation, ?string $publicToken = null): array
    {
        $invitation->markExpiredIfNeeded();

        $inviteUrl = $publicToken
            ? $this->invitationUrlService->acceptUrl($publicToken)
            : null;

        return [
            'id' => $invitation->id,
            'email' => $invitation->email,
            'role' => $invitation->role,
            'status' => $invitation->status,
            'delivery_method' => $invitation->delivery_method,
            'email_sent_at' => $invitation->email_sent_at?->toIso8601String(),
            'expires_at' => $invitation->expires_at?->toIso8601String(),
            'accepted_at' => $invitation->accepted_at?->toIso8601String(),
            'invite_url' => $inviteUrl,
            'organization' => [
                'id' => $invitation->organization?->id,
                'name' => $invitation->organization?->name,
                'slug' => $invitation->organization?->slug,
            ],
            'metadata' => $invitation->metadata ?? [],
            'can_accept' => $invitation->status === 'pending',
            // Surfaced so the pending list can answer "who sent this, and when
            // did the mail actually go out" without a second request — the two
            // questions an admin asks before deciding to resend.
            'invited_by' => $invitation->inviter ? [
                'id' => $invitation->inviter->id,
                'name' => $invitation->inviter->name,
            ] : null,
            // Expired invitations are resendable on purpose: rotating the token
            // and extending the window is exactly what the admin wants there.
            'can_resend' => in_array($invitation->status, ['pending', 'expired'], true),
            'can_revoke' => in_array($invitation->status, ['pending', 'expired'], true),
        ];
    }

    public function accept(Invitation $invitation, array $payload): User
    {
        $invitation->markExpiredIfNeeded();

        if ($invitation->status !== 'pending') {
            throw new HttpException(422, 'This invitation is no longer available.');
        }

        $existing = User::query()
            ->whereRaw('LOWER(email) = ?', [mb_strtolower($invitation->email)])
            ->first();

        if ($existing) {
            throw new HttpException(422, 'An account with this email already exists.');
        }

        // A pending invitation does not hold a seat; accepting one does. The cap
        // is checked here rather than at send time so an invite issued while a
        // seat was free still fails honestly if the seat went to someone else.
        // Organization carries no tenant scope (it is the tenant), so a plain
        // find is correct and greppable here.
        $invitedOrganization = \App\Models\Organization::find($invitation->organization_id);
        if ($invitedOrganization) {
            app(\App\Services\Billing\SeatGuard::class)->assertCanAdd($invitedOrganization, 1);
        }

        return DB::transaction(function () use ($invitation, $payload) {
            $userSettings = is_array($invitation->settings) ? $invitation->settings : [];
            if (!empty($payload['timezone'])) {
                $userSettings['timezone'] = $payload['timezone'];
            }

            $user = User::create([
                'name' => $payload['name'],
                'email' => $invitation->email,
                'password' => $payload['password'],
                'role' => $invitation->role,
                // Re-checked against the organisation at acceptance: the role
                // could have been deleted or deactivated since the invite was
                // sent, and a dangling role_id would break every hierarchy
                // lookup that reads it.
                'role_id' => $this->resolveCustomRole(
                    $invitation->organization,
                    $invitation->metadata['role_id'] ?? null
                )?->id,
                'organization_id' => $invitation->organization_id,
                'invited_by' => $invitation->invited_by,
                'settings' => !empty($userSettings) ? $userSettings : null,
                // Accepting the invitation IS the verification.
                //
                // The single-use token was delivered to this address and has
                // just been redeemed, which is the same proof a verification
                // link asks for. Leaving it unset sent the joiner round a
                // second time for the same mailbox — and because login refuses
                // an unverified account outright, a verification mail that
                // failed to send (which this flow tolerates and logs) left a
                // real person with an account they could never reach and no
                // self-service way out.
                'email_verified_at' => now(),
            ]);

            $groupIds = collect($invitation->metadata['group_ids'] ?? [])
                ->map(fn ($value) => (int) $value)
                ->filter()
                ->values()
                ->all();
            $projectIds = collect($invitation->metadata['project_ids'] ?? [])
                ->map(fn ($value) => (int) $value)
                ->filter()
                ->values()
                ->all();
            $jobTitle = trim((string) ($invitation->metadata['job_title'] ?? ''));
            $allowedGroupIds = [];

            if (!empty($groupIds)) {
                $allowedGroupIds = Group::query()
                    ->where('organization_id', $invitation->organization_id)
                    ->whereIn('id', $groupIds)
                    ->pluck('id')
                    ->all();

                $user->groups()->sync($allowedGroupIds);

            }
            $allowedProjectIds = [];
            if (!empty($projectIds)) {
                $allowedProjectIds = Project::query()
                    ->where('organization_id', $invitation->organization_id)
                    ->whereIn('id', $projectIds)
                    ->pluck('id')
                    ->map(fn ($id) => (int) $id)
                    ->all();
            }

            $user->assignedProjects()->sync($allowedProjectIds);

            /*
             * The work info row is created unconditionally.
             *
             * It used to be written only when a group or job title was present,
             * so anyone invited without either had no work info at all — and
             * therefore nowhere to hold their employee code, designation or
             * joining date. Three of twenty users on this deployment were in
             * that state. The row is the employment record; it exists because
             * the person was hired, not because a particular field was filled.
             */
            $employeeCode = trim((string) ($invitation->metadata['employee_code'] ?? ''));

            /*
             * Re-checked here because the code was reserved when the invite was
             * issued and anything could have happened since — most obviously an
             * admin creating the same person by hand through Create User.
             *
             * A collision must NOT fail the acceptance. The invitee is at the
             * door with a password already typed; refusing them turns an admin's
             * clerical mistake into a lockout. The account is created without a
             * code instead, which surfaces as an incomplete profile for HR to
             * resolve.
             */
            if ($employeeCode !== '' && $this->employeeCodeConflict(
                (int) $invitation->organization_id,
                $employeeCode,
                (int) $user->id,
                (int) $invitation->id
            ) !== null) {
                $employeeCode = '';
            }

            /*
             * Every field is written only when the invitation actually carries a
             * value. Now that this runs unconditionally, passing nulls through
             * would let a re-accept blank a designation, department or code that
             * an admin had since filled in by hand.
             */
            $workInfo = [];

            if (! empty($allowedGroupIds)) {
                $workInfo['report_group_id'] = $allowedGroupIds[0];
            }

            if ($jobTitle !== '') {
                $workInfo['designation'] = $jobTitle;
            }

            if ($employeeCode !== '') {
                $workInfo['employee_code'] = $employeeCode;
            }

            EmployeeWorkInfo::query()->updateOrCreate(
                [
                    'organization_id' => $invitation->organization_id,
                    'user_id' => $user->id,
                ],
                $workInfo
            );

            // Eagerly create payroll template with default salary structure
            \App\Models\EmployeePayrollTemplate::getOrCreateForUser(
                $user->id,
                $invitation->organization_id,
                $invitation->invited_by
            );

            $invitation->forceFill([
                'status' => 'accepted',
                'accepted_at' => now(),
                'accepted_by_user_id' => $user->id,
            ])->save();

            // Every route that produces an employee opens a journey. Before
            // this, only UserController::store did — so anyone who arrived by
            // invite, link or CSV import got an account and no onboarding at
            // all. Idempotent: if the invitation already carries a journey
            // (raised at invite time when a joining date was supplied), this
            // binds the new account to it instead of opening a second one.
            $joiningDate = $this->resolveJoiningDate($invitation);

            $this->onboardingService->ensureForUser(
                user: $user,
                creator: $invitation->invited_by ? User::find($invitation->invited_by) : null,
                attributes: [
                    'invitation_id' => $invitation->id,
                    'job_title' => $jobTitle !== '' ? $jobTitle : null,
                    'group_id' => $allowedGroupIds[0] ?? null,
                ],
                joiningDate: $joiningDate,
            );

            return $user;
        });
    }

    /**
     * The joining date an invited employee's checklist anchors on.
     *
     * Invites do not always carry one — the email and link forms ask for a role,
     * not a start date — so fall back to the day the invitation is accepted.
     * That is the truthful anchor: whatever the plan was, this is the day the
     * person actually entered the system.
     */
    private function resolveJoiningDate(Invitation $invitation): Carbon
    {
        $raw = $invitation->metadata['joining_date'] ?? null;

        if (filled($raw)) {
            try {
                return Carbon::parse((string) $raw)->startOfDay();
            } catch (\Throwable) {
                // A malformed date in metadata must not block someone joining.
            }
        }

        return Carbon::now()->startOfDay();
    }

    /**
     * Store a joining date as a plain `Y-m-d` string.
     *
     * Deliberately date-only. Serialising a datetime here would put the value
     * back through a UTC conversion on the way out and land the checklist a day
     * early for anyone ahead of UTC — the same shift that date-only columns are
     * cast around elsewhere in the app.
     */
    private function normalizeJoiningDate(mixed $raw): ?string
    {
        if (blank($raw)) {
            return null;
        }

        try {
            return Carbon::parse((string) $raw)->format('Y-m-d');
        } catch (\Throwable) {
            return null;
        }
    }

    private function createSingle(User $actor, Organization $organization, string $email, array $payload): array
    {
        $token = Invitation::generatePublicToken();
        $expiresAt = now()->addHours((int) ($payload['expires_in_hours'] ?? config('carevance.invitation_expiration_hours', 72)));
        $allowedGroupIds = Group::query()
            ->where('organization_id', $organization->id)
            ->whereIn('id', collect($payload['group_ids'] ?? [])->map(fn ($id) => (int) $id)->filter()->all())
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
        $allowedProjectIds = Project::query()
            ->where('organization_id', $organization->id)
            ->whereIn('id', collect($payload['project_ids'] ?? [])->map(fn ($id) => (int) $id)->filter()->all())
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $invitation = DB::transaction(function () use ($actor, $organization, $email, $payload, $token, $expiresAt, $allowedGroupIds, $allowedProjectIds) {
            Invitation::query()
                ->where('organization_id', $organization->id)
                ->whereRaw('LOWER(email) = ?', [$email])
                ->where('status', 'pending')
                ->update(['status' => 'revoked']);

            return Invitation::create([
                'organization_id' => $organization->id,
                'email' => $email,
                'role' => $payload['role'],
                'token_hash' => Invitation::hashPublicToken($token),
                'invited_by' => $actor->id,
                'status' => 'pending',
                'settings' => $this->normalizeSettings($payload['settings'] ?? null, (string) $payload['role']),
                'metadata' => [
                    'group_ids' => $allowedGroupIds,
                    'project_ids' => $allowedProjectIds,
                    'job_title' => isset($payload['job_title']) ? trim((string) $payload['job_title']) : null,
                    // The organisation's own employee code, recorded at invite
                    // time and stamped onto the work info at acceptance.
                    'employee_code' => filled($payload['employee_code'] ?? null)
                        ? trim((string) $payload['employee_code'])
                        : null,
                    // The admin-defined role, applied to the user at acceptance.
                    // Already validated against this organisation by the caller.
                    'role_id' => filled($payload['role_id'] ?? null) ? (int) $payload['role_id'] : null,
                    // Read back by resolveJoiningDate() when the invite is
                    // accepted. Before this the key was only ever read, so
                    // every invited employee's onboarding checklist anchored on
                    // whenever they happened to click the link — which makes
                    // the pre-boarding items, the ones that sit at day -14,
                    // impossible to schedule on any invite path.
                    'joining_date' => $this->normalizeJoiningDate($payload['joining_date'] ?? null),
                ],
                'delivery_method' => $payload['delivery'] ?? 'email',
                'expires_at' => $expiresAt,
            ]);
        });

        $mailDelivery = 'not_requested';
        if (($payload['delivery'] ?? 'email') === 'email') {
            $mailDelivery = $this->sendInvitationMail($invitation, $token) ? 'queued' : 'failed';
        }

        $invitation->setRelation('organization', $organization);

        return [
            ...$this->serialize($invitation, $token),
            'mail_delivery' => $mailDelivery,
        ];
    }

    private function validateRecipient(User $actor, Organization $organization, string $email): ?string
    {
        if (mb_strtolower($actor->email) === $email) {
            return 'This email already belongs to your account.';
        }

        $existingUser = User::query()
            ->whereRaw('LOWER(email) = ?', [$email])
            ->first();

        if (!$existingUser) {
            return null;
        }

        if ((int) $existingUser->organization_id === (int) $organization->id) {
            return 'This email already exists in your workspace.';
        }

        return 'This email is already in use by another workspace.';
    }

    private function mergeNumericIds(array $defaults, array $rowValues): array
    {
        return collect([...$defaults, ...$rowValues])
            ->map(fn ($value) => (int) $value)
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function mergeSettings(?array $defaults, ?array $rowSettings): ?array
    {
        $defaults = $defaults ?? [];
        $rowSettings = $rowSettings ?? [];
        $merged = array_replace($defaults, $rowSettings);

        return empty($merged) ? null : $merged;
    }

    private function normalizeSettings(?array $settings, string $role): ?array
    {
        if ($settings === null) {
            return null;
        }

        $normalized = [];

        // An OVERRIDE, not a stamped value: when the inviter did not pick an
        // interval the key is omitted and the invited user inherits the
        // organization default. Hardcoding 10 here made every invited user a
        // hard override and put the org default permanently out of reach.
        $interval = $this->monitoringSettingsResolver->sanitize($settings['monitoring_interval_minutes'] ?? null);
        if ($interval !== null) {
            $normalized['monitoring_interval_minutes'] = $interval;
        }

        foreach ([
            'can_edit_time',
            'attendance_monitoring',
            'payroll_visibility',
            'task_assignment_access',
        ] as $key) {
            if (array_key_exists($key, $settings)) {
                $normalized[$key] = filter_var($settings[$key], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false;
            }
        }

        if (!empty($settings['timezone'])) {
            $normalized['timezone'] = $settings['timezone'];
        }

        $lowerRole = strtolower(trim($role));
        if (in_array($lowerRole, ['employee', 'contractor'], true)) {
            $normalized['payroll_visibility'] = false;
        }

        return $normalized;
    }

    /**
     * Hand one invitation email to the queue.
     *
     * Returns whether the send was *accepted*, not whether it arrived — with a
     * real queue driver the send happens after this request is over. The
     * mail-configuration check stays in front of the dispatch so a workspace
     * with no SMTP credentials still gets told immediately, rather than queuing
     * work that can only fail.
     *
     * On the `sync` driver the job runs inline on dispatch, which is why a
     * throwing send still reports false here and the caller's per-recipient
     * failure reporting keeps working locally.
     */
    private function sendInvitationMail(Invitation $invitation, string $token): bool
    {
        try {
            if (!$this->hasMailConfiguration()) {
                Log::warning('Invitation email skipped because mail configuration is incomplete.', [
                    'invitation_id' => $invitation->id,
                    'organization_id' => $invitation->organization_id,
                    'email' => $invitation->email,
                ]);

                return false;
            }

            SendInvitationMail::dispatch($invitation->id, $token);

            return true;
        } catch (\Throwable $exception) {
            Log::warning('Invitation email dispatch failed.', [
                'invitation_id' => $invitation->id,
                'organization_id' => $invitation->organization_id,
                'email' => $invitation->email,
                'exception' => $exception::class,
                'message' => $exception->getMessage(),
            ]);

            return false;
        }
    }

    private function hasMailConfiguration(): bool
    {
        $mailer = (string) config('mail.default', 'log');

        if ($mailer !== 'smtp') {
            return true;
        }

        return filled(config('mail.mailers.smtp.host'))
            && filled(config('mail.mailers.smtp.port'))
            && filled(config('mail.mailers.smtp.username'))
            && filled(config('mail.mailers.smtp.password'))
            && filled(config('mail.from.address'));
    }
}
