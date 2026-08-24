<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\BreakTime;
use App\Models\LegalEntity;
use App\Models\Organization;
use App\Models\User;
use App\Services\Attendance\StatutoryComplianceService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Working-hour breaches.
 *
 * The failure mode that matters here is the FALSE NEGATIVE. Nobody re-checks a
 * clean compliance report, so a rule that quietly fails to fire is worse than
 * one that never existed — the establishment believes it is inside the law on
 * this product's word.
 *
 * So the tests below spend most of their effort on the cases where a naive
 * implementation reports nothing: an unconfigured establishment, a part-week at
 * the edge of the range, short breaks that do not add up to a rest interval,
 * and a quarter whose overtime is spread outside the requested window.
 */
class StatutoryComplianceTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;
    private LegalEntity $entity;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-compliance']);

        $this->entity = LegalEntity::query()->create([
            'organization_id' => $this->organization->id,
            'name' => 'CareVance Manufacturing',
            'state' => 'Karnataka',
            'establishment_type' => 'factory',
            'is_primary' => true,
            'is_active' => true,
        ]);

        $this->employee = User::create([
            'name' => 'Ramesh',
            'email' => 'ramesh@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
            'legal_entity_id' => $this->entity->id,
        ]);
    }

    private function day(string $date, string $in, string $out, int $workedMinutes): AttendanceRecord
    {
        return AttendanceRecord::query()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'attendance_date' => $date,
            'check_in_at' => "{$date} {$in}:00",
            'check_out_at' => "{$date} {$out}:00",
            'worked_seconds' => $workedMinutes * 60,
            'status' => 'present',
        ]);
    }

    private function breakOf(string $date, string $start, int $minutes): void
    {
        BreakTime::query()->create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'break_date' => $date,
            'start_at' => "{$date} {$start}:00",
            'end_at' => Carbon::parse("{$date} {$start}:00")->addMinutes($minutes)->toDateTimeString(),
            'duration_seconds' => $minutes * 60,
        ]);
    }

    /** @return array<int, array<string, mixed>> */
    private function breaches(string $from, string $to): array
    {
        return app(StatutoryComplianceService::class)
            ->forUser($this->employee->fresh(), $from, $to)['breaches'];
    }

    private function typesIn(array $breaches): array
    {
        return array_values(array_unique(array_column($breaches, 'type')));
    }

    public function test_an_unassessed_establishment_is_not_reported_as_compliant(): void
    {
        $this->entity->update(['establishment_type' => 'unregulated']);
        $this->day('2026-06-01', '08:00', '22:00', 13 * 60);

        $result = app(StatutoryComplianceService::class)
            ->forUser($this->employee->fresh(), '2026-06-01', '2026-06-01');

        // Thirteen hours, and no breach — because nobody has said what this
        // place is. The flag is what stops that reading as a clean bill of
        // health, and the controller counts these separately for the same
        // reason.
        $this->assertFalse($result['is_regulated']);
        $this->assertSame([], $result['breaches']);
    }

    public function test_it_reports_a_day_beyond_nine_hours(): void
    {
        $this->day('2026-06-01', '09:00', '20:00', 10 * 60);

        $breaches = $this->breaches('2026-06-01', '2026-06-01');
        $daily = collect($breaches)->firstWhere('type', StatutoryComplianceService::BREACH_DAILY_HOURS);

        $this->assertNotNull($daily);
        $this->assertSame(540, $daily['limit_minutes']);
        $this->assertSame(600, $daily['actual_minutes']);
        $this->assertSame(60, $daily['excess_minutes']);
        // "Says who" is the first question anybody asks of a compliance row.
        $this->assertSame('Factories Act 1948, s.54', $daily['citation']);
    }

    public function test_spread_over_counts_the_breaks_the_daily_limit_does_not(): void
    {
        // Eight hours worked across a thirteen-hour day: inside the daily limit
        // on hours, well outside the spread-over. Measured from the timestamps
        // rather than worked_seconds, which has the breaks removed.
        $this->day('2026-06-02', '08:00', '21:00', 8 * 60);

        $types = $this->typesIn($this->breaches('2026-06-02', '2026-06-02'));

        $this->assertContains(StatutoryComplianceService::BREACH_SPREAD_OVER, $types);
        $this->assertNotContains(StatutoryComplianceService::BREACH_DAILY_HOURS, $types);
    }

    public function test_two_short_breaks_are_not_a_rest_interval(): void
    {
        // Nine hours straight, broken only by two fifteen-minute teas. Three
        // half-hours of break in total on a naive sum, and not one qualifying
        // rest interval in law.
        $this->day('2026-06-03', '09:00', '18:00', 8 * 60);
        $this->breakOf('2026-06-03', '11:00', 15);
        $this->breakOf('2026-06-03', '15:00', 15);

        $rest = collect($this->breaches('2026-06-03', '2026-06-03'))
            ->firstWhere('type', StatutoryComplianceService::BREACH_REST_INTERVAL);

        $this->assertNotNull($rest, 'two short breaks were treated as a rest interval');
        $this->assertSame(300, $rest['limit_minutes']);
        $this->assertSame('Factories Act 1948, s.55', $rest['citation']);
    }

    public function test_a_real_rest_interval_clears_the_day(): void
    {
        // The same nine-hour span with one proper half-hour break in the middle:
        // no stretch longer than five hours, so nothing to report.
        $this->day('2026-06-04', '09:00', '18:00', 8 * 60);
        $this->breakOf('2026-06-04', '13:30', 30);

        $types = $this->typesIn($this->breaches('2026-06-04', '2026-06-04'));

        $this->assertNotContains(StatutoryComplianceService::BREACH_REST_INTERVAL, $types);
    }

    public function test_a_normal_overtime_week_is_not_filed_as_a_violation(): void
    {
        // Six nine-hour days: 54 hours. Over the 48 ordinary hours, so the
        // excess is overtime — lawful and paid at the overtime rate. It is the
        // 60-hour total that is prohibited, and it has not been reached.
        foreach (['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13'] as $date) {
            $this->day($date, '09:00', '18:00', 9 * 60);
        }

        $types = $this->typesIn($this->breaches('2026-06-08', '2026-06-14'));

        $this->assertContains(StatutoryComplianceService::BREACH_WEEKLY_HOURS, $types);
        $this->assertNotContains(StatutoryComplianceService::BREACH_WEEKLY_WITH_OVERTIME, $types);
    }

    public function test_it_reports_a_week_past_the_sixty_hour_ceiling(): void
    {
        // Six eleven-hour days: 66 hours, past the outright ceiling.
        foreach (['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13'] as $date) {
            $this->day($date, '09:00', '20:00', 11 * 60);
        }

        $types = $this->typesIn($this->breaches('2026-06-08', '2026-06-14'));

        $this->assertContains(StatutoryComplianceService::BREACH_WEEKLY_WITH_OVERTIME, $types);
        // Not both. Raising the softer one alongside it would double-count a
        // single week and inflate every total on the screen.
        $this->assertNotContains(StatutoryComplianceService::BREACH_WEEKLY_HOURS, $types);
    }

    public function test_a_part_week_at_the_edge_of_the_range_is_not_judged(): void
    {
        foreach (['2026-06-08', '2026-06-09', '2026-06-10'] as $date) {
            $this->day($date, '09:00', '20:00', 11 * 60);
        }

        // Three days is 33 hours. Under every weekly limit — but only because
        // the rest of the week was not asked for. Reporting "compliant" here
        // would be a false negative, so no weekly row is produced at all.
        $types = $this->typesIn($this->breaches('2026-06-08', '2026-06-10'));

        $this->assertNotContains(StatutoryComplianceService::BREACH_WEEKLY_HOURS, $types);
        $this->assertNotContains(StatutoryComplianceService::BREACH_WEEKLY_WITH_OVERTIME, $types);
    }

    public function test_the_quarterly_cap_counts_the_whole_quarter_not_the_asked_range(): void
    {
        /*
         * Overtime laid down across April and May, then a single day queried in
         * June. The cap is on the QUARTER - somebody asking about June cannot be
         * told they are inside it on June's evidence alone.
         */
        $date = Carbon::parse('2026-04-01');
        while ($date->lessThan(Carbon::parse('2026-06-01'))) {
            if (! $date->isWeekend()) {
                // Twelve-hour days: three hours a day past the statutory nine,
                // which is roughly 129 hours across the quarter and comfortably
                // past the fifty-hour cap.
                $this->day($date->toDateString(), '08:00', '20:00', 12 * 60);
            }
            $date->addDay();
        }

        $breach = collect($this->breaches('2026-06-01', '2026-06-01'))
            ->firstWhere('type', StatutoryComplianceService::BREACH_QUARTERLY_OVERTIME);

        $this->assertNotNull($breach, 'the quarterly cap only looked at the requested range');
        $this->assertSame(50 * 60, $breach['limit_minutes']);
        $this->assertSame('Factories Act 1948, s.64(4)', $breach['citation']);
    }

    public function test_an_exemption_raises_the_quarterly_cap(): void
    {
        $this->entity->update(['quarterly_overtime_cap_hours' => 144]);

        $date = Carbon::parse('2026-04-01');
        while ($date->lessThan(Carbon::parse('2026-06-01'))) {
            if (! $date->isWeekend()) {
                $this->day($date->toDateString(), '08:00', '20:00', 12 * 60);
            }
            $date->addDay();
        }

        $breach = collect($this->breaches('2026-06-01', '2026-06-01'))
            ->firstWhere('type', StatutoryComplianceService::BREACH_QUARTERLY_OVERTIME);

        // Section 65(3) and the state amendments raise the cap under a written
        // exemption. The same roughly 129 hours is over fifty and under 144, so
        // the identical pattern of work breaches one cap and not the other.
        $this->assertNull($breach);
    }
}
