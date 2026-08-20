<?php

namespace App\Services\Attendance;

use App\Models\EmployeeShift;
use App\Models\Shift;
use App\Models\User;
use Carbon\Carbon;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Builder;

/**
 * The single answer to "which shift is this person on, on this date".
 *
 * Resolution order, most specific first:
 *
 *   1. An active EmployeeShift assignment whose [effective_from, effective_to]
 *      window contains the date. effective_to NULL is open-ended. When several
 *      windows overlap — which they routinely do, because the previous
 *      assignment is usually left open-ended when a new one is added — the
 *      latest effective_from wins.
 *   2. employee_work_infos.shift_name, if it names a shift the organization
 *      actually has. This is the pre-shift-domain way people were rostered and
 *      a lot of rows still carry it.
 *   3. employee_work_infos.expected_start_time on its own, which gives a start
 *      but no length.
 *   4. Null.
 *
 * There is no fifth step. The resolver never invents a shift length, so
 * "unconfigured" stays visible to the caller instead of being laundered into a
 * plausible-looking eight hours by the layer least able to judge it.
 *
 * Two directions, and the second is the one that decides money:
 *
 *   occurrenceFor($user, $date)     date   → the shift instance running on it,
 *                                            both ends as real datetimes in
 *                                            the employee's own wall clock.
 *   attendanceDateFor($user, $when) instant → the attendance date it belongs
 *                                            to, which for a night worker
 *                                            punching at 01:30 is YESTERDAY.
 *
 * Tenancy: every lookup is pinned with forOrganization($user->organization_id)
 * rather than leaning on the ambient global scope. The scope is deliberately a
 * no-op when nothing is authenticated, so a scheduled command or a queued job
 * asking about one employee would otherwise be free to match another tenant's
 * assignment row.
 *
 * WEEKLY OFFS, AND WHY THEY DO NOT DELETE THE SHIFT
 * ------------------------------------------------
 * Two different things can say "not today", and they are not the same thing:
 *
 *   shifts.applicable_days   a property of the PATTERN — which days this shift
 *                            ever runs on. Empty means every day.
 *   WeeklyOffPolicy          a property of the PERSON — which days they are
 *                            off. Empty means nothing is off.
 *
 * A date has to pass both, but they produce different SHAPES of answer, and
 * that asymmetry is the precedence decision:
 *
 *   - A day the pattern does not run has no instance at all. resolve() returns
 *     null, exactly as it did before weekly offs existed. There is nothing to
 *     describe: the shift genuinely is not scheduled.
 *   - A weekly off KEEPS the instance and zeroes expectedSeconds. The shift is
 *     still the shift; only the expectation is nil.
 *
 * Keeping it is load-bearing twice over. Work on a weekly off is ordinary —
 * it is the reason Weekly Off is one of the three independent overtime scopes —
 * and a night shift that begins at 22:00 on a weekly off must still claim the
 * punches that land after midnight, which attendanceDateFor() can only do by
 * looking at the previous date's occurrence window. Returning null on a weekly
 * off would silently move half of that night onto the next day.
 *
 * So: policy wins over the shift's own columns wherever both speak, and where
 * the policy says "off" the answer is zero hours rather than no shift. An
 * organization with no weekly-off policy configured is untouched by every line
 * of this — isWeeklyOff is false and nothing else changes.
 */
class ShiftResolver
{
    public const SOURCE_ASSIGNMENT = 'assignment';
    public const SOURCE_WORK_INFO_SHIFT = 'work_info_shift';
    public const SOURCE_WORK_INFO_TIME = 'work_info_time';

    /**
     * How long past its scheduled end a shift may still claim an instant.
     *
     * Overrun is ordinary: the handover runs long and the punch-out lands at
     * 06:12 on a shift scheduled to end at 06:00. Without a tail those twelve
     * minutes open a second attendance record on the next date, and one night's
     * work is reported as two partial days. Two hours is wide enough for a real
     * overrun and far narrower than the gap to the next occurrence of any shift
     * short enough to have one (a 22:00→06:00 shift's tail closes at 08:00; the
     * next one does not begin until 22:00), so it can never make two
     * occurrences compete for the same instant.
     */
    public const OVERRUN_TOLERANCE_MINUTES = 120;

