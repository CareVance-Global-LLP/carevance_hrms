<?php

namespace Tests\Unit;

use App\Services\PayrollCalculatorService;
use Carbon\Carbon;
use PHPUnit\Framework\TestCase;

/**
 * The Indian financial year runs 1 April to 31 March, so January to March
 * belong to the previous start year. Getting this wrong applies the wrong
 * year's slabs for a quarter of every year.
 */
class FinancialYearResolutionTest extends TestCase
{
    public function test_april_starts_a_new_financial_year(): void
    {
        $this->assertSame(2025, PayrollCalculatorService::financialYearFor(Carbon::create(2025, 4, 1)));
    }

    public function test_march_still_belongs_to_the_previous_start_year(): void
    {
        // March 2026 is FY 2025-26, not FY 2026-27.
        $this->assertSame(2025, PayrollCalculatorService::financialYearFor(Carbon::create(2026, 3, 31)));
    }

    public function test_january_belongs_to_the_previous_start_year(): void
    {
        $this->assertSame(2025, PayrollCalculatorService::financialYearFor(Carbon::create(2026, 1, 15)));
    }

    public function test_december_belongs_to_the_current_start_year(): void
    {
        $this->assertSame(2025, PayrollCalculatorService::financialYearFor(Carbon::create(2025, 12, 31)));
    }

    public function test_a_future_year_still_taxes_at_the_latest_known_rates(): void
    {
        // Better a plausible figure from the most recent Finance Act we hold
        // than a silent zero because the year has no entry.
        $tax = (new PayrollCalculatorService())->calculateNewRegimeTax(2000000, []);

        $this->assertGreaterThan(0, $tax['total_tax'] ?? 0);
    }
}
