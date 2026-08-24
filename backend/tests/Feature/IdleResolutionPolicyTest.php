<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Monitoring\IdleResolutionService;
use App\Services\Monitoring\TrackerPolicyResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The organization's answer to "what happens to idle time when someone comes
 * back": ask them, always keep it, or never keep it.
 *
 * Enforced when the idle span is recorded rather than in the desktop prompt,
 * because a policy that only holds while the app is open is not a policy. The
 * numbers here become pay.
 */
class IdleResolutionPolicyTest extends TestCase
{
    use RefreshDatabase;

    private function makeOrganization(?string $policy): Organization
    {
        return Organization::create([
            'name' => 'CareVance',
            'slug' => 'org-idle-policy',
            'settings' => $policy === null ? [] : ['idle_resolution_policy' => $policy],
        ]);
    }

    private function makeUser(Organization $organization, string $email, string $role = 'employee', ?array $settings = null): User
    {
        return User::create([
            'name' => 'Employee',
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $organization->id,
            'settings' => $settings,
        ]);
    }

    /** Post an idle span the way the desktop tracker does. */
    private function recordIdle(User $user, TimeEntry $entry, int $seconds = 300): Activity
    {
        $response = $this->postJson('/api/activities', [
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'idle',
            'name' => 'Idle',
            'duration' => $seconds,
            'recorded_at' => now()->toIso8601String(),
        ], $this->apiHeadersFor($user));

        $response->assertSuccessful();

        return Activity::findOrFail($response->json('id'));
    }

