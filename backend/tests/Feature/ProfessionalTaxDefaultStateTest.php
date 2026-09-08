<?php

namespace Tests\Feature;

use App\Models\ArrearPayment;
use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\User;
use App\Services\PayrollCalculatorService;
use App\Services\PTStateService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * An unconfigured professional tax state must price at ₹0, never at some real
 * state's slabs.
 *
 * Professional tax is levied by the state an employee works in, and Delhi,
 * Haryana, Punjab and Uttar Pradesh levy none at all. Five separate places
 * substituted 'maharashtra' when nobody had chosen: the settings API's default
 * block, the calculator's own default parameters, the take-home preview, the
 * employee payroll card's create path, and the arrear engine's config
 * fallback. Each one of them ends at the same number — ₹200 a month, ₹300 in
 * February, ₹2,500 a year — deducted from an employee who owes nothing, in a
 * state their employer has never operated in.
 *
 * Nothing else in the suite catches that. Every one of those paths succeeds:
 * the settings save returns 200, the template is created, the arrear is
 * recorded, and the wrong money only appears on a payslip. So each test below
 * pins one of them, and each asserts the ₹0 *and* names the figure that used
 * to be charged instead — an assertion that only says "0" is one somebody can
 * satisfy by breaking professional tax altogether.
 */
class ProfessionalTaxDefaultStateTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        // Deliberately no `payroll` block at all: this is an organisation
        // that has never answered the professional tax question.
        $this->organization = Organization::factory()->create(['settings' => []]);
        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);
    }

    private function calculator(): PayrollCalculatorService
    {
        return app(PayrollCalculatorService::class);
    }

    public function test_the_calculator_charges_no_professional_tax_when_the_caller_names_no_state(): void
    {
        // ₹12,00,000 CTC puts monthly gross in Maharashtra's top band, so the
        // old default was not a rounding difference — it was the full slab.
        $result = $this->calculator()->calculatePayroll(1200000);

        $this->assertSame(
            0.0,
            (float) $result['components']['deductions']['pt'],
            'A caller that names no state must get no professional tax.'
        );
        $this->assertSame(
            '',
            $result['breakdown']['state_code'],
            'The unset state must be reported as unset, not laundered into a real one.'
        );

        $maharashtra = $this->calculator()->calculatePayroll(1200000, 'maharashtra');
        $this->assertSame(
            200.0,
            (float) $maharashtra['components']['deductions']['pt'],
            'Sanity check: this is the ₹200 an omitted argument used to buy.'
        );
    }

    public function test_the_pt_helper_charges_nothing_when_the_caller_names_no_state(): void
    {
        $this->assertSame(0.0, $this->calculator()->calculatePT(25000));
        $this->assertSame(200.0, $this->calculator()->calculatePT(25000, 'maharashtra'));
    }

    public function test_the_settings_api_does_not_report_a_state_nobody_chose(): void
    {
        $response = $this->getJson('/api/payroll/settings', $this->apiHeadersFor($this->admin))
            ->assertOk();

        $settings = $response->json('settings');

        $this->assertNotSame(
            'maharashtra',
            $settings['defaultState'] ?? null,
            'An organisation that has never chosen a state must not be told its default is Maharashtra.'
        );
        $this->assertArrayNotHasKey(
            'defaultState',
            $settings,
            'An absent key is what lets the setup wizard tell "unanswered" from "answered: none".'
        );
    }

    public function test_no_professional_tax_is_recorded_as_null_and_read_back_as_an_answer(): void
    {
        $this->putJson('/api/payroll/settings', [
            'defaultState' => null,
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $payroll = $this->organization->fresh()->settings['payroll'] ?? [];

        $this->assertArrayHasKey(
            'defaultState',
            $payroll,
            'The answer has to survive the round trip, or the wizard asks again forever.'
        );
        $this->assertNull($payroll['defaultState']);

        $settings = $this->getJson('/api/payroll/settings', $this->apiHeadersFor($this->admin))
            ->assertOk()
            ->json('settings');

        $this->assertArrayHasKey('defaultState', $settings);
        $this->assertNull($settings['defaultState']);
    }

    public function test_saving_the_payroll_card_does_not_stamp_a_state_on_a_new_template(): void
    {
        $employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        // Saving anything on the card is what first creates the template.
        $this->putJson('/api/payroll/employee-cards/'.$employee->id, [
            'annual_ctc' => 600000,
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $template = EmployeePayrollTemplate::where('user_id', $employee->id)->firstOrFail();

        $this->assertNull(
            $template->pt_state,
            'An admin who never saw the professional tax field has not chosen a state.'
        );
        $this->assertSame(0.0, PTStateService::calculate($template->pt_state ?: '', 50000));
    }

    public function test_an_arrear_withholds_no_professional_tax_when_no_state_is_configured(): void
    {
        $employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        // The two grosses straddle a Maharashtra band boundary (₹0 below
        // ₹7,500, ₹200 above ₹10,000), so the old fallback produced a ₹200
        // deduction here rather than a coincidental zero.
        $this->postJson('/api/payroll/arrears', [
            'user_id' => $employee->id,
            'arrear_month' => '2026-06',
            'calculation_month' => '2026-08',
            'arrear_type' => 'increment',
            'original_basic' => 3000,
            'revised_basic' => 10000,
            'original_gross' => 7000,
            'revised_gross' => 25000,
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $arrear = ArrearPayment::where('user_id', $employee->id)->firstOrFail();

        $this->assertSame(
            0.0,
            (float) $arrear->pt_on_arrear,
            'pt_on_arrear is a stored, payable deduction — it cannot be a guess at a state.'
        );
    }

    public function test_bulk_calculation_charges_no_professional_tax_without_a_state(): void
    {
        $employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        $response = $this->postJson('/api/payroll/calculate-bulk', [
            'employees' => [
                ['user_id' => $employee->id, 'annual_ctc' => 1200000],
            ],
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $this->assertSame(
            0.0,
            (float) $response->json('results.0.calculation.components.deductions.pt'),
            'calculate() already answered ₹0 for this employee; calculate-bulk must not answer ₹200.'
        );
    }
}
