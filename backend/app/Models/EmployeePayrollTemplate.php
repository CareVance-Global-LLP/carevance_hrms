<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeePayrollTemplate extends Model
{
    protected $table = 'employee_payroll_templates';
    
    protected $fillable = [
        'organization_id',
        'user_id',
        'annual_ctc',
        'basic_percentage',
        'hra_percentage',
        'da_percentage',
        'conveyance_allowance',
        'medical_allowance',
        'special_allowance',
        'cca_amount',
        'education_allowance',
        'hostel_allowance',
        'internet_allowance',
        'meal_allowance',
        'transport_allowance',
        'uniform_allowance',
        'books_periodicals',
        'fuel_maintenance',
        'pf_enabled',
        'esi_enabled',
        'pt_enabled',
        'tds_enabled',
        'lwf_enabled',
        'nps_enabled',
        'nps_employee_percentage',
        'vpf_enabled',
        'vpf_percentage',
        'pf_employee_percentage',
        'pf_employer_percentage',
        'pf_wage_cap',
        'pf_above_cap',
        'esi_employee_percentage',
        'esi_employer_percentage',
        'esi_threshold',
        'pt_state',
        'tax_regime',
        'is_metro_city',
        'custom_earnings',
        'custom_deductions',
        'component_settings',
        'is_active',
        'created_by',
        'updated_by',
    ];

    protected $casts = [
        'basic_percentage' => 'decimal:2',
        'hra_percentage' => 'decimal:2',
        'da_percentage' => 'decimal:2',
        'conveyance_allowance' => 'decimal:2',
        'medical_allowance' => 'decimal:2',
        'special_allowance' => 'decimal:2',
        'cca_amount' => 'decimal:2',
        'education_allowance' => 'decimal:2',
        'hostel_allowance' => 'decimal:2',
        'internet_allowance' => 'decimal:2',
        'meal_allowance' => 'decimal:2',
        'transport_allowance' => 'decimal:2',
        'uniform_allowance' => 'decimal:2',
        'books_periodicals' => 'decimal:2',
        'fuel_maintenance' => 'decimal:2',
        'pf_enabled' => 'boolean',
        'esi_enabled' => 'boolean',
        'pt_enabled' => 'boolean',
        'tds_enabled' => 'boolean',
        'lwf_enabled' => 'boolean',
        'nps_enabled' => 'boolean',
        'nps_employee_percentage' => 'decimal:2',
        'vpf_enabled' => 'boolean',
        'vpf_percentage' => 'decimal:2',
        'pf_employee_percentage' => 'decimal:2',
        'pf_employer_percentage' => 'decimal:2',
        'pf_wage_cap' => 'decimal:2',
        'pf_above_cap' => 'boolean',
        'esi_employee_percentage' => 'decimal:2',
        'esi_employer_percentage' => 'decimal:2',
        'esi_threshold' => 'decimal:2',
        'is_metro_city' => 'boolean',
        'custom_earnings' => 'array',
        'custom_deductions' => 'array',
        'component_settings' => 'array',
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function updatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    /**
     * Get default template settings
     */
    public static function getDefaultSettings(): array
    {
        return [
            'basic_percentage' => 40.00,
            'hra_percentage' => 50.00,
            'da_percentage' => 0,
            'conveyance_allowance' => 1600.00,
            'medical_allowance' => 0,
            'special_allowance' => 0,
            'cca_amount' => 0,
            'education_allowance' => 0,
            'hostel_allowance' => 0,
            'internet_allowance' => 0,
            'meal_allowance' => 0,
            'transport_allowance' => 0,
            'uniform_allowance' => 0,
            'books_periodicals' => 0,
            'fuel_maintenance' => 0,
            'pf_enabled' => true,
            'esi_enabled' => true,
            'pt_enabled' => true,
            'tds_enabled' => true,
            'lwf_enabled' => false,
            'nps_enabled' => false,
            'nps_employee_percentage' => 10.00,
            'vpf_enabled' => false,
            'vpf_percentage' => 0,
            'pf_employee_percentage' => 12.00,
            'pf_employer_percentage' => 12.00,
            'pf_wage_cap' => 15000.00,
            'pf_above_cap' => false,
            'esi_employee_percentage' => 0.75,
            'esi_employer_percentage' => 3.25,
            'esi_threshold' => 21000.00,
            'tax_regime' => 'new',
            'is_metro_city' => true,
            'custom_earnings' => [],
            'custom_deductions' => [],
            'component_settings' => [],
        ];
    }

    /**
     * Create or update template for user
     */
    public static function getOrCreateForUser(int $userId, int $organizationId, ?int $createdBy = null): self
    {
        $template = self::where('user_id', $userId)
            ->where('organization_id', $organizationId)
            ->first();

        if (!$template) {
            // Get organization settings
            $organization = \App\Models\Organization::find($organizationId);
            $orgSettings = $organization?->settings['payroll'] ?? [];
            
            // Merge default settings with organization settings
            $settings = array_merge(
                self::getDefaultSettings(),
                [
                    'basic_percentage' => $orgSettings['defaultBasicPercentage'] ?? 40.00,
                    'hra_percentage' => $orgSettings['defaultHraPercentage'] ?? 50.00,
                    'conveyance_allowance' => $orgSettings['defaultConveyance'] ?? 1600.00,
                    'pf_employee_percentage' => $orgSettings['pfEmployeePercentage'] ?? 12.00,
                    'pf_employer_percentage' => $orgSettings['pfEmployerPercentage'] ?? 12.00,
                    'pf_wage_cap' => $orgSettings['pfWageCap'] ?? 15000.00,
                    'esi_employee_percentage' => $orgSettings['esiEmployeePercentage'] ?? 0.75,
                    'esi_employer_percentage' => $orgSettings['esiEmployerPercentage'] ?? 3.25,
                    'esi_threshold' => $orgSettings['esiThreshold'] ?? 21000.00,
                    'pt_state' => $orgSettings['defaultState'] ?? 'maharashtra',
                    'tax_regime' => $orgSettings['defaultTaxRegime'] ?? 'new',
                    'is_metro_city' => $orgSettings['isMetroCity'] ?? true,
                    'pf_enabled' => $orgSettings['pfEnabled'] ?? true,
                    'esi_enabled' => $orgSettings['esiEnabled'] ?? true,
                    'pt_enabled' => $orgSettings['ptEnabled'] ?? true,
                    'tds_enabled' => $orgSettings['tdsEnabled'] ?? true,
                    'lwf_enabled' => $orgSettings['lwfEnabled'] ?? false,
                ]
            );
            
            $template = self::create([
                'user_id' => $userId,
                'organization_id' => $organizationId,
                'created_by' => $createdBy,
                ...$settings,
            ]);
        }

        return $template;
    }
}
