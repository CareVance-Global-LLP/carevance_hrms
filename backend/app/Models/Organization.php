<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;
use Illuminate\Support\Facades\DB;
use App\Models\OrganizationStats;

class Organization extends Model
{
    // Tests call Organization::factory(); without this trait every one of them
    // died with "Call to undefined method Organization::factory()".
    use HasFactory;

    public const SYSTEM_ROLE_HIERARCHY_LEVELS = [
        'admin' => 10,
        'manager' => 50,
        'employee' => 100,
    ];

    /**
     * What each system role is seeded with.
     *
     * DERIVED from User's constants, never a second copy. There used to be a
     * hand-written list here and it had already drifted: `manager` was missing
     * chat.use, assets.view and assets.manage, which User::PERMISSIONS_MANAGER
     * has granted all along. A manager with no custom role could chat; the same
     * manager with the seeded "Manager" role could not, and nothing said why.
     *
     * `admin` was worse — it had no entry at all, so the seeder fell through to
     * `Permission::pluck('key')` and gave each new organisation EVERY PERMISSION
     * ROW THAT HAPPENED TO EXIST THAT DAY. Rows added later never reached roles
     * already created, which is why seven organisations' admins could not open
     * Assets while an admin with no custom role could.
     *
     * @return array<string, list<string>>
     */
    public static function systemRolePermissionDefaults(): array
    {
        return [
            'admin' => \App\Models\User::PERMISSIONS_ADMIN,
            'manager' => \App\Models\User::PERMISSIONS_MANAGER,
            'employee' => \App\Models\User::PERMISSIONS_EMPLOYEE,
        ];
    }

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
        'auto_renew',
        'grace_ends_at',
        'last_renewal_at',
        'razorpay_mandate_id',
        'renewal_reminder_stage',
        'renewal_reminder_for',
    ];

    protected $casts = [
        'settings' => 'array',
        'trial_starts_at' => 'datetime',
        'trial_ends_at' => 'datetime',
        // 'date:Y-m-d' rather than 'date': a plain date cast serialises as a UTC
        // datetime, which reaches a client in a timezone ahead of UTC as the
        // previous calendar day. A renewal date is a calendar date.
        'subscription_expires_at' => 'date:Y-m-d',
        'grace_ends_at' => 'date:Y-m-d',
        'last_renewal_at' => 'date:Y-m-d',
        'renewal_reminder_for' => 'date:Y-m-d',
        'max_seats' => 'integer',
        'pending_seats' => 'integer',
        'pending_upgrade_amount' => 'decimal:2',
        'auto_renew' => 'boolean',
        'renewal_reminder_stage' => 'integer',
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

                $permKeys = self::systemRolePermissionDefaults()[$slug] ?? [];
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
