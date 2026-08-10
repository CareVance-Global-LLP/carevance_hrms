<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AttendanceHoliday extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'holiday_date',
        'country',
        'title',
        'details',
        'created_by',
        'updated_by',
    ];

    protected function casts(): array
    {
        return [
            'holiday_date' => 'date:Y-m-d',
        ];
    }

    public static function normalizeCountry(?string $value): string
    {
        $normalized = strtoupper(trim((string) $value));

        return $normalized !== '' ? $normalized : 'ALL';
    }

    public static function countryForSettings(?array $settings): string
    {
        $country = self::normalizeCountry((string) data_get($settings, 'country'));
        if ($country !== 'ALL') {
            return $country;
        }

        $timezone = strtolower(trim((string) data_get($settings, 'timezone')));
        if ($timezone === 'asia/kolkata') {
            return 'INDIA';
        }
        if (str_starts_with($timezone, 'america/')) {
            return 'USA';
        }
        if ($timezone === 'europe/london') {
            return 'UK';
        }
        if ($timezone === 'asia/dubai') {
            return 'UAE';
        }
        if (str_starts_with($timezone, 'australia/')) {
            return 'AUSTRALIA';
        }

        return 'ALL';
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
