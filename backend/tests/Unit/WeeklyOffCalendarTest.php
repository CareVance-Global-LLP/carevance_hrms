<?php

namespace Tests\Unit;

use App\Models\WeeklyOffPolicy;
use App\Services\Attendance\WeeklyOffCalendar;
use PHPUnit\Framework\TestCase;

/**
 * The batched weekly-off resolution, tested without a database.
 *
 * WeeklyOffCalendar exists so the attendance report can ask "is this date off
 * for this person" a hundred thousand times without a hundred thousand
 * queries. That only helps if it answers the same as WeeklyOffResolver, so
 * every rule the resolver documents has an assertion here: the latest window
 * wins, a closed window stops applying, id breaks a same-day tie, an archived
 * policy falls to the organization default rather than to the previous
 * assignment, and nothing configured means nothing off.
 *
 * Everything below the constructor is pure, so these are plain PHPUnit tests
 * with hand-built policies and no Laravel application at all.
 */
class WeeklyOffCalendarTest extends TestCase
{
    private const EMPLOYEE = 7;

    /** @param array<string, mixed> $rules */
    private function policy(int $id, array $rules, bool $isDefault = false): WeeklyOffPolicy
    {
        $policy = new WeeklyOffPolicy();
        $policy->forceFill([
            'id' => $id,
            'organization_id' => 1,
            'name' => 'Policy '.$id,
            'day_rules' => $rules,
            'is_default' => $isDefault,
            'is_active' => true,
        ]);

        return $policy;
    }

    /**
     * @return array{policy_id: int, effective_from: string, effective_to: string|null, id: int}
     */
    private function assignment(int $policyId, string $from, ?string $to = null, int $id = 1): array
    {
        return [
            'policy_id' => $policyId,
            'effective_from' => $from,
            'effective_to' => $to,
            'id' => $id,
        ];
    }

    // -----------------------------------------------------------------
    // Which policy answers
    // -----------------------------------------------------------------

    public function test_the_latest_effective_window_wins_over_an_older_open_one(): void
    {
        $sundays = $this->policy(1, ['sunday' => 'every']);
        $wednesdays = $this->policy(2, ['wednesday' => 'every']);

        $calendar = new WeeklyOffCalendar(
            [self::EMPLOYEE => [
                $this->assignment(1, '2026-01-01', null, id: 10),
                $this->assignment(2, '2026-08-01', null, id: 11),
            ]],
            [1 => $sundays, 2 => $wednesdays],
            null,
        );

        // 2026-08-05 is a Wednesday, 2026-08-09 a Sunday.
        $this->assertTrue($calendar->isWeeklyOff(self::EMPLOYEE, '2026-08-05'));
        $this->assertFalse($calendar->isWeeklyOff(self::EMPLOYEE, '2026-08-09'));
    }

    public function test_a_window_that_has_not_opened_yet_does_not_apply(): void
    {
        $calendar = new WeeklyOffCalendar(
            [self::EMPLOYEE => [
                $this->assignment(1, '2026-01-01', null, id: 10),
                $this->assignment(2, '2026-09-01', null, id: 11),
            ]],
            [1 => $this->policy(1, ['sunday' => 'every']), 2 => $this->policy(2, ['wednesday' => 'every'])],
            null,
        );

        // Still August, so the September assignment is not in force yet.
        $this->assertFalse($calendar->isWeeklyOff(self::EMPLOYEE, '2026-08-05'));
        $this->assertTrue($calendar->isWeeklyOff(self::EMPLOYEE, '2026-08-09'));
    }

    public function test_a_closed_window_stops_applying_the_day_after_it_ends(): void
    {
        $calendar = new WeeklyOffCalendar(
            [self::EMPLOYEE => [$this->assignment(1, '2026-01-01', '2026-08-04', id: 10)]],
            [1 => $this->policy(1, ['wednesday' => 'every'])],
            null,
        );

        // 2026-07-29 and 2026-08-05 are both Wednesdays; the window closed on
        // the 4th, so only the first is off.
        $this->assertTrue($calendar->isWeeklyOff(self::EMPLOYEE, '2026-07-29'));
        $this->assertFalse($calendar->isWeeklyOff(self::EMPLOYEE, '2026-08-05'));
    }

