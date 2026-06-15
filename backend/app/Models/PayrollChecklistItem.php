<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PayrollChecklistItem extends Model
{
    protected $table = 'payroll_checklist_items';

    protected $fillable = [
        'organization_id', 'category', 'check_code', 'label', 'description',
        'severity', 'affected_entity', 'sort_order', 'is_auto_resolvable', 'is_active',
    ];

    protected $casts = [
        'is_auto_resolvable' => 'boolean',
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function runChecks(): HasMany
    {
        return $this->hasMany(PayrollRunChecklist::class, 'checklist_item_id');
    }
}
