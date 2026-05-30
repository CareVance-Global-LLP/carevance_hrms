<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TaskLabel extends Model
{
    protected $fillable = [
        'organization_id',
        'name',
        'color',
    ];

    protected $casts = [
        'color' => 'string',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
