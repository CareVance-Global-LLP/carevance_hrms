<?php

namespace App\Services\Invitations;

use App\Mail\CareVanceInvitationMail;
use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\User;
use App\Services\Authorization\OrganizationRoleService;
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

        return DB::transaction(function () use ($invitation, $payload) {
            $user = User::create([
                'name' => $payload['name'],
                'email' => $invitation->email,
                'password' => $payload['password'],
                'role' => $invitation->role,
                'organization_id' => $invitation->organization_id,
                'invited_by' => $invitation->invited_by,
                'settings' => $invitation->settings,
            ]);

            $groupIds = collect($invitation->metadata['group_ids'] ?? [])
                ->map(fn ($value) => (int) $value)
                ->filter()
                ->values()
                ->all();

            if (!empty($groupIds)) {
                $allowedGroupIds = Group::query()
                    ->where('organization_id', $invitation->organization_id)
                    ->whereIn('id', $groupIds)
                    ->pluck('id')
                    ->all();

                $user->groups()->sync($allowedGroupIds);

                EmployeeWorkInfo::query()->updateOrCreate(
                    [
                        'organization_id' => $invitation->organization_id,
                        'user_id' => $user->id,
                    ],
                    [
                        'report_group_id' => $allowedGroupIds[0] ?? null,
                    ]
                );
            }

            $invitation->forceFill([
                'status' => 'accepted',
                'accepted_at' => now(),
                'accepted_by_user_id' => $user->id,
            ])->save();

            return $user;
        });
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

        $invitation = DB::transaction(function () use ($actor, $organization, $email, $payload, $token, $expiresAt, $allowedGroupIds) {
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
                    'project_ids' => $payload['project_ids'] ?? [],
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
        $interval = (int) ($settings['monitoring_interval_minutes'] ?? 10);
        $normalized['monitoring_interval_minutes'] = in_array($interval, [1, 3, 5, 10, 15, 30], true)
            ? $interval
            : 10;

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

        if ($role === 'employee') {
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
