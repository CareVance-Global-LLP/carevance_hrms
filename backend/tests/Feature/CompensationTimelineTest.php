<?php

namespace Tests\Feature;

use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\SalaryRevisionLetter;
use App\Models\User;
use App\Services\Payroll\CompensationTimeline;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Recovering what someone earned on a given day.
 *
 * annual_ctc is a single mutable scalar — accepting a revision overwrites it,
 * so the previous rate is lost and nothing can ask what was payable last month.
 * Accepted revision letters carry old_ctc, new_ctc and effective_from, which is
 * a dated series in all but name.
 */
class CompensationTimelineTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;
    private CompensationTimeline $timeline;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);
        $this->timeline = app(CompensationTimeline::class);

        EmployeePayrollTemplate::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'annual_ctc' => 720000, // current rate, after the revision below
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_allowance' => 1600,
            'tax_regime' => 'new',
            'pt_state' => '',
        ]);
    }

    private function acceptedRevision(string $effectiveFrom, float $oldCtc, float $newCtc): SalaryRevisionLetter
    {
        return SalaryRevisionLetter::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'old_ctc' => $oldCtc,
            'new_ctc' => $newCtc,
            'revision_percentage' => 0,
            'revision_type' => 'hike',
            'effective_from' => $effectiveFrom,
            'reason' => 'test',
            'status' => 'accepted',
            'generated_by' => $this->employee->id,
        ]);
    }

    public function test_the_current_rate_applies_when_there_is_no_revision(): void
    {
        $this->assertSame(
            720000.0,
            $this->timeline->annualCtcOn($this->employee->id, $this->organization->id, Carbon::create(2026, 6, 10))
        );
    }

    public function test_a_date_before_the_revision_recovers_the_old_rate(): void
    {
        $this->acceptedRevision('2026-06-16', 600000, 720000);

        $this->assertSame(
            600000.0,
            $this->timeline->annualCtcOn($this->employee->id, $this->organization->id, Carbon::create(2026, 6, 15)),
            'The 15th precedes the revision, so the old rate was in force.'
        );
    }

    public function test_the_effective_date_itself_is_on_the_new_rate(): void
    {
        $this->acceptedRevision('2026-06-16', 600000, 720000);

        $this->assertSame(
            720000.0,
            $this->timeline->annualCtcOn($this->employee->id, $this->organization->id, Carbon::create(2026, 6, 16))
        );
    }

    public function test_successive_revisions_unwind_in_order(): void
    {
        $this->acceptedRevision('2026-04-01', 480000, 600000);
        $this->acceptedRevision('2026-06-16', 600000, 720000);

        $this->assertSame(480000.0, $this->timeline->annualCtcOn($this->employee->id, $this->organization->id, Carbon::create(2026, 3, 31)));
        $this->assertSame(600000.0, $this->timeline->annualCtcOn($this->employee->id, $this->organization->id, Carbon::create(2026, 5, 1)));
        $this->assertSame(720000.0, $this->timeline->annualCtcOn($this->employee->id, $this->organization->id, Carbon::create(2026, 7, 1)));
    }

    public function test_an_unaccepted_revision_does_not_change_the_timeline(): void
    {
        $letter = $this->acceptedRevision('2026-06-16', 600000, 720000);
        $letter->update(['status' => 'draft']);

        $this->assertSame(
            720000.0,
            $this->timeline->annualCtcOn($this->employee->id, $this->organization->id, Carbon::create(2026, 6, 1)),
            'Only an accepted revision moves the rate.'
        );
    }

    public function test_a_month_with_no_revision_is_a_single_segment(): void
    {
        $segments = $this->timeline->segmentsForMonth($this->employee->id, $this->organization->id, '2026-06');

        $this->assertCount(1, $segments);
        $this->assertSame(30, $segments[0]['days']);
        $this->assertSame(720000.0, $segments[0]['annual_ctc']);
    }

    public function test_a_mid_month_revision_splits_the_month_at_the_effective_date(): void
    {
        $this->acceptedRevision('2026-06-16', 600000, 720000);

        $segments = $this->timeline->segmentsForMonth($this->employee->id, $this->organization->id, '2026-06');

        $this->assertCount(2, $segments);

        $this->assertSame('2026-06-01', $segments[0]['from']->toDateString());
        $this->assertSame('2026-06-15', $segments[0]['to']->toDateString());
        $this->assertSame(15, $segments[0]['days']);
        $this->assertSame(600000.0, $segments[0]['annual_ctc']);

        $this->assertSame('2026-06-16', $segments[1]['from']->toDateString());
        $this->assertSame('2026-06-30', $segments[1]['to']->toDateString());
        $this->assertSame(15, $segments[1]['days']);
        $this->assertSame(720000.0, $segments[1]['annual_ctc']);
    }

    public function test_segment_days_always_sum_to_the_month(): void
    {
        $this->acceptedRevision('2026-06-16', 600000, 720000);

        $segments = $this->timeline->segmentsForMonth($this->employee->id, $this->organization->id, '2026-06');

        $this->assertSame(30, array_sum(array_column($segments, 'days')), 'A split month must still be a whole month.');
    }

    public function test_a_revision_effective_on_the_first_does_not_create_an_empty_segment(): void
    {
        $this->acceptedRevision('2026-06-01', 600000, 720000);

        $segments = $this->timeline->segmentsForMonth($this->employee->id, $this->organization->id, '2026-06');

        $this->assertCount(1, $segments, 'A revision on the 1st is a whole-month rate, not a zero-day segment.');
        $this->assertSame(720000.0, $segments[0]['annual_ctc']);
    }
}
