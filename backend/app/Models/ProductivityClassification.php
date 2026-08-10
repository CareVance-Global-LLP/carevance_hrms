<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;

class ProductivityClassification extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'target_type',
        'target_value',
        'classification',
        'created_by',
    ];

    protected $casts = [
        'organization_id' => 'integer',
        'created_by' => 'integer',
    ];
}
