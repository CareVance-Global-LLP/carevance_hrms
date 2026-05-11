<?php

namespace App\Models;

use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class LeaveRequest extends Model
{
    protected $fillable = [
        'organization_id',
        'user_id',
        'start_date',
        'end_date',
        'leave_type',
        'reason',
        'status',
        'revoke_status',
        'revoke_requested_at',
        'revoke_reviewed_by',
        'revoke_reviewed_at',
        'revoke_review_note',
        'reviewed_by',
        'reviewed_at',
        'review_note',
    ];

    protected function casts(): array
    {
        return [
            'start_date' => 'date',
            'end_date' => 'date',
            'leave_type' => 'string',
            'reviewed_at' => 'datetime',
            'revoke_requested_at' => 'datetime',
            'revoke_reviewed_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }

    public function revokeReviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'revoke_reviewed_by');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function isHalfDay(): bool
    {
        return $this->leave_type === 'half_day';
    }

    public function hasExpiredPendingWindow(?Carbon $reference = null): bool
    {
        $referenceDate = ($reference ?: now())->copy()->startOfDay();

        return $this->status === 'pending'
            && $this->end_date instanceof Carbon
            && $this->end_date->copy()->startOfDay()->lt($referenceDate);
    }

    public static function expirePendingRequestsForOrganization(int $organizationId, ?Carbon $reference = null): int
    {
        $referenceDate = ($reference ?: now())->copy()->startOfDay()->toDateString();

        return DB::table('leave_requests')
            ->where('organization_id', $organizationId)
            ->where('status', 'pending')
            ->whereDate('end_date', '<', $referenceDate)
            ->update([
                'status' => 'auto_cancelled',
                'review_note' => DB::raw("COALESCE(review_note, 'Auto-cancelled because the leave date passed without approval.')"),
                'reviewed_at' => now(),
                'updated_at' => now(),
            ]);
    }

    public function unitsForDate(Carbon|string $date): float
    {
        $targetDate = $date instanceof Carbon ? $date->toDateString() : Carbon::parse($date)->toDateString();
        if ($targetDate < $this->start_date->toDateString() || $targetDate > $this->end_date->toDateString()) {
            return 0.0;
        }

        return $this->isHalfDay() ? 0.5 : 1.0;
    }

    public function effectiveUnitsInRange(Carbon $startDate, Carbon $endDate): float
    {
        $overlapStart = $this->start_date->copy()->startOfDay()->max($startDate->copy()->startOfDay());
        $overlapEnd = $this->end_date->copy()->startOfDay()->min($endDate->copy()->startOfDay());

        if ($overlapStart->greaterThan($overlapEnd)) {
            return 0.0;
        }

        if ($this->isHalfDay()) {
            return 0.5;
        }

        return (float) ($overlapStart->diffInDays($overlapEnd) + 1);
    }

    public function effectiveDateEntriesInRange(Carbon $startDate, Carbon $endDate, bool $excludeWeekends = false): Collection
    {
        $overlapStart = $this->start_date->copy()->startOfDay()->max($startDate->copy()->startOfDay());
        $overlapEnd = $this->end_date->copy()->endOfDay()->min($endDate->copy()->endOfDay());

        if ($overlapStart->greaterThan($overlapEnd)) {
            return collect();
        }

        return collect(CarbonPeriod::create($overlapStart->copy()->startOfDay(), $overlapEnd->copy()->startOfDay()))
            ->filter(fn (Carbon $date) => !$excludeWeekends || !$date->isWeekend())
            ->map(fn (Carbon $date) => [
                'date' => $date->toDateString(),
                'units' => $this->unitsForDate($date),
                'leave_type' => $this->leave_type ?: 'full_day',
            ])
            ->values();
    }
}
