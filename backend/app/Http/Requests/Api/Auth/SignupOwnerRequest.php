<?php

namespace App\Http\Requests\Api\Auth;

use App\Http\Requests\Api\ApiFormRequest;
use App\Services\Billing\PlanService;
use Illuminate\Validation\Rules\Password;
use App\Rules\ValidTimezone;
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
            'password' => ['required', 'string', 'confirmed', Password::defaults()],
            'plan_code' => ['nullable', 'string', Rule::in(array_keys(config('carevance.plans', [])))],
            'billing_cycle' => ['nullable', 'string', Rule::in(['monthly', 'yearly'])],
            'signup_mode' => ['nullable', 'string', Rule::in(['trial', 'paid'])],
            'trial_plan' => ['nullable', 'string', Rule::in(PlanService::TRIAL_PLANS)],
            'trial_type' => ['nullable', 'string', Rule::in(['tracking', 'payroll'])], // Alternative parameter
            'seats' => ['nullable', 'integer', 'min:5', 'max:1000'],
            'terms_accepted' => 'required|accepted',
            'role' => ['nullable', 'string', Rule::in(['admin'])],
            // The company profile is no longer collected on the signup form —
            // it is gathered in-product through the setup checklist, where it
            // also has a screen to be read back from. These rules stay for the
            // super-admin path and older clients; every one is nullable, so a
            // payload without them is valid.
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
            'timezone' => ['nullable', 'string', 'max:255', new ValidTimezone],
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
