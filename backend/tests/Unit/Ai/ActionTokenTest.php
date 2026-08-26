<?php

namespace Tests\Unit\Ai;

use App\Services\Ai\Actions\ActionToken;
use Illuminate\Support\Carbon;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The token is what makes "the previewed plan is what executes" enforceable.
 *
 * Apply is a SEPARATE request. Without a server-issued token the client would
 * be posting a plan of its own composition, and every guarantee the preview
 * makes — that a human saw this interpretation, that these were the live values
 * at the time, that the person confirming is the person who asked — would be a
 * claim the client makes about itself.
 *
 * So four properties are pinned here, and each corresponds to an attack that is
 * otherwise trivial:
 *
 *  - **A tampered token opens as null.** Otherwise "change the cap to 10"
 *    becomes "change it to 1000" by editing one character of a base64 string.
 *  - **It expires.** A preview a person walked away from is not consent given
 *    an hour later, and the expiry is INSIDE the signature so it cannot be
 *    pushed out by the holder.
 *  - **It is bound to one user.** Otherwise a token is a capability that can be
 *    forwarded, and the audit's "who confirmed this" names the wrong human.
 *  - **It carries the before-values.** The staleness check has nothing to
 *    compare the live row against otherwise, and applying a diff to a value
 *    that has moved erases somebody else's change silently.
 *
 * The token is SIGNED, not encrypted, and is deliberately allowed to be
 * readable: everything in it — the plan and the before-values — is what the
 * holder was just shown on screen. Anything they may not see must never be put
 * in here.
 *
 * @see docs/superpowers/specs/2026-08-26-ai-write-actions.md §5
 */
class ActionTokenTest extends TestCase
{
    private const PLAN = [
        'action' => 'leave_type.update',
        'target' => ['name' => 'Casual Leave'],
        'changes' => ['carry_forward_cap' => 10],
    ];

    /** Read back from a `decimal:2` cast, which yields a STRING, not a float. */
    private const BEFORE = ['carry_forward_cap' => '5.00'];

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_a_token_it_issued_opens_back_into_the_same_plan(): void
    {
        $opened = ActionToken::open(ActionToken::issue(self::PLAN, self::BEFORE, 7), 7);

        $this->assertNotNull($opened);
        $this->assertSame(self::PLAN, $opened['plan']);
        $this->assertSame(7, $opened['user_id']);
    }

    /**
     * The before-values come back BYTE FOR BYTE.
     *
     * `carry_forward_cap` is cast `decimal:2`, so the live row hands over the
     * string "5.00". If the round trip turned that into the float 5.0, the
     * staleness check would compare "5.00" against 5.0 and have to choose
     * between a loose comparison — which would let 5.004 pass as unchanged —
     * and a strict one that refuses every apply. Neither is a check.
     */
    public function test_the_before_values_survive_the_round_trip_unchanged(): void
    {
        $opened = ActionToken::open(ActionToken::issue(self::PLAN, self::BEFORE, 7), 7);

        $this->assertSame(self::BEFORE, $opened['before']);
        $this->assertIsString($opened['before']['carry_forward_cap']);
    }

    public function test_a_tampered_payload_opens_as_null(): void
    {
        $token = ActionToken::issue(self::PLAN, self::BEFORE, 7);
        [$body, $signature] = explode('.', $token, 2);

        $decoded = base64_decode(strtr($body, '-_', '+/'), true);
        $this->assertIsString($decoded, 'the body should be decodable — this test is about re-signing it');
        $this->assertStringContainsString('carry_forward_cap', $decoded);

        $forged = str_replace('"carry_forward_cap":10', '"carry_forward_cap":1000', $decoded);
        $this->assertNotSame($decoded, $forged, 'the forgery must actually change something');

        $rebuilt = rtrim(strtr(base64_encode($forged), '+/', '-_'), '=').'.'.$signature;

        $this->assertNull(ActionToken::open($rebuilt, 7));
    }

    public function test_a_tampered_signature_opens_as_null(): void
    {
        $token = ActionToken::issue(self::PLAN, self::BEFORE, 7);
        [$body, $signature] = explode('.', $token, 2);

        $flipped = ($signature[0] === 'a' ? 'b' : 'a').substr($signature, 1);

        $this->assertNull(ActionToken::open($body.'.'.$flipped, 7));
    }

