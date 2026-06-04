<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeeTaxDeclarationItem extends Model
{
    protected $fillable = [
        'declaration_id',
        'section',
        'category',
        'description',
        'declared_amount',
        'approved_amount',
        'proof_path',
        'status',
        'remarks',
    ];

    protected $casts = [
        'declared_amount' => 'decimal:2',
        'approved_amount' => 'decimal:2',
    ];

    public const SECTIONS = [
        '80C' => 'Section 80C (PPF, ELSS, Life Insurance, etc.)',
        '80CCC' => 'Section 80CCC (Pension Funds)',
        '80CCD1' => 'Section 80CCD(1) - Employee NPS',
        '80CCD1B' => 'Section 80CCD(1B) - Additional NPS (₹50K)',
        '80D' => 'Section 80D (Health Insurance)',
        '80DD' => 'Section 80DD (Disabled Dependent)',
        '80DDB' => 'Section 80DDB (Medical Treatment)',
        '80E' => 'Section 80E (Education Loan)',
        '80G' => 'Section 80G (Donations)',
        '80GG' => 'Section 80GG (Rent Paid)',
        '80TTA' => 'Section 80TTA (Savings Interest)',
        '80TTB' => 'Section 80TTB (Senior Citizens Interest)',
        '24B' => 'Section 24(b) - Home Loan Interest',
        'HRA' => 'House Rent Allowance (Exemption)',
        'LTA' => 'Leave Travel Allowance',
    ];

    public const CATEGORIES_BY_SECTION = [
        '80C' => ['PPF', 'EPF', 'ELSS', 'Life Insurance Premium', 'Tuition Fee', 'NSC', 'Fixed Deposit (5yr)', 'Sukanya Samriddhi', 'Tax Saving FDs', 'Home Loan Principal'],
        '80D' => ['Health Insurance - Self', 'Health Insurance - Family', 'Health Insurance - Parents', 'Preventive Health Checkup'],
        '80CCD1B' => ['Voluntary NPS Contribution'],
        '24B' => ['Home Loan Interest - Self Occupied', 'Home Loan Interest - Let Out'],
        'HRA' => ['Rent Paid'],
        'LTA' => ['Domestic Travel'],
        '80G' => ['Donations - 50%', 'Donations - 100%'],
    ];

    public function declaration(): BelongsTo
    {
        return $this->belongsTo(EmployeeTaxDeclaration::class, 'declaration_id');
    }
}
