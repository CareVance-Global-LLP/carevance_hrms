<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One monitoring figure, one threshold, one audience.
 *
 * Deliberately not a general expression engine. A rule anyone can read at a
 * glance — "tell the admins when somebody tracked under six hours" — is worth
 * more than one that can express anything and is understood by nobody.
 */
class MonitoringAlertRule extends Model
{
    use BelongsToOrganization;

    /** Somebody tracked less than the threshold (seconds) on the day. */
    public const METRIC_TRACKED_BELOW = 'tracked_seconds_below';

    /** Somebody recorded nothing at all on a day they were expected to work. */
    public const METRIC_NO_ACTIVITY = 'no_activity';

    /** Idle ran above the threshold (whole percent) as a share of tracked time. */
    public const METRIC_IDLE_SHARE_ABOVE = 'idle_share_above';

    public const METRICS = [
        self::METRIC_TRACKED_BELOW,
        self::METRIC_NO_ACTIVITY,
        self::METRIC_IDLE_SHARE_ABOVE,
    ];

    protected $fillable = [
        'organization_id',
        'name',
        'metric',
        'threshold',
        'group_id',
        'is_enabled',
        'last_evaluated_at',
    ];

    protected function casts(): array
    {
        return [
            'threshold' => 'integer',
            'group_id' => 'integer',
            'is_enabled' => 'boolean',
            'last_evaluated_at' => 'datetime',
        ];
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class);
    }

    /** Human phrasing, used in the alert itself so the rule explains itself. */
    public function describe(): string
    {
        return match ($this->metric) {
            self::METRIC_TRACKED_BELOW => sprintf('tracked less than %s', $this->formatHours((int) $this->threshold)),
            self::METRIC_NO_ACTIVITY => 'recorded no tracked time at all',
            self::METRIC_IDLE_SHARE_ABOVE => sprintf('spent more than %d%% of tracked time idle', (int) $this->threshold),
            default => 'crossed a monitoring threshold',
        };
    }

    private function formatHours(int $seconds): string
    {
        $hours = intdiv($seconds, 3600);
        $minutes = intdiv($seconds % 3600, 60);

        if ($hours > 0 && $minutes > 0) {
            return sprintf('%dh %02dm', $hours, $minutes);
        }

        return $hours > 0 ? sprintf('%dh', $hours) : sprintf('%dm', $minutes);
    }
}
