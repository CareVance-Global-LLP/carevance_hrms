<?php

namespace App\Models;

use App\Traits\Auditable;
use App\Traits\BelongsToOrganization;
use App\Traits\EncryptsPii;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeeGovernmentId extends Model
{
    use Auditable;
    use BelongsToOrganization;
    use EncryptsPii;

    protected $fillable = [
        'organization_id',
        'user_id',
        'id_type',
        'id_number',
        'status',
        'issue_date',
        'expiry_date',
        'notes',
        'employee_document_id',
        'reviewed_by',
        'reviewed_at',
    ];

    protected function casts(): array
    {
        return [
            'issue_date' => 'date:Y-m-d',
            'expiry_date' => 'date:Y-m-d',
            'reviewed_at' => 'datetime',

            // Aadhaar, PAN, passport, driving licence — whatever id_type says
            // this row holds. Encrypted at rest; id_number_bidx carries the
            // keyed lookup index EncryptsPii maintains.
            'id_number' => 'encrypted',
        ];
    }

    /** @return array<int, string> */
    public function piiColumns(): array
    {
        return ['id_number'];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function document(): BelongsTo
    {
        return $this->belongsTo(EmployeeDocument::class, 'employee_document_id');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }
}
