<?php

namespace Tests\Unit\Ai;

use App\Services\Ai\EntityRetriever;
use App\Services\Ai\SemanticLayer;
use ReflectionClass;
use ReflectionMethod;
use Tests\TestCase;

/**
 * Retrieval decides what the planner is even allowed to consider (§13). With
 * 80 entities and 2,612 columns the catalogue cannot go in a prompt, so the
 * top 5 this returns ARE the vocabulary of the answer — an entity it drops is
 * an entity the model can no longer choose.
 *
 * So the assertions here are about ORDER and REFUSAL, not "did it return
 * something". A retriever that returns five plausible entities in the wrong
 * order is how "compare average net pay" gets planned against attendance.
 */
class EntityRetrieverTest extends TestCase
{
    /**
     * A catalogue keyed the way §4 hand-writes it, with column sets taken from
     * the real tables so the synonym map is tested against real noise:
     * payroll_items genuinely has absent_days, present_days and
     * leave_encashment columns, and candidates genuinely has current_ctc. A
     * synonym map that only wins against a toy fixture has not been tested.
     */
    private function canonicalCatalogue(): array
    {
        return [
            'employees' => [
                'label' => 'Employees',
                'table' => 'employee_work_infos',
                'metrics' => ['headcount' => ['label' => 'Headcount']],
                'dimensions' => [
                    'department' => ['label' => 'Department', 'select' => 'groups.name'],
                    'employment_type' => ['label' => 'Employment type', 'select' => 'employee_work_infos.employment_type'],
                ],
                'list_columns' => [
                    'name' => ['label' => 'Name', 'select' => 'users.name'],
                    'designation' => ['label' => 'Designation', 'select' => 'employee_work_infos.designation'],
                    'joining_date' => ['label' => 'Joining date', 'select' => 'employee_work_infos.joining_date'],
                ],
            ],
            'payroll' => [
                'label' => 'Payroll',
                'table' => 'payroll_items',
                'metrics' => [
                    'avg_net_pay' => ['label' => 'Avg net pay'],
                    'total_gross' => ['label' => 'Total gross'],
                ],
                'dimensions' => [
                    'department' => ['label' => 'Department', 'select' => 'groups.name'],
                    'month' => ['label' => 'Month', 'select' => 'payroll_items.month_year'],
                ],
                'list_columns' => [
                    'name' => ['label' => 'Employee', 'select' => 'users.name'],
                    'net_pay' => ['label' => 'Net pay', 'select' => 'payroll_items.net_pay'],
                    'absent_days' => ['label' => 'Absent days', 'select' => 'payroll_items.absent_days'],
                    'present_days' => ['label' => 'Present days', 'select' => 'payroll_items.present_days'],
                    'leave_encashment' => ['label' => 'Leave encashment', 'select' => 'payroll_items.leave_encashment'],
                ],
            ],
            'attendance' => [
                'label' => 'Attendance',
                'table' => 'attendance_records',
                'metrics' => [
                    'absent_days' => ['label' => 'Absent days'],
                    'late_count' => ['label' => 'Late arrivals'],
                ],
                'dimensions' => [
                    'status' => ['label' => 'Status', 'select' => 'attendance_records.status'],
                    'date' => ['label' => 'Date', 'select' => 'attendance_records.attendance_date'],
                ],
                'list_columns' => [
                    'check_in_at' => ['label' => 'Check in', 'select' => 'attendance_records.check_in_at'],
                    'late_minutes' => ['label' => 'Late minutes', 'select' => 'attendance_records.late_minutes'],
                ],
            ],
            'leave' => [
                'label' => 'Leave',
                'table' => 'leave_requests',
                'metrics' => ['leave_days_taken' => ['label' => 'Days taken']],
                'dimensions' => [
                    'leave_type' => ['label' => 'Leave type', 'select' => 'leave_requests.leave_type'],
                    'status' => ['label' => 'Status', 'select' => 'leave_requests.status'],
                ],
                'list_columns' => [
                    'start_date' => ['label' => 'Start date', 'select' => 'leave_requests.start_date'],
                    'reason' => ['label' => 'Reason', 'select' => 'leave_requests.reason'],
                ],
            ],
            'assets' => [
                'label' => 'Assets',
                'table' => 'assets',
                'metrics' => ['asset_count' => ['label' => 'Assets']],
                'dimensions' => ['status' => ['label' => 'Status', 'select' => 'assets.status']],
                'list_columns' => [
                    'asset_tag' => ['label' => 'Asset tag', 'select' => 'assets.asset_tag'],
                    'category' => ['label' => 'Category', 'select' => 'assets.category'],
                    'serial_number' => ['label' => 'Serial number', 'select' => 'assets.serial_number'],
                ],
            ],
            'work' => [
                'label' => 'Tasks',
                'table' => 'tasks',
                'metrics' => ['task_count' => ['label' => 'Tasks']],
                'dimensions' => ['status' => ['label' => 'Status', 'select' => 'tasks.status']],
                'list_columns' => [
                    'title' => ['label' => 'Title', 'select' => 'tasks.title'],
                    'priority' => ['label' => 'Priority', 'select' => 'tasks.priority'],
                    'due_date' => ['label' => 'Due date', 'select' => 'tasks.due_date'],
                ],
            ],
            'hiring' => [
                'label' => 'Hiring',
                'table' => 'candidates',
                'metrics' => ['candidate_count' => ['label' => 'Candidates']],
                'dimensions' => ['source' => ['label' => 'Source', 'select' => 'candidates.source']],
                'list_columns' => [
                    'current_company' => ['label' => 'Current company', 'select' => 'candidates.current_company'],
                    'current_ctc' => ['label' => 'Current CTC', 'select' => 'candidates.current_ctc'],
                    'notice_period_days' => ['label' => 'Notice period', 'select' => 'candidates.notice_period_days'],
                ],
            ],
        ];
    }

