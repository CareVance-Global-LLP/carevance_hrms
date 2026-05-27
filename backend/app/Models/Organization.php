<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;
use Illuminate\Support\Facades\DB;
use App\Models\OrganizationStats;

class Organization extends Model
{
    public const SYSTEM_ROLE_HIERARCHY_LEVELS = [
        'admin' => 10,
        'manager' => 50,
        'employee' => 100,
    ];

    public const SYSTEM_ROLE_PERMISSION_DEFAULTS = [
        'manager' => [
            'dashboard.view', 'attendance.view', 'selfies.view',
            'employees.view', 'employees.manage', 'groups.view', 'groups.manage',
            'reports.view', 'monitoring.view', 'screenshots.view',
            'payroll.view', 'invoices.view', 'leave.view', 'leave.manage',
            'overtime.view', 'overtime.approve', 'tasks.view', 'tasks.manage',
            'projects.view', 'settings.view', 'notifications.publish',
            'audit.view',
        ],
        'employee' => [
            'dashboard.view', 'timer.use', 'chat.use',
        ],
    ];
    protected $fillable = [
        'name',
        'slug',
        'description',
        'website',
        'industry',
        'size',
        'phone',
        'email',
        'address_line',
        'city',
        'state',
        'postal_code',
        'country',
        'owner_user_id',
        'plan_code',
        'billing_cycle',
        'settings',
        'subscription_status',
        'subscription_intent',
        'trial_starts_at',
        'trial_ends_at',
        'subscription_expires_at',
        'max_seats',
        'pending_plan_code',
        'pending_billing_cycle',
        'pending_seats',
        'pending_upgrade_amount',
    ];

    protected $casts = [
        'settings' => 'array',
        'trial_starts_at' => 'datetime',
        'trial_ends_at' => 'datetime',
        'subscription_expires_at' => 'date',
        'max_seats' => 'integer',
        'pending_seats' => 'integer',
        'pending_upgrade_amount' => 'decimal:2',
    ];

    protected static function booted(): void
    {
        static::created(function (Organization $org) {
            $org->ensureSystemRolesExist();
        });
    }

    public function ensureSystemRolesExist(): void
    {
        DB::transaction(function () {
            foreach (self::SYSTEM_ROLE_HIERARCHY_LEVELS as $slug => $level) {
                if (\App\Models\Role::where('organization_id', $this->id)->where('slug', $slug)->exists()) {
                    continue;
                }

                $role = \App\Models\Role::create([
                    'organization_id' => $this->id,
                    'name' => ucfirst($slug),
                    'slug' => $slug,
                    'description' => ucfirst($slug) . ' role (system)',
                    'hierarchy_level' => $level,
                    'is_system' => true,
                    'is_active' => true,
                ]);

                $permKeys = self::SYSTEM_ROLE_PERMISSION_DEFAULTS[$slug] ?? \App\Models\Permission::pluck('key')->all();
                $permIds = \App\Models\Permission::whereIn('key', $permKeys)->pluck('id');
                $role->permissions()->attach($permIds);
            }
        });
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_user_id');
    }

    public function projects(): HasMany
    {
        return $this->hasMany(Project::class);
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function invitations(): HasMany
    {
        return $this->hasMany(Invitation::class);
    }

    public function tasks(): HasManyThrough
    {
        return $this->hasManyThrough(Task::class, Project::class);
    }

    public function stats(): HasMany
    {
        return $this->hasMany(OrganizationStats::class);
    }
}
