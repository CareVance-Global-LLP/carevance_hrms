<?php

namespace App\Http\Requests\Api\Auth;

use App\Http\Requests\Api\ApiFormRequest;
use Illuminate\Validation\Rule;

class SignupOwnerRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'company_name' => 'nullable|string|max:255',
            'organization_name' => 'nullable|string|max:255',
            'name' => 'required|string|max:255',
            'email' => 'required|string|email|max:255',
            'password' => 'required|string|min:8|confirmed',
            'plan_code' => ['nullable', 'string', Rule::in(array_keys(config('carevance.plans', [])))],
            'billing_cycle' => ['nullable', 'string', Rule::in(['monthly', 'yearly'])],
            'signup_mode' => ['nullable', 'string', Rule::in(['trial', 'paid'])],
            'seats' => ['nullable', 'integer', 'min:5', 'max:1000'],
            'terms_accepted' => 'required|accepted',
            'role' => ['nullable', 'string', Rule::in(['admin'])],
            // Organization profile fields
            'description' => 'nullable|string|max:1000',
            'website' => 'nullable|url|max:255',
            'industry' => 'nullable|string|max:100',
            'size' => 'nullable|string|max:50',
            'phone' => 'nullable|string|max:20',
            'org_email' => 'nullable|email|max:255',
            'address_line' => 'nullable|string|max:255',
            'city' => 'nullable|string|max:100',
            'state' => 'nullable|string|max:100',
            'postal_code' => 'nullable|string|max:20',
            'country' => 'nullable|string|max:100',
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator) {
            if (!filled($this->input('company_name')) && !filled($this->input('organization_name'))) {
                $validator->errors()->add('company_name', 'Company name is required.');
            }
        });
    }
}