    /**
     * The same seven concepts, keyed the way §9 DERIVES them — by table name.
     * Retrieval has to work on both, because the layer is derived and only the
     * overrides are hand-written.
     */
    private function derivedCatalogue(): array
    {
        $canonical = $this->canonicalCatalogue();

        return [
            'users' => [
                'label' => 'Users',
                'table' => 'users',
                'metrics' => [],
                'dimensions' => [],
                'list_columns' => [
                    'name' => ['label' => 'Name', 'select' => 'users.name'],
                    'role' => ['label' => 'Role', 'select' => 'users.role'],
                ],
            ],
            'employee_work_infos' => $canonical['employees'],
            'payroll_items' => $canonical['payroll'],
            'attendance_records' => $canonical['attendance'],
            'leave_requests' => $canonical['leave'],
            'assets' => $canonical['assets'],
            'tasks' => $canonical['work'],
            'projects' => [
                'label' => 'Projects',
                'table' => 'projects',
                'metrics' => [],
                'dimensions' => [],
                'list_columns' => ['name' => ['label' => 'Name', 'select' => 'projects.name']],
            ],
            'candidates' => $canonical['hiring'],
            'invoices' => [
                'label' => 'Invoices',
                'table' => 'invoices',
                'metrics' => [],
                'dimensions' => [],
                'list_columns' => ['total' => ['label' => 'Total', 'select' => 'invoices.total']],
            ],
        ];
    }

