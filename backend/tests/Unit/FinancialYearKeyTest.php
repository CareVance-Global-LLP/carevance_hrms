<?php

namespace Tests\Unit;

use App\Services\PayrollCalculatorService;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * One canonical financial-year key, whatever spelling arrives.
 *
 * employee_tax_declarations.financial_year was found holding '2025-26',
 * '2026-2027', '2026' and '2026-27' for the same concept, because every write
 * path formatted it however it liked. The tax engine looks declarations up
 * with an exact string match, so 17 of 102 rows were unreachable — and an
 * approved declaration that cannot be found reduces nobody's tax.
 */
class FinancialYearKeyTest extends TestCase
{
    #[DataProvider('spellings')]
    public function test_every_spelling_collapses_to_one_key(string $input, string $expected): void
    {
        $this->assertSame($expected, PayrollCalculatorService::financialYearKey($input));
    }

    /** @return array<string, array{string, string}> */
    public static function spellings(): array
    {
        return [
            'already canonical' => ['2026-27', '2026-27'],
            'four digit second half' => ['2026-2027', '2026-27'],
            'bare starting year' => ['2026', '2026-27'],
            'slash separated' => ['2026/27', '2026-27'],
            'FY prefix' => ['FY2026-27', '2026-27'],
            'FY prefix with space' => ['FY 2026-27', '2026-27'],
            'lowercase fy prefix' => ['fy2026-2027', '2026-27'],
            'surrounding whitespace' => ['  2026-27  ', '2026-27'],
            'previous year stays distinct' => ['2025-26', '2025-26'],
            'century rollover' => ['2099-2100', '2099-00'],
        ];
    }

    public function test_the_second_half_is_derived_not_trusted(): void
    {
        // '2026-30' is not a financial year anyone means. Deriving the second
        // half from the first is what makes every spelling land on one key.
        $this->assertSame('2026-27', PayrollCalculatorService::financialYearKey('2026-30'));
    }

    public function test_an_unrecognised_value_is_returned_untouched(): void
    {
        // A lookup that finds nothing is recoverable. A lookup that silently
        // finds the wrong year's declarations is not, so nothing is guessed.
        $this->assertSame('not-a-year', PayrollCalculatorService::financialYearKey('not-a-year'));
        $this->assertSame('', PayrollCalculatorService::financialYearKey(''));
    }

    public function test_it_agrees_with_the_current_financial_year_helper(): void
    {
        // The two must produce the same shape or the lookup misses again.
        $current = (new PayrollCalculatorService())->getCurrentFinancialYear();

        $this->assertSame($current, PayrollCalculatorService::financialYearKey($current));
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}$/', $current);
    }
}
