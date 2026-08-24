<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One reading from a device.
 *
 * Deliberately a record of what the hardware SAID, not a conclusion about what
 * somebody did. Direction is not taken from `device_status`: that field is set
 * by whichever key the person pressed, and in practice everybody presses the
 * same one. In/out is decided downstream from the sequence of punches in a day.
 */
class BiometricPunch extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'biometric_device_id',
        'device_user_id',
        'user_id',
        'punched_at',
        'device_status',
        'verify_mode',
        'processed_at',
        'process_result',
    ];

    protected $casts = [
        'punched_at' => 'datetime',
        'processed_at' => 'datetime',
    ];

    public function device(): BelongsTo
    {
        return $this->belongsTo(BiometricDevice::class, 'biometric_device_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
