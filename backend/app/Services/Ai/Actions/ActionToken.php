<?php

namespace App\Services\Ai\Actions;

use Illuminate\Support\Carbon;
use RuntimeException;

/**
 * The signed handle that ties an Apply back to a preview a human actually saw.
 *
 * Preview and Apply are two separate HTTP requests. Without something the
 * server issued, Apply would be carrying a plan of the client's own
 * composition, and every guarantee the preview makes would be a claim the
 * client makes about itself: that a person saw this interpretation, that these
 * were the live values at the time, that the one confirming is the one who
 * asked.
 *
 * Four properties carry that, and each is inside the signature rather than
 * beside it — a field the holder can edit is not a constraint:
 *
 *  1. **The plan.** What executes is what was previewed. It is still
 *     re-validated from scratch at execution, because a signature proves
 *     provenance and not that the catalogue still says yes.
 *  2. **The before-values.** The staleness check has nothing to compare the
 *     live row against otherwise, and applying a diff to a value that has moved
 *     silently erases whoever moved it.
 *  3. **A five-minute expiry.** A preview somebody walked away from is not
 *     consent given an hour later.
 *  4. **The user it was issued to.** Otherwise the token is a forwardable
 *     capability, and the audit's "who confirmed this" names the wrong human.
 *
 * SIGNED, NOT ENCRYPTED — and that is a decision, not an omission. Everything
 * in here is what the holder was just shown on their own screen, so hiding it
 * would buy nothing; what matters is that they cannot change it. Anything the
 * holder may NOT see must never be put in a token.
 *
 * A tampered, expired, misaddressed or malformed token all open as `null`. One
 * return value for every failure on purpose: the caller's response is the same
 * in each case (regenerate the preview), and distinguishing them would tell a
 * caller probing tokens which part of one they got right.
 *
 * @see docs/superpowers/specs/2026-08-26-ai-write-actions.md §5
 */
class ActionToken
{
    /**
     * Long enough to read a diff and decide; short enough that a preview left
     * open in a tab is not still applicable after a meeting.
     */
    public const TTL_SECONDS = 300;

    /**
     * Domain separation for the derived signing key.
     *
     * The application key signs several unrelated things. Deriving a
     * purpose-specific key from it means a signature valid here can never be
     * one produced for something else, and a future use cannot accidentally
     * mint tokens this class would honour.
     */
    private const PURPOSE = 'carevance.ai.action-token.v1';

    /**
     * @param  array<string, mixed>  $plan  the previewed plan, exactly as it will execute
     * @param  array<string, mixed>  $before  the live values the preview's diff was computed against
     * @param  int  $userId  the human who will be allowed to apply it
     */
    public static function issue(array $plan, array $before, int $userId): string
    {
        $issuedAt = Carbon::now()->getTimestamp();

        $body = self::encode(json_encode([
            'plan' => $plan,
            'before' => $before,
            'uid' => $userId,
            'iat' => $issuedAt,
            'exp' => $issuedAt + self::TTL_SECONDS,
        ], JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

        return $body.'.'.self::sign($body);
    }

    /**
     * Open a token issued to this user, or null.
     *
     * @return array{plan: array<string, mixed>, before: array<string, mixed>, user_id: int, issued_at: int, expires_at: int}|null
     */
    public static function open(string $token, int $userId): ?array
    {
        $parts = explode('.', $token);

        if (count($parts) !== 2) {
            return null;
        }

        [$body, $signature] = $parts;

        if ($body === '' || $signature === '') {
            return null;
        }

        /*
         * Constant-time, and BEFORE the body is decoded. Reading a payload that
         * has not been proved authentic is how a JSON parser ends up being the
         * first thing an attacker reaches.
         */
        if (! hash_equals(self::sign($body), $signature)) {
            return null;
        }

        $json = self::decode($body);

        if ($json === null) {
            return null;
        }

        $payload = json_decode($json, true);

        if (! is_array($payload)
            || ! is_array($payload['plan'] ?? null)
            || ! is_array($payload['before'] ?? null)
            || ! is_int($payload['uid'] ?? null)
            || ! is_int($payload['iat'] ?? null)
            || ! is_int($payload['exp'] ?? null)
        ) {
            return null;
        }

        // The binding, not a hint. A valid signature over somebody else's
        // token is still somebody else's token.
        if ($payload['uid'] !== $userId) {
            return null;
        }

        if (Carbon::now()->getTimestamp() > $payload['exp']) {
            return null;
        }

        return [
            'plan' => $payload['plan'],
            'before' => $payload['before'],
            'user_id' => $payload['uid'],
            'issued_at' => $payload['iat'],
            'expires_at' => $payload['exp'],
        ];
    }

    private static function sign(string $body): string
    {
        return self::encode(hash_hmac('sha256', $body, self::signingKey(), true));
    }

    /**
     * The application key, base64 form unwrapped, run through one HMAC with the
     * purpose string.
     *
     * An empty key THROWS rather than signing with ''. Signing with no key
     * produces tokens that round-trip perfectly and that anybody who has read
     * this file can forge — a failure with no symptom, which is the worst kind
     * to leave available.
     */
    private static function signingKey(): string
    {
        $key = (string) config('app.key');

        if (str_starts_with($key, 'base64:')) {
            $decoded = base64_decode(substr($key, strlen('base64:')), true);
            $key = $decoded === false ? '' : $decoded;
        }

        if ($key === '') {
            throw new RuntimeException(
                'No application key is configured, so an AI action token cannot be signed.'
            );
        }

        return hash_hmac('sha256', self::PURPOSE, $key, true);
    }

    /** URL-safe base64, unpadded — a token travels in JSON and in logs. */
    private static function encode(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private static function decode(string $encoded): ?string
    {
        $decoded = base64_decode(strtr($encoded, '-_', '+/'), true);

        return $decoded === false ? null : $decoded;
    }
}
