<?php

namespace Tests\Unit\Ai;

use App\Services\Ai\PeriodResolver;
use Carbon\Carbon;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * A period token is the one part of an AI plan that decides *which* rows the
 * answer is about. Get it wrong and the number returned is real, confident and
 * about a different question than the one asked — the exact failure the whole
 * plan-and-validate design exists to prevent.
 *
 * So every token in the grammar is pinned to both of its bounds here, not just
 * one, and the unrecognised cases are pinned to null. `PeriodResolver` may
 * never guess a range.
 */
class PeriodResolverTest extends TestCase
{
    /** A Wednesday, deliberately: a Monday `now` would hide a week-start bug. */
    private const NOW = '2026-08-26 10:30:00';

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    private function at(string $now): void
    {
        Carbon::setTestNow(Carbon::parse($now));
    }

    private function assertPeriod(string $token, string $start, string $end, ?string $label = null): void
    {
        $resolved = PeriodResolver::resolve($token);

        $this->assertIsArray($resolved, sprintf("'%s' should resolve, and did not.", $token));
        $this->assertSame($start, $resolved['start'], sprintf("'%s' start", $token));
        $this->assertSame($end, $resolved['end'], sprintf("'%s' end", $token));

        if ($label !== null) {
            $this->assertSame($label, $resolved['label'], sprintf("'%s' label", $token));
        }
    }

    // ---------------------------------------------------------------- days

    public function test_today_is_a_single_inclusive_day(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('today', '2026-08-26', '2026-08-26', '26 Aug 2026');
    }

    public function test_yesterday_is_the_day_before_and_excludes_today(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('yesterday', '2026-08-25', '2026-08-25', '25 Aug 2026');
    }

    // --------------------------------------------------------------- weeks

    public function test_this_week_runs_monday_to_sunday_around_now(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('this_week', '2026-08-24', '2026-08-30', '24 Aug 2026 – 30 Aug 2026');
    }

    public function test_last_week_is_the_whole_previous_monday_to_sunday(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('last_week', '2026-08-17', '2026-08-23', '17 Aug 2026 – 23 Aug 2026');
    }

    public function test_the_week_starts_on_monday_even_when_now_is_a_sunday(): void
    {
        // A Sunday `now` is where a locale-driven week start shows itself: with
        // a Sunday-first week this returns 23–29 Aug instead of 17–23.
        $this->at('2026-08-23 22:00:00');

        $this->assertPeriod('this_week', '2026-08-17', '2026-08-23');
    }

    // -------------------------------------------------------------- months

    public function test_this_month_covers_the_whole_calendar_month(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('this_month', '2026-08-01', '2026-08-31', 'August 2026');
    }

    public function test_last_month_covers_the_whole_previous_calendar_month(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('last_month', '2026-07-01', '2026-07-31', 'July 2026');
    }

    public function test_last_month_in_january_is_december_of_the_previous_year(): void
    {
        $this->at('2026-01-15 09:00:00');

        $this->assertPeriod('last_month', '2025-12-01', '2025-12-31', 'December 2025');
    }

    public function test_last_month_on_a_31st_does_not_overflow_back_into_this_month(): void
    {
        // Carbon's subMonth() on 31 March lands on 3 March, so a naive
        // now()->subMonth()->startOfMonth() answers "last month" with *March*.
        // Payroll runs on month ends, which is exactly when this gets asked.
        $this->at('2026-03-31 18:00:00');

        $this->assertPeriod('last_month', '2026-02-01', '2026-02-28', 'February 2026');
    }

    public function test_last_month_on_the_31st_of_a_31_day_month_is_still_the_month_before(): void
    {
        $this->at('2026-05-31 18:00:00');

        $this->assertPeriod('last_month', '2026-04-01', '2026-04-30', 'April 2026');
    }

    // ------------------------------------------------------------ quarters

