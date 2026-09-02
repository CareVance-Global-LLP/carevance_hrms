<?php

namespace Tests\Feature\Ai;

use App\Models\User;
use App\Services\AiChatService;
use Tests\TestCase;

/**
 * The assistant must never invent a limit the product does not have.
 *
 * Typed into AI mode: "give me all detail of kajal". Answered, in prose:
 *
 *     "I do not have access to individual employee records."
 *
 * Every part of that is false. The records exist, the asker is an admin of the
 * organisation that owns them, and they are on screen at /employees. What
 * actually happened is that `QueryPlanner` refused the phrasing as
 * NOT_A_DATA_QUESTION and `SearchAskController::answerInProse` fell through to
 * `AiChatService` — a missing TOOL. The prompt then reported it to the user as
 * a missing FEATURE, which is a different claim and one nothing in this process
 * can check.
 *
 * The clause that licensed it was written for the right reason:
 *
 *     "If no tool covers the question, say what you do not have rather than
 *      guessing."
 *
 * It exists to stop invented figures, and it works. But "what you do not have"
 * has two readings — this turn's tool list, and the product's capabilities —
 * and a model reaches for the second. So the prompt now names the distinction
 * outright and routes an unanswerable question to the screen that holds it.
 *
 * Asserted against the returned STRING, not against the file: the docblock on
 * `systemPrompt` quotes the old clause verbatim as the recorded defect, and a
 * grep over the source would call that a regression. The prompt is a pure
 * function of the user, so this whole file runs with no model call, no HTTP
 * fake and no database.
 *
 * The quoted phrases below are load-bearing, not incidental wording. If you
 * rewrite the prompt, rewrite these with it — but keep both halves it holds
 * together: no invented numbers, and no assertion about what CareVance cannot
 * do.
 */
class ProseCapabilityClaimsTest extends TestCase
{
    private function systemPrompt(?User $user = null): string
    {
        $method = new \ReflectionMethod(AiChatService::class, 'systemPrompt');
        $method->setAccessible(true);

        return $method->invoke(app(AiChatService::class), $user);
    }

    private function landingPrompt(): string
    {
        $method = new \ReflectionMethod(AiChatService::class, 'landingSystemPrompt');
        $method->setAccessible(true);

        return $method->invoke(app(AiChatService::class));
    }

    /**
     * The model is never asked to describe what it does not have, in any
     * phrasing — that instruction is what produced the sentence above.
     */
    public function test_the_prompt_no_longer_licenses_describing_what_it_lacks(): void
    {
        $admin = new User();
        $admin->role = 'admin';

        $prompt = $this->systemPrompt($admin);

        $this->assertDoesNotMatchRegularExpression(
            "/say what you do(?: not|n't) have/i",
            $prompt,
            'The clause that produced "I do not have access to individual employee records" is back.'
        );
    }

    /**
     * The half that was always right. The fix must not be paid for by letting
     * the model estimate a headcount it never read.
     */
    public function test_it_still_refuses_to_invent_a_figure(): void
    {
        $prompt = $this->systemPrompt(null);

        $this->assertStringContainsString(
            'NEVER invent, estimate or round a number you did not get from a tool',
            $prompt
        );
    }

    /**
     * "I could not answer that here" and "this product cannot do that" are
     * different claims. The prompt must draw the line and forbid the second
     * outright, because from inside a chat turn there is nothing to check it
     * against.
     */
    public function test_a_missing_tool_is_a_limit_of_the_conversation_not_of_the_product(): void
    {
        $prompt = $this->systemPrompt(null);

        $this->assertStringContainsString(
            'limit of THIS conversation, never a limit of CareVance',
            $prompt
        );

        $this->assertStringContainsString(
            'NEVER say the product cannot do something, does not have a feature, does not store a record',
            $prompt
        );

        // This one wants the banned sentence PRESENT, which reads backwards
        // until you see where: the prompt quotes "do not have access to"
        // inside the rule that forbids it. Matched as the object of the
        // prohibition and not loose in the prompt, because a bare occurrence
        // somewhere else would pass this while reading as permission, and a
        // ban reworded into the abstract ("do not speculate about
        // capabilities") would stop covering the one sentence a real user
        // was actually given.
        $this->assertStringContainsString(
            "or that you 'do not have access to' a kind of record",
            $prompt,
            'The banned sentence is no longer quoted inside the ban, so a rewording could re-license it.'
        );
    }

    /**
     * The honest reply to an unanswerable question is a route, not a refusal.
     * The prompt already carried the full route map; nothing pointed the model
     * at it when its tools came up short.
     */
    public function test_an_unanswerable_question_is_pointed_at_the_screen_that_holds_it(): void
    {
        $prompt = $this->systemPrompt(null);

        $this->assertStringContainsString(
            'send them to the screen that holds it, from the route map below',
            $prompt
        );
    }

    /**
     * The specific question that was answered with a lie. One named person is
     * always answerable in this product, and Employees is where they are.
     */
    public function test_a_question_about_one_named_person_is_answered_with_the_employees_route(): void
    {
        $prompt = $this->systemPrompt(null);

        $this->assertStringContainsString('ONE NAMED PERSON always has an answer here', $prompt);
        $this->assertStringContainsString('Employees (/employees)', $prompt);
        $this->assertStringContainsString(
            'Never reply that individual employee records are unavailable',
            $prompt
        );
    }

