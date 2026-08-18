<?php

namespace Tests\Unit;

use App\Services\Payroll\CodeOnWagesService;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/**
 * The Code on Wages s.2(y) proviso, and the 50% floor it implies.
 *
 * The rule is commonly stated as "basic must be 50% of CTC". It is neither of
 * those things: the test is on total remuneration, not cost-to-company, and it
 * is a floor on wages rather than a target for basic. Both misreadings
 * over-deduct, which is why the arithmetic is pinned here rather than left to
 * a comment.
 */
class CodeOnWagesTest extends TestCase
{
    private CodeOnWagesService $code;

    protected function setUp(): void
    {
        parent::setUp();
        $this->code = new CodeOnWagesService();
    }

    #[Test]
    public function a_compliant_structure_is_left_alone(): void
    {
        // Wages 60,000 of 100,000 remuneration — already past the floor.
        $this->assertTrue($this->code->complies(60000, 100000));
        $this->assertSame(60000.0, $this->code->statutoryWageBase(60000, 100000));
        $this->assertSame(0.0, $this->code->deemedAddition(60000, 100000));
    }

    /**
     * The proviso deems the excess into wages; it does not raise wages to
     * the whole of remuneration, and it does not leave them where they were.
     */
    #[Test]
    public function excess_allowances_are_deemed_into_wages(): void
    {
        // Wages 30,000 of 100,000. Excluded allowances are 70,000, which
        // exceeds one-half by 20,000 — so 20,000 is deemed into wages.
        $this->assertFalse($this->code->complies(30000, 100000));
        $this->assertSame(50000.0, $this->code->statutoryWageBase(30000, 100000));
        $this->assertSame(20000.0, $this->code->deemedAddition(30000, 100000));
    }

    /**
     * The base is exactly half of remuneration whenever the structure falls
     * short — never more. Deeming the *whole* excess in, rather than the part
     * above one-half, would over-deduct PF for every non-compliant employee.
     */
    #[Test]
    #[DataProvider('nonCompliantStructureProvider')]
    public function the_deemed_base_never_exceeds_half_of_remuneration(float $wages, float $remuneration): void
    {
        $base = $this->code->statutoryWageBase($wages, $remuneration);

        $this->assertEqualsWithDelta($remuneration * 0.5, $base, 0.01);
        $this->assertLessThan($remuneration, $base);
    }

    public static function nonCompliantStructureProvider(): array
    {
        return [
            'basic 40%' => [40000.0, 100000.0],
            'basic 30%' => [30000.0, 100000.0],
            'basic 25% of a low wage' => [6250.0, 25000.0],
            'basic 49.9%' => [49900.0, 100000.0],
        ];
    }

    /**
     * The base is total REMUNERATION, not CTC. Employer PF and the gratuity
     * provision are the employer's cost and are not payable to the employee, so
     * including them raises the floor against a number the employee never sees
     * — and over-deducts their PF as a result.
     */
    #[Test]
    public function the_floor_is_measured_against_remuneration_not_ctc(): void
    {
        $gross = 91600.0;      // CTC less employer PF and the gratuity provision
        $ctc = 100000.0;
        $wages = 45000.0;

        $againstGross = $this->code->statutoryWageBase($wages, $gross);
        $againstCtc = $this->code->statutoryWageBase($wages, $ctc);

        $this->assertSame(45800.0, $againstGross);
        $this->assertGreaterThan(
            $againstGross,
            $againstCtc,
            'Measuring against CTC inflates the base — the reason the parameter is named remuneration.'
        );
    }

    /**
     * Recomputing a pre-adoption month must reproduce what was actually paid.
     * Resolving the rule against today rather than against the period is how a
     * corrected March silently acquires a wage base March never had.
     */
    #[Test]
    public function the_rule_is_resolved_against_the_period_being_computed(): void
    {
        $adopted = '2026-04-01';

        $this->assertSame(CodeOnWagesService::RULE_PRE_CODE, $this->code->ruleFor($adopted, '2026-03'));
        $this->assertSame(CodeOnWagesService::RULE_CODE_ON_WAGES, $this->code->ruleFor($adopted, '2026-04'));
        $this->assertSame(CodeOnWagesService::RULE_CODE_ON_WAGES, $this->code->ruleFor($adopted, '2027-01'));

        // An organisation that has not adopted is on the old rule, whatever the
        // calendar says.
        $this->assertSame(CodeOnWagesService::RULE_PRE_CODE, $this->code->ruleFor(null, '2027-01'));
    }

