<?php

namespace App\Support;

use Illuminate\Support\Facades\Config;

/**
 * Deterministic, keyed lookup values for encrypted columns.
 *
 * Encrypting PAN or a bank account number makes `where('pan_number', $pan)`
 * stop matching: Laravel's encryption is randomised, so the same input yields
 * different ciphertext every time — which is exactly what you want for secrecy
 * and exactly what breaks equality lookups. A blind index is the standard
 * answer: store, beside the ciphertext, a deterministic HMAC of the normalised
 * value, and search on that instead.
 *
 * Keyed, not a bare hash. There are only 10^10-ish plausible PANs and far
 * fewer for a given name, so an unkeyed SHA-256 column is a rainbow table
 * somebody else has already computed. HMAC with a secret the database dump
 * does not contain removes that.
 *
 * Two consequences worth stating plainly:
 *
 *  - The index key must NOT rotate casually. Changing it invalidates every
 *    stored index and requires a full reindex, which needs the plaintext —
 *    i.e. a decrypt-and-rewrite pass over every row. That is why it is its own
 *    key rather than APP_KEY, which is expected to rotate and which Laravel
 *    supports rotating through APP_PREVIOUS_KEYS.
 *  - Equal values produce equal indexes, so this leaks "these two employees
 *    have the same PAN". That is a property we actively want: it is how
 *    duplicate-PAN detection works at all, and duplicates are a real problem
 *    on this data — 15 employees carry two PAN rows with different values.
 */
class BlindIndex
{
    /**
     * The stored index for a value, or null when there is nothing to index.
     *
     * Normalisation is part of the contract: trimmed and upper-cased, because
     * the queries this replaces did exactly that — `UPPER(TRIM(id_number))`.
     * An index computed differently from the query that reads it silently
     * matches nothing, so both sides must come through here.
     */
    public static function of(?string $value): ?string
    {
        $normalised = self::normalise($value);

        if ($normalised === null) {
            return null;
        }

        return hash_hmac('sha256', $normalised, self::key());
    }

    public static function normalise(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $normalised = strtoupper(trim($value));

        return $normalised === '' ? null : $normalised;
    }

    /**
     * The HMAC key.
     *
     * Falls back to APP_KEY so that a deployment which has not yet set the
     * dedicated key still gets a keyed index rather than a bare hash. That
     * fallback is a safety net, not a recommendation: PII_INDEX_KEY should be
     * set explicitly and kept out of the same store as the database.
     */
    private static function key(): string
    {
        $key = (string) Config::get('security.pii_index_key');

        if ($key !== '') {
            return $key;
        }

        return (string) Config::get('app.key');
    }
}
