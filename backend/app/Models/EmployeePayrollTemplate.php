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
        'basic_percentage',
        'hra_percentage',
        'conveyance_allowance',
        'medical_allowance',
        'special_allowance',
        'pf_enabled',
        'esi_enabled',
        'pt_enabled',
        'tds_enabled',
        'lwf_enabled',
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
        'is_active',
        'created_by',
        'updated_by',
    ];

    protected $casts = [
        'basic_percentage' => 'decimal:2',
        'hra_percentage' => 'decimal:2',
        'conveyance_allowance' => 'decimal:2',
        'medical_allowance' => 'decimal:2',
        'special_allowance' => 'decimal:2',
        'pf_enabled' => 'boolean',
        'esi_enabled' => 'boolean',
        'pt_enabled' => 'boolean',
        'tds_enabled' => 'boolean',
        'lwf_enabled' => 'boolean',
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
            'conveyance_allowance' => 1600.00,
            'medical_allowance' => 0,
            'special_allowance' => 0,
            'pf_enabled' => true,
            'esi_enabled' => true,
            'pt_enabled' => true,
            'tds_enabled' => true,
            'lwf_enabled' => false,
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
            $template = self::create([
                'user_id' => $userId,
                'organization_id' => $organizationId,
                'created_by' => $createdBy,
                ...self::getDefaultSettings(),
            ]);
        }

        return $template;
    }
}
