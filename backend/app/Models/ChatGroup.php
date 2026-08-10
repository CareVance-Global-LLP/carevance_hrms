<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ChatGroup extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'created_by',
        'name',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function members(): HasMany
    {
        return $this->hasMany(ChatGroupMember::class, 'group_id');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(ChatGroupMessage::class, 'group_id');
    }
}
