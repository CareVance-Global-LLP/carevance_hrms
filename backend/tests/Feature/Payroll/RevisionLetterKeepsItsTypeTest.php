<?php

namespace Tests\Feature\Payroll;

use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\SalaryRevisionLetter;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A PROMOTION IS NOT A CORRECTION.
 *
 * generateRevisionLetter stored a literal:
 *
 *     'revision_type' => 'correction',
 *
 * for every revision, whatever it was. The column's own comment lists
 * annual_increment, promotion, correction and other; the screen above it says
 * "Record CTC changes — increments, promotions, corrections"; and the API
 * client has always declared `revision_type` in its payload. The value was
 * accepted from nobody and asserted to be the same thing every time.
 *
 * It is not cosmetic. This lands on a salary revision letter the employee
 * receives: telling somebody their promotion was a correction to their pay is a
 * different statement about their year, and "correction" is the one word of the
 * four that implies a previous mistake.
 *
 * `reason` was dropped on the floor for the same reason — never validated,
 * never written — so the one field that could explain a revision was silently
 * discarded.
 *
 * The default is `other`, not a guess. An unstated type is unknown, and the
 * database defaulting a professional-tax state to Maharashtra is the standing
 * lesson here about inventing a plausible value.
 */
class RevisionLetterKeepsItsTypeTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        EmployeePayrollTemplate::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'annual_ctc' => 840000,
            'is_active' => true,
        ]);
    }

    public function test_a_promotion_is_recorded_as_a_promotion(): void
    {
        $this->create(['revision_type' => 'promotion']);

        $this->assertSame('promotion', SalaryRevisionLetter::firstOrFail()->revision_type);
    }

    public function test_an_annual_increment_keeps_its_name(): void
    {
        $this->create(['revision_type' => 'annual_increment']);

        $this->assertSame('annual_increment', SalaryRevisionLetter::firstOrFail()->revision_type);
    }

    public function test_an_unstated_type_is_other_rather_than_a_guess(): void
    {
        $this->create();

        // Not 'correction'. An unstated type is unknown, and 'correction' is the
        // one value of the four that implies somebody made a mistake before.
        $this->assertSame('other', SalaryRevisionLetter::firstOrFail()->revision_type);
    }

    public function test_a_type_outside_the_list_is_refused(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/payroll/revision-letters', [
                'user_id' => $this->employee->id,
                'new_ctc' => 960000,
                'revision_type' => 'whatever',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('revision_type');
    }

    public function test_the_reason_is_kept(): void
    {
        $this->create([
            'revision_type' => 'promotion',
            'reason' => 'Promoted to Senior Recruiter after Q2 review.',
        ]);

        $this->assertSame(
            'Promoted to Senior Recruiter after Q2 review.',
            SalaryRevisionLetter::firstOrFail()->reason
        );
    }

    private function create(array $extra = []): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/payroll/revision-letters', array_merge([
                'user_id' => $this->employee->id,
                'new_ctc' => 960000,
                'effective_date' => '2026-10-01',
            ], $extra))
            ->assertStatus(201);
    }
}