    public function __construct(
        private readonly UserTimezoneResolver $timezones,
        private readonly WeeklyOffResolver $weeklyOffs,
    ) {
    }

    public function resolve(?User $user, Carbon|string|null $date = null): ?ResolvedShift
    {
        if (!$user || !$user->organization_id) {
            return null;
        }

        $on = $this->normalizeDate($date);

        $resolved = null;

        $assignment = $this->assignmentFor($user, $on);
        if ($assignment) {
            $shift = $this->shiftFor($user, (int) $assignment->shift_id);

            if ($shift) {
                $resolved = $this->instance($shift, $on, self::SOURCE_ASSIGNMENT, $assignment);
            }
        }

        $resolved ??= $this->fromWorkInfo($user, $on);

        if ($resolved === null) {
            return null;
        }

        // The pattern stands; only the expectation changes. See the class
        // docblock for why this is not a null.
        return $this->weeklyOffs->isWeeklyOff($user, $on)
            ? $resolved->onWeeklyOff()
            : $resolved;
    }

    /**
     * The work seconds expected of this person on this date.
     *
     * Three distinct answers, and collapsing any two of them is a bug:
     *
     *   null  nothing usable is configured. The caller supplies the default —
     *         see the class docblock.
     *   0     a weekly off. Known, and none are owed.
     *   n     the shift length less its unpaid break.
     *
     * Zero is answered even when no shift pattern exists at all: an
     * organization that has assigned a weekly-off policy has said this date is
     * off, and that is a complete answer on its own.
     */
    public function expectedSecondsFor(?User $user, Carbon|string|null $date = null): ?int
    {
        if ($user && $user->organization_id && $this->weeklyOffs->isWeeklyOff($user, $date)) {
            return 0;
        }

        return $this->resolve($user, $date)?->expectedSeconds;
    }

    /**
     * Is this date one of the person's weekly offs? Exposed here so callers
     * already holding a ShiftResolver do not need a second dependency.
     */
    public function isWeeklyOff(?User $user, Carbon|string|null $date = null): bool
    {
        return $this->weeklyOffs->isWeeklyOff($user, $date);
    }

    /**
     * The shift OCCURRENCE for a person on a calendar date: the attendance date
     * plus both ends as full datetimes in that person's own wall clock.
     *
     * This is the forward direction of the night-shift problem. resolve() gives
     * the pattern and its length in whatever zone the caller happened to hand
     * in; an occurrence is anchored in the employee's resolved timezone (see
     * UserTimezoneResolver) and for a night shift its end lands on the NEXT
     * calendar date while the attendance date stays the date the shift began.
     *
     * $date is read as a calendar date. A Carbon passed here contributes only
     * its Y-m-d — its own time and zone are ignored, because "the shift on the
     * 19th" must not become the 18th just because the caller's clock was behind
     * the employee's.
     */
    public function occurrenceFor(?User $user, Carbon|string|null $date = null): ?ShiftOccurrence
    {
        if (! $user || ! $user->organization_id) {
            return null;
        }

        $timezone = $this->timezones->forUser($user);
        $on = $this->normalizeDateIn($date, $timezone);

        $resolved = $this->resolve($user, $on->toDateString());
        if (! $resolved || ! $resolved->startsAt) {
            return null;
        }

        // The wall clock the shift starts at. Taken from the pattern when there
        // is one, otherwise from the resolved start — which for the
        // work_info_time source is the only time anybody configured.
        $startsAtWallClock = $resolved->shift?->start_time ?? $resolved->startsAt->format('H:i:s');
        $start = $this->wallClockOn($on, $startsAtWallClock, $timezone);

        $span = $resolved->shift?->spanMinutes();

        return new ShiftOccurrence(
            attendanceDate: $on,
            timezone: $timezone,
            source: $resolved->source,
            shiftStartAt: $start,
            // Elapsed time, not a clock offset: a shift is N minutes of work
            // wherever the calendar puts them. Across a DST transition that is
            // deliberately a different wall clock at the far end.
            shiftEndAt: ($span !== null && $span > 0) ? $start->copy()->addMinutes($span) : null,
            expectedSeconds: $resolved->expectedSeconds,
            shift: $resolved->shift,
            assignment: $resolved->assignment,
            isWeeklyOff: $resolved->isWeeklyOff,
        );
    }

