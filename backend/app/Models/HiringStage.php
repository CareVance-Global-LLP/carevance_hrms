<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One step in an organization's hiring pipeline.
 *
 * Configurable because a startup runs three stages and an enterprise runs
 * eight. `kind` is what stops that flexibility becoming meaningless: the
 * product needs to know a stage schedules interviews or produces an offer, and
 * a customer renaming "Interview" to "Tech Round" must not break either.
 */
class HiringStage extends Model
{
    use BelongsToOrganization;

    public const KINDS = ['screening', 'interview', 'offer', 'hired', 'rejected'];

    protected $fillable = [
        'organization_id',
        'name',
        'slug',
        'position',
        'kind',
        'is_terminal',
        'is_active',
    ];

    protected $casts = [
        'position' => 'integer',
        'is_terminal' => 'boolean',
        'is_active' => 'boolean',
    ];

    public function applications(): HasMany
    {
        return $this->hasMany(JobApplication::class);
    }

    /**
     * The pipeline every new organization starts with.
     *
     * Deliberately short. A customer will rename and extend these, and a long
     * default pipeline is one somebody has to delete their way out of before
     * they can use the product at all.
     *
     * @return array<int, array<string, mixed>>
     */
    public static function defaults(): array
    {
        return [
            ['name' => 'Applied', 'slug' => 'applied', 'kind' => 'screening', 'position' => 0],
            ['name' => 'Screening', 'slug' => 'screening', 'kind' => 'screening', 'position' => 1],
            ['name' => 'Interview', 'slug' => 'interview', 'kind' => 'interview', 'position' => 2],
            ['name' => 'Offer', 'slug' => 'offer', 'kind' => 'offer', 'position' => 3],
            ['name' => 'Hired', 'slug' => 'hired', 'kind' => 'hired', 'position' => 4, 'is_terminal' => true],
        ];
    }
}
