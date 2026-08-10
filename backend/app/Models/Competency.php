<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Competency extends Model
{
    use BelongsToOrganization;
    use HasFactory;

    public const DEFAULTS = [
        ['name' => 'Communication', 'description' => 'Clarity and effectiveness in written and verbal exchanges.'],
        ['name' => 'Ownership', 'description' => 'Taking responsibility for outcomes end to end.'],
        ['name' => 'Craft & quality', 'description' => 'Skill and rigor in the core work of the role.'],
        ['name' => 'Collaboration', 'description' => 'Working across people and teams to get things done.'],
        ['name' => 'Leadership', 'description' => 'Guiding, mentoring, and raising the bar for others.'],
    ];

    protected $fillable = [
        'organization_id',
        'name',
        'description',
        'sort_order',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'sort_order' => 'integer',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /** Create the default competency set for an organization that has none. */
    public static function seedDefaults(int $organizationId): void
    {
        foreach (self::DEFAULTS as $index => $default) {
            self::create([
                'organization_id' => $organizationId,
                'name' => $default['name'],
                'description' => $default['description'],
                'sort_order' => $index,
                'is_active' => true,
            ]);
        }
    }
}
