<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

class ValidTimezone implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if ($value === null || $value === '') {
            return;
        }

        // Accept if it's in PHP's official timezone list
        if (in_array($value, timezone_identifiers_list(), true)) {
            return;
        }

        // Also accept common IANA timezone formats that JavaScript might send
        // but PHP might not recognize (e.g., some deprecated or newer timezones)
        // Pattern: Region/City or Region/Subregion/City
        if (preg_match('/^[A-Za-z_]+(\/[A-Za-z_]+)+$/', $value)) {
            return;
        }

        // Accept UTC offset formats like "UTC+5", "UTC-8", "UTC+5:30"
        if (preg_match('/^UTC[+-]\d{1,2}(:\d{2})?$/', $value)) {
            return;
        }

        $fail('The :attribute must be a valid timezone identifier.');
    }
}
