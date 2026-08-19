<?php

namespace App\Services\Attendance;

use App\Models\EmployeeShift;
use App\Models\Shift;
use Carbon\Carbon;

/**
 * One shift INSTANCE: the pattern plus the calendar date it is being run on.
 *
 * The date is carried explicitly rather than inferred from the start instant,
 * because for a night shift they differ — a 22:00→06:00 shift on the 19th ends
 * at 06:00 on the 20th, and every punch in that window belongs to the 19th.
 * Bucketing punches by their own calendar date is precisely the bug this shape
 * exists to prevent.
 *
 * expectedSeconds is nullable on purpose. Null means "we know when this person
 * starts but not how long they work", which is a different fact from "they work
 * eight hours", and only the caller is entitled to turn one into the other.
 */
final class ResolvedShift
{
    public function __construct(
        public readonly Carbon $attendanceDate,
        public readonly string $source,
        public readonly ?Shift $shift = null,
        public readonly ?EmployeeShift $assignment = null,
        public readonly ?Carbon $startsAt = null,
        public readonly ?Carbon $endsAt = null,
        public readonly ?int $expectedSeconds = null,
    ) {
    }

    public function crossesMidnight(): bool
    {
        if (!$this->endsAt) {
            return false;
        }

        return $this->endsAt->toDateString() !== $this->attendanceDate->toDateString();
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'attendance_date' => $this->attendanceDate->toDateString(),
            'source' => $this->source,
            'shift_id' => $this->shift?->id,
            'shift_name' => $this->shift?->name,
            'shift_code' => $this->shift?->code,
            'starts_at' => $this->startsAt?->toIso8601String(),
            'ends_at' => $this->endsAt?->toIso8601String(),
            'crosses_midnight' => $this->crossesMidnight(),
            'expected_seconds' => $this->expectedSeconds,
        ];
    }
}
