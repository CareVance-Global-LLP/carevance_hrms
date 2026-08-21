<?php

namespace Tests\Feature;

use App\Models\Candidate;
use App\Models\JobOpening;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The recruitment API.
 *
 * Candidate records carry personal data, a current salary and a résumé, so
 * where the gate sits matters as much as what the endpoints do. Hiring is line
 * management work — a hiring manager must be able to move their own candidates
 * without asking HR — but it stops there rather than being open to everybody.
 */
class RecruitmentApiTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $manager;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-ats-api']);
        $this->manager = $this->makeUser('manager@carevance.test', 'manager');
        $this->employee = $this->makeUser('kajal@carevance.test', 'employee');
    }

    private function makeUser(string $email, string $role): User
    {
        return User::create([
            'name' => explode('@', $email)[0],
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $this->organization->id,
        ]);
    }

    private function opening(array $over = []): array
    {
        return array_merge([
            'title' => 'Backend Engineer',
            'status' => 'open',
            'openings_count' => 2,
        ], $over);
    }

    public function test_a_manager_can_open_a_requisition_and_gets_a_reference(): void
    {
        $this->actingAs($this->manager);

        $response = $this->postJson('/api/recruitment/openings', $this->opening())->assertCreated();

        // Generated so nobody has to invent one, and readable enough to say out
        // loud in a stand-up.
        $this->assertSame('REQ-1', $response->json('data.code'));
        $this->assertSame($this->organization->id, $response->json('data.organization_id'));
    }

    public function test_the_reference_does_not_collide_after_a_deletion(): void
    {
        $this->actingAs($this->manager);

        $this->postJson('/api/recruitment/openings', $this->opening())->assertCreated();
        $second = $this->postJson('/api/recruitment/openings', $this->opening(['title' => 'Frontend']))->assertCreated();

        JobOpening::query()->where('code', 'REQ-2')->delete();
        $third = $this->postJson('/api/recruitment/openings', $this->opening(['title' => 'QA']))->assertCreated();

        // Derived from the highest number, not from a count - otherwise
        // deleting REQ-2 makes the next opening REQ-2 as well and the unique
        // index rejects it.
        $this->assertSame('REQ-2', $second->json('data.code'));
        $this->assertSame('REQ-3', $third->json('data.code'));
    }

    public function test_opening_a_requisition_stamps_the_date_once(): void
    {
        $this->actingAs($this->manager);

        $created = $this->postJson('/api/recruitment/openings', $this->opening(['status' => 'draft']))->assertCreated();
        $id = $created->json('data.id');

        $this->putJson("/api/recruitment/openings/{$id}", ['status' => 'open'])->assertOk();
        $opened = JobOpening::query()->find($id)->opened_at->toDateString();

        $this->putJson("/api/recruitment/openings/{$id}", ['title' => 'Backend Engineer II'])->assertOk();

        // Re-stamping on every later edit would make time-to-hire measure from
        // the last time somebody fixed a typo.
        $this->assertSame($opened, JobOpening::query()->find($id)->opened_at->toDateString());
    }

    public function test_a_salary_band_that_runs_backwards_is_refused(): void
    {
        $this->actingAs($this->manager);

        $this->postJson('/api/recruitment/openings', $this->opening([
            'min_ctc' => 2000000,
            'max_ctc' => 1200000,
        ]))->assertStatus(422);
    }

    public function test_the_same_email_may_exist_as_a_candidate_in_two_workspaces(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'other-ats-api']);
        Candidate::withoutOrganizationScope()->create([
            'organization_id' => $other->id,
            'first_name' => 'Priya',
            'email' => 'priya@example.test',
        ]);

        $this->actingAs($this->manager);

        /*
         * Deliberately unlike users.email, which is globally unique. The same
         * person legitimately applies to two different customers on this
         * platform, and a global rule would let one customer's pipeline block
         * another's.
         */
        $this->postJson('/api/recruitment/candidates', [
            'first_name' => 'Priya',
            'email' => 'priya@example.test',
        ])->assertCreated();
    }

    public function test_the_same_email_twice_in_one_workspace_is_refused(): void
    {
        $this->actingAs($this->manager);

        $this->postJson('/api/recruitment/candidates', ['first_name' => 'Priya', 'email' => 'priya@example.test'])->assertCreated();
        $this->postJson('/api/recruitment/candidates', ['first_name' => 'Priya', 'email' => 'priya@example.test'])->assertStatus(422);
    }

    public function test_a_refused_transition_is_a_422_not_a_500(): void
    {
        $this->actingAs($this->manager);

        $opening = $this->postJson('/api/recruitment/openings', $this->opening(['status' => 'draft']))->json('data.id');
        $candidate = $this->postJson('/api/recruitment/candidates', [
            'first_name' => 'Priya', 'email' => 'priya@example.test',
        ])->json('data.id');

        // "That opening is not accepting applications" is a rule the caller can
        // act on. A 500 tells them only that something broke.
        $this->postJson('/api/recruitment/applications', [
            'job_opening_id' => $opening,
            'candidate_id' => $candidate,
        ])->assertStatus(422)->assertJsonPath('message', 'That opening is not accepting applications.');
    }

    public function test_rejecting_without_a_reason_is_refused(): void
    {
        $this->actingAs($this->manager);

        $application = $this->seedApplication();

        $this->postJson("/api/recruitment/applications/{$application}/decide", [
            'decision' => 'rejected',
        ])->assertStatus(422);
    }

    public function test_the_event_trail_explains_how_somebody_got_where_they_are(): void
    {
        $this->actingAs($this->manager);

        $application = $this->seedApplication();
        $stages = $this->getJson('/api/recruitment/stages')->json('data');
        $interview = collect($stages)->firstWhere('slug', 'interview');

        $this->postJson("/api/recruitment/applications/{$application}/move", [
            'hiring_stage_id' => $interview['id'],
            'note' => 'Strong take-home',
        ])->assertOk();

        $events = $this->getJson("/api/recruitment/applications/{$application}/events")->assertOk()->json('data');

        // Applied, then advanced. "Why has this person been in screening for
        // three weeks" is answerable only from rows like these.
        $this->assertSame(['applied', 'advanced'], array_column($events, 'action'));
        $this->assertSame('Strong take-home', $events[1]['note']);
    }

    public function test_an_employee_cannot_reach_recruitment(): void
    {
        $this->actingAs($this->employee);

        // Candidate records carry personal data, a current salary and a résumé.
        $this->getJson('/api/recruitment/openings')->assertForbidden();
        $this->getJson('/api/recruitment/candidates')->assertForbidden();
        $this->postJson('/api/recruitment/candidates', ['first_name' => 'X', 'email' => 'x@y.test'])->assertForbidden();
    }

    public function test_another_workspaces_opening_is_not_found(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'other-ats-reach']);
        $theirs = JobOpening::withoutOrganizationScope()->create([
            'organization_id' => $other->id,
            'code' => 'REQ-1',
            'title' => 'Theirs',
            'status' => 'open',
        ]);

        $this->actingAs($this->manager);

        $this->getJson("/api/recruitment/openings/{$theirs->id}")->assertNotFound();
        $this->putJson("/api/recruitment/openings/{$theirs->id}", ['title' => 'Renamed'])->assertNotFound();
        $this->assertSame('Theirs', $theirs->fresh()->title);
    }

    public function test_the_funnel_comes_back_with_the_opening(): void
    {
        $this->actingAs($this->manager);
        $this->seedApplication();

        $opening = JobOpening::query()->first();
        $response = $this->getJson("/api/recruitment/openings/{$opening->id}")->assertOk();

        $this->assertCount(5, $response->json('funnel'));
        // Two openings, one hire away from full - the number a hiring manager
        // actually asks for.
        $this->assertSame(2, $response->json('remaining_openings'));
    }

    private function seedApplication(): int
    {
        $opening = $this->postJson('/api/recruitment/openings', $this->opening())->json('data.id');
        $candidate = $this->postJson('/api/recruitment/candidates', [
            'first_name' => 'Priya', 'email' => 'priya@example.test',
        ])->json('data.id');

        return (int) $this->postJson('/api/recruitment/applications', [
            'job_opening_id' => $opening,
            'candidate_id' => $candidate,
        ])->assertCreated()->json('data.id');
    }
}
