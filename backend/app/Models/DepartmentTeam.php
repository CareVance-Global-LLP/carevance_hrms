<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class DepartmentTeam extends Model
{
    use BelongsToOrganization;

    protected $table = 'department_teams';

    protected $fillable = [
        'organization_id',
        'department_id',
        'name',
        'slug',
        'description',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Group::class, 'department_id');
    }

    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'department_team_members', 'team_id', 'user_id')
            ->withTimestamps();
    }

    public function managers(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'department_team_managers', 'team_id', 'user_id')
            ->withTimestamps();
    }
}
