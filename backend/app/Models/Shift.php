<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A shift pattern an organization runs. Assignment to a person is effective
 * dated and lives in EmployeeShift; this row is only the pattern.
 *
 * On the time columns, and why they are NOT cast
 * ----------------------------------------------
 * start_time and end_time are SQL TIME values: a wall-clock reading with no
 * date attached. Laravel's `datetime` cast would anchor them to *today*, which
 * is exactly the wrong date for the half of the domain that matters — a
 * 22:00→06:00 night shift ends on the day AFTER the attendance date, and a
 * Carbon pinned to today would silently claim it ended nine hours before it
 * started. `datetime:H:i` would hide that by formatting the date away, leaving
 * a value that reads correctly and compares wrongly.
 *
 * So they stay strings, normalised to H:i:s on read, and the only way to get an
 * instant out of a shift is startsOn()/endsOn(), which take the attendance date
 * explicitly and roll the end forward when the shift crosses midnight. That
 * mirrors how the domain is actually modelled elsewhere: an attendance date
 * plus two real datetimes, not two bare times bucketed by the punch's calendar
 * day.
 */
class Shift extends Model
{
    use BelongsToOrganization;
    use HasFactory;

    protected $table = 'shifts';

    protected $fillable = [
        'organization_id',
        'name',
        'code',
        'type',
        'description',
        'start_time',
        'end_time',
        'duration_minutes',
        'break_duration_minutes',
        'is_night_shift',
        'night_shift_start',
        'night_shift_end',
        'has_shift_differential',
        'differential_percentage',
        'differential_fixed',
        'has_weekend_differential',
        'weekend_differential_percentage',
        'weekend_differential_fixed',
        'overtime_multiplier',
        'grace_period_minutes',
        'early_exit_grace_minutes',
        'is_active',
        'applicable_days',
    ];

