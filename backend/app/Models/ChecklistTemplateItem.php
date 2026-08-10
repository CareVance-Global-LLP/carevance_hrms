<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ChecklistTemplateItem extends Model
{
    public const OWNER_KINDS = ['hr', 'manager', 'employee', 'it', 'finance', 'buddy'];
    public const REQUIRES = ['none', 'document', 'asset_return', 'acknowledgement'];

    protected $fillable = [
        'checklist_template_id',
        'title',
        'description',
        'owner_kind',
        'offset_days',
        'requires',
        'document_category',
        'is_blocking',
        'sort_order',
    ];

    protected $casts = [
        'offset_days' => 'integer',
        'is_blocking' => 'boolean',
        'sort_order' => 'integer',
    ];

    public function template(): BelongsTo
    {
        return $this->belongsTo(ChecklistTemplate::class, 'checklist_template_id');
    }
}
