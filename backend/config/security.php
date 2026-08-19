<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Blind index key
    |--------------------------------------------------------------------------
    |
    | HMAC key for the deterministic lookup columns beside encrypted PII
    | (PAN, Aadhaar, UAN, ESI, bank account numbers). See App\Support\BlindIndex.
    |
    | This key is NOT interchangeable with APP_KEY and must not be rotated
    | casually: changing it invalidates every stored index and requires a
    | decrypt-and-rewrite pass over every row to rebuild. APP_KEY, by contrast,
    | can be rotated normally using APP_PREVIOUS_KEYS.
    |
    | Left unset, the index falls back to APP_KEY so that an index is still
    | keyed rather than a bare hash — a safety net, not a recommendation.
    |
    */

    'pii_index_key' => env('PII_INDEX_KEY', ''),

];
