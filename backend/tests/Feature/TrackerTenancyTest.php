<?php

namespace Tests\Feature;

use App\Jobs\ReclassifyProductivityJob;
use App\Models\Activity;
use App\Models\ActivitySession;
use App\Models\Organization;
use App\Models\ProductivityClassification;
use App\Models\Screenshot;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Monitoring\ProductivityClassifier;
use App\Traits\BelongsToOrganization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * The tracker domain was reachable only through user_id, which means tenancy
 * depended on every query remembering to join users. This asserts it is now a
 * property of the tables instead.
 */
class TrackerTenancyTest extends TestCase
{
    use RefreshDatabase;

    public function test_every_tracker_table_carries_an_organization_id(): void
    {
        foreach (['activity_sessions', 'activities', 'time_entries', 'screenshots'] as $table) {
            $this->assertTrue(
                Schema::hasColumn($table, 'organization_id'),
                "{$table} has no organization_id, so its tenancy is not structural"
            );
        }
    }

    public function test_every_tracker_model_is_organization_scoped(): void
    {
        foreach ([Activity::class, ActivitySession::class, Screenshot::class, TimeEntry::class] as $model) {
            $this->assertContains(
                BelongsToOrganization::class,
                class_uses_recursive($model),
                $model.' owns a table with organization_id but is not scoped'
            );
        }
    }

    public function test_a_query_cannot_see_another_organizations_sessions(): void
    {
        [$orgA, $adminA] = $this->orgWithAdmin('a');
        [$orgB, $adminB] = $this->orgWithAdmin('b');

        Auth::setUser($adminA);
        ActivitySession::create($this->sessionAttributes($adminA));

        Auth::setUser($adminB);
        $this->assertSame(0, ActivitySession::count(), 'org B saw org A activity');

        Auth::setUser($adminA);
        $this->assertSame(1, ActivitySession::count());
    }

    public function test_creating_a_session_stamps_the_acting_users_organization(): void
    {
        [$org, $admin] = $this->orgWithAdmin('c');
        Auth::setUser($admin);

        $session = ActivitySession::create($this->sessionAttributes($admin));

        $this->assertSame($org->id, $session->organization_id);
    }

