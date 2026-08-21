<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeeDocument extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'user_id',
        'title',
        'category',
        'file_path',
        'file_name',
        'file_disk',
        'mime_type',
        'file_size',
        'uploaded_by',
        'uploaded_at',
        'review_status',
        'notes',
        'meta',
        'part',
        'financial_year',
        // Whether the person this document is about may see it. False by
        // default: a record can hold a warning letter or a background check as
        // easily as an offer letter, and nothing here distinguishes them.
        'visible_to_employee',
    ];

    protected function casts(): array
    {
        return [
            'uploaded_at' => 'datetime',
            'file_size' => 'integer',
            'meta' => 'array',
            'visible_to_employee' => 'boolean',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }
}
