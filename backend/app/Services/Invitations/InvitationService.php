<?php

namespace App\Services\Invitations;

use App\Mail\CareVanceInvitationMail;
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
use Illuminate\Support\Facades\Mail;
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

    public function createBatch(User $actor, Organization $organization, array $payload): array
    {
        $this->organizationRoleService->assertCanAssignRole($actor, $payload['role']);

        $emails = collect($payload['emails'] ?? [])
            ->push($payload['email'] ?? null)
            ->filter(fn ($email) => filled($email))
            ->map(fn ($email) => mb_strtolower(trim((string) $email)))
            ->unique()
            ->values();

        $created = [];
        $failed = [];

        foreach ($emails as $email) {
            $failure = $this->validateRecipient($actor, $organization, $email);

            if ($failure !== null) {
                $failed[] = [
                    'email' => $email,
                    'message' => $failure,
                ];
                continue;
            }

            $invitation = $this->createSingle($actor, $organization, $email, $payload);
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

            $invitation = $this->createSingle($actor, $organization, $email, [
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
                'organization_id' => $invitation->organization_id,
                'invited_by' => $invitation->invited_by,
                'settings' => !empty($userSettings) ? $userSettings : null,
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

            if (!empty($groupIds) || $jobTitle !== '') {
                EmployeeWorkInfo::query()->updateOrCreate(
                    [
                        'organization_id' => $invitation->organization_id,
                        'user_id' => $user->id,
                    ],
                    [
                        'report_group_id' => $allowedGroupIds[0] ?? null,
                        'designation' => $jobTitle !== '' ? $jobTitle : null,
                    ]
                );
            }

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
                ],
                'delivery_method' => $payload['delivery'] ?? 'email',
                'expires_at' => $expiresAt,
            ]);
        });

        $mailDelivery = 'not_requested';
        if (($payload['delivery'] ?? 'email') === 'email') {
            $mailDelivery = $this->sendInvitationMail($invitation, $token) ? 'sent' : 'failed';
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

            Mail::to($invitation->email)->sendNow(
                new CareVanceInvitationMail(
                    invitation: $invitation->fresh(['organization', 'inviter']),
                    acceptUrl: $this->invitationUrlService->acceptUrl($token),
                )
            );

            $invitation->forceFill(['email_sent_at' => now()])->save();

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
