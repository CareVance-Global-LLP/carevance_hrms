<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class OrganizationStats extends Model
{
    use HasFactory;

    protected $fillable = [
        'organization_id',
        'total_users',
        'active_users',
        'storage_used',
        'last_activity',
    ];

    protected $casts = [
        'last_activity' => 'datetime',
    ];

    public function organization()
    {
        return $this->belongsTo(Organization::class);
    }
}
