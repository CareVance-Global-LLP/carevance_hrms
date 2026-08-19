<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An effective-dated assignment of one shift to one person.
 *
 * The assignment key is the employee, never the department or the location —
 * those are how you choose whom to assign, not what the assignment hangs off.
 * Re-rostering someone is a new row with a later effective_from, not an edit,
 * so history stays readable and a payroll re-run for an earlier month resolves
 * the shift that was actually in force then.
 */
class EmployeeShift extends Model
{
    use BelongsToOrganization;
    use HasFactory;

    protected $table = 'employee_shifts';

    protected $fillable = [
        'organization_id',
        'user_id',
        'shift_id',
        'effective_from',
        'effective_to',
        'is_active',
        'custom_differential_rate',
    ];

    protected function casts(): array
    {
        return [
            // date:Y-m-d, not date — a plain date cast serialises as UTC
            // midnight, so an assignment effective from the 1st reaches an
            // IST client as the 31st and a roster change appears to have
            // happened a day early.
            'effective_from' => 'date:Y-m-d',
            'effective_to' => 'date:Y-m-d',
            'is_active' => 'boolean',
            'custom_differential_rate' => 'decimal:2',
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

    public function shift(): BelongsTo
    {
        return $this->belongsTo(Shift::class);
    }
}
