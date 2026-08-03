<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeeProfile extends Model
{
    use HasFactory;

    protected $fillable = [
        'organization_id',
        'user_id',
        'first_name',
        'last_name',
        'display_name',
        'gender',
        'date_of_birth',
        'phone',
        'personal_email',
        'address_line',
        'city',
        'state',
        'postal_code',
        'emergency_contact_name',
        'emergency_contact_number',
        'emergency_contact_relationship',
        'meta',
    ];

    protected function casts(): array
    {
        return [
            'date_of_birth' => 'date',
            'meta' => 'array',
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
}
