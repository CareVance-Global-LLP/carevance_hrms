<?php

namespace App\Services\Attendance;

use Illuminate\Database\Eloquent\Model;

/**
 * Which working-time policy applies to one person on one date, and HOW it was
 * arrived at.
 *
 * The source is not decoration. "Assigned to this employee", "the workspace
 * default" and "nothing configured" produce the same policy object in the first
 * two cases and none in the third, but they mean different things to a payslip
 * query and to the settings screen — a manager changing the default must be
 * able to see who it actually reaches. Collapsing them to a nullable policy
 * throws that away.
 */
final class ResolvedPolicy
{
    public const SOURCE_ASSIGNMENT = 'assignment';
    public const SOURCE_DEFAULT = 'default';
    public const SOURCE_NONE = 'none';

    public function __construct(
        public readonly string $kind,
        public readonly string $source,
        public readonly ?Model $policy = null,
        /** The employee_*_policies row, present only when source is assignment. */
        public readonly ?Model $assignment = null,
    ) {
    }

    public static function none(string $kind): self
    {
        return new self($kind, self::SOURCE_NONE);
    }

    public function exists(): bool
    {
        return $this->policy !== null;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'kind' => $this->kind,
            'source' => $this->source,
            'policy' => $this->policy?->toArray(),
            'assignment' => $this->assignment?->toArray(),
        ];
    }
}
