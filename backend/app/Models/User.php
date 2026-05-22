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
        'organization_id',
        'invited_by',
        'avatar',
        'settings',
        'last_seen_at',
        'email_verified_at',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'remember_token',
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
        ];
    }

    protected $appends = ['is_active', 'is_online'];

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

    public function getIsActiveAttribute(): bool
    {
        return true;
    }

    public function getIsOnlineAttribute(): bool
    {
        if (!$this->last_seen_at) {
            return false;
        }

        return $this->last_seen_at->greaterThanOrEqualTo(now()->subMinutes(2));
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
        $verificationUrl = URL::temporarySignedRoute(
            'api.verification.verify',
            now()->addMinutes((int) config('carevance.auth.email_verification_expire_minutes', 1440)),
            [
                'id' => $this->getKey(),
                'hash' => sha1((string) $this->email),
            ]
        );

        Mail::to($this->email)->queue(new VerifyEmailMail($this, $verificationUrl));
    }

    public function sendPasswordResetNotification(#[\SensitiveParameter] $token): void
    {
        $resetUrl = rtrim((string) config('carevance.frontend_url', config('app.url')), '/').'/reset-password?'.http_build_query([
            'token' => $token,
            'email' => $this->email,
        ]);

        Mail::to($this->email)->queue(new PasswordResetMail($this, $resetUrl));
    }
}
