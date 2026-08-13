<?php

namespace App\Http\Requests\Api\Settings;

use App\Http\Requests\Api\ApiFormRequest;
use App\Rules\ValidTimezone;
use App\Services\Monitoring\MonitoringSettingsResolver;
use App\Services\Monitoring\TrackerPolicyResolver;
use Illuminate\Validation\Rule;

class UpdateOrganizationRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'name' => 'required|string|max:255',
            'slug' => 'required|string|max:255',
            'office_start_time' => ['nullable', 'string', 'regex:/^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$/'],
            'late_after_time' => ['nullable', 'string', 'regex:/^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$/'],
            'logo_file' => 'nullable|file|image|max:2048',
            'leave_categories' => 'nullable|array|max:15',
            'leave_categories.*.code' => 'required_with:leave_categories|string|max:50',
            'leave_categories.*.name' => 'required_with:leave_categories|string|max:120',
            'leave_categories.*.annual_quota' => 'required_with:leave_categories|numeric|min:0|max:366',
            'leave_categories_json' => 'nullable|string',
            'timezone' => ['nullable', 'string', 'max:255', new ValidTimezone],

            /*
             * The company profile.
             *
             * These columns existed from the start but had no write path outside
             * signup and no read path at all, so nobody could ever correct what
             * they typed. They matter at conversion: the address is what the
             * invoice is raised against, and `size` seeds the seat count we
             * suggest when a trial converts. All optional — the payment flow is
             * what insists on the address, and only when money is about to move.
             */
            'description' => 'nullable|string|max:1000',
            'website' => 'nullable|url|max:255',
            'industry' => 'nullable|string|max:100',
            'size' => ['nullable', 'string', Rule::in(['1-10', '11-50', '51-200', '201-500', '500+'])],
            'phone' => 'nullable|string|max:20',
            'org_email' => 'nullable|email|max:255',
            'address_line' => 'nullable|string|max:255',
            'city' => 'nullable|string|max:100',
            'state' => 'nullable|string|max:100',
            'postal_code' => 'nullable|string|max:20',
            'country' => 'nullable|string|max:100',
            // Organization-wide screenshot capture default. null clears it, so
            // users fall through to the system default.
            'monitoring_interval_minutes' => [
                'nullable',
                'integer',
                Rule::in(app(MonitoringSettingsResolver::class)->allowedIntervals()),
            ],

            /*
             * Idle policy, per organization.
             *
             * There is no single correct idle threshold — a support desk and a
             * research team disagree about what five minutes of no input means.
             * Rather than picking a number for everyone, each organization sets
             * its own; null clears the override and falls back to the system
             * default. The bounds are the same ones TrackerPolicyResolver
             * enforces, so an out-of-range value is rejected at the edge with a
             * readable message instead of being silently discarded later.
             */
            'idle_track_threshold_seconds' => 'nullable|integer|min:60|max:3600',
            'idle_auto_stop_threshold_seconds' => 'nullable|integer|min:300|max:3600',
            'lock_auto_stop_threshold_seconds' => 'nullable|integer|min:60|max:3600',
            /*
             * What happens to idle time when someone returns. Null clears the
             * override so the organization falls back to prompting, which is
             * the only option that does not change a timesheet without asking.
             */
            'idle_resolution_policy' => ['nullable', Rule::in([
                TrackerPolicyResolver::IDLE_POLICY_PROMPT,
                TrackerPolicyResolver::IDLE_POLICY_ALWAYS_KEEP,
                TrackerPolicyResolver::IDLE_POLICY_NEVER_KEEP,
            ])],

            /*
             * Whether an employee may delete their own screenshots.
             *
             * Off unless an organization turns it on: enabling it by default
             * would hand every existing customer a way to erase tracked time
             * without them ever asking for it. Deletion is coupled to the
             * worked minutes it covers, so it can never be used to drop the
             * evidence while keeping the pay.
             */
            /*
             * Whether the people being tracked may see their own record at all.
             * Off unless an organization turns it on.
             */
            'employee_activity_visible' => 'nullable|boolean',
            'screenshot_employee_delete' => 'nullable|boolean',
            'screenshot_retention_days' => 'nullable|integer|min:7|max:730',
        ];
    }
}