    public function test_this_quarter_in_q1(): void
    {
        $this->at('2026-02-10 09:00:00');

        $this->assertPeriod('this_quarter', '2026-01-01', '2026-03-31', '1 Jan 2026 – 31 Mar 2026');
    }

    public function test_this_quarter_in_q2(): void
    {
        $this->at('2026-05-20 09:00:00');

        $this->assertPeriod('this_quarter', '2026-04-01', '2026-06-30', '1 Apr 2026 – 30 Jun 2026');
    }

    public function test_this_quarter_in_q3(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('this_quarter', '2026-07-01', '2026-09-30', '1 Jul 2026 – 30 Sep 2026');
    }

    public function test_this_quarter_in_q4(): void
    {
        $this->at('2026-11-05 09:00:00');

        $this->assertPeriod('this_quarter', '2026-10-01', '2026-12-31', '1 Oct 2026 – 31 Dec 2026');
    }

    public function test_last_quarter_is_the_previous_calendar_quarter(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('last_quarter', '2026-04-01', '2026-06-30');
    }

    public function test_last_quarter_in_q1_is_the_previous_years_q4(): void
    {
        $this->at('2026-02-10 09:00:00');

        $this->assertPeriod('last_quarter', '2025-10-01', '2025-12-31');
    }

    public function test_last_quarter_on_a_month_end_does_not_overflow(): void
    {
        // 31 May minus one quarter overflows in Carbon's arithmetic; anchoring
        // on the start of the quarter before subtracting is what avoids it.
        $this->at('2026-05-31 12:00:00');

        $this->assertPeriod('last_quarter', '2026-01-01', '2026-03-31');
    }

    // --------------------------------------------------------------- years

    public function test_this_year_covers_the_whole_calendar_year(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('this_year', '2026-01-01', '2026-12-31', '2026');
    }

    public function test_last_year_covers_the_whole_previous_calendar_year(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('last_year', '2025-01-01', '2025-12-31', '2025');
    }

    // ------------------------------------------------------ rolling windows

    public function test_last_7_days_includes_today_and_spans_exactly_seven_days(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('last_7_days', '2026-08-20', '2026-08-26', '20 Aug 2026 – 26 Aug 2026');

        $resolved = PeriodResolver::resolve('last_7_days');
        $span = Carbon::parse($resolved['start'])->diffInDays(Carbon::parse($resolved['end'])) + 1;

        $this->assertSame(7, (int) $span);
    }

    public function test_last_30_days_includes_today_and_spans_exactly_thirty_days(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('last_30_days', '2026-07-28', '2026-08-26');
    }

    public function test_last_90_days_includes_today_and_spans_exactly_ninety_days(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('last_90_days', '2026-05-29', '2026-08-26');
    }

    public function test_last_12_months_is_a_rolling_window_ending_today(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('last_12_months', '2025-08-27', '2026-08-26', '27 Aug 2025 – 26 Aug 2026');
    }

    public function test_last_12_months_across_a_leap_day_does_not_overflow(): void
    {
        $this->at('2028-02-29 09:00:00');

        $this->assertPeriod('last_12_months', '2027-03-01', '2028-02-29');
    }

    // ------------------------------------------------------- explicit forms

    public function test_an_explicit_month_resolves_to_that_calendar_month(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('2026-07', '2026-07-01', '2026-07-31', 'July 2026');
    }

    public function test_an_explicit_month_in_february_of_a_leap_year_ends_on_the_29th(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('2028-02', '2028-02-01', '2028-02-29', 'February 2028');
    }

    public function test_an_explicit_year_resolves_to_that_calendar_year(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('2025', '2025-01-01', '2025-12-31', '2025');
    }

    public function test_an_explicit_range_is_inclusive_at_both_ends(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('2026-07-01..2026-07-31', '2026-07-01', '2026-07-31');
    }

