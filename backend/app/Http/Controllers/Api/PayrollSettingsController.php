<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PayrollSettingsController extends Controller
{
    /**
     * Default payroll settings structure
     */
    private const DEFAULT_SETTINGS = [
        'defaultBasicPercentage' => 40,
        'defaultHraPercentage' => 50,
        'defaultConveyance' => 1600,
        /*
         * `defaultState` is deliberately ABSENT from this list.
         *
         * It used to read 'maharashtra'. getSettings() merges these defaults
         * over the org row, so an organisation that had never chosen a state
         * was told its default *was* Maharashtra — the setup wizard pre-filled
         * that answer, an admin who never opened the dropdown saved it, and
         * resetSettings() wrote it into the org row outright. From there
         * EmployeePayrollTemplate::getOrCreateForUser stamps it on every new
         * template and PayrollAutoProcessService deducts Maharashtra's slab:
         * ₹200 a month, ₹300 in February, ₹2,500 a year per head — taken from
         * people in Delhi, Haryana, Punjab or UP, which levy no professional
         * tax at all.
         *
         * The three cases are now distinguishable, and they are three
         * different statements:
         *   key absent  — nobody has answered yet
         *   key => null — answered: this organisation's state levies none
         *   key => code — that state's slabs
         * Both of the first two price at ₹0 through PTStateService, so an
         * unanswered setup under-deducts, which is correctable. Taking a tax
         * that was never owed is not.
         *
         * Do not put a state back here. If a default is ever wanted, it has
         * to come from the organisation's own registered address, not from a
         * literal in a controller.
         */
        'defaultTaxRegime' => 'new',
        'pfWageCap' => 15000,
        'esiThreshold' => 21000,
        'workingDaysPerMonth' => 26,
        /*
         * The divisor a monthly salary is spread across for loss of pay and
         * pro-ration: 'calendar' (actual days in the month), 'fixed_30' or
         * 'fixed_26'.
         *
         * Calendar is the default because Payment of Wages Act s.9(2) caps a
         * deduction for absence at the proportion the absent period bears to
         * the wage period, and it is what comparable products default to.
         * `workingDaysPerMonth` above is a different number for a different
         * job — the Minimum Wages daily rate used by overtime, gratuity and
         * leave encashment — and must not be used as the LOP divisor.
         */
        'dayBasis' => \App\Services\Payroll\PayrollDayBasisResolver::DEFAULT_BASIS,
        'pfEmployeePercentage' => 12,
        'pfEmployerPercentage' => 12,
        'esiEmployeePercentage' => 0.75,
        'esiEmployerPercentage' => 3.25,
        'pfEnabled' => true,
        'esiEnabled' => true,
        'ptEnabled' => true,
        'tdsEnabled' => true,
        'lwfEnabled' => false,
        'npsEnabled' => false,
        'npsEmployeePercentage' => 10,
        'vpfEnabled' => false,
        'vpfPercentage' => 0,
        'isMetroCity' => true,
        // Maker-checker: when true, a *different* admin must approve/release
        // a run. When null (default), it is derived from the live admin count.
        'requireSecondApprover' => null,
        // Payment of Bonus Act: applicable rate (8.33%–20%) set by finance each
        // year based on the company's allocable surplus. Used by Bonus Form C.
        'bonusPercent' => 8.33,
    ];

    /**
     * Get payroll settings for the organization
     */
    public function getSettings(Request $request): JsonResponse
    {
        $organization = $request->user()->organization;
        
        $settings = $organization->settings ?? [];
        $payrollSettings = $settings['payroll'] ?? [];
        
        // Merge with defaults
        $mergedSettings = array_merge(self::DEFAULT_SETTINGS, $payrollSettings);
        
        return response()->json([
            'success' => true,
            'settings' => $mergedSettings,
        ]);
    }

    /**
     * Update payroll settings for the organization
     */
    public function updateSettings(Request $request): JsonResponse
    {
        $request->validate([
            'defaultBasicPercentage' => 'nullable|numeric|min:0|max:100',
            'defaultHraPercentage' => 'nullable|numeric|min:0|max:100',
            'defaultConveyance' => 'nullable|numeric|min:0',
            'defaultState' => 'nullable|string',
            'defaultTaxRegime' => 'nullable|in:new,old',
            'pfWageCap' => 'nullable|numeric|min:0',
            'esiThreshold' => 'nullable|numeric|min:0',
            'workingDaysPerMonth' => 'nullable|integer|min:1|max:31',
            'dayBasis' => 'nullable|string|in:'.implode(',', \App\Services\Payroll\PayrollDayBasisResolver::SELECTABLE),
            'pfEmployeePercentage' => 'nullable|numeric|min:0|max:100',
            'pfEmployerPercentage' => 'nullable|numeric|min:0|max:100',
            'esiEmployeePercentage' => 'nullable|numeric|min:0|max:100',
            'esiEmployerPercentage' => 'nullable|numeric|min:0|max:100',
            'pfEnabled' => 'nullable|boolean',
            'esiEnabled' => 'nullable|boolean',
            'ptEnabled' => 'nullable|boolean',
            'tdsEnabled' => 'nullable|boolean',
            'lwfEnabled' => 'nullable|boolean',
            'npsEnabled' => 'nullable|boolean',
            'npsEmployeePercentage' => 'nullable|numeric|min:0|max:100',
            'vpfEnabled' => 'nullable|boolean',
            'vpfPercentage' => 'nullable|numeric|min:0|max:100',
            'isMetroCity' => 'nullable|boolean',
            'requireSecondApprover' => 'nullable|boolean',
            'bonusPercent' => 'nullable|numeric|min:8.33|max:20',
            // Compliance toggles (SetupCompliance)
            'compliance' => 'nullable|array',
            'compliance.*' => 'nullable|boolean',
            'compliance_due_dates' => 'nullable|array',
            'compliance_due_dates.*' => 'nullable|string',
            // Pay schedule (SetupPaySchedule)
            'paySchedule' => 'nullable|array',
            'paySchedule.frequency' => 'nullable|in:monthly,biweekly,weekly,daily',
            'paySchedule.payDay' => 'nullable|in:last_working_day,last_day,specific',
            'paySchedule.customPayDay' => 'nullable|integer|min:1|max:31',
            'paySchedule.cutoffDay' => 'nullable|integer|min:1|max:31',
            'paySchedule.processingBuffer' => 'nullable|integer|min:1|max:10',
            // Bank & payout (SetupBank)
            'bank' => 'nullable|array',
            'bank.bankName' => 'nullable|string|max:255',
            'bank.accountHolder' => 'nullable|string|max:255',
            'bank.accountNumber' => 'nullable|string|max:50',
            'bank.ifsc' => 'nullable|string|max:11',
            'bank.branch' => 'nullable|string|max:255',
            'bank.fileFormat' => 'nullable|string|max:50',
            'bank.payoutMode' => 'nullable|in:neft,rtgs,mixed',
            // Statutory details (SetupStatutory)
            'statutory' => 'nullable|array',
            'statutory.tan' => 'nullable|string|max:10',
            'statutory.pan' => 'nullable|string|max:10',
            'statutory.establishmentCode' => 'nullable|string|max:50',
            'statutory.esiCode' => 'nullable|string|max:17',
            'statutory.ptRegNumber' => 'nullable|string|max:50',
            'statutory.lwfRegNumber' => 'nullable|string|max:50',
        ]);

        $organization = $request->user()->organization;

        $settings = $organization->settings ?? [];
        
        // Update payroll settings
        $settings['payroll'] = array_merge(
            $settings['payroll'] ?? [],
            $request->only([
                'defaultBasicPercentage',
                'defaultHraPercentage',
                'defaultConveyance',
                'defaultState',
                'defaultTaxRegime',
                'pfWageCap',
                'esiThreshold',
                'workingDaysPerMonth',
                'dayBasis',
                'pfEmployeePercentage',
                'pfEmployerPercentage',
                'esiEmployeePercentage',
                'esiEmployerPercentage',
                'pfEnabled',
                'esiEnabled',
                'ptEnabled',
                'tdsEnabled',
                'lwfEnabled',
                'npsEnabled',
                'npsEmployeePercentage',
                'vpfEnabled',
                'vpfPercentage',
                'isMetroCity',
                'requireSecondApprover',
                'bonusPercent',
                'compliance',
                'paySchedule',
                'bank',
                'statutory',
                'compliance_due_dates',
            ])
        );
        
        $organization->settings = $settings;
        $organization->save();
        
        return response()->json([
            'success' => true,
            'message' => 'Payroll settings updated successfully',
            'settings' => $settings['payroll'],
        ]);
    }

    /**
     * Reset payroll settings to defaults
     */
    public function resetSettings(Request $request): JsonResponse
    {
        $organization = $request->user()->organization;
        
        $settings = $organization->settings ?? [];
        $settings['payroll'] = self::DEFAULT_SETTINGS;
        
        $organization->settings = $settings;
        $organization->save();

        return response()->json([
            'success' => true,
            'message' => 'Payroll settings reset to defaults',
            'settings' => self::DEFAULT_SETTINGS,
        ]);
    }

    /**
     * Apply current org settings (and optionally dept templates) to ALL existing
     * employee templates. Used by the Setup Wizard when the user changes a default
     * and wants existing employees to reflect it.
     *
     * Only updates fields that are NULL or match the *previous* defaults — never
     * overwrites values the user has explicitly customised on an employee.
     * Use ?force=true to overwrite everything.
     */
    public function applyToAllEmployees(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $force = filter_var($request->get('force'), FILTER_VALIDATE_BOOLEAN);

        $organization = \App\Models\Organization::find($organizationId);
        if (!$organization) {
            return response()->json(['message' => 'Organization not found'], 404);
        }

        $settings = is_array($organization->settings) ? $organization->settings : [];
        $payroll = $settings['payroll'] ?? [];

        $defaults = \App\Models\EmployeePayrollTemplate::getDefaultSettings();

        // Snapshot the "previous defaults" — what was considered default *before*
        // this call. Anything an employee matches here was likely just inherited,
        // not customised. (Note: this is best-effort; a perfectly-tracked override
        // log would be more accurate, but this keeps it cheap.)
        //
        // We construct the previous-default map from current org settings merged
        // on top of built-in defaults. If the admin hasn't changed org settings
        // yet, this snapshot equals the built-in defaults. If they have, we still
        // want to update rows whose values trace back to the *old* org settings.
        $previousDefaults = array_merge(
            $defaults,
            [
                'pf_employee_percentage' => $payroll['pfEmployeePercentage'] ?? $defaults['pf_employee_percentage'],
                'pf_employer_percentage' => $payroll['pfEmployerPercentage'] ?? $defaults['pf_employer_percentage'],
                'pf_wage_cap' => $payroll['pfWageCap'] ?? $defaults['pf_wage_cap'],
                'esi_employee_percentage' => $payroll['esiEmployeePercentage'] ?? $defaults['esi_employee_percentage'],
                'esi_employer_percentage' => $payroll['esiEmployerPercentage'] ?? $defaults['esi_employer_percentage'],
                'esi_threshold' => $payroll['esiThreshold'] ?? $defaults['esi_threshold'],
                'basic_percentage' => $payroll['defaultBasicPercentage'] ?? $defaults['basic_percentage'],
                'hra_percentage' => $payroll['defaultHraPercentage'] ?? $defaults['hra_percentage'],
                'conveyance_allowance' => $payroll['defaultConveyance'] ?? $defaults['conveyance_allowance'],
                // EmployeePayrollTemplate::getDefaultSettings() carries no
                // pt_state on purpose, so there is nothing to fall back to.
                // null here means "this org has not named a state", which the
                // array_filter below turns into "leave every template's
                // pt_state alone" rather than "stamp one on everybody".
                'pt_state' => $payroll['defaultState'] ?? null,
                'tax_regime' => $payroll['defaultTaxRegime'] ?? $defaults['tax_regime'],
                'is_metro_city' => $payroll['isMetroCity'] ?? $defaults['is_metro_city'],
                'pf_enabled' => $payroll['pfEnabled'] ?? $defaults['pf_enabled'],
                'esi_enabled' => $payroll['esiEnabled'] ?? $defaults['esi_enabled'],
                'pt_enabled' => $payroll['ptEnabled'] ?? $defaults['pt_enabled'],
                'tds_enabled' => $payroll['tdsEnabled'] ?? $defaults['tds_enabled'],
                'lwf_enabled' => $payroll['lwfEnabled'] ?? $defaults['lwf_enabled'],
                'nps_enabled' => $payroll['npsEnabled'] ?? $defaults['nps_enabled'],
                'nps_employee_percentage' => $payroll['npsEmployeePercentage'] ?? $defaults['nps_employee_percentage'],
                'vpf_enabled' => $payroll['vpfEnabled'] ?? $defaults['vpf_enabled'],
                'vpf_percentage' => $payroll['vpfPercentage'] ?? $defaults['vpf_percentage'],
            ]
        );

        // The new values that will replace them (current org settings → built-ins).
        $newValues = [
            'pf_employee_percentage' => $payroll['pfEmployeePercentage'] ?? $defaults['pf_employee_percentage'],
            'pf_employer_percentage' => $payroll['pfEmployerPercentage'] ?? $defaults['pf_employer_percentage'],
            'pf_wage_cap' => $payroll['pfWageCap'] ?? $defaults['pf_wage_cap'],
            'esi_employee_percentage' => $payroll['esiEmployeePercentage'] ?? $defaults['esi_employee_percentage'],
            'esi_employer_percentage' => $payroll['esiEmployerPercentage'] ?? $defaults['esi_employer_percentage'],
            'esi_threshold' => $payroll['esiThreshold'] ?? $defaults['esi_threshold'],
            'basic_percentage' => $payroll['defaultBasicPercentage'] ?? $defaults['basic_percentage'],
            'hra_percentage' => $payroll['defaultHraPercentage'] ?? $defaults['hra_percentage'],
            'conveyance_allowance' => $payroll['defaultConveyance'] ?? $defaults['conveyance_allowance'],
            'pt_state' => $payroll['defaultState'] ?? null,
            'tax_regime' => $payroll['defaultTaxRegime'] ?? $defaults['tax_regime'],
            'is_metro_city' => $payroll['isMetroCity'] ?? $defaults['is_metro_city'],
            'pf_enabled' => $payroll['pfEnabled'] ?? $defaults['pf_enabled'],
            'esi_enabled' => $payroll['esiEnabled'] ?? $defaults['esi_enabled'],
            'pt_enabled' => $payroll['ptEnabled'] ?? $defaults['pt_enabled'],
            'tds_enabled' => $payroll['tdsEnabled'] ?? $defaults['tds_enabled'],
            'lwf_enabled' => $payroll['lwfEnabled'] ?? $defaults['lwf_enabled'],
            'nps_enabled' => $payroll['npsEnabled'] ?? $defaults['nps_enabled'],
            'nps_employee_percentage' => $payroll['npsEmployeePercentage'] ?? $defaults['nps_employee_percentage'],
            'vpf_enabled' => $payroll['vpfEnabled'] ?? $defaults['vpf_enabled'],
            'vpf_percentage' => $payroll['vpfPercentage'] ?? $defaults['vpf_percentage'],
        ];

        // Filter out null values so we don't overwrite with null.
        $updates = array_filter($newValues, fn ($v) => $v !== null);

        $query = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId);

        if (! $force) {
            // Eligible if EITHER:
            //   - the column is NULL (never set, definitely safe to overwrite), OR
            //   - the column equals the *previous* default (inherited, not customised)
            //
            // We protect user-customised values by leaving them alone.
            $skipMeta = ['user_id', 'organization_id', 'created_by', 'updated_by', 'created_at', 'updated_at', 'id', 'annual_ctc'];
            $query->where(function ($q) use ($previousDefaults, $skipMeta) {
                $first = true;
                foreach ($previousDefaults as $field => $prevValue) {
                    if (in_array($field, $skipMeta, true)) {
                        continue;
                    }
                    $q->where(function ($sub) use ($field, $prevValue) {
                        $sub->whereNull($field)
                            ->orWhere($field, '=', $prevValue);
                    });
                    if ($first) {
                        $first = false;
                    }
                }
            });
        }

        $affected = $query->update($updates);

        return response()->json([
            'success' => true,
            'message' => "Applied org settings to {$affected} employee templates",
            'affected_count' => $affected,
            'force' => (bool) $force,
            'applied_fields' => array_keys($updates),
        ]);
    }
}
