<?php

namespace Tests\Feature;

use App\Support\MonthYear;
use Carbon\Carbon;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

/**
 * The month a payroll figure is computed for must not depend on the day it is
 * computed on.
 *
 * See App\Support\MonthYear for the failure this locks out. The structural test
 * at the bottom is the load-bearing one: the broken idiom looks correct, so the
 * only durable defence is refusing to let it back into app/.
 */
class MonthYearParsingTest extends TestCase
{
    /** Every day of a 31-day month, asked about every month of a year. */
    public function test_the_parsed_month_never_depends_on_todays_date(): void
    {
        foreach (range(1, 31) as $today) {
            Carbon::setTestNow(Carbon::create(2026, 8, $today));

            foreach (range(1, 12) as $month) {
                $monthYear = sprintf('2026-%02d', $month);

                $this->assertSame(
                    $monthYear.'-01',
                    MonthYear::start($monthYear)->toDateString(),
                    "asked for {$monthYear} while today is 2026-08-{$today}"
                );
            }
        }

        Carbon::setTestNow();
    }

    public function test_it_reports_the_real_length_of_each_month(): void
    {
        // The 31st is the day the old idiom overflowed a short month.
        Carbon::setTestNow(Carbon::create(2026, 8, 31));

        $this->assertSame(30, MonthYear::days('2026-06'), 'June has 30 days on every day of the year');
        $this->assertSame(28, MonthYear::days('2026-02'));
        $this->assertSame(29, MonthYear::days('2028-02'), 'leap year');
        $this->assertSame(31, MonthYear::days('2026-07'));

        Carbon::setTestNow();
    }

    public function test_the_end_of_a_short_month_is_not_the_start_of_the_next(): void
    {
        Carbon::setTestNow(Carbon::create(2026, 8, 31));

        $this->assertSame('2026-06-30', MonthYear::end('2026-06')->toDateString());
        $this->assertSame('2026-02-28', MonthYear::end('2026-02')->toDateString());

        Carbon::setTestNow();
    }

    public function test_shifting_months_cannot_skip_february(): void
    {
        Carbon::setTestNow(Carbon::create(2026, 8, 31));

        // `Carbon::parse('2026-03-31')->subMonth()` is 2026-03-03, so the naive
        // version of this walked straight past February.
        $this->assertSame('2026-02', MonthYear::shift('2026-03', -1));
        $this->assertSame('2026-03', MonthYear::shift('2026-02', 1));
        $this->assertSame('2027-01', MonthYear::shift('2026-12', 1));

        Carbon::setTestNow();
    }

    public function test_a_malformed_month_is_refused_rather_than_treated_as_today(): void
    {
        foreach (['2026-13', '2026-00', '202606', 'June 2026', '', '2026-6'] as $bad) {
            try {
                MonthYear::start($bad);
                $this->fail("'{$bad}' should have been refused");
            } catch (\InvalidArgumentException $e) {
                $this->assertStringContainsString('YYYY-MM', $e->getMessage());
            }
        }
    }

    /**
     * The structural guard.
     *
     * `createFromFormat('Y-m', ...)` inherits today's day-of-month, and adding
     * `->startOfMonth()` does not undo it. Seventeen call sites had this; all of
     * them now go through MonthYear. This fails if one comes back.
     */
    public function test_no_call_site_parses_a_month_with_the_unsafe_idiom(): void
    {
        $offenders = [];

        foreach (File::allFiles(app_path()) as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }

            foreach (file($file->getPathname()) as $index => $line) {
                // Skip the docblocks in MonthYear and this rule's own prose,
                // which quote the broken idiom deliberately.
                if (preg_match('/^\s*(\*|\/\/)/', $line) === 1) {
                    continue;
                }

                if (str_contains($line, "createFromFormat('Y-m'")
                    || str_contains($line, 'createFromFormat("Y-m"')) {
                    $offenders[] = str_replace(base_path().DIRECTORY_SEPARATOR, '', $file->getPathname())
                        .':'.($index + 1);
                }
            }
        }

        $this->assertSame(
            [],
            $offenders,
            "Use App\\Support\\MonthYear instead — createFromFormat('Y-m') inherits today's "
            ."day-of-month and reads the wrong month on the 29th-31st:\n  ".implode("\n  ", $offenders)
        );
    }
}
