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
        'defaultState' => 'maharashtra',
        'defaultTaxRegime' => 'new',
        'pfWageCap' => 15000,
        'esiThreshold' => 21000,
        'workingDaysPerMonth' => 26,
        'pfEmployeePercentage' => 12,
        'pfEmployerPercentage' => 12,
        'esiEmployeePercentage' => 0.75,
        'esiEmployerPercentage' => 3.25,
        'pfEnabled' => true,
        'esiEnabled' => true,
        'ptEnabled' => true,
        'tdsEnabled' => true,
        'lwfEnabled' => false,
        'isMetroCity' => true,
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
            'pfEmployeePercentage' => 'nullable|numeric|min:0|max:100',
            'pfEmployerPercentage' => 'nullable|numeric|min:0|max:100',
            'esiEmployeePercentage' => 'nullable|numeric|min:0|max:100',
            'esiEmployerPercentage' => 'nullable|numeric|min:0|max:100',
            'pfEnabled' => 'nullable|boolean',
            'esiEnabled' => 'nullable|boolean',
            'ptEnabled' => 'nullable|boolean',
            'tdsEnabled' => 'nullable|boolean',
            'lwfEnabled' => 'nullable|boolean',
            'isMetroCity' => 'nullable|boolean',
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
                'pfEmployeePercentage',
                'pfEmployerPercentage',
                'esiEmployeePercentage',
                'esiEmployerPercentage',
                'pfEnabled',
                'esiEnabled',
                'ptEnabled',
                'tdsEnabled',
                'lwfEnabled',
                'isMetroCity',
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
}