    /**
     * The inverse, and the one that decides where hours are booked: given an
     * instant, which attendance date does it belong to for this person?
     *
     * The rule, stated in full:
     *
     *   An instant belongs to its OWN calendar date in the employee's
     *   timezone — UNLESS the PREVIOUS date's occurrence crosses midnight and
     *   the instant falls within that occurrence's window, extended by
     *   OVERRUN_TOLERANCE_MINUTES. Then it belongs to the previous date.
     *
     * Which is to say: the only thing that can pull an instant backwards is a
     * shift that was demonstrably still running when the clock passed midnight.
     * Nothing else moves, so a day worker is untouched by every line of this.
     *
     * Boundaries, decided rather than inherited:
     *   - Exactly at the scheduled start  → that occurrence (inclusive).
     *   - Exactly at the scheduled end    → the previous date (inclusive), so
     *     the punch-out that closes the shift books to the shift.
     *   - Exactly at end + tolerance      → still the previous date.
     *   - One second later                → the instant's own date.
     *   - 00:00:00 exactly, mid-shift     → the previous date, since it is
     *     inside a window that has not closed.
     *
     * Only one day back is ever inspected. A second look-back would need a
     * shift longer than 24 hours to matter, and a shift that long is a data
     * error rather than a case to silently accommodate.
     *
     * Never null: every instant belongs to some date. When nothing is
     * configured the answer is the instant's own local date, which is exactly
     * what the system does today.
     */
    public function attendanceDateFor(?User $user, Carbon|string|DateTimeInterface|null $instant = null): string
    {
        $timezone = $this->timezones->forUser($user);
        $moment = $this->normalizeInstant($instant, $timezone);
        $ownDate = $moment->toDateString();

        if (! $user || ! $user->organization_id) {
            return $ownDate;
        }

        $previousDate = $moment->copy()->startOfDay()->subDay()->toDateString();
        $previous = $this->occurrenceFor($user, $previousDate);

        if ($previous
            && $previous->crossesMidnight()
            && $previous->covers($moment, self::OVERRUN_TOLERANCE_MINUTES)) {
            return $previous->attendanceDateString();
        }

        return $ownDate;
    }

    /**
     * The occurrence an instant belongs to — attendanceDateFor() followed by
     * occurrenceFor(), for callers that want the window and not just the key.
     */
    public function occurrenceForInstant(
        ?User $user,
        Carbon|string|DateTimeInterface|null $instant = null,
    ): ?ShiftOccurrence {
        return $this->occurrenceFor($user, $this->attendanceDateFor($user, $instant));
    }

    /**
     * The assignment row in force on the date, ignoring whether its shift is
     * still usable. Exposed separately because rostering screens care about the
     * assignment even when the pattern behind it has been archived.
     */
    public function assignmentFor(User $user, Carbon|string|null $date = null): ?EmployeeShift
    {
        $on = $this->normalizeDate($date)->toDateString();

        return EmployeeShift::forOrganization((int) $user->organization_id)
            ->where('user_id', $user->id)
            ->where('is_active', true)
            ->whereDate('effective_from', '<=', $on)
            ->where(function (Builder $window) use ($on) {
                $window->whereNull('effective_to')
                    ->orWhereDate('effective_to', '>=', $on);
            })
            // Latest window wins; id breaks a same-day tie deterministically so
            // two assignments added on one day cannot flip between requests.
            ->orderByDesc('effective_from')
            ->orderByDesc('id')
            ->first();
    }

    private function fromWorkInfo(User $user, Carbon $on): ?ResolvedShift
    {
        $workInfo = $user->employeeWorkInfo;
        if (!$workInfo) {
            return null;
        }

        $shiftName = is_string($workInfo->shift_name) ? trim($workInfo->shift_name) : '';
        if ($shiftName !== '') {
            $shift = $this->shiftByName($user, $shiftName);

            if ($shift) {
                return $this->instance($shift, $on, self::SOURCE_WORK_INFO_SHIFT);
            }
        }

        $startTime = Shift::normalizeTime($workInfo->expected_start_time);
        if ($startTime === null) {
            return null;
        }

        [$hours, $minutes, $seconds] = array_map('intval', explode(':', $startTime));

        return new ResolvedShift(
            attendanceDate: $on,
            source: self::SOURCE_WORK_INFO_TIME,
            startsAt: $on->copy()->startOfDay()->addHours($hours)->addMinutes($minutes)->addSeconds($seconds),
            // No end and no length: a start time says nothing about duration,
            // and guessing one here is how the eight-hour assumption spread in
            // the first place.
            expectedSeconds: null,
        );
    }

