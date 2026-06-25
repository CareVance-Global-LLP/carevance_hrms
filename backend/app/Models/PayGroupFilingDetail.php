<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PayGroupFilingDetail extends Model
{
    protected $fillable = [
        'pay_group_id',
        'state_code',
        'state_name',
        'pt_enabled',
        'pt_establishment_id',
        'pt_registration_date',
        'pt_signatory',
        'lwf_enabled',
        'lwf_establishment_id',
        'lwf_registration_date',
        'lwf_signatory',
        'pf_registration_number',
        'pf_group_code',
        'esi_registration_number',
    ];

    protected function casts(): array
    {
        return [
            'pt_enabled' => 'boolean',
            'lwf_enabled' => 'boolean',
            'pt_registration_date' => 'date',
            'lwf_registration_date' => 'date',
        ];
    }

    public function payGroup(): BelongsTo
    {
        return $this->belongsTo(PayGroup::class);
    }
}
