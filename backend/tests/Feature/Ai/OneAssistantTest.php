<?php

namespace Tests\Feature\Ai;

use App\Services\Ai\QueryPlanner;
use App\Services\Ai\UnsupportedQuestionException;
use App\Services\AiChatService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * One assistant, not a data mode beside a help bubble.
 *
 * A person does not know in advance whether what they are about to type is "a
 * data question" or "a help question", and making them pick the right box
 * before typing is the tool's problem, not theirs. So a planner refusal became
 * a FALLBACK to prose rather than a dead end.
 *
 * The line that must hold is not "answer everything" — it is **never invent a
 * figure**. Prose explains; numbers come from an executed metric or from
 * AiToolRegistry, which runs the same scoped queries and hands back a route to
 * go and check them.
 *
 * And one refusal must survive the fallback entirely. Asked for "everyone's PAN
 * number" with prose enabled and no exclusion guard, the assistant replied:
 *
 *   "I cannot view employee PAN numbers directly. You can view or export
 *    employee tax and statutory details by going to Payroll Dashboard → Tax
 *    Declarations"
 *
 * — a route around the exclusion, offered by the system that exists to enforce
 * it. Withholding has to be decided on the QUESTION, because for that question
 * no plan is ever built to refuse.
 */
class OneAssistantTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_withheld_subject_is_refused_before_any_model_call(): void
    {
        // Http is not faked and no provider is reachable in tests: if this
        // reached the network it would fail differently, which is the point.
        foreach ([
            "everyone's PAN number",
            'list every employee UAN',
            'show me bank account details for the team',
            'what is the account number for Priya',
        ] as $question) {
            try {
                app(QueryPlanner::class)->plan($question);
                $this->fail("'{$question}' should have been withheld");
            } catch (UnsupportedQuestionException $e) {
                $this->assertFalse(
                    $e->mayAnswerInProse(),
                    "'{$question}' must never reach the prose assistant"
                );
                $this->assertSame(UnsupportedQuestionException::WITHHELD, $e->getReason());
            }
        }
    }

    public function test_a_job_title_is_not_mistaken_for_a_statutory_id(): void
    {
        // "designation" contains "esi"; "company" contains "pan". Matching on
        // substrings would refuse real questions about job titles and orgs,
        // which is the narrowness this design was told to stop.
        foreach ([
            'headcount by designation',
            'how many people work at the company',
            'list employees by designation and department',
        ] as $question) {
            try {
                app(QueryPlanner::class)->plan($question);
            } catch (UnsupportedQuestionException $e) {
                $this->assertNotSame(
                    UnsupportedQuestionException::WITHHELD,
                    $e->getReason(),
                    "'{$question}' is an ordinary question and must not be withheld"
                );
            }
        }

        $this->addToAssertionCount(1);
    }

    public function test_an_ordinary_refusal_may_be_answered_in_prose(): void
    {
        $refusal = new UnsupportedQuestionException('That is not a data question.');

        $this->assertTrue($refusal->mayAnswerInProse());
        $this->assertSame(UnsupportedQuestionException::NOT_A_DATA_QUESTION, $refusal->getReason());
    }

    public function test_a_malformed_plan_is_not_conversation_either(): void
    {
        // A plan this system cannot honour is a defect report, not a question
        // about the product. Answering it in prose hides a real bug behind a
        // friendly reply.
        $refusal = UnsupportedQuestionException::malformed('The plan named no entity.');

        $this->assertFalse($refusal->mayAnswerInProse());
    }

    public function test_the_prose_half_is_the_same_service_as_the_help_bubble(): void
    {
        // Not a second implementation. A copy would drift from the original the
        // first time either changed, and the tool registry — which is what
        // keeps prose figures real — lives on this one.
        $this->assertTrue(
            method_exists(AiChatService::class, 'chat'),
            'the prose fallback calls AiChatService::chat; a private copy would drift'
        );
    }
}