    public function test_a_partial_explicit_range_labels_both_of_its_bounds(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('2026-07-03..2026-07-19', '2026-07-03', '2026-07-19', '3 Jul 2026 – 19 Jul 2026');
    }

    public function test_a_single_day_explicit_range_is_allowed(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('2026-07-04..2026-07-04', '2026-07-04', '2026-07-04', '4 Jul 2026');
    }

    public function test_an_explicit_range_may_span_years(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('2025-11-15..2026-02-02', '2025-11-15', '2026-02-02', '15 Nov 2025 – 2 Feb 2026');
    }

    // ------------------------------------------------------------- refusals

    public static function unrecognisedTokens(): array
    {
        return [
            'empty' => [''],
            'whitespace only' => ['   '],
            'a token the grammar does not define' => ['next_month'],
            'a plausible near-miss' => ['last_month_to_date'],
            'a spaced variant' => ['last month'],
            'a bare word' => ['july'],
            'an unlisted window' => ['last_60_days'],
            'a month name and year' => ['july 2026'],
            'an unpadded month' => ['2026-7'],
            'a two-digit year' => ['26'],
            'a five-digit year' => ['20266'],
            'month 00' => ['2026-00'],
            'month 13' => ['2026-13'],
            'a date that is not on the calendar' => ['2026-02-30..2026-03-05'],
            'the 31st of a 30-day month' => ['2026-04-31..2026-05-05'],
            'a range with one bad end' => ['2026-07-01..2026-07'],
            'a range with no separator' => ['2026-07-01-2026-07-31'],
            'a three-dot separator' => ['2026-07-01...2026-07-31'],
            'a bare date' => ['2026-07-01'],
            'sql' => ["2026-07-01' OR 1=1--"],
            'a wildcard' => ['%'],
        ];
    }

    #[DataProvider('unrecognisedTokens')]
    public function test_an_unrecognised_token_is_null_never_a_guess(string $token): void
    {
        $this->at(self::NOW);

        // Null is a refusal the caller turns into "I could not read that date
        // range". Any fallback here — today, this month, the whole table —
        // answers a different question with total confidence.
        $this->assertNull(PeriodResolver::resolve($token), sprintf("'%s' should not resolve.", $token));
    }

    public function test_a_reversed_range_is_refused_rather_than_swapped(): void
    {
        $this->at(self::NOW);

        // Swapping the ends guesses what was meant. The asker may equally have
        // mistyped one of the two dates, and we cannot know which.
        $this->assertNull(PeriodResolver::resolve('2026-07-31..2026-07-01'));
    }

    // ---------------------------------------------------------- normalising

    public function test_surrounding_whitespace_and_case_do_not_change_the_answer(): void
    {
        $this->at(self::NOW);

        $this->assertPeriod('  LAST_MONTH  ', '2026-07-01', '2026-07-31');
    }

    // -------------------------------------------------- the grammar in full

    public static function grammarTokens(): array
    {
        return array_map(
            static fn (string $token): array => [$token],
            [
                'today', 'yesterday',
                'this_week', 'last_week',
                'this_month', 'last_month',
                'this_quarter', 'last_quarter',
                'this_year', 'last_year',
                'last_7_days', 'last_30_days', 'last_90_days', 'last_12_months',
                '2026-07', '2026', '2026-07-01..2026-07-31',
            ]
        );
    }

    #[DataProvider('grammarTokens')]
    public function test_every_token_in_the_grammar_resolves_to_ordered_ymd_bounds(string $token): void
    {
        $this->at(self::NOW);

        $resolved = PeriodResolver::resolve($token);

        $this->assertIsArray($resolved, sprintf("'%s' is in the grammar and must resolve.", $token));
        $this->assertSame(['start', 'end', 'label'], array_keys($resolved));
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}$/', $resolved['start']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}$/', $resolved['end']);
        $this->assertLessThanOrEqual($resolved['end'], $resolved['start']);
        $this->assertNotSame('', trim($resolved['label']));
    }
}
