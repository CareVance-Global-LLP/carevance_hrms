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

        if (!in_array($value, timezone_identifiers_list(), true)) {
            $fail('The :attribute must be a valid timezone identifier.');
        }
    }
}
