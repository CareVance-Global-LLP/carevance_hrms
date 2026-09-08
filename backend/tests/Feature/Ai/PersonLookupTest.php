<?php

namespace Tests\Feature\Ai;

use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\Organization;
use App\Models\User;
use App\Services\Ai\EntityRetriever;
use App\Services\Ai\PersonLookup;
use App\Services\Ai\PlanValidator;
use App\Services\Ai\QueryPlanExecutor;
use App\Services\Ai\QueryPlanner;
use App\Services\Ai\SchemaIntrospector;
use App\Services\Ai\SemanticLayer;
use App\Services\Ai\UnsupportedQuestionException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * "give me all detail of kajal"
 *
 * The data path refused it and prose then answered that the data did not
 * exist. It does — she is in `employee_work_infos`, and so is everybody else.
 * A question naming one person and asking for their details is the single most
 * obvious thing anyone asks an HR assistant, and it has to return that row.
 *
 * WHAT ACTUALLY BROKE, measured on the 150-entity catalogue on 26 Aug 2026:
 *
 *     "show me kajal"             every entity 0.00 -> refused, never planned
 *     "everything about kajal"    every entity 0.00 -> refused, never planned
 *     "details of kajal"          attendance_holidays 15.03, employees 0.00
 *     "kajal profile"             employee_profiles  36.24, employees 0.00
 *
 * Retrieval indexes NAMES and never column VALUES, so a person's name scores
 * nothing anywhere, and the two questions that carried a word at all were
 * decided by that word: "detail" won a holiday table on its `details` column.
 * The `employees` entity was never in the prompt in any of the four.
 *
 * THE FIX IS NOT A SYNONYM, AND COULD NOT HAVE BEEN. The `namedEntities()`
 * reservation reads the question against the catalogue and the synonym map; a
 * colleague's first name is in neither, and a map listing every employee is a
 * copy of the roster that is stale the day somebody is hired. The roster is the
 * only place the word means anything, so `PersonLookup` asks it and
 * `QueryPlanner` plans the lookup itself.
 *
 * THE LINE THIS FILE EXISTS TO HOLD is that "all details" means every field the
 * layer PUBLISHES and not every column on the row. PAN, UAN, ESI and bank
 * details are withheld from the layer entirely, and a lookup that felt
 * incomplete is exactly the pressure that would widen that. It is asserted
 * below rather than trusted.
 */
class PersonLookupTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private Organization $otherOrg;

    private User $admin;

    private Group $engineering;

    private int $sequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        // The planner refuses on an unconfigured client before it reaches
        // anything this file is about, so the vendor is configured and faked.
        // Nothing here should ever reach it, which is its own assertion below.
        config()->set('services.ai.secondary_base_url', 'https://openrouter.test/api/v1');
        config()->set('services.ai.secondary_api_key', 'test-key');
        config()->set('services.ai.secondary_models', 'stealth/ox-alpha');

        $this->org = Organization::create(['name' => 'Org A', 'slug' => 'person-org-a']);
        $this->otherOrg = Organization::create(['name' => 'Org B', 'slug' => 'person-org-b']);

        $this->admin = User::create([
            'name' => 'Admin', 'email' => 'admin-person@org.test',
            'password' => Hash::make('password123'), 'role' => 'admin',
            'organization_id' => $this->org->id,
        ]);

        Auth::setUser($this->admin);

        $this->engineering = Group::create([
            'organization_id' => $this->org->id,
            'name' => 'Engineering',
            'slug' => 'engineering-person',
        ]);
    }

    // -------------------------------------------------------------- fixtures

    private function person(string $name, ?Organization $organization = null): User
    {
        $this->sequence++;
        $organization ??= $this->org;

        $user = User::create([
            'name' => $name,
            'email' => "person-{$this->sequence}@org.test",
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        EmployeeWorkInfo::create([
            'organization_id' => $organization->id,
            'user_id' => $user->id,
            'employee_code' => 'EMP-'.$this->sequence,
            'report_group_id' => $organization->is($this->org) ? $this->engineering->id : null,
            'designation' => 'Software Engineer',
            'work_location' => 'Pune',
            'employment_type' => 'full_time',
            'employment_status' => 'active',
            'joining_date' => '2025-04-01',
        ]);

        return $user;
    }

    /**
     * The whole read path, exactly as `SearchAskController` runs it: plan,
     * validate, execute. Asserting on `PersonLookup` alone would prove the
     * lookup resolves a name and prove nothing about whether a table comes
     * back, which is the half that was broken.
     *
     * @return array<string, mixed>
     */
    private function ask(string $question): array
    {
        $plan = app(PlanValidator::class)->validate(app(QueryPlanner::class)->plan($question));

        return app(QueryPlanExecutor::class)->execute($plan) + ['plan' => $plan];
    }

    /**
     * @param  array<string, mixed>  $result
     * @return list<string>
     */
    private function namesIn(array $result): array
    {
        return array_map(fn (array $row): string => (string) $row['name'], $result['rows']);
    }

    // ------------------------------------------------------------ the defect

    public function test_the_question_that_fell_through_to_prose_now_returns_her_row(): void
    {
        $this->person('Kajal Sharma');
        $this->person('Ravi Kumar');

        $result = $this->ask('give me all detail of kajal');

        $this->assertSame(['Kajal Sharma'], $this->namesIn($result));
        $this->assertSame('list', $result['plan']['mode'], 'A person lookup is a row listing, never an aggregate.');
        $this->assertSame('employees', $result['plan']['entity']);

        $row = $result['rows'][0];
        $this->assertSame('Software Engineer', $row['designation']);
        $this->assertSame('Engineering', $row['department']);
        $this->assertSame('EMP-1', $row['employee_code']);
    }

    /**
     * A person does not phrase this one way. Two of these five carried no word
     * at all beyond the name, which is why no amount of synonym work could have
     * reached them: there was nothing in the sentence to be a synonym FOR.
     */
    public function test_every_phrasing_of_a_person_lookup_returns_her_row(): void
    {
        $this->person('Kajal Sharma');
        $this->person('Ravi Kumar');

        foreach ([
            'details of kajal',
            'give me all detail of kajal',
            'show me kajal',
            'kajal profile',
            'everything about kajal',
            'who is kajal',
            'kajal',
        ] as $question) {
            $this->assertSame(
                ['Kajal Sharma'],
                $this->namesIn($this->ask($question)),
                "'{$question}' did not return the person it names."
            );
        }
    }

    /**
     * The plan is built here, not asked for.
     *
     * Two things would otherwise be left to a model and both decide the answer:
     * whether "kajal" reads as a VALUE for `name` or as a field it could not
     * find in the catalogue (a field it cannot find is the error shape, which
     * is a refusal), and which eight of twenty allowed columns "all details"
     * means. The second is a product decision about what a profile IS and must
     * not be re-taken per request, or the same question shows different fields
     * on different days.
     */
    public function test_a_person_lookup_never_calls_the_model(): void
    {
        Http::fake();
        $this->person('Kajal Sharma');

        $this->ask('give me all detail of kajal');

        Http::assertNothingSent();
    }

    // ----------------------------------------------------------- ambiguity

    /**
     * TWO PEOPLE CALLED KAJAL ARE TWO ROWS.
     *
     * Not the first one, not a clarifying question. A row listing is already
     * the shape that can say "there are two of them", and it says it with the
     * department, the code and the joining date beside each — everything the
     * reader needs to tell them apart. Asking back costs a round trip to say
     * something the table says better. What is never acceptable is one row: an
     * answer that looks complete and is about the wrong person.
     */
    public function test_two_people_with_the_same_first_name_both_come_back(): void
    {
        $this->person('Kajal Sharma');
        $this->person('Kajal Mehta');
        $this->person('Ravi Kumar');

        $names = $this->namesIn($this->ask('give me all detail of kajal'));

        sort($names);
        $this->assertSame(['Kajal Mehta', 'Kajal Sharma'], $names);
    }

    /**
     * Every word of the name is ANDed, so the surname is what narrows it.
     * ORing them would answer "kajal sharma" with every Sharma in the company
     * standing beside her.
     */
    public function test_a_full_name_narrows_to_the_one_person(): void
    {
        $this->person('Kajal Sharma');
        $this->person('Kajal Mehta');
        $this->person('Anil Sharma');

        $this->assertSame(['Kajal Sharma'], $this->namesIn($this->ask('details of kajal sharma')));
    }

    /**
     * A misspelling is normal, and it is resolved against the ROSTER — so it
     * can only ever produce a real colleague, and it produces every candidate
     * rather than the closest one. That is what lets the floor sit one
     * character below `EntityRetriever::FUZZY_MIN_LENGTH`: this correction
     * arrives labelled with the name it found, in a column the reader is
     * looking at, where a wrong guess is visible instead of hidden inside an
     * aggregate.
     */
    public function test_a_name_typed_one_character_wrong_still_finds_her(): void
    {
        $this->person('Kajal Sharma');
        $this->person('Ravi Kumar');

        $this->assertSame(['Kajal Sharma'], $this->namesIn($this->ask('kajel details')));
        $this->assertSame(['Kajal Sharma'], $this->namesIn($this->ask('everything about kajall')));
    }

    // ------------------------------------------------------- what is shown

    /**
     * "ALL DETAILS" MEANS EVERY FIELD THIS LAYER PUBLISHES, NEVER EVERY COLUMN.
     *
     * `employee_work_infos` joined to `users` sits next to statutory
     * identifiers and bank details. `SchemaIntrospector` withholds those from
     * the layer entirely, so none of them could be named — but "give me
     * everything" is exactly the question that would tempt somebody to widen
     * the exclusion to make a lookup feel complete, and this is the assertion
     * that says no. It is deliberately not a check that the plan validated:
     * a plan validates fine while quietly showing one column.
     */
    public function test_all_details_is_the_published_profile_and_nothing_withheld(): void
    {
        $this->person('Kajal Sharma');

        $result = $this->ask('give me all detail of kajal');
        $columns = array_column($result['columns'], 'key');

        $this->assertSame([
            'name',
            'employee_code',
            'designation',
            'department',
            'reporting_manager',
            'work_location',
            'employment_status',
            'joining_date',
        ], $columns);

        foreach ($columns as $column) {
            $this->assertFalse(
                SchemaIntrospector::isExcludedColumn($column),
                "A person lookup shows '{$column}', which is withheld from every table at every role."
            );

            $this->assertNotNull(
                SemanticLayer::listColumn('employees', $column) ?? SemanticLayer::dimension('employees', $column),
                "'{$column}' is not on the employees allow-list, so this plan named a column the layer does not publish."
            );
        }
    }

    /**
     * The exclusion is decided on the QUESTION and stays decided when a name is
     * standing next to the withheld word. A WITHHELD refusal never becomes
     * prose, so this must not quietly become a person lookup either — that
     * would be a route around the exclusion opened by the feature that answers
     * the innocent half of the same sentence.
     */
    public function test_a_withheld_subject_is_still_refused_beside_a_name(): void
    {
        $this->person('Kajal Sharma');

        foreach (['kajal pan number', 'kajal bank account details', 'what is kajal uan'] as $question) {
            try {
                app(QueryPlanner::class)->plan($question);
                $this->fail("'{$question}' was planned rather than refused.");
            } catch (UnsupportedQuestionException $e) {
                $this->assertSame(
                    UnsupportedQuestionException::WITHHELD,
                    $e->getReason(),
                    "'{$question}' was refused for the wrong reason, so it can reach the prose assistant."
                );
            }
        }
    }

    // ------------------------------------------------- what it does NOT take

    /**
     * A question with a subject of its own is not a person lookup, however
     * clearly it names somebody. "kajal attendance last month" is about
     * attendance and the planner can filter it by a person; answering it from
     * the profile list would be a confident answer to a question nobody asked
     * — the exact failure this layer is built to prevent, arriving through the
     * fix for it.
     */
    public function test_a_question_with_a_subject_of_its_own_is_left_to_the_planner(): void
    {
        $this->person('Kajal Sharma');

        Http::fake([
            'openrouter.test/*' => Http::response([
                'choices' => [['message' => ['content' => '{"entity":"attendance","metrics":["absent_days"],"group_by":["employee"]}']]],
            ], 200),
        ]);

        $plan = app(QueryPlanner::class)->plan('kajal attendance last month');

        $this->assertSame('attendance', $plan['entity']);
        Http::assertSentCount(1);
    }

    /** Same rule, at the level the lookup itself decides it. */
    public function test_a_named_subject_stops_the_lookup_before_any_query(): void
    {
        $this->person('Kajal Sharma');
        $catalogue = SemanticLayer::cached();

        foreach ([
            'what did kajal earn last month',
            'kajal leave balance',
            'how many people are in engineering',
            'kajal salary',
        ] as $question) {
            $this->assertNull(
                PersonLookup::nameFiltersFor($question, $catalogue),
                "'{$question}' was taken as a person lookup."
            );
        }
    }

    /**
     * A CHANGE REQUEST NAMING SOMEBODY IS NOT A LOOKUP.
     *
     * `SearchAskController` consults the write path only after the read path
     * has declined, so a person lookup that swallowed "offboard kajal" would
     * show her profile where the product should have offered to make the
     * change — and the reader would reasonably conclude nothing happened
     * because nothing was proposed. The verb is an extra word that is not part
     * of the name, and that is exactly what the gate is measuring.
     */
    public function test_a_change_request_naming_somebody_is_not_a_lookup(): void
    {
        $this->person('Kajal Sharma');
        $catalogue = SemanticLayer::cached();

        foreach ([
            'delete kajal',
            'deactivate kajal',
            'offboard kajal',
            'terminate kajal',
            'promote kajal',
            'change kajal designation',
            'add kajal to engineering',
            'approve kajal leave',
        ] as $question) {
            $this->assertNull(
                PersonLookup::nameFiltersFor($question, $catalogue),
                "'{$question}' was answered with a profile instead of reaching the write path."
            );
        }
    }

    /**
     * The roster is what confirms a word is a name, and that is what keeps this
     * from swallowing the prose assistant's questions. An unusual word is not a
     * person just because nothing in the schema recognises it — otherwise "how
     * do I configure reverb" would come back as "no employee called reverb",
     * and a help question would have been answered with an empty table.
     */
    public function test_a_word_that_names_nobody_is_not_a_person_lookup(): void
    {
        $this->person('Kajal Sharma');
        $catalogue = SemanticLayer::cached();

        foreach ([
            'everything about zephyrine',
            'how do i configure reverb',
            'details of quorum',
        ] as $question) {
            $this->assertNull(
                PersonLookup::nameFiltersFor($question, $catalogue),
                "'{$question}' was taken as a person lookup."
            );
        }
    }

    /**
     * A WORD IS NOT A NAME BECAUSE IT HAPPENS TO SIT INSIDE ONE.
     *
     * The measured defect: the roster probe asked `lower(name) like '%kra%'`,
     * Vikram answered yes, and "what is a kra" — three letters of ordinary HR
     * vocabulary, in no table name and in no synonym, therefore unrecognised —
     * came back as Vikram's profile table instead of an explanation. One of 34
     * realistic non-person questions, which is one too many: the person path
     * runs BEFORE the prose assistant, so a hijack here does not degrade an
     * answer, it replaces it.
     *
     * The other two are the same bug with different letters, and they are here
     * because a length floor is the tempting fix and would have missed them.
     * 'lop' (loss of pay) is four characters short of Lopamudra; 'ram' is a
     * word an IT question uses and sits inside Vikram and Sriram. Raising the
     * floor to five buys those three and loses Anu, Raj, Dev and Ram, who are
     * people. The distinction that actually holds is the word BOUNDARY, and
     * the last assertion is what keeps this from being a length rule wearing a
     * different hat: the same three letters ARE a lookup the moment somebody is
     * called Ram.
     */
    public function test_a_word_that_only_sits_inside_a_name_is_not_a_person_lookup(): void
    {
        $this->person('Vikram Rao');
        $this->person('Lopamudra Nair');
        $this->person('Sriram Iyer');
        $catalogue = SemanticLayer::cached();

        foreach ([
            'kra',
            'what is a kra',
            'kra details',
            'lop',
            'what is lop',
            'ram',
        ] as $question) {
            $this->assertNull(
                PersonLookup::nameFiltersFor($question, $catalogue),
                "'{$question}' was answered with the profile of somebody whose name merely contains it."
            );
        }

        $this->person('Ram Prasad');

        $this->assertSame(
            [['field' => 'name', 'op' => 'contains', 'value' => 'ram']],
            PersonLookup::nameFiltersFor('details of ram', $catalogue),
            'The gate is about naming, not about length: three letters that are somebody\'s name are a lookup.'
        );
    }

    /**
     * The boundary is the one `partsOf()` uses, so a name written with a full
     * stop or a hyphen is still made of parts. Getting this wrong would refuse
     * to look up half the people whose names carry an initial — a false
     * negative rather than a hijack, but a real person unreachable by name.
     */
    public function test_a_name_part_separated_by_punctuation_is_still_a_name(): void
    {
        $this->person('K.Sharma');
        $this->person('Anne-Marie Dsouza');
        $catalogue = SemanticLayer::cached();

        $this->assertSame(
            [['field' => 'name', 'op' => 'contains', 'value' => 'sharma']],
            PersonLookup::nameFiltersFor('details of sharma', $catalogue)
        );

        $this->assertSame(
            [['field' => 'name', 'op' => 'contains', 'value' => 'marie']],
            PersonLookup::nameFiltersFor('marie profile', $catalogue)
        );
    }

    // ------------------------------------------------------------- tenancy

    /**
     * The lookup is built on `EmployeeWorkInfo`, never on `User`.
     *
     * `User` deliberately carries no `BelongsToOrganization`, so `User::query()`
     * reads every tenant on the platform. A lookup built on it would confirm a
     * name belonging to another customer and then answer with an empty table,
     * which reads as "she has no details" rather than "she is not yours".
     * Sharing `QueryPlanExecutor`'s own base is what makes those two impossible
     * to disagree.
     */
    public function test_a_person_in_another_organization_is_never_found(): void
    {
        $this->person('Kajal Verma', $this->otherOrg);
        $catalogue = SemanticLayer::cached();

        $this->assertNull(
            PersonLookup::nameFiltersFor('give me all detail of kajal', $catalogue),
            'A name from another organization was confirmed as a person on this roster.'
        );

        // And with somebody of that name on BOTH rosters, only ours comes back.
        $this->person('Kajal Sharma');

        $this->assertSame(['Kajal Sharma'], $this->namesIn($this->ask('give me all detail of kajal')));
    }

    // ----------------------------------------------------------- the reason

    /**
     * The measurement the whole design rests on, pinned so it cannot quietly
     * stop being true: retrieval scores `employees` at ZERO on a question about
     * a person, because a name is a value and values are not indexed. If this
     * ever changes, the short-circuit is no longer load-bearing and somebody
     * should be told rather than left to find out.
     */
    public function test_retrieval_cannot_see_a_person_and_says_so(): void
    {
        $catalogue = SemanticLayer::cached();

        foreach (['show me kajal', 'everything about kajal', 'give me all detail of kajal'] as $question) {
            $this->assertSame(
                0.0,
                EntityRetriever::scoreAll($question, $catalogue)['employees'],
                "'{$question}' now scores the employees entity, which the person path assumes it does not."
            );
        }

        $this->assertSame(
            [],
            EntityRetriever::forQuestion('show me kajal', $catalogue),
            'A bare name still matches no entity at all, which is why it never reached a model.'
        );

        // The one thing retrieval CAN honestly say about a name: that this
        // catalogue means nothing by the word. It never guesses what it is.
        $words = EntityRetriever::questionWords('kajal attendance', $catalogue);

        $this->assertSame(['attendance'], $words['known']);
        $this->assertSame(['kajal'], $words['unknown']);
    }
}