    #[DataProvider('malformedTokens')]
    public function test_a_token_that_is_not_one_opens_as_null(string $token): void
    {
        $this->assertNull(ActionToken::open($token, 7));
    }

    /** @return array<string, array{string}> */
    public static function malformedTokens(): array
    {
        return [
            'empty' => [''],
            'no separator' => ['abcdef'],
            'body only' => ['eyJhIjoxfQ.'],
            'signature only' => ['.deadbeef'],
            'three parts' => ['a.b.c'],
            'not base64' => ['!!!.!!!'],
            'not json' => ['bm90LWpzb24.0000000000000000000000000000000000000000000000000000000000000000'],
        ];
    }

    /**
     * Five minutes, and the boundary is pinned on BOTH sides.
     *
     * Only asserting that an hour-old token fails would pass an implementation
     * whose expiry was a hundred years, and only asserting the fresh case would
     * pass one with no expiry at all.
     */
    public function test_it_expires_after_five_minutes(): void
    {
        Carbon::setTestNow('2026-08-26 10:00:00');
        $token = ActionToken::issue(self::PLAN, self::BEFORE, 7);

        Carbon::setTestNow('2026-08-26 10:04:59');
        $this->assertNotNull(ActionToken::open($token, 7), 'still inside the five minutes');

        Carbon::setTestNow('2026-08-26 10:05:01');
        $this->assertNull(ActionToken::open($token, 7), 'past the five minutes');
    }

    /**
     * The expiry is inside the signature, so pushing it out is a forgery.
     *
     * This is the difference between a deadline and a suggestion: an expiry
     * carried beside the signature is a field the holder edits.
     */
    public function test_the_expiry_cannot_be_extended_by_the_holder(): void
    {
        Carbon::setTestNow('2026-08-26 10:00:00');
        $token = ActionToken::issue(self::PLAN, self::BEFORE, 7);
        [$body, $signature] = explode('.', $token, 2);

        $decoded = base64_decode(strtr($body, '-_', '+/'), true);
        $expiry = Carbon::now()->addMinutes(5)->getTimestamp();
        $forged = str_replace((string) $expiry, (string) ($expiry + 86400), $decoded);
        $this->assertNotSame($decoded, $forged, 'the expiry should be present in the body to move');

        $rebuilt = rtrim(strtr(base64_encode($forged), '+/', '-_'), '=').'.'.$signature;

        Carbon::setTestNow('2026-08-26 11:00:00');
        $this->assertNull(ActionToken::open($rebuilt, 7));
    }

    public function test_a_token_issued_to_somebody_else_opens_as_null(): void
    {
        $token = ActionToken::issue(self::PLAN, self::BEFORE, 7);

        $this->assertNull(ActionToken::open($token, 8));
        $this->assertNotNull(ActionToken::open($token, 7));
    }

    /**
     * Two people previewing the same change get two different tokens, because
     * the holder is signed in. Identical tokens would mean the binding lived
     * somewhere outside the signature, where it is advisory.
     */
    public function test_the_same_plan_for_two_people_is_two_different_tokens(): void
    {
        Carbon::setTestNow('2026-08-26 10:00:00');

        $this->assertNotSame(
            ActionToken::issue(self::PLAN, self::BEFORE, 7),
            ActionToken::issue(self::PLAN, self::BEFORE, 8),
        );
    }

    /**
     * Rotating the application key invalidates every outstanding token.
     *
     * That is the point of signing with it rather than with a constant: a key
     * rotation is the one lever an operator has, and a token that survived it
     * would make the lever useless.
     */
    public function test_rotating_the_application_key_invalidates_outstanding_tokens(): void
    {
        $token = ActionToken::issue(self::PLAN, self::BEFORE, 7);

        config(['app.key' => 'base64:'.base64_encode(str_repeat('b', 32))]);

        $this->assertNull(ActionToken::open($token, 7));
    }

    /**
     * An unkeyed signature is not a signature. Signing with an empty key would
     * make every token forgeable by anyone who can read this file, and it would
     * do so silently — the tokens would still round-trip.
     */
    public function test_it_refuses_to_sign_without_an_application_key(): void
    {
        config(['app.key' => '']);

        $this->expectException(\RuntimeException::class);

        ActionToken::issue(self::PLAN, self::BEFORE, 7);
    }
}
