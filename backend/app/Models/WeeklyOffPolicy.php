<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Which days of the week an employee is off.
 *
 * The whole reason this is not seven booleans is "2nd and 4th Saturday", which
 * is near-universal in Indian companies. `day_rules` is a JSON object keyed by
 * weekday, each key holding one of three rule shapes:
 *
 *   "every"                       off every week.
 *
 *   [2, 4] or [2, "last"]         ORDINAL WITHIN THE CALENDAR MONTH — the nth
 *                                 occurrence of that weekday in the month the
 *                                 date falls in. "last" is the final one, which
 *                                 is a different rule from 5: August 2026 has
 *                                 five Saturdays (1, 8, 15, 22, 29) so "last"
 *                                 is the 29th, while February 2026 has four so
 *                                 a literal 5 matches nothing at all.
 *
 *   {"mode": "alternate",         A CONTINUOUS every-nth-week count from a real
 *    "interval_weeks": 2,         date, which does NOT reset at the month
 *    "anchor_date": "2026-08-01"} boundary. From Aug 1 2026 that gives Aug 1,
 *                                 15 and 29, then Sep 12 and 26 — where the
 *                                 month-ordinal reading would have said Sep 5
 *                                 and 19. Both schemes are in real use and they
 *                                 disagree in any month with five Saturdays.
 *
 * Keys are tolerant on the way in — ISO numbers as strings ("1" = Monday …
 * "7" = Sunday, with "0" also read as Sunday), full names, and three or two
 * letter abbreviations — and normalised to ISO integers before evaluation, so a
 * hand-edited row does not have to guess the house convention.
 *
 * An absent key, or an empty day_rules, means NOTHING is off. That is the
 * opposite of Shift::appliesOn, where empty means "runs every day", and the
 * asymmetry is deliberate: an unconfigured shift that never runs is a visible
 * annoyance, whereas an unconfigured weekly-off policy that marks every day off
 * would mark an entire organization absent.
 */
class WeeklyOffPolicy extends Model
{
    use BelongsToOrganization;

    /** Rule shapes, as stored. */
    public const MODE_EVERY = 'every';
    public const MODE_ORDINALS = 'ordinals';
    public const MODE_ALTERNATE = 'alternate';

    protected $table = 'weekly_off_policies';

    protected $fillable = [
        'organization_id',
        'name',
        'description',
        'day_rules',
        'is_default',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'day_rules' => 'array',
            'is_default' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(EmployeeWeeklyOffPolicy::class);
    }

    /**
     * Is this calendar date a weekly off?
     *
     * A Carbon passed here contributes only its Y-m-d. Its own time and zone
     * are ignored, because "is the 8th an off day" must not become the 7th just
     * because the caller's clock was behind the employee's.
     */
    public function isOffOn(Carbon|string $date): bool
    {
        $on = $date instanceof Carbon
            ? Carbon::parse($date->toDateString())
            : Carbon::parse($date)->startOfDay();

        $rule = $this->ruleForIsoDay((int) $on->dayOfWeekIso);

        if ($rule === null) {
            return false;
        }

        return $this->ruleMatches($rule, $on);
    }

    /**
     * Every off date in a month, as Y-m-d strings, ascending.
     *
     * @return list<string>
     */
    public function offDatesForMonth(int $year, int $month): array
    {
        $cursor = Carbon::create($year, $month, 1)->startOfDay();
        $days = (int) $cursor->daysInMonth;
        $dates = [];

        for ($day = 1; $day <= $days; $day++) {
            $date = $cursor->copy()->day($day);

            if ($this->isOffOn($date)) {
                $dates[] = $date->toDateString();
            }
        }

        return $dates;
    }

    /**
     * The rules keyed by ISO weekday, whatever spelling was stored.
     *
     * @return array<int, array<string, mixed>>
     */
    public function normalizedDayRules(): array
    {
        $rules = $this->day_rules;

        if (! is_array($rules)) {
            return [];
        }

        $normalized = [];

        foreach ($rules as $key => $rule) {
            $iso = self::isoDayFrom($key);

            if ($iso === null) {
                continue;
            }

            $shape = self::normalizeRule($rule);

            if ($shape !== null) {
                $normalized[$iso] = $shape;
            }
        }

        return $normalized;
    }

    /** @return array<string, mixed>|null */
    private function ruleForIsoDay(int $iso): ?array
    {
        return $this->normalizedDayRules()[$iso] ?? null;
    }

    /** @param array<string, mixed> $rule */
    private function ruleMatches(array $rule, Carbon $date): bool
    {
        return match ($rule['mode']) {
            self::MODE_EVERY => true,
            self::MODE_ORDINALS => $this->ordinalMatches($rule, $date),
            self::MODE_ALTERNATE => $this->alternateMatches($rule, $date),
            default => false,
        };
    }

