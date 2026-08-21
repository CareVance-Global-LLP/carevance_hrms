<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\UserController;
use App\Providers\AppServiceProvider;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;
use Tests\TestCase;

/**
 * The password policy production actually enforces.
 *
 * `Password::defaults()` short-circuits to a bare `min(8)` outside production —
 * deliberately, so the suite runs offline and fast, since `uncompromised()` is a
 * network call. The consequence is that no request-level test can reach the
 * strict rules, which AppServiceProvider used to concede in a comment ending
 * "verify it by hand".
 *
 * These validate the real rule object instead, with the Have I Been Pwned
 * lookup faked. That keeps the suite offline while still exercising the actual
 * policy rather than a copy of it — including the breach check, which is the
 * single most effective rule in the set and the one most worth proving.
 *
 * The minimum is 8 rather than 12. That was a deliberate product decision and it
 * is the weakest part of this policy; what keeps it defensible is that only the
 * length was relaxed. These tests are what hold the rest in place.
 */
class PasswordPolicyTest extends TestCase
{
    /** The k-anonymity range endpoint `uncompromised()` calls. */
    private const HIBP = 'https://api.pwnedpasswords.com/*';

    protected function setUp(): void
    {
        parent::setUp();

        // Nothing in this suite may touch the network. Every test arms its own
        // response; an unfaked call would fail loudly rather than hang.
        Http::preventStrayRequests();
    }

    /** Answer the range lookup as though the password appears in no breach. */
    private function fakeCleanBreachLookup(): void
    {
        Http::fake([self::HIBP => Http::response('', 200)]);
    }

    /**
     * Answer as though this exact password is in a breach corpus.
     *
     * HIBP replies with `SUFFIX:COUNT` lines, where the suffix is everything
     * after the first five characters of the SHA-1 of the password.
     */
    private function fakeBreachedLookup(string $password): void
    {
        $suffix = substr(strtoupper(sha1($password)), 5);

        Http::fake([self::HIBP => Http::response($suffix.':4242', 200)]);
    }

    private function validate(string $password)
    {
        return Validator::make(
            ['password' => $password],
            ['password' => ['string', AppServiceProvider::productionRules()]]
        );
    }

    private function fails(string $password): bool
    {
        return $this->validate($password)->fails();
    }

    // ------------------------------------------------------------ the length

    public function test_eight_compliant_characters_are_accepted(): void
    {
        // The whole point of the change: this is now long enough.
        $this->fakeCleanBreachLookup();

        $this->assertFalse($this->fails('Abcd12!x'));
    }

    public function test_seven_characters_are_refused(): void
    {
        $this->fakeCleanBreachLookup();

        $this->assertTrue($this->fails('Abc12!x'));
    }

    // ------------------------------------------------------- everything else

    public function test_the_composition_rules_survived_the_length_change(): void
    {
        // Only the minimum moved. Each of these is long enough and fails on one
        // rule alone, so a silently dropped rule shows up here.
        $this->fakeCleanBreachLookup();

        $this->assertTrue($this->fails('abcd1234!'), 'no uppercase should fail');
        $this->assertTrue($this->fails('ABCD1234!'), 'no lowercase should fail');
        $this->assertTrue($this->fails('Abcdefg!'), 'no number should fail');
        $this->assertTrue($this->fails('Abcd1234'), 'no symbol should fail');
    }

    public function test_a_breached_password_is_refused_even_when_it_satisfies_every_other_rule(): void
    {
        /*
         * This is the rejection that generated the support questions: the
         * password looks compliant, every visible rule is met, and it is still
         * refused. Worth proving it genuinely fires rather than assuming it.
         */
        $this->fakeBreachedLookup('Passw0rd!');

        $this->assertTrue($this->fails('Passw0rd!'));
    }

    public function test_the_breach_rejection_is_worded_for_a_human(): void
    {
        // Laravel's default reads as though CareVance leaked the password, and
        // never says what to do instead.
        $this->fakeBreachedLookup('Passw0rd!');

        $message = $this->validate('Passw0rd!')->errors()->first('password');

        $this->assertStringContainsString('public data breach', $message);
        $this->assertStringNotContainsString('The given password', $message);
    }

    // ------------------------------------------- the password an admin hands over

    /** The generator is private; nothing else calls it, so reach it directly. */
    private function generateTemporaryPassword(): string
    {
        $method = new \ReflectionMethod(UserController::class, 'generateTemporaryPassword');
        $method->setAccessible(true);

        return $method->invoke(null);
    }

    public function test_a_generated_temporary_password_would_pass_the_policy(): void
    {
        /*
         * It is minted after validation, so nothing else checks it. The point is
         * that the credential an admin reads out to a joiner could actually be
         * typed into the form that later accepts it — handing over something the
         * system would itself reject is its own support question.
         *
         * Run repeatedly because the generator is random: a rule satisfied only
         * most of the time would pass here once and fail in the field.
         */
        $this->fakeCleanBreachLookup();

        for ($i = 0; $i < 50; $i++) {
            $generated = $this->generateTemporaryPassword();

            $this->assertFalse(
                $this->fails($generated),
                "Generated temporary password did not satisfy the policy: {$generated}"
            );
        }
    }

    public function test_a_generated_temporary_password_avoids_characters_that_cannot_be_transcribed(): void
    {
        // It gets read aloud or copied off a note. A password containing 0/O or
        // 1/l/I is a reset request waiting to happen.
        for ($i = 0; $i < 50; $i++) {
            $this->assertDoesNotMatchRegularExpression('/[0O1lI]/', $this->generateTemporaryPassword());
        }
    }

    // -------------------------------------------------------- the test escape

    public function test_outside_production_the_suite_gets_the_relaxed_rule(): void
    {
        /*
         * Pinned on purpose. Dozens of tests create users with passwords like
         * "password123"; if the strict rule ever leaked into the test
         * environment they would all fail at once, and the cause would not be
         * obvious from any one of them. No HTTP fake here either — the relaxed
         * rule must not make a network call at all.
         */
        $this->assertFalse($this->app->isProduction());

        $validator = Validator::make(
            ['password' => 'password123'],
            ['password' => ['string', Password::defaults()]]
        );

        $this->assertFalse($validator->fails());
    }
}
