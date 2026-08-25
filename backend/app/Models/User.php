<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Mail\PasswordResetMail;
use App\Mail\VerifyEmailMail;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\URL;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable
{
    /** @use HasFactory<\Database\Factories\UserFactory> */
    use HasFactory, Notifiable;

    public function organizations()
    {
        return $this->hasMany(Organization::class);
    }

    public function ownedOrganization(): HasOne
    {
        return $this->hasOne(Organization::class, 'owner_user_id');
    }

    public function projects()
    {
        return $this->hasMany(Project::class);
    }

    public function assignedProjects(): BelongsToMany
    {
        return $this->belongsToMany(Project::class, 'project_user')
            ->withTimestamps();
    }

    public function tasks()
    {
        return $this->hasMany(Task::class, 'assignee_id');
    }

    public function timeEntries()
    {
        return $this->hasMany(TimeEntry::class);
    }

    public function invoices()
    {
        return $this->hasMany(Invoice::class);
    }

    public function payrollStructures()
    {
        return $this->hasMany(PayrollStructure::class);
    }

    public function payslips()
    {
        return $this->hasMany(Payslip::class);
    }

    /**
     * Payroll items generated for this user. One row per (user, month)
     * — see the unique-friendly UNIQUE on (user_id, effective_from)
     * for the pay-group variant, but for PayrollItem there's no such
     * constraint; the latest one per month is what the UI shows.
     */
    public function payrollItems()
    {
        return $this->hasMany(PayrollItem::class);
    }

    public function payrolls()
    {
        return $this->hasMany(Payroll::class);
    }

    public function payrollTaxDeclarations(): HasMany
    {
        return $this->hasMany(PayrollTaxDeclaration::class);
    }

    public function payrollProfile(): HasOne
    {
        return $this->hasOne(PayrollProfile::class);
    }

    public function employeeProfile(): HasOne
    {
        return $this->hasOne(EmployeeProfile::class);
    }

    public function employeePayrollTemplate(): HasOne
    {
        return $this->hasOne(EmployeePayrollTemplate::class);
    }

    public function payGroupAssignments(): HasMany
    {
        return $this->hasMany(PayGroupAssignment::class);
    }

    public function legalEntity(): BelongsTo
    {
        return $this->belongsTo(LegalEntity::class);
    }

    public function employeeWorkInfo(): HasOne
    {
        return $this->hasOne(EmployeeWorkInfo::class);
    }

    public function employeeDocuments(): HasMany
    {
        return $this->hasMany(EmployeeDocument::class);
    }

    public function employeeGovernmentIds(): HasMany
    {
        return $this->hasMany(EmployeeGovernmentId::class);
    }

    public function employeeBankAccounts(): HasMany
    {
        return $this->hasMany(EmployeeBankAccount::class);
    }

    /**
     * A statutory identifier, wherever this person's happens to be stored.
     *
     * There are two homes for these: dedicated columns on the employee profile
     * (`pan_number`, `uan_number`, `esi_ip_number`) and free-form rows in
     * `employee_government_ids`. Onboarding writes the rows; payroll filing was
     * reading only the columns, so every Form 16 came out as NOPAN and every
     * 24Q deductee as PANNOTAVBL while the PAN sat one table away. Stored
     * `id_type` values are mixed case ('pan', 'PAN', 'uan'), hence the
     * case-insensitive match.
     */
    public function statutoryId(string $type): ?string
    {
        $column = match (strtolower($type)) {
            'pan' => 'pan_number',
            'uan' => 'uan_number',
            'esi' => 'esi_ip_number',
            default => null,
        };

        $fromProfile = $column ? ($this->employeeProfile?->{$column} ?? null) : null;
        if (filled($fromProfile)) {
            return trim((string) $fromProfile);
        }

        /*
         * A person can carry more than one row of the same kind — 15 employees
         * on the live database have two PAN rows with different values, e.g.
         * "A7C3F04348" and "45300C". `->first()` returned whichever the
         * collection happened to yield, so the PAN that reached Form 16 could
         * change between requests depending on load order.
         *
         * Resolve deterministically instead: prefer a value that matches the
         * statutory format, and fall back to the most recently updated row so
         * the answer is at least stable and explainable when none of them do.
         */
        $candidates = $this->employeeGovernmentIds
            ->filter(fn ($id) => str_contains(strtolower((string) $id->id_type), strtolower($type)))
            ->filter(fn ($id) => filled($id->id_number))
            ->sortByDesc(fn ($id) => $id->updated_at?->getTimestamp() ?? 0)
            ->values();

        if ($candidates->isEmpty()) {
            return null;
        }

        $pattern = match (strtolower($type)) {
            'pan' => '/^[A-Z]{5}[0-9]{4}[A-Z]$/',
            'uan' => '/^\d{12}$/',
            default => null,
        };

        if ($pattern !== null) {
            $wellFormed = $candidates->first(
                fn ($id) => preg_match($pattern, strtoupper(trim((string) $id->id_number))) === 1
            );

            if ($wellFormed !== null) {
                return trim((string) $wellFormed->id_number);
            }
        }

        return trim((string) $candidates->first()->id_number);
    }

    public function employeeActivityLogs(): HasMany
    {
        return $this->hasMany(EmployeeActivityLog::class);
    }

    public function salaryAssignments(): HasMany
    {
        return $this->hasMany(EmployeeSalaryAssignment::class);
    }

    public function sentChatMessages()
    {
        return $this->hasMany(ChatMessage::class, 'sender_id');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function auditLogs(): HasMany
    {
        return $this->hasMany(AuditLog::class, 'actor_user_id');
    }

    public function groups(): BelongsToMany
    {
        return $this->belongsToMany(Group::class, 'group_user')
            ->withTimestamps();
    }

    public function departmentTeamMemberships(): BelongsToMany
    {
        return $this->belongsToMany(DepartmentTeam::class, 'department_team_members', 'user_id', 'team_id')
            ->withTimestamps();
    }

    public function departmentTeamManagerships(): BelongsToMany
    {
        return $this->belongsToMany(DepartmentTeam::class, 'department_team_managers', 'user_id', 'team_id')
            ->withTimestamps();
    }

    public function reportGroups(): BelongsToMany
    {
        return $this->belongsToMany(ReportGroup::class, 'group_user', 'user_id', 'group_id')
            ->withTimestamps();
    }

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'name',
        'email',
        'password',
        'role',
        'role_id',
        'organization_id',
        // Which company within the organization employs this person, for
        // statutory purposes. Null means the organization's primary entity,
        // which is every existing employee - see LegalEntityResolver.
        'legal_entity_id',
        'invited_by',
        'avatar',
        'settings',
        'last_seen_at',
        'email_verified_at',
        'google_id',
        'google_token',
        'google_refresh_token',
        'trial_used_at',
        'trial_ended_at',
    
        'scim_external_id',
        'is_scim_managed',
        'scim_synced_at',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'remember_token',
        // OAuth credentials must never reach a client. The refresh token in
        // particular is long-lived and would otherwise be serialized by every
        // endpoint that returns a User.
        'google_token',
        'google_refresh_token',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'settings' => 'array',
            'last_seen_at' => 'datetime',
            'trial_used_at' => 'datetime',
            'trial_ended_at' => 'datetime',
            'deactivated_at' => 'datetime',
            'is_scim_managed' => 'boolean',
            'scim_synced_at' => 'datetime',
        ];
    }

    /*
     * `tracker_policy` is deliberately NOT appended.
     *
     * Resolving it reads the user's organization, so appending it globally
     * made every roster and report endpoint issue one extra query per row —
     * an N+1 on lists that are already the hottest queries in the app. It is
     * also meaningless for anyone but the authenticated user: a manager
     * looking at a team list has no use for each member's idle threshold.
     *
     * Attach it explicitly where a tracker actually needs it (see
     * AuthController::me).
     */
    protected $appends = ['is_active', 'is_online', 'effective_monitoring_interval_minutes'];

    public function inviter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by');
    }

    public function sentInvitations(): HasMany
    {
        return $this->hasMany(Invitation::class, 'invited_by');
    }

    public function resignations(): HasMany
    {
        return $this->hasMany(Resignation::class);
    }

    public function approvedResignations(): HasMany
    {
        return $this->hasMany(Resignation::class, 'approved_by');
    }

    /**
     * Whether the account can still be used.
     *
     * This used to return a hardcoded `true`, which meant "revoke access on the
     * last working day" had nothing to write to and accounts outlived the people
     * who held them. It is now backed by `deactivated_at`, set by the exit
     * process on the last working day.
     */
    public function getIsActiveAttribute(): bool
    {
        return $this->deactivated_at === null;
    }

    /**
     * Check if this user has already consumed their free trial.
     */
    public function hasConsumedTrial(): bool
    {
        return $this->trial_used_at !== null;
    }

    /**
     * Check if the user's trial is still active (within 14 days of trial_used_at).
     */
    public function isTrialActive(): bool
    {
        if ($this->trial_used_at === null) {
            return false;
        }
        $trialDays = max(1, (int) config('carevance.trial_days', 14));
        return now()->lt($this->trial_used_at->copy()->addDays($trialDays));
    }

    /**
     * Check if the user's trial has expired.
     */
    public function isTrialExpired(): bool
    {
        if ($this->trial_used_at === null) {
            return false;
        }
        $trialDays = max(1, (int) config('carevance.trial_days', 14));
        return now()->gte($this->trial_used_at->copy()->addDays($trialDays));
    }

    /**
     * Mark trial as used and set end date.
     */
    public function markTrialUsed(): void
    {
        $trialDays = max(1, (int) config('carevance.trial_days', 14));
        $this->trial_used_at = now();
        $this->trial_ended_at = now()->addDays($trialDays);
        $this->save();
    }

    public function getIsOnlineAttribute(): bool
    {
        if (!$this->last_seen_at) {
            return false;
        }

        return $this->last_seen_at->greaterThanOrEqualTo(now()->subMinutes(2));
    }

    /**
     * The capture interval this user is actually monitored at, resolved
     * server-side (per-user override -> organization default -> system default).
     *
     * Read-only and deliberately NOT written back into `settings`: the SPA
     * round-trips the settings object, so baking the resolved value in there
     * would silently convert an inheriting user into a hard override on the next
     * unrelated save.
     */
    public function getEffectiveMonitoringIntervalMinutesAttribute(): int
    {
        return app(\App\Services\Monitoring\MonitoringSettingsResolver::class)->resolveForUser($this);
    }

    /**
     * The desktop tracker's policy for this user.
     *
     * Shipped with the user payload so the client never carries its own
     * opinion about idle thresholds — the two used to be configured
     * independently, and a client that disagreed with the server either burned
     * its retry cap on rejected stops or left the cron as the real rule.
     *
     * @return array<string, mixed>
     */
    public function getTrackerPolicyAttribute(): array
    {
        return app(\App\Services\Monitoring\TrackerPolicyResolver::class)->resolveForUser($this);
    }

    public function hasVerifiedEmail(): bool
    {
        return $this->email_verified_at !== null;
    }

    public function markEmailAsVerified(): bool
    {
        return $this->forceFill([
            'email_verified_at' => now(),
        ])->save();
    }

    public function sendEmailVerificationNotification(): void
    {
        \Illuminate\Support\Facades\Log::info('DEBUG: Starting email verification notification', [
            'email' => $this->email,
            'mail_driver' => config('mail.default'),
            'environment' => app()->environment(),
        ]);

        $verificationUrl = URL::temporarySignedRoute(
            'api.verification.verify',
            now()->addMinutes((int) config('carevance.auth.email_verification_expire_minutes', 1440)),
            [
                'id' => $this->getKey(),
                'hash' => sha1((string) $this->email),
            ]
        );

        // The full signed verification URL used to be written here. Anyone who
        // could read the log — and until a moment ago that was anyone at all,
        // via the unauthenticated GET /api/test/email-log — could take it and
        // verify someone else's address. Log that one was issued, not the
        // credential itself.
        \Illuminate\Support\Facades\Log::info('Verification URL generated', ['user_id' => $this->getKey()]);

        // Use send() for immediate delivery, or queue() for background processing
        // For localhost development, send() ensures immediate delivery
        if (config('mail.default') === 'log' || app()->environment('local')) {
            \Illuminate\Support\Facades\Log::info('DEBUG: Sending email via send() method');
            try {
                Mail::to($this->email)->send(new VerifyEmailMail($this, $verificationUrl));
                \Illuminate\Support\Facades\Log::info('DEBUG: Email sent successfully');
            } catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::error('DEBUG: Email sending failed', ['error' => $e->getMessage()]);
                throw $e;
            }
        } else {
            \Illuminate\Support\Facades\Log::info('DEBUG: Queueing email');
            Mail::to($this->email)->queue(new VerifyEmailMail($this, $verificationUrl));
        }
    }

    public function sendPasswordResetNotification(#[\SensitiveParameter] $token): void
    {
        $resetUrl = rtrim((string) config('carevance.frontend_url', config('app.url')), '/').'/reset-password?'.http_build_query([
            'token' => $token,
            'email' => $this->email,
        ]);

        // Use send() for immediate delivery in local environment
        if (config('mail.default') === 'log' || app()->environment('local')) {
            Mail::to($this->email)->send(new PasswordResetMail($this, $resetUrl));
        } else {
            Mail::to($this->email)->queue(new PasswordResetMail($this, $resetUrl));
        }
    }

    public function customRole(): BelongsTo
    {
        return $this->belongsTo(Role::class, 'role_id');
    }

    public const PERMISSIONS_ADMIN = [
        'dashboard.view', 'attendance.view', 'selfies.view',
        'employees.view', 'employees.manage', 'groups.view', 'groups.manage',
        'reports.view', 'monitoring.view', 'screenshots.view',
        'payroll.view', 'invoices.view', 'leave.view', 'leave.manage',
        'overtime.view', 'overtime.approve', 'tasks.view', 'tasks.manage',
        'projects.view', 'settings.view', 'settings.manage',
        'productivity.manage', 'roles.manage', 'notifications.publish',
        'audit.view', 'geofence.manage', 'chat.use',
        'assets.view', 'assets.manage',
    ];

    public const PERMISSIONS_MANAGER = [
        'dashboard.view', 'attendance.view', 'selfies.view',
        'employees.view', 'employees.manage', 'groups.view', 'groups.manage',
        'reports.view', 'monitoring.view', 'screenshots.view',
        'payroll.view', 'invoices.view', 'leave.view', 'leave.manage',
        'overtime.view', 'overtime.approve', 'tasks.view', 'tasks.manage',
        'projects.view', 'settings.view', 'notifications.publish',
        'audit.view', 'chat.use',
        'assets.view', 'assets.manage',
    ];

    public const PERMISSIONS_EMPLOYEE = [
        'dashboard.view', 'timer.use', 'chat.use',
    ];

    public function hasPermission(string $key): bool
    {
        if ($this->role_id !== null) {
            $customRole = $this->relationLoaded('customRole')
                ? $this->customRole
                : $this->customRole()->first();

            if ($customRole) {
                return $customRole->hasPermission($key);
            }
        }

        return match ($this->role) {
            'super_admin' => true,
            // HR and payroll managers were absent from this map and fell
            // through to `default => false`, so an HR user with no custom role
            // held NO permissions at all: /auth/me returned an empty list, the
            // frontend hid every module, and the eight controllers that gate on
            // hasPermission() refused them outright.
            //
            // This is the same omission that getHierarchyLevel() already had
            // and already fixed — the two maps have to be corrected together or
            // the role is privileged for routing and unprivileged for features.
            // They sit with admin, which is where the hierarchy places them.
            'admin', 'hr', 'payroll_manager' => in_array($key, self::PERMISSIONS_ADMIN, true),
            'manager' => in_array($key, self::PERMISSIONS_MANAGER, true),
            'employee' => in_array($key, self::PERMISSIONS_EMPLOYEE, true),
            default => false,
        };
    }

    public function canAccess(string $key): bool
    {
        return $this->hasPermission($key);
    }

    public function getHierarchyLevel(): int
    {
        return $this->customRole?->hierarchy_level ?? match ($this->role) {
            'super_admin' => 0,
            'admin' => 10,
            // HR and payroll managers run payroll — PayslipController's
            // PAYROLL_ROLES has always listed them alongside admin — but they
            // were absent from this map and fell through to 999, which ranks
            // them BELOW a plain employee. Nothing exposed it while payroll
            // authorisation was inline; the moment the routes got a real role
            // gate, HR was locked out of their own module. Placed above line
            // managers and below admins: they can operate payroll, they cannot
            // administer the organisation.
            'hr', 'payroll_manager' => 20,
            'manager' => 50,
            'employee' => 100,
            // Unknown roles stay maximally unprivileged. Only the 'employee'
            // gate, which admits everyone, will let them through.
            default => 999,
        };
    }
}
