<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Role extends Model
{
    protected $fillable = [
        'organization_id', 'name', 'slug', 'description',
        'hierarchy_level', 'color', 'is_system', 'is_active',
    ];

    protected $casts = [
        'hierarchy_level' => 'integer',
        'color' => 'string',
        'is_system' => 'boolean',
        'is_active' => 'boolean',
    ];

    public static function defaultColorForLevel(int $level): string
    {
        $palette = [
            1 => 'rose', 2 => 'pink', 3 => 'fuchsia', 4 => 'purple', 5 => 'violet',
            6 => 'indigo', 7 => 'blue', 8 => 'sky', 9 => 'teal', 10 => 'emerald',
            11 => 'lime', 12 => 'amber', 13 => 'orange',
        ];

        $idx = (($level - 1) % 13 + 13) % 13 + 1;

        return $palette[$idx] ?? 'slate';
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'role_permissions')
            ->withTimestamps();
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class, 'role_id');
    }

    public function hasPermission(string $key): bool
    {
        return $this->permissions()->where('key', $key)->exists();
    }

    public function scopeActive($query)
    {
        return $query->where('is_active', true);
    }

    public function scopeSystem($query)
    {
        return $query->where('is_system', true);
    }
}
