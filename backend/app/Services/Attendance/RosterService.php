<?php

namespace App\Services\Attendance;

use App\Models\EmployeeShiftRotation;
use App\Models\RosterDay;
use App\Models\Shift;
use App\Models\ShiftRotation;
use App\Models\User;
use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Building and publishing a roster.
 *
 * REGENERATING NEVER DESTROYS A DECISION. A manager who moved one person to
 * nights on the 14th must not lose that because the rota was rebuilt for the
 * month. Generation replaces only rows it produced (`source = generated`);
 * anything a human set is left exactly where it is.
 *
 * PUBLISHING IS THE ACT THAT MAKES A ROSTER REAL. Draft days are invisible to
 * ShiftResolver, so a manager can build next month in the open without
 * changing what attendance expects of anybody today. It is also why publishing
 * is separate rather than implied by saving.
 *
 * AN OFF DAY IS A ROW. A rotation's rest day produces a roster_day with a null
 * shift, not an absent row, because "you are off on Tuesday" and "nobody has
 * scheduled you" are different things to be told.
 *
 * A PAST DAY IS NOT REWRITTEN. Generation refuses to touch dates that have
 * already happened: the roster for last Tuesday is a record of what people
 * were told to work, and rebuilding it would quietly rewrite the expectation
 * every attendance record on that date was measured against.
 */
class RosterService
{
    /**
     * Generate a roster for a person over a range.
     *
     * Days are written as DRAFT. Nothing an employee sees changes until
     * somebody publishes.
     *
     * @return array{created: int, updated: int, skipped_manual: int, skipped_past: int}
     */
    public function generateForUser(User $user, Carbon|string $from, Carbon|string $to): array
    {
        $start = $this->day($from);
        $end = $this->day($to);

        if ($end->lessThan($start)) {
            throw new RuntimeException('The end date is before the start date.');
        }

        $created = 0;
        $updated = 0;
        $skippedManual = 0;
        $skippedPast = 0;
        $today = now()->startOfDay();

        DB::transaction(function () use (
            $user, $start, $end, $today, &$created, &$updated, &$skippedManual, &$skippedPast
        ) {
            foreach (CarbonPeriod::create($start, $end) as $date) {
                /*
                 * A roster already worked is a record of what people were told.
                 * Rebuilding it would rewrite the expectation every attendance
                 * record on that date was measured against.
                 */
                if ($date->lessThan($today)) {
                    $skippedPast++;

                    continue;
                }

                $assignment = $this->rotationFor($user, $date);

                if (! $assignment) {
                    continue;
                }

                $existing = RosterDay::query()
                    ->where('user_id', $user->id)
                    ->whereDate('roster_date', $date->toDateString())
                    ->first();

                if ($existing && $existing->isHumanSet()) {
                    $skippedManual++;

                    continue;
                }

                $shiftId = $this->shiftIdFor($assignment, $date);

                if ($existing) {
                    $existing->forceFill([
                        'shift_id' => $shiftId,
                        'shift_rotation_id' => $assignment->shift_rotation_id,
                        'source' => 'generated',
                    ])->save();
                    $updated++;

                    continue;
                }

                RosterDay::query()->create([
                    'organization_id' => $user->organization_id,
                    'user_id' => $user->id,
                    'roster_date' => $date->toDateString(),
                    'shift_id' => $shiftId,
                    'status' => 'draft',
                    'source' => 'generated',
                    'shift_rotation_id' => $assignment->shift_rotation_id,
                ]);
                $created++;
            }
        });

        return [
            'created' => $created,
            'updated' => $updated,
            'skipped_manual' => $skippedManual,
            'skipped_past' => $skippedPast,
        ];
    }

    /**
     * Publish a range.
     *
     * Returns how many days actually moved. A publish that silently affected
     * nothing - because the range was already published, or empty - looks
     * identical to one that worked, and the manager needs to know which.
     */
    public function publish(User $actor, Carbon|string $from, Carbon|string $to, ?array $userIds = null): int
    {
        $start = $this->day($from);
        $end = $this->day($to);

        return RosterDay::query()
            ->where('organization_id', $actor->organization_id)
            ->where('status', 'draft')
            ->whereDate('roster_date', '>=', $start->toDateString())
            ->whereDate('roster_date', '<=', $end->toDateString())
            ->when($userIds, fn (Builder $query) => $query->whereIn('user_id', $userIds))
            ->update([
                'status' => 'published',
                'published_at' => now(),
                'published_by' => $actor->id,
            ]);
    }

