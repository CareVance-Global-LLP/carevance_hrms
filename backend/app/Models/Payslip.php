<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Payslip.
 *
 * Mirrors the `payslips` table as actually migrated:
 *   2026_03_05_130200_create_payslips_table
 *   2026_03_06_160100_add_payment_fields_to_payslips_table
 *
 * The period is stored as a single `period_month` string in 'Y-m' form —
 * there are no separate pay_month / pay_year columns. Callers that think in
 * month+year should go through periodMonth() / splitPeriod() below rather
 * than inventing columns.
 */
class Payslip extends Model
{
    use HasFactory;
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'user_id',
        'payroll_structure_id',
        'period_month',
        'currency',
        'basic_salary',
        'total_allowances',
        'total_deductions',
        'net_salary',
        'allowances',
        'deductions',
        'generated_by',
        'generated_at',
        'payment_status',
        'paid_at',
        'paid_by',
    ];

    protected $casts = [
        'allowances' => 'array',
        'deductions' => 'array',
        'basic_salary' => 'decimal:2',
        'total_allowances' => 'decimal:2',
        'total_deductions' => 'decimal:2',
        'net_salary' => 'decimal:2',
        'generated_at' => 'datetime',
        'paid_at' => 'datetime',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /**
     * The employee this payslip belongs to.
     *
     * Note: employees are `users` — there is no separate Employee model or
     * table. The previous `belongsTo(Employee::class, 'employee_id')` pointed
     * at a class that does not exist and fataled on access.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function generatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'generated_by');
    }

    public function paidBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'paid_by');
    }

    public function ytdHistory(): BelongsTo
    {
        return $this->belongsTo(PayslipYtdHistory::class, 'user_id', 'employee_id');
    }

    /**
     * Build the canonical 'Y-m' period key from a month + year pair.
     */
    public static function periodMonth(int $payMonth, int $payYear): string
    {
        return sprintf('%04d-%02d', $payYear, $payMonth);
    }

    /**
     * Split a stored 'Y-m' period back into [year, month].
     *
     * @return array{0:int,1:int}
     */
    public static function splitPeriod(string $periodMonth): array
    {
        [$year, $month] = array_pad(explode('-', $periodMonth, 2), 2, '0');

        return [(int) $year, (int) $month];
    }

    public function getPayYearAttribute(): int
    {
        return self::splitPeriod((string) $this->period_month)[0];
    }

    public function getPayMonthAttribute(): int
    {
        return self::splitPeriod((string) $this->period_month)[1];
    }

    /**
     * Human-facing reference. Derived, not stored — the previous
     * generateNumber() did an unlocked `max + 1` scan that was both racy
     * (duplicate numbers under concurrency) and unscoped by organization
     * (numbers collided across tenants). The row id is already unique and
     * monotonic, so derive rather than allocate.
     */
    public function getPayslipNumberAttribute(): string
    {
        [$year, $month] = self::splitPeriod((string) $this->period_month);

        return sprintf('PAY-%04d-%02d-%05d', $year, $month, $this->id);
    }
}