    public function test_the_last_day_of_a_closed_window_is_still_inside_it(): void
    {
        $calendar = new WeeklyOffCalendar(
            [self::EMPLOYEE => [$this->assignment(1, '2026-01-01', '2026-08-05', id: 10)]],
            [1 => $this->policy(1, ['wednesday' => 'every'])],
            null,
        );

        $this->assertTrue($calendar->isWeeklyOff(self::EMPLOYEE, '2026-08-05'));
    }

    public function test_the_first_day_of_a_window_is_already_inside_it(): void
    {
        $calendar = new WeeklyOffCalendar(
            [self::EMPLOYEE => [$this->assignment(1, '2026-08-05', null, id: 10)]],
            [1 => $this->policy(1, ['wednesday' => 'every'])],
            null,
        );

        // effective_from is the Wednesday itself. An off-by-one on that
        // comparison costs the employee the very first day of their new
        // arrangement, which is exactly the day anyone would check.
        $this->assertTrue($calendar->isWeeklyOff(self::EMPLOYEE, '2026-08-05'));
    }

    public function test_the_newest_default_wins_when_an_organization_has_more_than_one(): void
    {
        // load() picks the default; this asserts the shape it must hand over,
        // so a caller building one by hand cannot pass a stale policy.
        $calendar = new WeeklyOffCalendar(
            [],
            [],
            $this->policy(9, ['sunday' => 'every'], isDefault: true),
        );

        $this->assertTrue($calendar->isWeeklyOff(self::EMPLOYEE, '2026-08-09'));
        $this->assertFalse($calendar->isWeeklyOff(self::EMPLOYEE, '2026-08-05'));
    }

    public function test_the_highest_id_breaks_a_same_day_tie(): void
    {
        $calendar = new WeeklyOffCalendar(
            [self::EMPLOYEE => [
                $this->assignment(1, '2026-08-01', null, id: 10),
                $this->assignment(2, '2026-08-01', null, id: 11),
            ]],
            [1 => $this->policy(1, ['sunday' => 'every']), 2 => $this->policy(2, ['wednesday' => 'every'])],
            null,
        );

        $this->assertTrue($calendar->isWeeklyOff(self::EMPLOYEE, '2026-08-05'));
        $this->assertFalse($calendar->isWeeklyOff(self::EMPLOYEE, '2026-08-09'));
    }

    public function test_an_assignment_pointing_at_an_archived_policy_falls_to_the_organization_default(): void
    {
        // Policy 2 is not in the map at all -- that is what an inactive or
        // deleted policy looks like once load() has filtered to active ones.
        $calendar = new WeeklyOffCalendar(
            [self::EMPLOYEE => [
                $this->assignment(1, '2026-01-01', null, id: 10),
                $this->assignment(2, '2026-08-01', null, id: 11),
            ]],
            [1 => $this->policy(1, ['wednesday' => 'every'])],
            $this->policy(3, ['sunday' => 'every'], isDefault: true),
        );

        $this->assertFalse(
            $calendar->isWeeklyOff(self::EMPLOYEE, '2026-08-05'),
            'An archived assignment fell back to the previous assignment instead of the default.'
        );
        $this->assertTrue($calendar->isWeeklyOff(self::EMPLOYEE, '2026-08-09'));
    }

    public function test_somebody_with_no_assignment_gets_the_organization_default(): void
    {
        $calendar = new WeeklyOffCalendar(
            [],
            [3 => $this->policy(3, ['sunday' => 'every'], isDefault: true)],
            $this->policy(3, ['sunday' => 'every'], isDefault: true),
        );

        $this->assertTrue($calendar->isWeeklyOff(self::EMPLOYEE, '2026-08-09'));
    }

    public function test_one_persons_assignment_never_answers_for_another(): void
    {
        $calendar = new WeeklyOffCalendar(
            [self::EMPLOYEE => [$this->assignment(1, '2026-01-01', null, id: 10)]],
            [1 => $this->policy(1, ['wednesday' => 'every'])],
            null,
        );

        $this->assertTrue($calendar->isWeeklyOff(self::EMPLOYEE, '2026-08-05'));
        $this->assertFalse($calendar->isWeeklyOff(99, '2026-08-05'));
    }