    /**
     * Set one person's day by hand.
     *
     * Marked `manual`, which is what protects it from the next regeneration.
     * Publishing state is preserved: editing a published day leaves it
     * published, because unpublishing somebody's Tuesday without telling them
     * is worse than changing it.
     */
    public function setDay(
        User $user,
        Carbon|string $date,
        ?Shift $shift,
        ?User $actor = null,
        ?string $note = null,
    ): RosterDay {
        $on = $this->day($date);

        if ($shift && (int) $shift->organization_id !== (int) $user->organization_id) {
            throw new RuntimeException('That shift belongs to another workspace.');
        }

        $day = RosterDay::query()->firstOrNew([
            'user_id' => $user->id,
            'roster_date' => $on->toDateString(),
        ]);

        $day->fill([
            'organization_id' => $user->organization_id,
            'shift_id' => $shift?->id,
            'source' => 'manual',
            'note' => $note,
            'status' => $day->exists ? $day->status : 'draft',
        ])->save();

        return $day->fresh();
    }

    /**
     * The published roster for a person on a date.
     *
     * Published only. A draft day is a plan, and a plan must not decide what
     * somebody is measured against.
     */
    public function publishedDayFor(?User $user, Carbon|string|null $date = null): ?RosterDay
    {
        if (! $user || ! $user->organization_id) {
            return null;
        }

        return RosterDay::query()
            ->where('user_id', $user->id)
            ->where('status', 'published')
            ->whereDate('roster_date', $this->day($date ?? now())->toDateString())
            ->first();
    }

    /**
     * Who is covering a date, and who is off.
     *
     * Both halves are returned. A cover report that lists only the people
     * working cannot answer "is anybody on nights tonight", which is the
     * question a rota exists for.
     *
     * @return array<int, array<string, mixed>>
     */
    public function coverageFor(int $organizationId, Carbon|string $date): array
    {
        return RosterDay::query()
            ->where('organization_id', $organizationId)
            ->where('status', 'published')
            ->whereDate('roster_date', $this->day($date)->toDateString())
            ->with(['user:id,name', 'shift:id,name,code,start_time,end_time'])
            ->get()
            ->map(fn (RosterDay $day) => [
                'user_id' => (int) $day->user_id,
                'name' => $day->user?->name,
                'shift' => $day->shift?->name,
                'shift_id' => $day->shift_id,
                // Explicit rather than inferred from a null shift, so a
                // consumer cannot mistake "off" for "missing".
                'is_rest_day' => $day->isRestDay(),
                'note' => $day->note,
            ])
            ->all();
    }

    /** The rotation assignment in force for somebody on a date. */
    private function rotationFor(User $user, Carbon $date): ?EmployeeShiftRotation
    {
        $on = $date->toDateString();

        return EmployeeShiftRotation::query()
            ->where('user_id', $user->id)
            ->where('is_active', true)
            ->whereDate('effective_from', '<=', $on)
            ->where(function (Builder $window) use ($on) {
                $window->whereNull('effective_to')->orWhereDate('effective_to', '>=', $on);
            })
            // Latest window wins; id breaks a same-day tie deterministically,
            // the same rule every other effective-dated resolver here uses.
            ->orderByDesc('effective_from')
            ->orderByDesc('id')
            ->first();
    }

    /**
     * Which shift the pattern puts somebody on, on a date.
     *
     * The day of the cycle is counted from the assignment's own start, plus the
     * person's offset. Counting from an epoch instead would mean everybody on a
     * rota rests on the same days, which is the opposite of what a rota is for.
     */
    private function shiftIdFor(EmployeeShiftRotation $assignment, Carbon $date): ?int
    {
        $rotation = ShiftRotation::query()->with('steps')->find($assignment->shift_rotation_id);

        if (! $rotation || ! $rotation->is_active || $rotation->cycle_length_days < 1) {
            return null;
        }

        $elapsed = (int) $assignment->effective_from->startOfDay()->diffInDays($date->copy()->startOfDay(), false);

        return $rotation->stepFor($elapsed + (int) $assignment->start_offset)?->shift_id;
    }

    private function day(Carbon|string $value): Carbon
    {
        return $value instanceof Carbon
            ? Carbon::parse($value->toDateString())->startOfDay()
            : Carbon::parse($value)->startOfDay();
    }
}
