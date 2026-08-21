<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Whose finger the device thinks it read.
 *
 * The id here is enrolled on the device keypad and has nothing to do with
 * anything in this system. Mapping it to a person is the step every integration
 * of this kind actually breaks at, so it is an explicit row an admin can see and
 * correct rather than a convention like "device id equals employee code".
 *
 * A null user_id means "seen, not yet claimed" — a state to surface, not an
 * error to drop. Punches keep arriving and attach themselves once somebody
 * claims the id.
 */
class BiometricDeviceUser extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'device_user_id',
        'user_id',
        'first_seen_at',
    ];

    protected $casts = [
        'first_seen_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
