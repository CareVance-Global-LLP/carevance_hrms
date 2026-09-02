<?php

namespace Tests\Feature;

use App\Support\LoanSchedule;
use InvalidArgumentException;
use Tests\TestCase;

/**
 * Two of amount, EMI and instalments must always determine the third.
 *
 * The loan form took all three as free text, so a ₹40,000 loan could be stored
 * as ₹6,000 over four instalments — ₹24,000 of schedule against ₹40,000 of debt,
 * with nothing anywhere noticing the ₹16,000 that would never be collected.
 */
class LoanScheduleTest extends TestCase
{
    public function test_an_uneven_amount_rounds_up_to_a_whole_number_of_payments(): void
    {
        // 40,000 / 6,000 = 6.67 — which is not a number of payments.
        $this->assertSame(7, LoanSchedule::instalmentsFor(40000, 6000));
    }

    public function test_the_final_payment_is_the_remainder_not_a_full_emi(): void
    {
        // Six at 6,000 is 36,000; the tail is the 4,000 that is left.
        $this->assertSame(4000.0, LoanSchedule::finalInstalmentFor(40000, 6000));
    }

    public function test_an_exact_division_leaves_a_final_payment_equal_to_the_emi(): void
    {
        $this->assertSame(4, LoanSchedule::instalmentsFor(40000, 10000));
        $this->assertSame(10000.0, LoanSchedule::finalInstalmentFor(40000, 10000));

        $schedule = LoanSchedule::fromEmi(40000, 10000);
        $this->assertFalse(
            $schedule['has_smaller_final'],
            'an exact division has no smaller tail to warn anybody about'
        );
    }

    public function test_choosing_instalments_gives_back_an_emi_that_clears_the_loan(): void
    {
        $this->assertSame(10000.0, LoanSchedule::emiFor(40000, 4));

        // The round trip must not lose money: EMI x instalments >= amount.
        $emi = LoanSchedule::emiFor(40000, 7);
        $this->assertGreaterThanOrEqual(40000, $emi * 7);
        $this->assertSame(5714.29, $emi);
    }

    public function test_the_emi_rounds_up_so_a_residue_never_adds_a_month(): void
    {
        // 10,000 / 3 = 3333.33... Rounding DOWN would leave a paisa outstanding
        // and turn a three-month loan into a four-month one.
        $emi = LoanSchedule::emiFor(10000, 3);

        $this->assertSame(3333.34, $emi);
        $this->assertSame(
            3,
            LoanSchedule::instalmentsFor(10000, $emi),
            'the derived EMI must clear the loan in exactly the months asked for'
        );
    }

    public function test_an_emi_larger_than_the_loan_is_a_single_payment(): void
    {
        $this->assertSame(1, LoanSchedule::instalmentsFor(5000, 6000));
        $this->assertSame(
            5000.0,
            LoanSchedule::finalInstalmentFor(5000, 6000),
            'nobody should be charged more than they borrowed'
        );
    }

    public function test_the_whole_schedule_reads_the_same_from_either_direction(): void
    {
        $fromEmi = LoanSchedule::fromEmi(40000, 10000);
        $fromCount = LoanSchedule::fromInstalments(40000, 4);

        $this->assertSame($fromEmi, $fromCount);
    }

    public function test_it_refuses_nonsense_rather_than_returning_it(): void
    {
        $this->expectException(InvalidArgumentException::class);
        LoanSchedule::instalmentsFor(40000, 0);
    }

    public function test_it_refuses_more_instalments_than_the_api_allows(): void
    {
        $this->expectException(InvalidArgumentException::class);
        LoanSchedule::emiFor(40000, 61);
    }
}
