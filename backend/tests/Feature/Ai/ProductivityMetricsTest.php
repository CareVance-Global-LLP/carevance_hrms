<?php

namespace Tests\Feature\Ai;

use App\Models\Activity;
use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\Ai\EntityRetriever;
use App\Services\Ai\PlanValidator;
use App\Services\Ai\QueryPlanExecutor;
use App\Services\Ai\SemanticLayer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * "make me an table with different department with whoes more produtive"
 *
 * That question was answered "No records match that question." The product
 * computed AVG(productivity_score) over `payroll_items` — the only table with a
 * column of that name — which is a PAYROLL SNAPSHOT holding zero rows until a
 * run has been processed. Meanwhile `activities` held 10,548 fully classified
 * rows that answer the question directly.
 *
 * Two failures, and this file guards both:
 *
 *  1. RETRIEVAL indexes names and labels, never column VALUES. "productive" is
 *     a value of `activities.classification`, so the only names carrying the
 *     word were payroll's `total_productive_seconds` and `productivity_score`.
 *     Fixed with synonyms — and, because a real question is not a clean one,
 *     with a one-edit correction for a word the catalogue does not recognise.
 *
 *  2. There was NO CURATED PRODUCTIVITY METRIC to route to. The curated set is
 *     what makes an answer correct rather than merely available, and the
 *     arithmetic here is deliberately not new: it reproduces the
 *     "Departments · efficiency" panel of Monitoring → Usage Analytics
 *     (`ReportController::employeeInsights`), because a second definition would
 *     mean the product states two different productivity numbers for the same
 *     department. Three formulas already exist in this codebase and disagree.
 *
 * The exclusion tests are the load-bearing half. A productivity figure that is
 * merely close to the screen's is worse than one that is obviously different:
 * two numbers near enough to look like the same measurement is how a
 * reconciliation argument starts.
 */
class ProductivityMetricsTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private Organization $otherOrg;

    private User $admin;

    private Group $engineering;

    private Group $design;

    private Group $operations;

    private QueryPlanExecutor $executor;

    private PlanValidator $validator;

    private int $sequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        $this->org = Organization::create(['name' => 'Org A', 'slug' => 'prod-org-a']);
        $this->otherOrg = Organization::create(['name' => 'Org B', 'slug' => 'prod-org-b']);

        $this->admin = User::create([
            'name' => 'Admin', 'email' => 'admin-productivity@org.test',
            'password' => Hash::make('password123'), 'role' => 'admin',
            'organization_id' => $this->org->id,
        ]);

        $this->engineering = $this->group('Engineering');
        $this->design = $this->group('Design');
        $this->operations = $this->group('Operations');

        Auth::setUser($this->admin);

        $this->executor = app(QueryPlanExecutor::class);
        $this->validator = app(PlanValidator::class);
    }

    // -------------------------------------------------------------- fixtures

    private function group(string $name): Group
    {
        return Group::create([
            'organization_id' => $this->org->id,
            'name' => $name,
            'slug' => strtolower($name).'-prod',
        ]);
    }

    private function person(string $name, ?Group $group): User
    {
        $this->sequence++;

        $user = User::create([
            'name' => $name,
            'email' => "prod-{$this->sequence}@org.test",
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->org->id,
        ]);

        EmployeeWorkInfo::create([
            'organization_id' => $this->org->id,
            'user_id' => $user->id,
            'employment_status' => 'active',
            'report_group_id' => $group?->id,
        ]);

        return $user;
    }

    /**
     * One tracked segment. `type` is app/url/idle — the only three the write
     * API accepts — and `duration` is seconds, which is what the column stores.
     *
     * The classification is written PAST the model, deliberately.
     * `Activity::booted()` stamps `classification` from `ProductivityClassifier`
     * on every save, so a fixture that passes one to `create()` silently gets
     * the classifier's answer instead — "segment-3" matches no rule and lands
     * on the `neutral` fallback. Fixing the arithmetic in this file means
     * pinning the four buckets exactly, so the column is set afterwards.
     */
    private function activity(User $person, ?string $classification, int $seconds, string $type = 'app'): void
    {
        $this->sequence++;

        $activity = Activity::withoutOrganizationScope()->create([
            'organization_id' => $person->organization_id,
            'user_id' => $person->id,
            'type' => $type,
            'name' => "segment-{$this->sequence}",
            'duration' => $seconds,
            'recorded_at' => '2026-08-20 10:00:00',
        ]);

        DB::table('activities')
            ->where('id', $activity->id)
            ->update(['classification' => $classification]);
    }

    /** @param array<string, mixed> $raw */
    private function answer(array $raw): array
    {
        return $this->executor->execute($this->validator->validate($raw));
    }

    /** @return array<string, array<string, mixed>> department name => its row */
    private function byDepartment(array $result): array
    {
        $rows = [];

        foreach ($result['rows'] as $row) {
            $rows[(string) $row['department']] = $row;
        }

        return $rows;
    }

    /**
     * The population the whole file is measured against.
     *
     * Engineering (Ada): 3600 productive, 1800 unproductive, 1200 neutral,
     * 600 context-dependent — 7200s tracked, of which 3600s productive.
     * Design (Bo): 2700 productive, 900 neutral — 3600s tracked.
     */
    private function seedTwoDepartments(): array
    {
        $ada = $this->person('Ada', $this->engineering);
        $this->activity($ada, 'productive', 3600);
        $this->activity($ada, 'unproductive', 1800);
        $this->activity($ada, 'neutral', 1200);
        $this->activity($ada, 'context_dependent', 600);

        $bo = $this->person('Bo', $this->design);
        $this->activity($bo, 'productive', 2700);
        $this->activity($bo, 'neutral', 900);

        return ['ada' => $ada, 'bo' => $bo];
    }

    /**
     * The Monitoring screen's arithmetic, written out here rather than
     * imported, so this test fails if either side drifts:
     *
     *     productive / (productive + unproductive + neutral + context_dependent)
     *
     * — `ReportController::employeeInsights()`, `team_rankings.by_efficiency`.
     */
    private function screenEfficiency(int $productive, int $unproductive, int $neutral, int $contextDependent): float
    {
        $total = $productive + $unproductive + $neutral + $contextDependent;

        return $total > 0 ? round(($productive / $total) * 100, 2) : 0.0;
    }

    // ------------------------------------------------------------- retrieval

    /**
     * The question EXACTLY as it was typed, typo included. A retrieval fix that
     * only works on a clean sentence fixes nothing — nobody types the clean
     * sentence.
     */
    public function test_the_question_as_actually_typed_reaches_activities_and_not_payroll(): void
    {
        $catalogue = SemanticLayer::entities();

        $picked = array_keys(EntityRetriever::forQuestion(
            'make me an table with different department with whoes more produtive',
            $catalogue
        ));

        $this->assertContains('activities', $picked, 'the planner was never offered the table the answer lives in');
        $this->assertSame('activities', $picked[0], 'a named entity leads; productivity names activities');

        if (in_array('payroll', $picked, true)) {
            $this->assertLessThan(
                array_search('payroll', $picked, true),
                array_search('activities', $picked, true),
                'payroll_items is a snapshot; it must never outrank the live activity table on a productivity question'
            );
        }
    }

    /**
     * Order and refusal, not mere presence — the retriever's own convention.
     * Every one of these previously handed the planner payroll.
     *
     * @dataProvider productivityPhrasings
     */
    public function test_a_productivity_question_reaches_activities(string $question): void
    {
        $picked = array_keys(EntityRetriever::forQuestion($question, SemanticLayer::entities()));

        $this->assertContains('activities', $picked, "'{$question}' did not reach the activity table");
    }

    /** @return array<string, array{0: string}> */
    public static function productivityPhrasings(): array
    {
        return [
            'most productive' => ['which department is most productive'],
            'least productive' => ['least productive team this month'],
            'productivity' => ['productivity by department'],
            'unproductive' => ['unproductive time by department'],
            'active time' => ['active time per person'],
            'idle' => ['idle time last month'],
            'utilisation' => ['utilisation by department'],
            'tracker' => ['what does the tracker show for each department'],
        ];
    }

    /**
     * A correction is applied ONLY to a word that means nothing here. A real
     * word one edit from a synonym is left alone, or the retriever would
     * quietly answer a different question than the one asked.
     */
    public function test_a_word_the_catalogue_already_knows_is_never_rewritten(): void
    {
        $catalogue = SemanticLayer::entities();

        $this->assertContains(
            'payroll',
            array_keys(EntityRetriever::forQuestion('average net pay by department', $catalogue)),
            'a clean payroll question must not be dragged off by fuzzy matching'
        );

        // 'leave' is five characters: below the length floor, so it can never
        // be rewritten at all, whatever it is one edit away from.
        $this->assertContains(
            'leave',
            array_keys(EntityRetriever::forQuestion('how many leave days were taken', $catalogue))
        );
    }

    /**
     * The other half of the retrieval fix: payroll keeps its productivity
     * vocabulary, because once a run HAS been processed those columns are the
     * right answer to "what was this payroll computed against".
     */
    public function test_a_genuinely_payroll_question_still_reaches_payroll(): void
    {
        $catalogue = SemanticLayer::entities();

        foreach ([
            'average net pay by department',
            'total gross this month',
            'what was the productivity score on the payroll run',
        ] as $question) {
            $picked = array_keys(EntityRetriever::forQuestion($question, $catalogue));

            $this->assertContains('payroll', $picked, "'{$question}' stopped reaching payroll");
        }

        $payroll = SemanticLayer::entity('payroll');

        $this->assertArrayHasKey('avg_productivity_score', $payroll['metrics']);
        $this->assertStringContainsString(
            'not live tracker data',
            (string) $payroll['metrics']['avg_productivity_score']['note'],
            'the snapshot metric has to say it is a snapshot'
        );
    }

    // ----------------------------------------------------------- the numbers

    public function test_the_productivity_rate_matches_the_monitoring_screen(): void
    {
        $this->seedTwoDepartments();

        $result = $this->answer([
            'entity' => 'activities',
            'metrics' => ['productive_hours', 'tracked_hours', 'productivity_rate'],
            'group_by' => ['department'],
            'sort' => ['by' => 'department', 'dir' => 'asc'],
        ]);

        $rows = $this->byDepartment($result);

        $this->assertSame(['Design', 'Engineering'], array_keys($rows));

        // Engineering: 3600 of 7200 tracked seconds.
        $this->assertEqualsWithDelta(1.0, (float) $rows['Engineering']['productive_hours'], 0.001);
        $this->assertEqualsWithDelta(2.0, (float) $rows['Engineering']['tracked_hours'], 0.001);
        $this->assertEqualsWithDelta(
            $this->screenEfficiency(3600, 1800, 1200, 600),
            (float) $rows['Engineering']['productivity_rate'],
            0.001
        );

        // Design: 2700 of 3600.
        $this->assertEqualsWithDelta(
            $this->screenEfficiency(2700, 0, 900, 0),
            (float) $rows['Design']['productivity_rate'],
            0.001
        );
        $this->assertEqualsWithDelta(75.0, (float) $rows['Design']['productivity_rate'], 0.001);
    }

    /**
     * context_dependent is GENUINELY UNKNOWN — YouTube, WhatsApp, Telegram,
     * Discord, a browser with no resolvable domain. It sits in the denominator
     * and never in the numerator, which is the only defensible treatment:
     * folding it into productive rewards it, and excluding it altogether lets
     * somebody who spent the day on WhatsApp score 100%.
     */
    public function test_context_dependent_time_drags_the_rate_down_and_never_up(): void
    {
        $person = $this->person('Cal', $this->engineering);
        $this->activity($person, 'productive', 3600);
        $this->activity($person, 'context_dependent', 3600);

        $result = $this->answer([
            'entity' => 'activities',
            'metrics' => ['productivity_rate', 'tracked_hours'],
            'group_by' => ['department'],
        ]);

        $this->assertEqualsWithDelta(50.0, (float) $result['rows'][0]['productivity_rate'], 0.001);
        $this->assertEqualsWithDelta(2.0, (float) $result['rows'][0]['tracked_hours'], 0.001);
    }

    /**
     * §6.4, applied to a rate. A department nobody tracked has no rate; it did
     * not score zero. Rendering that as 0% puts a team at the bottom of a
     * league table for having no data.
     */
    public function test_a_department_with_no_tracked_time_has_a_blank_rate_never_zero(): void
    {
        $this->seedTwoDepartments();

        // Operations exists and has a person, whose only activity is idle.
        $idler = $this->person('Dee', $this->operations);
        $this->activity($idler, 'neutral', 5000, 'idle');

        $result = $this->answer([
            'entity' => 'activities',
            'metrics' => ['productivity_rate', 'idle_hours'],
            'group_by' => ['department'],
            'sort' => ['by' => 'department', 'dir' => 'asc'],
        ]);

        $rows = $this->byDepartment($result);

        $this->assertArrayHasKey('Operations', $rows, 'a rostered department with only idle time is still a department');
        $this->assertNull($rows['Operations']['productivity_rate']);
        // 5000s stated to two places, the precision the definition claims.
        $this->assertEqualsWithDelta(1.39, (float) $rows['Operations']['idle_hours'], 0.005);
    }

    // ------------------------------------------------------------ exclusions

    /**
     * The classifier hard-codes idle to neutral with the reason "Idle time is
     * never marked productive", and every Monitoring screen strips it before
     * computing a share. Leaving it in silently reproduces the PAYROLL formula,
     * which is the definition this whole change exists to stop inheriting.
     */
    public function test_idle_time_is_excluded_from_every_productivity_bucket(): void
    {
        $person = $this->person('Eve', $this->engineering);
        $this->activity($person, 'productive', 3600);
        $this->activity($person, 'neutral', 3600, 'idle');

        $result = $this->answer([
            'entity' => 'activities',
            'metrics' => ['productive_hours', 'tracked_hours', 'productivity_rate', 'idle_hours'],
            'group_by' => ['department'],
        ]);

        $row = $result['rows'][0];

        $this->assertEqualsWithDelta(1.0, (float) $row['tracked_hours'], 0.001, 'idle leaked into tracked time');
        $this->assertEqualsWithDelta(100.0, (float) $row['productivity_rate'], 0.001);
        $this->assertEqualsWithDelta(1.0, (float) $row['idle_hours'], 0.001, 'idle is measured, just kept apart');
    }

    /**
     * UsageProcessingService clips every row to `max_log_duration_seconds` at
     * read time, and a non-idle row is NOT bounded when it is written —
     * `ActivityController::boundedActivityDuration()` returns early for
     * anything but idle. Clipping, not dropping: dropping the row would lose
     * the first four hours as well.
     */
    public function test_an_oversized_row_is_clipped_the_way_the_screen_clips_it_not_dropped(): void
    {
        $person = $this->person('Fay', $this->operations);
        $this->activity($person, 'productive', 20000);

        $result = $this->answer([
            'entity' => 'activities',
            'metrics' => ['productive_hours', 'tracked_hours'],
            'group_by' => ['department'],
        ]);

        // 4.00, not 5.56 and not nothing.
        $this->assertEqualsWithDelta(4.0, (float) $result['rows'][0]['productive_hours'], 0.001);
        $this->assertEqualsWithDelta(4.0, (float) $result['rows'][0]['tracked_hours'], 0.001);
    }

    /**
     * There is no `users.is_active` column — it is an accessor over
     * `deactivated_at`. A leaver's historic activity would keep inflating a
     * department they have left, which is the exact presence SCIM
     * deactivation is bought to end.
     */
    public function test_a_deactivated_person_no_longer_counts_towards_their_old_department(): void
    {
        $this->seedTwoDepartments();

        $leaver = $this->person('Gus', $this->design);
        $this->activity($leaver, 'productive', 36000);

        // Written past the model on purpose: `deactivated_at` is not fillable,
        // so an array passed to create() is dropped in silence and the test
        // would pass while measuring an active person.
        DB::table('users')->where('id', $leaver->id)->update(['deactivated_at' => now()]);

        $result = $this->answer([
            'entity' => 'activities',
            'metrics' => ['productive_hours', 'productivity_rate'],
            'group_by' => ['department'],
            'sort' => ['by' => 'department', 'dir' => 'asc'],
        ]);

        $rows = $this->byDepartment($result);

        // Design is still Bo's 2700 productive seconds of 3600 tracked.
        $this->assertEqualsWithDelta(0.75, (float) $rows['Design']['productive_hours'], 0.001);
        $this->assertEqualsWithDelta(75.0, (float) $rows['Design']['productivity_rate'], 0.001);
    }

    /**
     * `classification` is nullable and unclassified rows must never vanish:
     * dropping them without saying so shrinks the denominator and inflates
     * every department's rate. They get a bucket of their own instead.
     */
    public function test_unclassified_activity_is_reported_rather_than_silently_dropped(): void
    {
        $person = $this->person('Hal', $this->engineering);
        $this->activity($person, 'productive', 3600);
        $this->activity($person, null, 7200);

        $result = $this->answer([
            'entity' => 'activities',
            'metrics' => ['tracked_hours', 'unclassified_hours', 'productivity_rate'],
            'group_by' => ['department'],
        ]);

        $row = $result['rows'][0];

        $this->assertEqualsWithDelta(1.0, (float) $row['tracked_hours'], 0.001);
        $this->assertEqualsWithDelta(2.0, (float) $row['unclassified_hours'], 0.001);
        $this->assertEqualsWithDelta(100.0, (float) $row['productivity_rate'], 0.001);

        $this->assertNoteContaining($result, 'has not classified');
    }

    /** Under the read-time noise threshold; the screen drops these, so this must too. */
    public function test_a_zero_length_segment_is_dropped(): void
    {
        $person = $this->person('Ivy', $this->engineering);
        $this->activity($person, 'productive', 3600);
        $this->activity($person, 'unproductive', 0);

        $result = $this->answer([
            'entity' => 'activities',
            'metrics' => ['tracked_hours', 'productivity_rate'],
            'group_by' => ['department'],
        ]);

        $this->assertEqualsWithDelta(1.0, (float) $result['rows'][0]['tracked_hours'], 0.001);
        $this->assertEqualsWithDelta(100.0, (float) $result['rows'][0]['productivity_rate'], 0.001);
    }

    // ------------------------------------------------------------ department

    /**
     * THE DEPARTMENT JOIN, AND THE ONE IT IS NOT.
     *
     * Departments are the `groups` table, reached from a person through
     * `employee_work_infos.report_group_id`. `group_user` is a separate
     * many-to-many ACCESS grouping — on the live database 72 of ~90 people sit
     * in more than one group — so resolving a department through it counts one
     * person's hours into several departments and stops the breakdown summing
     * to the organisation total.
     *
     * Ada below is in BOTH groups through `group_user` and reports into
     * Engineering. Her hours appear once, under Engineering.
     *
     * KNOWN DIVERGENCE, asserted rather than discovered: Monitoring →
     * Usage Analytics resolves membership through `ReportGroup::users()`,
     * which IS `group_user`, so its department totals double-count those
     * people. The rate arithmetic matches; the grouping deliberately does not.
     */
    public function test_department_resolves_through_the_reporting_group_never_the_access_grouping(): void
    {
        $people = $this->seedTwoDepartments();

        DB::table('group_user')->insert([
            ['group_id' => $this->engineering->id, 'user_id' => $people['ada']->id],
            ['group_id' => $this->design->id, 'user_id' => $people['ada']->id],
        ]);

        $result = $this->answer([
            'entity' => 'activities',
            'metrics' => ['productive_hours'],
            'group_by' => ['department'],
            'sort' => ['by' => 'department', 'dir' => 'asc'],
        ]);

        $rows = $this->byDepartment($result);

        $this->assertSame(['Design', 'Engineering'], array_keys($rows));
        $this->assertEqualsWithDelta(1.0, (float) $rows['Engineering']['productive_hours'], 0.001);
        // 0.75, not 1.75 — Ada's access to the Design group is not membership.
        $this->assertEqualsWithDelta(0.75, (float) $rows['Design']['productive_hours'], 0.001);

        $this->assertStringNotContainsString(
            'group_user',
            json_encode(SemanticLayer::dimension('activities', 'department')),
            'the activity department must not resolve through the access grouping'
        );
    }

    /**
     * CLAUDE.md records that this schema carries both "HR" and "Human
     * Resources" as separate groups. Merging them here would be this layer
     * inventing a fact about the organisation's structure; the note says the
     * grouping is by the group as recorded, and the rows stay separate so
     * somebody can see the duplicate and fix it at the source.
     */
    public function test_two_similarly_named_groups_stay_two_rows(): void
    {
        $hr = $this->group('HR');
        $humanResources = $this->group('Human Resources');

        $this->activity($this->person('Jo', $hr), 'productive', 3600);
        $this->activity($this->person('Kim', $humanResources), 'productive', 1800);

        $result = $this->answer([
            'entity' => 'activities',
            'metrics' => ['productive_hours'],
            'group_by' => ['department'],
            'sort' => ['by' => 'department', 'dir' => 'asc'],
        ]);

        $rows = $this->byDepartment($result);

        $this->assertArrayHasKey('HR', $rows);
        $this->assertArrayHasKey('Human Resources', $rows);
        $this->assertEqualsWithDelta(1.0, (float) $rows['HR']['productive_hours'], 0.001);
        $this->assertEqualsWithDelta(0.5, (float) $rows['Human Resources']['productive_hours'], 0.001);
    }

    /**
     * A LEFT join both hops, so somebody with no work info or no group still
     * appears. Dropping them is how a breakdown stops adding up to the total
     * above it.
     */
    public function test_activity_from_somebody_with_no_department_is_shown_not_dropped(): void
    {
        $this->activity($this->person('Lee', null), 'productive', 3600);

        $result = $this->answer([
            'entity' => 'activities',
            'metrics' => ['productive_hours'],
            'group_by' => ['department'],
        ]);

        $this->assertSame('(unassigned)', $result['rows'][0]['department']);
        $this->assertEqualsWithDelta(1.0, (float) $result['rows'][0]['productive_hours'], 0.001);
    }

    // -------------------------------------------------------- tenancy, notes

    public function test_another_organization_activity_is_never_counted(): void
    {
        $this->seedTwoDepartments();

        $outsider = User::create([
            'name' => 'Outsider', 'email' => 'outsider-productivity@org.test',
            'password' => Hash::make('password123'), 'role' => 'employee',
            'organization_id' => $this->otherOrg->id,
        ]);

        $this->activity($outsider, 'productive', 100000);

        $result = $this->answer(['entity' => 'activities', 'metrics' => ['productive_hours']]);

        // 1.0 (Ada) + 0.75 (Bo), and nothing from the other tenant.
        $this->assertEqualsWithDelta(1.75, (float) $result['rows'][0]['productive_hours'], 0.001);
    }

    /**
     * The payroll snapshot, kept and made honest. Averaging an unprocessed
     * item's 0 is the `avg_net_pay` defect exactly — it drags the score toward
     * zero and reads as "these people were unproductive".
     */
    public function test_the_payroll_snapshot_metric_excludes_unprocessed_items(): void
    {
        $run = PayrollMonthlyRun::create([
            'organization_id' => $this->org->id, 'month_year' => '2026-07', 'status' => 'draft',
        ]);

        foreach ([['80000.00', '90.00'], ['0.00', '0.00']] as [$net, $score]) {
            PayrollItem::create([
                'payroll_run_id' => $run->id, 'organization_id' => $this->org->id,
                'user_id' => $this->person('Payroll '.$net, $this->engineering)->id,
                'department_id' => $this->engineering->id, 'month_year' => '2026-07',
                'gross_salary' => '100000.00', 'net_pay' => $net,
                'productivity_score' => $score, 'payment_status' => 'pending',
            ]);
        }

        $result = $this->answer(['entity' => 'payroll', 'metrics' => ['avg_productivity_score']]);

        // 90, not 45 — the unprocessed row is not averaged in.
        $this->assertEqualsWithDelta(90.0, (float) $result['rows'][0]['avg_productivity_score'], 0.001);
    }

    /**
     * BUG 2, from inside the read path. "No records match that question." was
     * the whole answer whether the source was empty, the filters excluded
     * everything, or the question was nonsense — a dead end that reads as a
     * refusal, which is what teaches somebody to stop asking.
     *
     * The executor cannot tell a bad question from a good one, but it can tell
     * an empty source from an exhausted filter, and those are two of the three.
     */
    public function test_an_empty_answer_says_whether_the_source_was_empty(): void
    {
        $empty = $this->answer([
            'entity' => 'activities',
            'metrics' => ['productive_hours'],
        ]);

        $this->assertSame([], $empty['rows']);
        $this->assertNoteContaining($empty, 'no activities data recorded in this organization at all');

        // Now the source holds rows and a filter empties the answer instead — a
        // different fact, and it says so rather than leaving the reader the one
        // sentence that also means "I could not answer that".
        $this->seedTwoDepartments();

        $excluded = $this->answer([
            'entity' => 'activities',
            'metrics' => ['productive_hours'],
            'filters' => [['field' => 'type', 'op' => 'eq', 'value' => 'nothing_is_this']],
        ]);

        $this->assertSame([], $excluded['rows']);
        $this->assertNoteContaining($excluded, 'The source is not empty');
    }

    private function assertNoteContaining(array $result, string $needle): void
    {
        foreach ($result['notes'] as $note) {
            if (str_contains($note, $needle)) {
                $this->assertTrue(true);

                return;
            }
        }

        $this->fail("No note contained '{$needle}'. Notes: ".json_encode($result['notes']));
    }
}
