<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TaxWizardSession extends Model
{
    protected $table = 'tax_wizard_sessions';

    protected $fillable = [
        'organization_id', 'user_id', 'financial_year', 'current_step',
        'step_data', 'tax_regime', 'estimated_tax_old', 'estimated_tax_new', 'status',
    ];

    protected $casts = [
        'step_data' => 'array',
        'estimated_tax_old' => 'decimal:2',
        'estimated_tax_new' => 'decimal:2',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
