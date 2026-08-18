<?php

namespace Tests\Feature;

use App\Services\PayrollCalculatorService;
use App\Services\PTStateService;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * There is one income tax engine, and one professional tax source.
 *
 * Four tax engines coexisted. For the same employee in the same month they
 * disagreed on the slabs, the rebate and the standard deduction:
 *
 *   A  PayrollCalculatorService  — correct: 87A on taxable income with
 *                                  marginal relief, contiguous surcharge bands
 *   B  SalaryCalculationService  — a flat 5% of anything over 2.5L
 *   C  PayrollFilingController   — FY 2024-25 slabs, no 87A, no surcharge,
 *                                  caller-applied cess, and a standard
 *                                  deduction hardcoded at 75,000 for BOTH
 *                                  regimes where the old regime's is 50,000
 *   D  TaxSimulatorService       — orphaned, and double-counted the 4% cess
 *
 * B and C are now delegations, D is deleted. This suite exists so a fifth
 * cannot quietly appear: every vendor in this market — Keka, Zoho, greytHR —
 * resolves the regime comparison and the payroll run from one computation,
 * because an employee elects their regime on the comparison screen and s.115BAC
 * makes that election consequential.
 */
class SingleTaxEngineTest extends TestCase
{
    /**
     * Slab tables live in exactly one class. A file that hardcodes the slab
     * boundaries is by definition a second engine.
     */
    #[Test]
    public function only_one_class_defines_income_tax_slabs(): void
    {
        // The new-regime boundaries. Any file spelling these out is deciding
        // tax for itself rather than asking the engine.
        $slabSignature = '/(?<![\d.])300000(?![\d.])(?:[^;]|\n){0,400}?(?<![\d.])700000(?![\d.])/';

        $offenders = [];

        foreach ($this->phpFilesIn(app_path()) as $file) {
            if (basename($file) === 'PayrollCalculatorService.php') {
                continue;
            }

            if (preg_match($slabSignature, $this->sourceWithoutComments($file))) {
                $offenders[] = str_replace(base_path().DIRECTORY_SEPARATOR, '', $file);
            }
        }

        $this->assertSame(
            [],
            $offenders,
            "These files carry their own income tax slabs. PayrollCalculatorService is the engine; "
            ."call it instead:\n  ".implode("\n  ", $offenders)
        );
    }

    /**
     * The reason C had to go, expressed as arithmetic rather than as a rule.
     *
     * C subtracted a 75,000 standard deduction for both regimes. The old
     * regime's is 50,000, so C's taxable income was 25,000 too low for every
     * old-regime employee, before any slab was reached.
     */
    #[Test]
    public function the_two_regimes_do_not_share_a_standard_deduction(): void
    {
        $this->assertNotSame(
            PayrollCalculatorService::STANDARD_DEDUCTION_OLD,
            PayrollCalculatorService::STANDARD_DEDUCTION_NEW,
            'If these ever converge, remove this test — until then, no caller may hardcode one for both.'
        );

        $this->assertSame(50000, PayrollCalculatorService::STANDARD_DEDUCTION_OLD);
        $this->assertSame(75000, PayrollCalculatorService::STANDARD_DEDUCTION_NEW);
    }

    /**
     * Professional tax is state-levied. A national slab table is wrong for
     * every employee: it invents a tax in the states that levy none, and gets
     * the amount wrong in the ones that do.
     *
     * The table removed from PayrollFilingController topped out at 6,000 a
     * year — 2.4x the Article 276(2) ceiling that binds every state and UT.
     */
    #[Test]
    public function professional_tax_resolves_through_one_state_aware_source(): void
    {
        // A state that does not levy it deducts nothing, whatever the salary.
        $this->assertSame(0.0, PTStateService::calculate('delhi', 500000));

        // An unknown or unset state must not fall back to a real one.
        $this->assertSame(0.0, PTStateService::calculate('', 500000));
        $this->assertSame(0.0, PTStateService::calculate('atlantis', 500000));

        // And no jurisdiction may exceed the constitutional ceiling — the
        // property the removed national table violated by 2.4x.
        foreach (PTStateService::getStates() as $state) {
            $this->assertLessThanOrEqual(
                2500.0,
                PTStateService::getAnnualLimit($state['code']),
                "{$state['code']} exceeds the Article 276(2) ceiling"
            );
        }
    }

    private function sourceWithoutComments(string $file): string
    {
        $source = '';

        foreach (token_get_all(file_get_contents($file)) as $token) {
            if (is_array($token)) {
                if ($token[0] === T_COMMENT || $token[0] === T_DOC_COMMENT) {
                    continue;
                }

                $source .= $token[1];

                continue;
            }

            $source .= $token;
        }

        return $source;
    }

    /** @return list<string> */
    private function phpFilesIn(string $directory): array
    {
        $files = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($directory));

        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $files[] = $file->getPathname();
            }
        }

        return $files;
    }
}
