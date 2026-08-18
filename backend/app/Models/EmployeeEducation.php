<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One qualification an employee holds.
 *
 * Several per person is the normal case, which is the whole reason this is a
 * table rather than a column. The certificate lives in employee_documents and
 * is referenced, so the scan sits on the private disk with every other employee
 * document instead of acquiring a second storage path of its own.
 */
class EmployeeEducation extends Model
{
    use BelongsToOrganization;

    /**
     * Stated explicitly: Laravel treats "education" as uncountable and derives
     * `employee_education`, which is not the table the migration creates.
     */
    protected $table = 'employee_educations';

    protected $fillable = [
        'organization_id',
        'user_id',
        'qualification',
        'institution',
        'specialisation',
        'year_of_passing',
        'grade',
        'employee_document_id',
        'notes',
    ];

    protected $casts = [
        'year_of_passing' => 'integer',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /** The certificate, if one was uploaded. */
    public function document(): BelongsTo
    {
        return $this->belongsTo(EmployeeDocument::class, 'employee_document_id');
    }
}