    private function startedEntry(User $user): TimeEntry
    {
        // Stamps organization_id the same way BelongsToOrganization would
        // from a real authenticated request.
        Auth::setUser($user);

        return TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => now()->subHour(),
        ]);
    }

    public function test_prompt_leaves_the_idle_span_for_the_person_to_answer(): void
    {
        $organization = $this->makeOrganization(TrackerPolicyResolver::IDLE_POLICY_PROMPT);
        $user = $this->makeUser($organization, 'prompt@example.com');

        $activity = $this->recordIdle($user, $this->startedEntry($user));

        // Unanswered is the whole point: the desktop prompt asks, and until it
        // is answered nothing has been added to or taken off the timesheet.
        $this->assertNull($activity->fresh()->idle_resolution);
    }

    public function test_never_keep_discards_the_idle_span_without_being_asked(): void
    {
        $organization = $this->makeOrganization(TrackerPolicyResolver::IDLE_POLICY_NEVER_KEEP);
        $user = $this->makeUser($organization, 'never@example.com');

        $activity = $this->recordIdle($user, $this->startedEntry($user));

        $this->assertSame(IdleResolutionService::DISCARDED, $activity->fresh()->idle_resolution);
        $this->assertNotNull($activity->fresh()->idle_resolved_at);
    }

    public function test_always_keep_marks_the_idle_span_kept_without_being_asked(): void
    {
        $organization = $this->makeOrganization(TrackerPolicyResolver::IDLE_POLICY_ALWAYS_KEEP);
        $user = $this->makeUser($organization, 'always@example.com');

        $activity = $this->recordIdle($user, $this->startedEntry($user));

        $this->assertSame(IdleResolutionService::KEPT, $activity->fresh()->idle_resolution);
    }

    public function test_an_organization_that_never_set_a_policy_prompts(): void
    {
        // Absent must mean "ask", never either automatic answer.
        $organization = $this->makeOrganization(null);
        $user = $this->makeUser($organization, 'unset@example.com');

        $activity = $this->recordIdle($user, $this->startedEntry($user));

        $this->assertNull($activity->fresh()->idle_resolution);
    }

    public function test_a_malformed_policy_falls_back_to_prompting(): void
    {
        // A typo in settings must not start discarding people's time.
        $organization = $this->makeOrganization('discard_everything');
        $user = $this->makeUser($organization, 'junk@example.com');

        $activity = $this->recordIdle($user, $this->startedEntry($user));

        $this->assertNull($activity->fresh()->idle_resolution);
    }

    public function test_a_per_user_override_beats_the_organization(): void
    {
        $organization = $this->makeOrganization(TrackerPolicyResolver::IDLE_POLICY_NEVER_KEEP);
        $user = $this->makeUser(
            $organization,
            'override@example.com',
            'employee',
            ['idle_resolution_policy' => TrackerPolicyResolver::IDLE_POLICY_ALWAYS_KEEP]
        );

        $activity = $this->recordIdle($user, $this->startedEntry($user));

        $this->assertSame(IdleResolutionService::KEPT, $activity->fresh()->idle_resolution);
    }

    public function test_an_invalid_per_user_value_falls_through_to_the_organization(): void
    {
        // Not to the system default. A junk personal value must not bypass what
        // the organization deliberately chose.
        $organization = $this->makeOrganization(TrackerPolicyResolver::IDLE_POLICY_NEVER_KEEP);
        $user = $this->makeUser($organization, 'junk-user@example.com', 'employee', ['idle_resolution_policy' => 'nonsense']);

        $activity = $this->recordIdle($user, $this->startedEntry($user));

        $this->assertSame(IdleResolutionService::DISCARDED, $activity->fresh()->idle_resolution);
    }

    public function test_auto_resolution_is_not_applied_twice(): void
    {
        $organization = $this->makeOrganization(TrackerPolicyResolver::IDLE_POLICY_NEVER_KEEP);
        $user = $this->makeUser($organization, 'twice@example.com');
        $entry = $this->startedEntry($user);
        $activity = $this->recordIdle($user, $entry, 300);
        $durationAfterFirst = (int) $entry->fresh()->duration;

        // The desktop still calls resolve-idle when it has an unanswered row
        // cached. A second discard of the same span would deduct the minutes
        // again, so IdleResolutionService short-circuits on idle_resolution.
        $this->postJson("/api/activities/{$activity->id}/resolve-idle", [
            'action' => 'discarded',
        ], $this->apiHeadersFor($user))->assertOk()->assertJsonPath('seconds_removed', 0);

        $this->assertSame($durationAfterFirst, (int) $entry->fresh()->duration);
    }

    public function test_the_policy_ships_on_the_user_payload(): void
    {
        $organization = $this->makeOrganization(TrackerPolicyResolver::IDLE_POLICY_NEVER_KEEP);
        $user = $this->makeUser($organization, 'payload@example.com');

        // The desktop reads this to decide whether to show its prompt at all.
        $this->getJson('/api/auth/me', $this->apiHeadersFor($user))
            ->assertOk()
            ->assertJsonPath('tracker_policy.idle_resolution_policy', TrackerPolicyResolver::IDLE_POLICY_NEVER_KEEP);
    }

    public function test_an_admin_can_set_and_clear_the_organization_policy(): void
    {
        $organization = $this->makeOrganization(null);
        $admin = $this->makeUser($organization, 'admin-policy@example.com', 'admin');

        $this->putJson('/api/settings/organization', [
            'name' => $organization->name,
            'slug' => $organization->slug,
            'idle_resolution_policy' => TrackerPolicyResolver::IDLE_POLICY_NEVER_KEEP,
        ], $this->apiHeadersFor($admin))->assertOk();

        $this->assertSame(
            TrackerPolicyResolver::IDLE_POLICY_NEVER_KEEP,
            $organization->fresh()->settings['idle_resolution_policy'] ?? null
        );

        $this->putJson('/api/settings/organization', [
            'name' => $organization->name,
            'slug' => $organization->slug,
            'idle_resolution_policy' => null,
        ], $this->apiHeadersFor($admin))->assertOk();

        $this->assertNull($organization->fresh()->settings['idle_resolution_policy'] ?? null);
    }

    public function test_an_unrecognised_policy_is_rejected_rather_than_stored(): void
    {
        $organization = $this->makeOrganization(null);
        $admin = $this->makeUser($organization, 'admin-reject@example.com', 'admin');

        // Storing junk that the resolver then ignores is the silent-discard
        // trap; refuse it at the boundary instead.
        $this->putJson('/api/settings/organization', [
            'name' => $organization->name,
            'slug' => $organization->slug,
            'idle_resolution_policy' => 'delete_it_all',
        ], $this->apiHeadersFor($admin))->assertStatus(422);
    }
}