    protected function casts(): array
    {
        return [
            'duration_minutes' => 'integer',
            'break_duration_minutes' => 'integer',
            'grace_period_minutes' => 'integer',
            'early_exit_grace_minutes' => 'integer',
            'is_night_shift' => 'boolean',
            'has_shift_differential' => 'boolean',
            'has_weekend_differential' => 'boolean',
            'is_active' => 'boolean',
            // Rates, not amounts, but the same rule applies: decimal, never
            // float, so a differential never drifts by a paisa per hour.
            'differential_percentage' => 'decimal:2',
            'differential_fixed' => 'decimal:2',
            'weekend_differential_percentage' => 'decimal:2',
            'weekend_differential_fixed' => 'decimal:2',
            'overtime_multiplier' => 'decimal:2',
            'applicable_days' => 'array',
            // start_time / end_time / night_shift_* are deliberately uncast —
            // see the class docblock.
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function employeeShifts(): HasMany
    {
        return $this->hasMany(EmployeeShift::class);
    }

    protected function startTime(): Attribute
    {
        return Attribute::get(fn ($value) => self::normalizeTime($value));
    }

    protected function endTime(): Attribute
    {
        return Attribute::get(fn ($value) => self::normalizeTime($value));
    }

    /**
     * Length of the shift from clock-in to clock-out, breaks included.
     *
     * duration_minutes is authoritative when set, because an org may pay a
     * declared span that differs from the literal difference between the two
     * times. When it is absent or nonsense, fall back to the times themselves,
     * rolling over midnight for a night shift.
     */
    public function spanMinutes(): int
    {
        $declared = (int) ($this->duration_minutes ?? 0);
        if ($declared > 0) {
            return $declared;
        }

        return $this->spanMinutesFromTimes();
    }

    /**
     * Working seconds the shift is expected to produce: the span less the
     * unpaid break. A 09:00–18:00 shift with a one-hour break is the eight-hour
     * day the old global constant assumed — which is why that constant looked
     * right for so long.
     */
    public function expectedWorkSeconds(): int
    {
        $break = max(0, (int) ($this->break_duration_minutes ?? 0));

        return max(60, ($this->spanMinutes() - $break) * 60);
    }

    /**
     * The instant this shift starts on a given attendance date.
     */
    public function startsOn(Carbon $attendanceDate): Carbon
    {
        [$hours, $minutes, $seconds] = self::timeParts($this->start_time);

        return $attendanceDate->copy()->startOfDay()
            ->addHours($hours)->addMinutes($minutes)->addSeconds($seconds);
    }

    /**
     * The instant this shift ends. For a night shift this lands on the NEXT
     * calendar date — the attendance date stays the date the shift began, which
     * is what a punch at 01:00 has to be attributed to.
     */
    public function endsOn(Carbon $attendanceDate): Carbon
    {
        return $this->startsOn($attendanceDate)->addMinutes($this->spanMinutes());
    }

    public function crossesMidnightFrom(Carbon $attendanceDate): bool
    {
        return $this->endsOn($attendanceDate)->toDateString() !== $attendanceDate->toDateString();
    }

    /**
     * Does this shift run on the given date at all?
     *
     * applicable_days is free-form JSON that nothing has ever written, so every
     * plausible encoding is accepted rather than guessed at: day names, three-
     * and two-letter abbreviations, ISO numbers (1=Monday … 7=Sunday) and the
     * zero-based convention (0=Sunday). 1–6 mean Monday–Saturday under both, so
     * only Sunday is ambiguous and both spellings of it are honoured.
     *
     * Empty or absent means "every day" — a shift with no restriction recorded
     * must not silently become a shift that never runs.
     */
    public function appliesOn(Carbon $date): bool
    {
        $days = $this->applicable_days;

        if (!is_array($days) || $days === []) {
            return true;
        }

        $iso = (int) $date->dayOfWeekIso;
        $name = strtolower($date->format('l'));

        foreach ($days as $day) {
            if (is_int($day) || (is_string($day) && ctype_digit(trim($day)))) {
                $number = (int) $day;
                if (($number === 0 ? 7 : $number) === $iso) {
                    return true;
                }

                continue;
            }

            if (!is_string($day)) {
                continue;
            }

            $token = strtolower(trim($day));
            if ($token === '') {
                continue;
            }

            if ($token === $name || $token === substr($name, 0, 3) || $token === substr($name, 0, 2)) {
                return true;
            }
        }

        return false;
    }

    private function spanMinutesFromTimes(): int
    {
        $reference = Carbon::create(2000, 1, 1, 0, 0, 0);
        $start = $this->startsOn($reference);
        [$hours, $minutes, $seconds] = self::timeParts($this->end_time);
        $end = $reference->copy()->startOfDay()
            ->addHours($hours)->addMinutes($minutes)->addSeconds($seconds);

        if ($end->lessThanOrEqualTo($start)) {
            $end->addDay();
        }

        return (int) $start->diffInMinutes($end);
    }

    /** @return array{0:int,1:int,2:int} */
    private static function timeParts(mixed $value): array
    {
        $normalized = self::normalizeTime($value) ?? '00:00:00';
        $parts = array_map('intval', explode(':', $normalized));

        return [$parts[0] ?? 0, $parts[1] ?? 0, $parts[2] ?? 0];
    }

    /**
     * Postgres hands back "09:00:00"; SQLite hands back whatever was written,
     * which in a fixture is often "09:00". Normalising on read means callers
     * never have to care which database they are on.
     */
    public static function normalizeTime(mixed $value): ?string
    {
        if (!is_string($value) || trim($value) === '') {
            return null;
        }

        if (preg_match('/(\d{1,2}):(\d{2})(?::(\d{2}))?/', $value, $matches) !== 1) {
            return null;
        }

        return sprintf('%02d:%02d:%02d', (int) $matches[1], (int) $matches[2], (int) ($matches[3] ?? 0));
    }
}
