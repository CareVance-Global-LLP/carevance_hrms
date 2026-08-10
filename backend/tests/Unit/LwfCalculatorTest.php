<?php

namespace Tests\Unit;

use App\Services\Payroll\LwfCalculator;
use PHPUnit\Framework\TestCase;

/**
 * Labour Welfare Fund must be deducted from the same table the LWF return is
 * built from, and must never be guessed for a state that has no LWF Act.
 */
class LwfCalculatorTest extends TestCase
{
    private LwfCalculator $calculator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->calculator = new LwfCalculator();
    }

    public function test_monthly_state_is_charged_every_month(): void
    {
        $this->assertSame(50.0, $this->calculator->forMonth('maharashtra', 6));
        $this->assertSame(50.0, $this->calculator->forMonth('maharashtra', 11));
    }

    public function test_bi_annual_state_is_charged_only_in_its_months(): void
    {
        // Gujarat collects in January and July.
        $this->assertSame(25.0, $this->calculator->forMonth('gujarat', 1));
        $this->assertSame(25.0, $this->calculator->forMonth('gujarat', 7));
        $this->assertSame(0.0, $this->calculator->forMonth('gujarat', 6));
    }

    public function test_state_without_an_lwf_act_owes_nothing(): void
    {
        // Uttar Pradesh has no Labour Welfare Fund Act.
        $this->assertSame(0.0, $this->calculator->forMonth('uttar_pradesh', 6));
    }

    public function test_unset_state_owes_nothing_rather_than_defaulting(): void
    {
        $this->assertSame(0.0, $this->calculator->forMonth('', 6));
        $this->assertSame(0.0, $this->calculator->forMonth('not_a_state', 6));
    }

    public function test_state_code_is_case_insensitive(): void
    {
        $this->assertSame(50.0, $this->calculator->forMonth('Maharashtra', 6));
    }

    public function test_bi_annual_state_with_no_month_supplied_is_not_charged(): void
    {
        // Without a month we cannot know whether this is a collection month;
        // charging would invent a deduction.
        $this->assertSame(0.0, $this->calculator->forMonth('gujarat', null));
    }
}
