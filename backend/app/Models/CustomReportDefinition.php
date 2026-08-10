<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CustomReportDefinition extends Model
{
    use BelongsToOrganization;

    protected $table = 'custom_report_definitions';

    protected $fillable = [
        'organization_id', 'name', 'code', 'category', 'fields', 'filters',
        'grouping', 'sorting', 'export_format', 'is_shared', 'created_by',
    ];

    protected $casts = [
        'fields' => 'array',
        'filters' => 'array',
        'grouping' => 'array',
        'sorting' => 'array',
        'is_shared' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
