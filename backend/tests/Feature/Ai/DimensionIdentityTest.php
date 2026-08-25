<?php

namespace Tests\Feature\Ai;

use App\Models\Organization;
use App\Models\User;
use App\Services\Ai\PlanValidator;
use App\Services\Ai\QueryPlanExecutor;
use App\Services\Ai\SemanticLayer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * A name is not an identity.
 *
 * Found live on 24 Aug 2026: "who was absent more than 3 days last month"
 * answered `QA E2E — 47` against a 31-day month. Twelve separate users in the
 * database are all called "QA E2E", and the `employee` dimension grouped by
 * `users.name`, so twelve people's absences were summed and presented as one
 * person's. Four was the true figure for any single one of them.
 *
 * The plan, the period and the metric were all correct — the merge happened in
 * the GROUP BY. That makes it exactly the failure this design exists to
 * prevent: a confident wrong number with a correct-looking derivation behind
 * it. Nothing about it is specific to seed data; any organisation with two
 * people called Priya Sharma had their attendance, payroll and leave silently
 * combined.
 */
class DimensionIdentityTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        Auth::setUser(User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]));
    }

    public function test_a_foreign_key_dimension_declares_an_identity(): void
    {
        $dimension = SemanticLayer::dimension('attendance', 'employee');

        $this->assertNotEmpty(
            $dimension['identity'] ?? null,
            'employee selects a name; without an identity the grouping merges people'
        );
        $this->assertStringContainsString('user_id', (string) $dimension['identity']);
    }

    public function test_two_people_sharing_a_name_stay_two_rows(): void
    {
        [$first, $second] = collect(range(1, 2))->map(fn () => User::factory()->create([
            'organization_id' => $this->organization->id,
            'name' => 'Priya Sharma',
        ]))->all();

        // Three absences each. Merged, this reads as one person with six.
        foreach ([$first, $second] as $person) {
            foreach (range(1, 3) as $day) {
                $this->absence($person->id, $day);
            }
        }

        $rows = $this->rowsFor([
            'entity' => 'attendance',
            'metrics' => ['absent_days'],
            'group_by' => ['employee'],
        ]);

        $sharing = array_values(array_filter($rows, fn ($row) => $row['employee'] === 'Priya Sharma'));

        $this->assertCount(2, $sharing, 'two employees sharing a name must remain two rows');

        foreach ($sharing as $row) {
            $this->assertSame(3, (int) $row['absent_days'], 'each row must carry only its own person');
        }
    }

    public function test_the_totals_are_not_inflated_by_the_split(): void
    {
        // The fix must separate rows, not duplicate work: six absences across
        // two same-named people is still six, never twelve.
        foreach (range(1, 2) as $ignored) {
            $person = User::factory()->create([
                'organization_id' => $this->organization->id,
                'name' => 'Same Name',
            ]);

            foreach (range(1, 3) as $day) {
                $this->absence($person->id, $day);
            }
        }

        $rows = $this->rowsFor([
            'entity' => 'attendance',
            'metrics' => ['absent_days'],
            'group_by' => ['employee'],
        ]);

        $total = array_sum(array_map(fn ($row) => (int) $row['absent_days'], $rows));

        $this->assertSame(6, $total);
    }

    public function test_a_threshold_is_applied_per_person_not_per_name(): void
    {
        // The live failure in one assertion: three people called "Team" with
        // two absences each cleared a "more than 3" threshold as a merged six.
        foreach (range(1, 3) as $ignored) {
            $person = User::factory()->create([
                'organization_id' => $this->organization->id,
                'name' => 'Team',
            ]);

            foreach (range(1, 2) as $day) {
                $this->absence($person->id, $day);
            }
        }

        $rows = $this->rowsFor([
            'entity' => 'attendance',
            'metrics' => ['absent_days'],
            'group_by' => ['employee'],
            'having' => [['metric' => 'absent_days', 'op' => 'gt', 'value' => 3]],
        ]);

        $this->assertSame([], $rows, 'nobody was absent more than three days; only the merge made it look so');
    }

    /** There is no AttendanceRecord factory, and this needs only four columns. */
    private function absence(int $userId, int $day): void
    {
        DB::table('attendance_records')->insert([
            'organization_id' => $this->organization->id,
            'user_id' => $userId,
            'attendance_date' => sprintf('2026-07-%02d', $day),
            'status' => 'absent',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * @param  array<string, mixed>  $plan
     * @return list<array<string, mixed>>
     */
    private function rowsFor(array $plan): array
    {
        $validated = app(PlanValidator::class)->validate($plan);

        return app(QueryPlanExecutor::class)->execute($validated)['rows'];
    }
}
