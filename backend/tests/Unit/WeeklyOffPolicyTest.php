<?php

namespace Tests\Unit;

use App\Models\WeeklyOffPolicy;
use Carbon\Carbon;
use Tests\TestCase;

/**
 * The weekly-off representation, evaluated against a real calendar.
 *
 * "2nd and 4th Saturday" is near-universal in Indian companies and it is the
 * reason this cannot be a bitmask of seven booleans. The thing that has to be
 * true is narrow and checkable: for a named month, the policy must name exactly
 * the dates a human with a wall calendar would name.
 *
 * August 2026 is used deliberately — it has FIVE Saturdays (1, 8, 15, 22, 29),
 * so it separates the three representations that a four-Saturday month would
 * make look identical:
 *
 *   ordinals [2, 4]  → 8 and 22          (working: 1, 15, 29)
 *   ordinals ['last']→ 29                 (NOT 22)
 *   alternate/2 from Aug 1 → 1, 15, 29    (a continuous count, not a monthly one)
 *
 * No database: this is a pure evaluation over a JSON column.
 */
class WeeklyOffPolicyTest extends TestCase
{
    /** @param array<string, mixed> $rules */
    private function policy(array $rules): WeeklyOffPolicy
    {
        return new WeeklyOffPolicy(['name' => 'Test', 'day_rules' => $rules]);
    }

    /** @return list<int> */
    private function offDaysIn(WeeklyOffPolicy $policy, int $year, int $month): array
    {
        return array_map(
            fn (string $date) => (int) substr($date, 8, 2),
            $policy->offDatesForMonth($year, $month)
        );
    }

    public function test_every_mode_marks_that_weekday_off_for_the_whole_month(): void
    {
        // Sundays in August 2026: 2, 9, 16, 23, 30.
        $policy = $this->policy(['sunday' => 'every']);

        $this->assertSame([2, 9, 16, 23, 30], $this->offDaysIn($policy, 2026, 8));
        $this->assertTrue($policy->isOffOn('2026-08-16'));
        $this->assertFalse($policy->isOffOn('2026-08-15'), 'A Saturday was marked off by a Sunday-only policy.');
    }

    public function test_second_and_fourth_saturday_in_a_five_saturday_month(): void
    {
        // Hand-checked against a wall calendar: August 2026 Saturdays fall on
        // 1, 8, 15, 22 and 29. The 2nd is the 8th, the 4th is the 22nd.
        $policy = $this->policy([
            'sunday' => 'every',
            'saturday' => [2, 4],
        ]);

        $this->assertSame([2, 8, 9, 16, 22, 23, 30], $this->offDaysIn($policy, 2026, 8));

        foreach ([8, 22] as $off) {
            $this->assertTrue(
                $policy->isOffOn(sprintf('2026-08-%02d', $off)),
                "August {$off} 2026 is a 2nd/4th Saturday and should be a weekly off."
            );
        }

        foreach ([1, 15, 29] as $working) {
            $this->assertFalse(
                $policy->isOffOn(sprintf('2026-08-%02d', $working)),
                "August {$working} 2026 is a 1st/3rd/5th Saturday and should be a working day."
            );
        }
    }

    public function test_the_same_policy_lands_on_different_dates_in_a_four_saturday_month(): void
    {
        // February 2026 Saturdays: 7, 14, 21, 28. The 4th Saturday is the 28th,
        // which is also the last one — the case that makes 'last' and 4 look
        // interchangeable, and they are not.
        $policy = $this->policy(['saturday' => [2, 4]]);

        $this->assertSame([14, 28], $this->offDaysIn($policy, 2026, 2));
    }