    /**
     * The synonym map from §13, one word at a time. Each probe is the bare
     * synonym so nothing else in the sentence can carry the result — if
     * "wage" does not reach payroll on its own, the map has a hole.
     *
     * @return array<string, array{0: string, 1: string}>
     */
    public static function synonymProvider(): array
    {
        return [
            // salary|pay|ctc|payroll|wage -> payroll
            'salary' => ['salary', 'payroll'],
            'pay' => ['pay', 'payroll'],
            'ctc' => ['ctc', 'payroll'],
            'payroll' => ['payroll', 'payroll'],
            'wage' => ['wage', 'payroll'],

            // absent|present|late|attendance -> attendance
            'absent' => ['absent', 'attendance'],
            'present' => ['present', 'attendance'],
            'late' => ['late', 'attendance'],
            'attendance' => ['attendance', 'attendance'],

            // leave|holiday|pto|vacation -> leave
            'leave' => ['leave', 'leave'],
            'holiday' => ['holiday', 'leave'],
            'pto' => ['pto', 'leave'],
            'vacation' => ['vacation', 'leave'],

            // who|people|staff|employee|headcount -> employees
            'who' => ['who', 'employees'],
            'people' => ['people', 'employees'],
            'staff' => ['staff', 'employees'],
            'employee' => ['employee', 'employees'],
            'headcount' => ['headcount', 'employees'],

            // asset|laptop|device -> assets
            'asset' => ['asset', 'assets'],
            'laptop' => ['laptop', 'assets'],
            'device' => ['device', 'assets'],

            // task|project|work -> work
            'task' => ['task', 'work'],
            'project' => ['project', 'work'],
            'work' => ['work', 'work'],

            // candidate|hiring|applicant|job -> hiring
            'candidate' => ['candidate', 'hiring'],
            'hiring' => ['hiring', 'hiring'],
            'applicant' => ['applicant', 'hiring'],
            'job' => ['job', 'hiring'],
        ];
    }

    /**
     * @dataProvider synonymProvider
     */
    public function test_each_synonym_routes_to_its_entity(string $word, string $expected): void
    {
        $result = EntityRetriever::forQuestion($word, $this->canonicalCatalogue());

        $this->assertNotSame([], $result, "'{$word}' retrieved nothing at all");
        $this->assertSame(
            $expected,
            array_key_first($result),
            sprintf("'%s' ranked [%s] ahead of %s", $word, implode(', ', array_keys($result)), $expected)
        );
    }

    /**
     * Plurals are how people actually type. "salaries" and "laptops" must not
     * fall off the map because the keyword list happens to be singular.
     */
    public function test_plurals_reach_the_same_entity_as_the_singular(): void
    {
        foreach ([
            'salaries' => 'payroll',
            'laptops' => 'assets',
            'tasks' => 'work',
            'candidates' => 'hiring',
            'holidays' => 'leave',
            'employees' => 'employees',
        ] as $word => $expected) {
            $result = EntityRetriever::forQuestion($word, $this->canonicalCatalogue());

            $this->assertSame($expected, array_key_first($result), "'{$word}' did not reach {$expected}");
        }
    }

    /** The worked example from the task, against the real committed layer. */
    public function test_compare_average_net_pay_by_department_ranks_payroll_first(): void
    {
        $result = EntityRetriever::forQuestion(
            'compare average net pay by department',
            SemanticLayer::entities()
        );

        $this->assertSame('payroll', array_key_first($result));
    }

    /**
     * The threshold question from §8. "who" must not outrank "absent" — the
     * noun names the entity, the interrogative only names the grouping, and
     * the plan for this question is entity:attendance grouped by employee.
     */
    public function test_who_was_absent_puts_attendance_ahead_of_employees(): void
    {
        $result = EntityRetriever::forQuestion(
            'who was absent more than 3 days last month',
            $this->canonicalCatalogue()
        );

        $keys = array_keys($result);

        $this->assertSame('attendance', $keys[0]);
        $this->assertContains('employees', $keys, 'the grouping entity must still reach the prompt');
    }

    public function test_a_nonsense_question_retrieves_nothing(): void
    {
        foreach ([
            'what is the airspeed velocity of an unladen swallow',
            'please write me a haiku about the sea',
            'how tall is the eiffel tower',
        ] as $nonsense) {
            $this->assertSame(
                [],
                EntityRetriever::forQuestion($nonsense, $this->canonicalCatalogue()),
                "'{$nonsense}' should clear no entity above the floor"
            );
        }
    }

    /**
     * A word that names a column on every table names no ENTITY. Returning all
     * seven for "status" is the same as returning none, except it costs a
     * prompt and looks like an answer.
     */
    public function test_a_word_that_matches_every_table_equally_clears_nothing(): void
    {
        $this->assertSame([], EntityRetriever::forQuestion('status', $this->canonicalCatalogue()));
        $this->assertSame([], EntityRetriever::forQuestion('show me the created at value', $this->canonicalCatalogue()));
    }