    private function instance(
        Shift $shift,
        Carbon $on,
        string $source,
        ?EmployeeShift $assignment = null,
    ): ?ResolvedShift {
        // A shift that does not run today produces no instance today. Whether
        // that means "target zero" or "fall back to the org default" is the
        // caller's decision, not this one's.
        if (!$shift->appliesOn($on)) {
            return null;
        }

        return new ResolvedShift(
            attendanceDate: $on,
            source: $source,
            shift: $shift,
            assignment: $assignment,
            startsAt: $shift->startsOn($on),
            endsAt: $shift->endsOn($on),
            expectedSeconds: $shift->expectedWorkSeconds(),
        );
    }

    private function shiftFor(User $user, int $shiftId): ?Shift
    {
        if ($shiftId <= 0) {
            return null;
        }

        return Shift::forOrganization((int) $user->organization_id)
            ->where('is_active', true)
            ->find($shiftId);
    }

    private function shiftByName(User $user, string $name): ?Shift
    {
        $needle = mb_strtolower($name);

        return Shift::forOrganization((int) $user->organization_id)
            ->where('is_active', true)
            ->get()
            ->first(fn (Shift $shift) => mb_strtolower((string) $shift->name) === $needle
                || mb_strtolower((string) $shift->code) === $needle);
    }

    /**
     * Local midnight of a calendar date, in a named timezone.
     */
    private function normalizeDateIn(Carbon|string|null $date, string $timezone): Carbon
    {
        if ($date instanceof Carbon) {
            // Y-m-d only, reinterpreted in the employee's zone — see
            // occurrenceFor()'s docblock.
            return Carbon::parse($date->toDateString(), $timezone)->startOfDay();
        }

        if (is_string($date) && trim($date) !== '') {
            return Carbon::parse($date, $timezone)->startOfDay();
        }

        return Carbon::now($timezone)->startOfDay();
    }

    /**
     * An instant, expressed on the employee's wall clock.
     *
     * A bare string with no zone is parsed on the app default, matching every
     * other Carbon::parse in the codebase, then converted. A value that already
     * knows its own offset keeps its instant and only changes clock.
     */
    private function normalizeInstant(Carbon|string|DateTimeInterface|null $instant, string $timezone): Carbon
    {
        if ($instant instanceof Carbon) {
            return $instant->copy()->setTimezone($timezone);
        }

        if ($instant instanceof DateTimeInterface) {
            return Carbon::instance($instant)->setTimezone($timezone);
        }

        if (is_string($instant) && trim($instant) !== '') {
            return Carbon::parse($instant)->setTimezone($timezone);
        }

        return Carbon::now($timezone);
    }

    /**
     * A wall-clock time on a given date, in a named timezone.
     *
     * Built with Carbon::create rather than midnight + N hours on purpose: on a
     * DST transition day local midnight plus nine hours is not 09:00, and that
     * off-by-an-hour is exactly the "assume a fixed offset" bug this domain
     * cannot afford.
     */
    private function wallClockOn(Carbon $date, ?string $time, string $timezone): Carbon
    {
        $normalized = Shift::normalizeTime($time) ?? '00:00:00';
        $parts = array_map('intval', explode(':', $normalized));

        $created = Carbon::create(
            $date->year,
            $date->month,
            $date->day,
            $parts[0] ?? 0,
            $parts[1] ?? 0,
            $parts[2] ?? 0,
            $timezone,
        );

        return $created instanceof Carbon
            ? $created
            : $date->copy()->startOfDay();
    }

    private function normalizeDate(Carbon|string|null $date): Carbon
    {
        if ($date instanceof Carbon) {
            return $date->copy()->startOfDay();
        }

        if (is_string($date) && trim($date) !== '') {
            return Carbon::parse($date)->startOfDay();
        }

        return Carbon::now()->startOfDay();
    }
}