    /**
     * The carve-out that keeps this fix from undoing an earlier one.
     *
     * `QueryPlanner::refuseWithheldSubject()` exists because the assistant,
     * asked for everyone's PAN, helpfully answered "you can view or export
     * employee tax and statutory details by going to Payroll Dashboard → Tax
     * Declarations" — a route around the exclusion, offered by the system that
     * enforces it. "Answer with a route" is the right rule for a person and
     * the wrong one for a PAN, and only the chat bubble
     * (`AiChatController`) reaches this prompt without the planner's guard in
     * front of it. So the prompt has to carry the exception itself.
     */
    public function test_a_withheld_identifier_is_not_answered_with_a_route_either(): void
    {
        $prompt = $this->systemPrompt(null);

        $this->assertStringContainsString('do not name a screen to read it off', $prompt);

        // Refusing is still not a claim about the product — the same line the
        // rest of this file draws, held on the one bullet allowed to refuse.
        // Which rules this bullet beats is asserted separately, below.
        $this->assertStringContainsString('a limit of you, not of the product', $prompt);
    }

    /**
     * The same defect, aimed at a prospect instead of an admin.
     *
     * The sales prompt lists six capability bullets and the product has far
     * more than six; asked about recruitment or rostering, a model reading that
     * list as exhaustive tells a buyer CareVance does not do it. CLAUDE.md
     * records that exact failure costing real marks in a customer evaluation
     * for features that had already shipped.
     */
    public function test_the_sales_bot_cannot_tell_a_prospect_the_product_lacks_a_feature(): void
    {
        $prompt = $this->landingPrompt();

        $this->assertStringContainsString('That list is a summary, not the whole product', $prompt);
        $this->assertStringContainsString('NEVER tell a visitor CareVance does not do something', $prompt);

        // It still may not invent a price to fill the same kind of gap.
        $this->assertStringContainsString(
            'Never invent exact prices, discounts, or contractual promises',
            $prompt
        );
    }

    /**
     * The same fix, run the other way.
     *
     * The first pass at the bullet above closed "never claim we lack a feature"
     * by writing "recruitment, rostering, statutory filings ... are all built"
     * and then forbidding the model from ever admitting a gap. Two of those
     * words are false: CLAUDE.md records seven filing generators as
     * `reference_only` with nothing submitting to a portal, and recruitment with
     * no public careers page. So a prospect who asked "does it file our PF
     * return to EPFO?" would have been told yes, by a prompt whose only stated
     * rule was optimism.
     *
     * A false yes and a false no are the same defect, and the yes is the one the
     * buyer signs a contract on. The rule is ACCURACY: the summary is evidence
     * of neither presence nor absence for anything not written in it.
     */
    public function test_the_sales_bot_cannot_tell_a_prospect_the_product_has_a_feature_either(): void
    {
        $prompt = $this->landingPrompt();

        $this->assertStringContainsString(
            'NEVER tell a visitor it DOES something that is not written above',
            $prompt,
            'The ban on over-claiming is missing, so the prompt is honest in one direction only.'
        );

        $this->assertDoesNotMatchRegularExpression(
            '/all built/i',
            $prompt,
            'The prompt is asserting completeness for features it cannot inspect. '
            .'Seven filings are reference_only and recruitment has no careers page.'
        );

        // Depth is the half a buyer actually asks about, and the half this
        // process has no way to check.
        $this->assertStringContainsString('never say how complete, certified or automated any of it is', $prompt);
    }

    /**
     * Precedence has to name what it beats.
     *
     * The bullet said it "outranks the two above it". Counted from the withheld
     * bullet, the two above are the never-say-the-product-cannot rule and the
     * named-person rule — but the rule it actually has to beat is "answer with a
     * route", which sits three above and was therefore left in force. A model
     * resolving the conflict by counting lines lands on the wrong pair.
     */
    public function test_the_withheld_bullet_names_the_rules_it_overrides(): void
    {
        $prompt = $this->systemPrompt(null);

        $this->assertDoesNotMatchRegularExpression(
            '/outranks the two above it/i',
            $prompt,
            'Precedence is being expressed by counting lines, which does not survive an edit above it.'
        );

        $this->assertStringContainsString(
            "overrides both the 'send them to the screen' rule and the named-person rule",
            $prompt
        );
    }

    /**
     * The two rules collided on the exact sentence this whole file exists for.
     *
     * "Give me all detail of kajal" arguably asks for every field of a person,
     * PAN and bank account included — in which case the withheld-identifier
     * bullet outranks the named-person bullet and the reply is a dead end with
     * no screen on it. That is the original defect wearing the fix's clothes.
     *
     * Withholding a field is not withholding the person: the question is
     * answered at /employees and the identifiers are simply not in the answer.
     */
    public function test_withholding_a_field_does_not_withhold_the_person(): void
    {
        $prompt = $this->systemPrompt(null);

        $this->assertStringContainsString('Withholding a FIELD is not withholding the PERSON', $prompt);
        $this->assertStringContainsString('leave the identifiers out of the reply', $prompt);

        // Only a question whose SUBJECT is the identifier is refused.
        $this->assertStringContainsString('Only a question whose subject IS the identifier', $prompt);
    }
}
