<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AttendanceSelfie extends Model
{
    protected $fillable = [
        'user_id',
        'attendance_date',
        'image_path',
        'latitude',
        'longitude',
        'accuracy_meters',
    ];

    protected function casts(): array
    {
        return [
            'attendance_date' => 'date',
            'latitude' => 'float',
            'longitude' => 'float',
            'accuracy_meters' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function getImageUrlAttribute(): string
    {
        if (! $this->image_path) {
            return '';
        }

        return '/api/media/public/'.$this->image_path;
    }
}