    /**
     * §13 refuses when nothing clears the floor, "with the entities it DID
     * consider, so the user can rephrase". That sentence is unwriteable unless
     * the scores survive the refusal, so scoreAll() reports every entity —
     * including the ones that scored nothing.
     */
    public function test_scores_survive_a_refusal_so_the_planner_can_say_what_it_considered(): void
    {
        $catalogue = $this->canonicalCatalogue();

        $scores = EntityRetriever::scoreAll('what is the airspeed velocity of a swallow', $catalogue);

        $this->assertSame(
            count($catalogue),
            count($scores),
            'every entity must be accounted for, or the refusal cannot name what it considered'
        );

        foreach (array_keys($catalogue) as $key) {
            $this->assertArrayHasKey($key, $scores);
            $this->assertSame(0.0, $scores[$key]);
        }
    }

    /** scoreAll ranks, so a refusal can name the nearest misses first. */
    public function test_score_all_is_ranked_highest_first(): void
    {
        $scores = EntityRetriever::scoreAll('average net pay by department', $this->canonicalCatalogue());

        $this->assertSame('payroll', array_key_first($scores));
        $this->assertSame(array_values($scores), array_values(collect($scores)->sortDesc()->all()));
    }

    /**
     * "headcount by nationality" (§8) is a PLANNER refusal, not a retrieval
     * one: employees is the right entity and there is simply no such
     * dimension. Retrieval must hand it over so the refusal can name the
     * missing dimension rather than claim the whole subject is unknown.
     */
    public function test_a_real_entity_with_a_missing_dimension_still_retrieves(): void
    {
        $result = EntityRetriever::forQuestion('headcount by nationality', $this->canonicalCatalogue());

        $this->assertSame('employees', array_key_first($result));
    }

    public function test_it_returns_at_most_the_requested_number_of_entities(): void
    {
        $catalogue = $this->canonicalCatalogue();
        $question = 'salary and attendance and leave and assets and tasks and candidates for every employee';

        $this->assertLessThanOrEqual(5, count(EntityRetriever::forQuestion($question, $catalogue)));
        $this->assertCount(2, EntityRetriever::forQuestion($question, $catalogue, 2));
        $this->assertCount(1, EntityRetriever::forQuestion($question, $catalogue, 1));
    }

    /**
     * Zero and negative both mean "use the default", exactly as PlanValidator
     * treats `limit`. An explicit 0 clamped to 1 is what made "headcount by
     * department" return a single row and read like the org had one
     * department; the same mistake here would silently starve the prompt.
     */
    public function test_a_zero_or_negative_top_means_the_default_not_nothing(): void
    {
        $catalogue = $this->canonicalCatalogue();
        $question = 'salary and attendance and leave and assets and tasks and candidates for every employee';

        $default = EntityRetriever::forQuestion($question, $catalogue);

        $this->assertCount(5, $default);
        $this->assertSame($default, EntityRetriever::forQuestion($question, $catalogue, 0));
        $this->assertSame($default, EntityRetriever::forQuestion($question, $catalogue, -3));
    }

    /** The returned entries are the DEFINITIONS, so the planner can build a catalogue from them. */
    public function test_it_returns_the_definitions_not_just_the_keys(): void
    {
        $catalogue = $this->canonicalCatalogue();
        $result = EntityRetriever::forQuestion('average net pay', $catalogue);

        $this->assertSame($catalogue['payroll'], $result['payroll']);
    }

    public function test_it_works_on_a_schema_derived_catalogue_keyed_by_table_name(): void
    {
        foreach ([
            'salary' => 'payroll_items',
            'absent' => 'attendance_records',
            'leave' => 'leave_requests',
            'staff' => 'users',
            'laptop' => 'assets',
            'task' => 'tasks',
            'project' => 'projects',
            'candidate' => 'candidates',
        ] as $word => $expected) {
            $result = EntityRetriever::forQuestion($word, $this->derivedCatalogue());

            $this->assertSame(
                $expected,
                array_key_first($result),
                sprintf("'%s' ranked [%s] ahead of %s", $word, implode(', ', array_keys($result)), $expected)
            );
        }
    }