    /**
     * The trait's global scope is deliberately a no-op with no authenticated
     * user, so console commands are not filtered to nothing. In a job that
     * default means querying across EVERY tenant — the same trap the payroll
     * jobs solve with Auth::setUser(), asserted by PayrollRunProcessingQueueTest.
     *
     * A queue worker is a long-running process that reuses the same PHP state
     * across jobs, so "no authenticated user" is not the only failure mode: a
     * worker that just finished a request for a DIFFERENT organization can
     * leave that organization's user as the ambient Auth::user() when the next
     * job starts. This reproduces exactly that — organization B's admin is
     * still "logged in" when a reclassification for organization A runs.
     *
     * Freshness (updated_at) alone is not enough to prove this: the job can
     * re-save a row without landing the right DATA on it. The path that
     * actually matters is the admin override this job exists to apply —
     * ProductivityClassifier::overridesFor() queries ProductivityClassification,
     * which is ALSO BelongsToOrganization-scoped, so its explicit
     * `where organization_id = A` sits beside the model's own ambient scope.
     * Under the worker-reuse setup above, an implementation that pins only the
     * two Activity/ActivitySession queries leaves that ambient scope reading
     * org B — the two predicates never overlap, the override lookup silently
     * finds nothing, and the row gets re-stamped with the default heuristic
     * instead of the administrator's override: the exact inverse of why this
     * job runs at all. So this asserts the CLASSIFICATION written to the row,
     * not merely that the row was touched.
     */
    public function test_the_reclassify_job_only_touches_the_acting_organizations_rows(): void
    {
        [$orgA, $adminA] = $this->orgWithAdmin('ra');
        [$orgB, $adminB] = $this->orgWithAdmin('rb');

        Auth::setUser($adminA);
        // array_merge(), not +: sessionAttributes() already sets display_name
        // to 'VS Code', and `+` keeps the LEFT array's value for a key present
        // in both — it would silently discard the override below rather than
        // apply it, leaving the row's real content unrelated to the 'chrome'
        // override this test creates further down.
        $sessionA = ActivitySession::create(array_merge($this->sessionAttributes($adminA), [
            'display_name' => 'Google Chrome',
            'software_name' => 'chrome',
        ]));

        Auth::setUser($adminB);
        $sessionB = ActivitySession::create(array_merge($this->sessionAttributes($adminB), [
            'display_name' => 'Google Chrome',
            'software_name' => 'chrome',
        ]));

        // A throwaway instance: ProductivityClassifier::overridesFor() memoizes
        // per organization ON THE INSTANCE, so probing the baseline through the
        // SAME classifier the job later uses would leave it holding a stale
        // "no overrides yet" answer for organization A from before the
        // override below existed — a bug in the test, not the job, but one
        // that would make this assertion fail for the wrong reason.
        //
        // Learn what the classifier says with NO override at all, so the
        // override created below for organization A is guaranteed to differ
        // from it — otherwise the classification assertion further down
        // could pass by coincidence instead of because the override was
        // genuinely found and applied. Built from exactly the fields the
        // job's own ActivitySession branch passes to classifyContext().
        $baseline = app(ProductivityClassifier::class)->classifyContext([
            'activity_type' => 'app',
            'raw_name' => 'Google Chrome',
            'window_title' => '',
            'app_name' => '',
            'url' => '',
            'user_id' => $adminA->id,
            'organization_id' => $orgA->id,
            'group_ids' => [],
        ])['classification'];
        $override = $baseline === 'unproductive' ? 'productive' : 'unproductive';

        // Organization A's admin set an override — this job runs BECAUSE that
        // happened, to re-stamp existing rows with it.
        Auth::setUser($adminA);
        ProductivityClassification::create([
            'target_type' => 'app',
            'target_value' => 'chrome',
            'classification' => $override,
        ]);

        // Backdate both sessions so "was this one re-saved by the job" can
        // also be read straight off updated_at, independent of the
        // classification value.
        $stale = now()->subDay();
        ActivitySession::withoutOrganizationScope()->whereKey($sessionA->id)->update(['updated_at' => $stale]);
        ActivitySession::withoutOrganizationScope()->whereKey($sessionB->id)->update(['updated_at' => $stale]);

        // Simulate the worker-reuse scenario: organization B's admin is still
        // the ambient authenticated user when this job for organization A
        // begins running.
        Auth::setUser($adminB);

        // A second fresh instance for the same reason — this is the job's own
        // classifier, and it must start with no cached (empty) answer for
        // organization A's overrides.
        (new ReclassifyProductivityJob($orgA->id, 'app', 'chrome'))
            ->handle(app(ProductivityClassifier::class));

        $refreshedA = ActivitySession::withoutOrganizationScope()->find($sessionA->id);
        $refreshedB = ActivitySession::withoutOrganizationScope()->find($sessionB->id);

        $this->assertTrue(
            $refreshedA->updated_at->greaterThan($stale),
            "the job should have reprocessed the acting organization's (A) session"
        );
        $this->assertSame(
            $stale->timestamp,
            $refreshedB->updated_at->timestamp,
            "the job must not touch another organization's (B) session"
        );

        // The assertion that actually matters: A's session must carry A's
        // own admin's override, not the default heuristic computed with no
        // override in play.
        $this->assertSame(
            $override,
            $refreshedA->classification,
            "organization A's session must carry A's own override — the override lookup ".
            "must not silently miss it because the ambient organization disagrees with ".
            "the explicit one"
        );
    }

    /** @return array{0: Organization, 1: User} */
    private function orgWithAdmin(string $slug): array
    {
        $org = Organization::create(['name' => 'Org '.$slug, 'slug' => 'org-'.$slug]);
        $admin = User::create([
            'name' => 'Admin '.$slug, 'email' => "admin-{$slug}@tracker.test",
            'password' => Hash::make('password123'), 'role' => 'admin',
            'organization_id' => $org->id,
        ]);

        return [$org, $admin];
    }

    /** @return array<string, mixed> */
    private function sessionAttributes(User $user): array
    {
        return [
            'user_id' => $user->id,
            'source' => 'desktop',
            'activity_kind' => 'app',
            'tool_type' => 'editor',
            'display_name' => 'VS Code',
            'classification' => 'productive',
            'started_at' => now()->subHour(),
            'ended_at' => now(),
            'duration_seconds' => 3600,
        ];
    }
}
