<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class LeaveRequest extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'user_id',
        'start_date',
        'end_date',
        'leave_type',
        'leave_category',
        'consumed_breakdown',
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
        'escalated_to_user_id',
        'escalation_history',
    ];

    protected function casts(): array
    {
        return [
            'start_date' => 'date:Y-m-d',
            'end_date' => 'date:Y-m-d',
            'leave_type' => 'string',
            'leave_category' => 'string',
            'consumed_breakdown' => 'array',
            'reviewed_at' => 'datetime',
            'revoke_requested_at' => 'datetime',
            'revoke_reviewed_at' => 'datetime',
            'escalation_history' => 'array',
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

    public function escalatedTo(): BelongsTo
    {
        return $this->belongsTo(User::class, 'escalated_to_user_id');
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

    /**
     * Split this leave's units for a single date into paid and unpaid.
     *
     * The paid/unpaid decision lives in `leave_category`: 'unpaid' is the only
     * unpaid category (LeavePolicyService::resolvePolicyCategories refuses to
     * register any other), everything else is drawn from a quota and is paid.
     *
     * When a request overruns its quota the approver records the split in
     * `consumed_breakdown`. Quota is consumed chronologically, so the earliest
     * days of the request are the paid ones and the overflow is unpaid.
     *
     * @return array{paid: float, unpaid: float}
     */
    public function paidUnpaidUnitsForDate(Carbon|string $date): array
    {
        $units = $this->unitsForDate($date);
        if ($units <= 0) {
            return ['paid' => 0.0, 'unpaid' => 0.0];
        }

        if (strtolower(trim((string) ($this->leave_category ?: 'paid'))) === 'unpaid') {
            return ['paid' => 0.0, 'unpaid' => $units];
        }

        $paidQuotaUnits = $this->paidUnitsFromBreakdown();
        if ($paidQuotaUnits === null) {
            return ['paid' => $units, 'unpaid' => 0.0];
        }

        // Walk the request's own days in order and work out how much paid quota
        // is still unspent by the time we reach $date.
        $targetDate = $date instanceof Carbon ? $date->toDateString() : Carbon::parse($date)->toDateString();
        $spentBefore = 0.0;
        foreach (CarbonPeriod::create($this->start_date->copy()->startOfDay(), $this->end_date->copy()->startOfDay()) as $day) {
            if ($day->toDateString() >= $targetDate) {
                break;
            }
            $spentBefore += $this->unitsForDate($day);
        }

        $paid = max(0.0, min($units, $paidQuotaUnits - $spentBefore));

        return ['paid' => $paid, 'unpaid' => round($units - $paid, 2)];
    }

    /**
     * Paid units recorded on `consumed_breakdown`, or null when the request has
     * no breakdown and should therefore be treated as wholly paid.
     */
    private function paidUnitsFromBreakdown(): ?float
    {
        $breakdown = collect((array) ($this->consumed_breakdown ?? []))
            ->filter(fn ($row) => is_array($row));

        if ($breakdown->isEmpty()) {
            return null;
        }

        return (float) $breakdown
            ->reject(fn (array $row) => strtolower(trim((string) ($row['category'] ?? 'unpaid'))) === 'unpaid')
            ->sum(fn (array $row) => (float) ($row['units'] ?? 0));
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
