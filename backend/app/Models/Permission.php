<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Permission extends Model
{
    protected $fillable = [
        'key', 'name', 'group_name', 'description', 'plan_feature',
    ];

    protected $casts = [
        'plan_feature' => 'string',
    ];
}