    #[Test]
    public function a_pre_code_period_keeps_the_structure_wage_base(): void
    {
        $this->assertSame(
            30000.0,
            $this->code->statutoryWageBase(30000, 100000, CodeOnWagesService::RULE_PRE_CODE),
            'Before adoption the structure governs, however low basic is.'
        );
    }

    /**
     * The advisory has to name the size of the problem, not merely its
     * existence: "move 20,000 into basic" is actionable, "non-compliant" is not.
     */
    #[Test]
    public function the_assessment_names_the_amount_to_move(): void
    {
        $assessment = $this->code->assess(30000, 100000);

        $this->assertFalse($assessment['complies']);
        $this->assertSame(0.3, $assessment['wage_ratio']);
        $this->assertSame(50000.0, $assessment['statutory_wage_base']);
        $this->assertSame(20000.0, $assessment['deemed_addition']);
        $this->assertSame(20000.0, $assessment['shortfall_in_wages']);
        $this->assertStringContainsString('30.0%', $assessment['message']);
        $this->assertStringContainsString('20,000.00', $assessment['message']);
    }

    #[Test]
    public function zero_remuneration_does_not_divide_by_zero(): void
    {
        $this->assertTrue($this->code->complies(0, 0));

        $assessment = $this->code->assess(0, 0);
        $this->assertSame(0.0, $assessment['statutory_wage_base']);
        $this->assertSame(1.0, $assessment['wage_ratio']);
    }

    /**
     * The floor only ever raises the base. A structure already above 50% must
     * not be pulled down to it.
     */
    #[Test]
    #[DataProvider('compliantStructureProvider')]
    public function the_floor_never_lowers_a_compliant_base(float $wages, float $remuneration): void
    {
        $this->assertSame($wages, $this->code->statutoryWageBase($wages, $remuneration));
    }

    public static function compliantStructureProvider(): array
    {
        return [
            'exactly half' => [50000.0, 100000.0],
            'well above' => [80000.0, 100000.0],
            'all wages' => [100000.0, 100000.0],
        ];
    }

    /**
     * The audit question, end to end.
     *
     * An organisation adopting on 1 April 2026 must produce a pre-Code base for
     * March and a Code base for April, from the same structure. If the rule
     * were resolved against today instead of against the period, recomputing
     * March after adoption would hand the auditor a base March never used.
     */
    #[Test]
    public function the_same_structure_yields_different_bases_either_side_of_adoption(): void
    {
        $basic = 30000.0;
        $gross = 100000.0;
        $adopted = '2026-04-01';

        $marchRule = $this->code->ruleFor($adopted, '2026-03');
        $aprilRule = $this->code->ruleFor($adopted, '2026-04');

        $marchBase = $this->code->statutoryWageBase($basic, $gross, $marchRule);
        $aprilBase = $this->code->statutoryWageBase($basic, $gross, $aprilRule);

        $this->assertSame(30000.0, $marchBase, 'March predates adoption and keeps the structure base.');
        $this->assertSame(50000.0, $aprilBase, 'April is governed by the proviso.');

        // And each carries the label that explains itself.
        $this->assertSame(CodeOnWagesService::RULE_PRE_CODE, $marchRule);
        $this->assertSame(CodeOnWagesService::RULE_CODE_ON_WAGES, $aprilRule);
    }

    /**
     * A month whose gratuity provision keys off the statutory base rather than
     * contractual basic. This is the practical consequence: the same employee,
     * the same structure, a 67% higher provision once the Code applies.
     */
    #[Test]
    public function the_deemed_base_flows_into_the_contribution_it_governs(): void
    {
        $gratuityRate = 0.0481;

        $preCode = 30000.0 * $gratuityRate;
        $underCode = $this->code->statutoryWageBase(30000, 100000) * $gratuityRate;

        $this->assertEqualsWithDelta(1443.0, $preCode, 0.01);
        $this->assertEqualsWithDelta(2405.0, $underCode, 0.01);
        $this->assertGreaterThan($preCode, $underCode);
    }
}