    public function test_last_is_the_final_occurrence_not_the_fifth(): void
    {
        $policy = $this->policy(['saturday' => ['last']]);

        // Five-Saturday month: last is the 29th, not the 22nd.
        $this->assertSame([29], $this->offDaysIn($policy, 2026, 8));
        // Four-Saturday month: last is the 28th.
        $this->assertSame([28], $this->offDaysIn($policy, 2026, 2));

        // A literal 5th ordinal is a different rule: it simply does not occur
        // in a four-Saturday month, and must not silently become the 4th.
        $fifth = $this->policy(['saturday' => [5]]);
        $this->assertSame([29], $this->offDaysIn($fifth, 2026, 8));
        $this->assertSame([], $this->offDaysIn($fifth, 2026, 2));
    }

    public function test_alternate_mode_counts_continuously_across_the_month_boundary(): void
    {
        // Every other Saturday counted from Aug 1 2026, which does NOT reset at
        // the start of September. Aug: 1, 15, 29. Sep Saturdays are 5, 12, 19,
        // 26 — and 12 and 26 are 6 and 8 weeks after the anchor, so they are
        // off while 5 and 19 are working. A month-ordinal rule would have
        // picked 5 and 19 instead, which is the bug this mode exists to avoid.
        $policy = $this->policy([
            'saturday' => ['mode' => 'alternate', 'interval_weeks' => 2, 'anchor_date' => '2026-08-01'],
        ]);

        $this->assertSame([1, 15, 29], $this->offDaysIn($policy, 2026, 8));
        $this->assertSame([12, 26], $this->offDaysIn($policy, 2026, 9));
    }

    public function test_an_alternate_rule_with_no_anchor_marks_nothing_off(): void
    {
        // Inert rather than guessed. Picking an anchor on the policy's behalf
        // would mark real people absent on days they were told to work.
        $policy = $this->policy([
            'saturday' => ['mode' => 'alternate', 'interval_weeks' => 2],
        ]);

        $this->assertSame([], $this->offDaysIn($policy, 2026, 8));
    }

    public function test_day_keys_are_accepted_by_name_number_or_abbreviation(): void
    {
        $byName = $this->policy(['saturday' => [2, 4]]);
        $byIso = $this->policy(['6' => [2, 4]]);
        $byAbbrev = $this->policy(['Sat' => [2, 4]]);

        $expected = [8, 22];
        $this->assertSame($expected, $this->offDaysIn($byName, 2026, 8));
        $this->assertSame($expected, $this->offDaysIn($byIso, 2026, 8));
        $this->assertSame($expected, $this->offDaysIn($byAbbrev, 2026, 8));
    }

    public function test_sunday_is_iso_seven_and_never_confused_with_monday(): void
    {
        // 0-vs-7 for Sunday is the classic off-by-one in this shape. ISO is the
        // convention here: 1 = Monday … 7 = Sunday, and 0 is read as Sunday too
        // because half the world writes it that way.
        $iso = $this->policy(['7' => 'every']);
        $zero = $this->policy(['0' => 'every']);
        $monday = $this->policy(['1' => 'every']);

        $sundays = [2, 9, 16, 23, 30];
        $mondays = [3, 10, 17, 24, 31];

        $this->assertSame($sundays, $this->offDaysIn($iso, 2026, 8));
        $this->assertSame($sundays, $this->offDaysIn($zero, 2026, 8));
        $this->assertSame($mondays, $this->offDaysIn($monday, 2026, 8));
    }

    public function test_an_empty_policy_marks_no_day_off(): void
    {
        // The opposite of Shift::appliesOn, and deliberately so. An empty
        // applicable_days means "runs every day"; an empty weekly-off policy
        // must mean "nothing is off", because the failure mode of guessing here
        // is a whole organization marked absent.
        $this->assertSame([], $this->offDaysIn($this->policy([]), 2026, 8));
        $this->assertFalse((new WeeklyOffPolicy(['name' => 'Empty']))->isOffOn('2026-08-16'));
    }

    public function test_is_off_on_accepts_a_carbon_and_ignores_its_time(): void
    {
        $policy = $this->policy(['saturday' => [2, 4]]);

        $this->assertTrue($policy->isOffOn(Carbon::parse('2026-08-08 23:59:59')));
        $this->assertFalse($policy->isOffOn(Carbon::parse('2026-08-15 00:00:00')));
    }
}
