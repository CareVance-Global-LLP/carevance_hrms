<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeeProfile extends Model
{
    use BelongsToOrganization;
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
        // These six columns exist and are read all over payroll —
        // User::statutoryId() checks pan_number first, and PayrollController
        // calls $profile->fill([...]) with every one of them. None were
        // fillable, so that fill() silently discarded the lot: 0 of 86 profiles
        // on the live database carry a pan_number, while employee_government_ids
        // holds 98 PAN rows. The save appeared to succeed and wrote nothing.
        'pan_number',
        'uan_number',
        'esi_ip_number',
        'tax_regime',
        'is_metro_city',
        'pt_state',
        'meta',
    ];

    protected function casts(): array
    {
        return [
            // date:Y-m-d, not date. A plain `date` cast serialises as a UTC
            // datetime, so a birthday stored as 1996-08-24 leaves the API as
            // "1996-08-23T18:30:00.000000Z" and reaches every Indian client a
            // day early — and the detail page rendered that string verbatim.
            'date_of_birth' => 'date:Y-m-d',
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