    /**
     * An entity nobody wrote a synonym for is still reachable by its own name.
     * That is what makes 80 derived entities reachable without an 80-entry
     * map — the map only exists for words that do NOT match a table name.
     */
    public function test_an_entity_with_no_synonym_is_reachable_by_its_own_name(): void
    {
        $result = EntityRetriever::forQuestion('list the invoices', $this->derivedCatalogue());

        $this->assertSame('invoices', array_key_first($result));
    }

    /**
     * A word that genuinely names two tables is genuinely ambiguous, and top-5
     * retrieval is how that gets resolved — by the planner seeing both, not by
     * the retriever guessing. Documented rather than hidden.
     */
    public function test_a_genuinely_ambiguous_word_returns_both_candidates(): void
    {
        $keys = array_keys(EntityRetriever::forQuestion('work', $this->derivedCatalogue()));

        $this->assertContains('employee_work_infos', $keys);
        $this->assertContains('tasks', $keys);
    }

    /** Same question, same answer — a retriever that reorders on ties is unreviewable. */
    public function test_retrieval_is_deterministic(): void
    {
        $catalogue = $this->canonicalCatalogue();

        $first = EntityRetriever::forQuestion('salary by department', $catalogue);

        for ($i = 0; $i < 5; $i++) {
            $this->assertSame($first, EntityRetriever::forQuestion('salary by department', $catalogue));
        }
    }

    /** Ties keep catalogue order rather than whatever the sort felt like. */
    public function test_ties_are_broken_by_catalogue_order(): void
    {
        $alpha = ['label' => 'Alpha', 'table' => 'alpha', 'metrics' => [], 'dimensions' => [], 'list_columns' => []];
        $beta = ['label' => 'Beta', 'table' => 'beta', 'metrics' => [], 'dimensions' => [], 'list_columns' => []];

        $this->assertSame(
            ['alpha', 'beta'],
            array_keys(EntityRetriever::forQuestion('alpha beta', ['alpha' => $alpha, 'beta' => $beta]))
        );

        $this->assertSame(
            ['beta', 'alpha'],
            array_keys(EntityRetriever::forQuestion('alpha beta', ['beta' => $beta, 'alpha' => $alpha]))
        );
    }

    /** An empty question is a refusal, not a shrug that returns the first five entities. */
    public function test_an_empty_question_retrieves_nothing(): void
    {
        $this->assertSame([], EntityRetriever::forQuestion('', $this->canonicalCatalogue()));
        $this->assertSame([], EntityRetriever::forQuestion('   ?  ', $this->canonicalCatalogue()));
        $this->assertSame([], EntityRetriever::forQuestion('salary', []));
    }

    /**
     * §13: LOCAL, no model call. A class with no constructor and only static
     * methods cannot be handed an HTTP client, which is a structural
     * guarantee rather than a promise in a comment.
     */
    public function test_retrieval_is_local_and_can_hold_no_client(): void
    {
        $reflection = new ReflectionClass(EntityRetriever::class);

        $this->assertNull($reflection->getConstructor());

        foreach ($reflection->getMethods(ReflectionMethod::IS_PUBLIC) as $method) {
            $this->assertTrue($method->isStatic(), "{$method->getName()} is not static");
        }
    }

    /**
     * The whole reason this component exists: 80 entities do not fit a prompt.
     * A catalogue an order of magnitude larger must still narrow to 5, and
     * must not let 200 tables full of `status` and `name` columns crowd out
     * the one entity the question was about.
     */
    public function test_it_narrows_a_full_size_catalogue_to_the_top_five(): void
    {
        $catalogue = $this->canonicalCatalogue();

        for ($i = 0; $i < 200; $i++) {
            $catalogue["synthetic_table_{$i}"] = [
                'label' => "Synthetic {$i}",
                'table' => "synthetic_table_{$i}",
                'metrics' => [],
                'dimensions' => ['status' => ['label' => 'Status', 'select' => "synthetic_table_{$i}.status"]],
                'list_columns' => ['name' => ['label' => 'Name', 'select' => "synthetic_table_{$i}.name"]],
            ];
        }

        $result = EntityRetriever::forQuestion('average net pay by department last month', $catalogue);

        $this->assertLessThanOrEqual(5, count($result));
        $this->assertSame('payroll', array_key_first($result));
    }
}