    /**
     * The nth occurrence of this weekday within its own calendar month.
     *
     * ordinal = ((day of month - 1) / 7) + 1 — the 1st through 7th of a month
     * hold the first of every weekday, the 8th through 14th the second, and so
     * on. "last" is resolved against the actual number of occurrences, which is
     * four or five depending on the month.
     *
     * @param array<string, mixed> $rule
     */
    private function ordinalMatches(array $rule, Carbon $date): bool
    {
        $ordinals = $rule['ordinals'] ?? [];

        if (! is_array($ordinals) || $ordinals === []) {
            return false;
        }

        $ordinal = intdiv($date->day - 1, 7) + 1;
        $isLastOccurrence = $date->copy()->addWeek()->month !== $date->month;

        foreach ($ordinals as $wanted) {
            if (is_string($wanted) && strtolower(trim($wanted)) === 'last') {
                if ($isLastOccurrence) {
                    return true;
                }

                continue;
            }

            if ((int) $wanted === $ordinal) {
                return true;
            }
        }

        return false;
    }

    /**
     * Every nth week counted continuously from an anchor date.
     *
     * With no anchor the rule is INERT — the day is never off. Picking an
     * anchor on the policy's behalf would mark real people absent on days they
     * were told to work, and there is no guess that is safe to make.
     *
     * @param array<string, mixed> $rule
     */
    private function alternateMatches(array $rule, Carbon $date): bool
    {
        $anchor = $rule['anchor_date'] ?? null;
        $interval = max(1, (int) ($rule['interval_weeks'] ?? 2));

        if (! is_string($anchor) || trim($anchor) === '') {
            return false;
        }

        $anchorDate = Carbon::parse($anchor)->startOfDay();
        $days = (int) $anchorDate->diffInDays($date, false);

        // Before the anchor the pattern is not yet in force. Counting backwards
        // would hand an answer for a period the policy did not exist in.
        if ($days < 0) {
            return false;
        }

        return intdiv($days, 7) % $interval === 0;
    }

    /**
     * ISO weekday (1 = Monday … 7 = Sunday) from a name, abbreviation or number.
     *
     * 0 is read as Sunday as well as 7, because half the world writes it that
     * way and silently reading it as "no day" would drop a rule.
     */
    public static function isoDayFrom(mixed $key): ?int
    {
        if (is_int($key) || (is_string($key) && ctype_digit(trim($key)))) {
            $number = (int) $key;

            if ($number === 0) {
                return 7;
            }

            return ($number >= 1 && $number <= 7) ? $number : null;
        }

        if (! is_string($key)) {
            return null;
        }

        $token = strtolower(trim($key));

        if ($token === '') {
            return null;
        }

        foreach (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as $index => $name) {
            if ($token === $name || $token === substr($name, 0, 3) || $token === substr($name, 0, 2)) {
                return $index + 1;
            }
        }

        return null;
    }

    /**
     * One stored rule, in any accepted spelling, as {mode, ...}.
     *
     * @return array<string, mixed>|null
     */
    public static function normalizeRule(mixed $rule): ?array
    {
        if ($rule === true) {
            return ['mode' => self::MODE_EVERY];
        }

        if (is_string($rule)) {
            $token = strtolower(trim($rule));

            return in_array($token, ['every', 'all', 'weekly'], true)
                ? ['mode' => self::MODE_EVERY]
                : null;
        }

        if (! is_array($rule)) {
            return null;
        }

        // A bare list — [2, 4] or [2, "last"] — is the ordinal shorthand.
        if (! array_key_exists('mode', $rule)) {
            return array_is_list($rule) && $rule !== []
                ? ['mode' => self::MODE_ORDINALS, 'ordinals' => array_values($rule)]
                : null;
        }

        $mode = is_string($rule['mode']) ? strtolower(trim($rule['mode'])) : '';

        return match ($mode) {
            self::MODE_EVERY, 'all', 'weekly' => ['mode' => self::MODE_EVERY],
            self::MODE_ORDINALS => [
                'mode' => self::MODE_ORDINALS,
                'ordinals' => is_array($rule['ordinals'] ?? null) ? array_values($rule['ordinals']) : [],
            ],
            self::MODE_ALTERNATE => [
                'mode' => self::MODE_ALTERNATE,
                'interval_weeks' => (int) ($rule['interval_weeks'] ?? 2),
                'anchor_date' => $rule['anchor_date'] ?? null,
            ],
            default => null,
        };
    }
}
