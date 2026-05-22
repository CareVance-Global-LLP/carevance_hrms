<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;
use App\Models\OrganizationStats;

class Organization extends Model
{
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