    // -----------------------------------------------------------------
    // Nothing configured is not "works every day"
    // -----------------------------------------------------------------

    public function test_nothing_configured_reports_no_policy_rather_than_no_days_off(): void
    {
        $calendar = new WeeklyOffCalendar([], [], null);
        $august = ['2026-08-03', '2026-08-08', '2026-08-09'];

        $this->assertFalse($calendar->hasPolicyFor(self::EMPLOYEE, $august));
        $this->assertSame([], $calendar->offDates(self::EMPLOYEE, $august));
    }

    public function test_a_policy_anywhere_in_the_range_counts_as_a_policy_for_the_range(): void
    {
        $calendar = new WeeklyOffCalendar(
            [self::EMPLOYEE => [$this->assignment(1, '2026-08-06', null, id: 10)]],
            [1 => $this->policy(1, ['wednesday' => 'every'])],
            null,
        );

        $this->assertFalse($calendar->hasPolicyFor(self::EMPLOYEE, ['2026-08-03', '2026-08-04']));
        $this->assertTrue($calendar->hasPolicyFor(self::EMPLOYEE, ['2026-08-03', '2026-08-07']));
    }

    public function test_an_organization_default_speaks_for_everybody_without_walking_the_range(): void
    {
        $calendar = new WeeklyOffCalendar(
            [],
            [3 => $this->policy(3, ['sunday' => 'every'], isDefault: true)],
            $this->policy(3, ['sunday' => 'every'], isDefault: true),
        );

        $this->assertTrue($calendar->hasPolicyFor(self::EMPLOYEE, []));
    }

    // -----------------------------------------------------------------
    // The range walk
    // -----------------------------------------------------------------

    public function test_off_dates_keeps_the_order_it_was_given_and_drops_the_rest(): void
    {
        $calendar = new WeeklyOffCalendar(
            [self::EMPLOYEE => [$this->assignment(1, '2026-01-01', null, id: 10)]],
            [1 => $this->policy(1, ['saturday' => 'every', 'sunday' => 'every'])],
            null,
        );

        $week = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];

        $this->assertSame(['2026-08-08', '2026-08-09'], $calendar->offDates(self::EMPLOYEE, $week));
    }

    public function test_a_mid_range_reassignment_is_honoured_from_the_day_it_takes_effect(): void
    {
        $calendar = new WeeklyOffCalendar(
            [self::EMPLOYEE => [
                $this->assignment(1, '2026-01-01', null, id: 10),
                $this->assignment(2, '2026-08-10', null, id: 11),
            ]],
            [
                1 => $this->policy(1, ['wednesday' => 'every']),
                2 => $this->policy(2, ['sunday' => 'every']),
            ],
            null,
        );

        // Wednesdays: 2026-08-05 and 2026-08-12. Sundays: 08-09 and 08-16.
        $fortnight = [];
        for ($day = 3; $day <= 16; $day++) {
            $fortnight[] = sprintf('2026-08-%02d', $day);
        }

        $this->assertSame(
            ['2026-08-05', '2026-08-16'],
            $calendar->offDates(self::EMPLOYEE, $fortnight),
            'The reassignment on the 10th was applied to the whole range instead of from its own date.'
        );
    }

    public function test_alternate_saturdays_are_resolved_by_the_policy_not_by_the_calendar(): void
    {
        $calendar = new WeeklyOffCalendar(
            [self::EMPLOYEE => [$this->assignment(1, '2026-01-01', null, id: 10)]],
            [1 => $this->policy(1, ['saturday' => [2, 4]])],
            null,
        );

        // August 2026 Saturdays: 1st, 8th, 15th, 22nd, 29th.
        $saturdays = ['2026-08-01', '2026-08-08', '2026-08-15', '2026-08-22', '2026-08-29'];

        $this->assertSame(['2026-08-08', '2026-08-22'], $calendar->offDates(self::EMPLOYEE, $saturdays));
    }
}
