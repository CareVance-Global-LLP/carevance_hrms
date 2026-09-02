<?php

namespace Tests\Feature;

use App\Models\DepartmentPayrollTemplate;
use App\Models\EmployeePayrollTemplate;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\PayrollAutoProcessService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\BuildsPayrollFixture;
use Tests\TestCase;

/**
 * The department template must not fabricate a professional-tax state, and an
 * explicit "my state levies none" must survive one.
 *
 * Five code paths that substituted 'maharashtra' were removed and pinned by
 * ProfessionalTaxDefaultStateTest. A sixth survived all of them because it was
 * not code: `2026_06_17_100000_create_department_payroll_templates_table`
 * declared `pt_state` NOT NULL DEFAULT 'maharashtra'. The setup wizard's
 * Departments step sends no pt_state at all, so the database supplied one, and
 * EmployeePayrollTemplate::getOrCreateForUser — which runs once per new hire —
 * copied it onto every employee template created afterwards. Then
 * PayrollAutoProcessService priced it: ₹200 a month, ₹300 in February, ₹2,500
 * a year per head, from people in Delhi, Haryana, Punjab or Uttar Pradesh,
 * which levy no professional tax at all.
 *
 * Worse, it beat an explicit answer. getOrCreateForUser resolved the state with
 * `$orgSettings['defaultState'] ?? $deptTemplate?->pt_state`, and `??` cannot
 * tell "nobody has answered" (key absent) from "answered: this organisation's
 * state levies none" (key => null). So an admin who ticked "No professional tax
 * in my state" and then saved any department template had Maharashtra stamped
 * on every subsequent hire.
 *
 * Nothing in the suite touched DepartmentPayrollTemplate at all — a full green
 * run proved nothing here. Each test below pins one link in that chain, and the
 * last one asserts the RUPEES on a processed payroll item rather than a null
 * column, because a null column is not what the defect cost anybody.
 */
class DepartmentPayrollTemplatePtStateTest extends TestCase
{
    use RefreshDatabase;
    use BuildsPayrollFixture;

    /** Deliberately not February: Maharashtra's ₹300 instalment would muddy the ₹200 anchor. */
    private const MONTH = '2026-05';

    protected function setUp(): void
    {
        parent::setUp();
        $this->buildPayrollFixture();
    }

    /**
     * The wizard's Departments step, exactly as it posts: CTC, the percentage
     * fields and the enable flags, and no pt_state anywhere.
     */
    private function departmentTemplateFromTheWizard(): DepartmentPayrollTemplate
    {
        return DepartmentPayrollTemplate::create([
            'organization_id' => $this->organization->id,
            'department_id' => $this->department->id,
            'default_annual_ctc' => 600000,
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_allowance' => 1600,
            'pf_enabled' => true,
            'esi_enabled' => true,
            'pt_enabled' => true,
            'tds_enabled' => true,
            'is_active' => true,
        ]);
    }

    /** A department whose admin genuinely chose a state. */
    private function departmentTemplateChoosing(string $state): DepartmentPayrollTemplate
    {
        $template = $this->departmentTemplateFromTheWizard();
        $template->pt_state = $state;
        $template->save();

        return $template;
    }

    /** The wizard's "No professional tax in my state" answer: the key is present and null. */
    private function answerNoProfessionalTax(): void
    {
        $settings = $this->organization->settings ?? [];
        $settings['payroll']['defaultState'] = null;

        $this->organization->settings = $settings;
        $this->organization->save();
        $this->organization->refresh();

        $this->assertArrayHasKey(
            'defaultState',
            $this->organization->settings['payroll'],
            'The answer is the KEY being present. If it round-trips away, this test proves nothing.'
        );
    }

    private function assertProfessionalTaxIsUnanswered(): void
    {
        $this->assertArrayNotHasKey(
            'defaultState',
            $this->organization->fresh()->settings['payroll'] ?? [],
            'This fixture is meant to represent an organisation that has never answered.'
        );
    }

    /** Put a fully fixtured user into the department, so the dept template applies to them. */
    private function joinDepartment(User $user): void
    {
        DB::table('group_user')->insert([
            'group_id' => $this->department->id,
            'user_id' => $user->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function process(): PayrollMonthlyRun
    {
        Auth::setUser($this->admin);

        return app(PayrollAutoProcessService::class)
            ->processForUsers($this->organization->id, self::MONTH, null, $this->admin->id);
    }

    private function itemFor(PayrollMonthlyRun $run, User $user): ?PayrollItem
    {
        return PayrollItem::where('payroll_run_id', $run->id)
            ->where('user_id', $user->id)
            ->first();
    }

    /**
     * The migration itself. Before 2026_08_27_000000 the column was NOT NULL
     * DEFAULT 'maharashtra', so this row came back holding a state nobody had
     * typed, chosen or seen.
     */
    public function test_a_department_template_saved_without_a_state_does_not_come_back_holding_one(): void
    {
        $template = $this->departmentTemplateFromTheWizard();

        $stored = DB::table('department_payroll_templates')->where('id', $template->id)->value('pt_state');

        $this->assertNull(
            $stored,
            'The Departments step sends no pt_state, so the stored row must have none — '
            .'a database default here is ₹200 a month on a payslip.'
        );
        $this->assertNull($template->fresh()->pt_state);
    }

    /** A state that IS chosen must of course still be stored. */
    public function test_a_department_that_chooses_a_state_keeps_it(): void
    {
        $template = $this->departmentTemplateChoosing('karnataka');

        $this->assertSame('karnataka', $template->fresh()->pt_state);
    }

    public function test_the_department_default_map_does_not_fabricate_a_state(): void
    {
        $defaults = $this->departmentTemplateFromTheWizard()->fresh()->toEmployeeTemplateDefaults();

        $this->assertArrayHasKey('pt_state', $defaults);
        $this->assertNull(
            $defaults['pt_state'],
            'This map seeds brand-new employee templates; a state invented here is a real deduction.'
        );
    }

    /**
     * The `??` bug. The organisation answered "none"; the department genuinely
     * chose Maharashtra. The organisation-level answer is the more specific
     * statement about where professional tax is owed, and it must win — under
     * `??` the explicit null read as unanswered and Maharashtra came through.
     */
    public function test_an_explicit_no_professional_tax_answer_survives_a_department_template(): void
    {
        $this->answerNoProfessionalTax();
        $this->departmentTemplateChoosing('maharashtra');
        $this->joinDepartment($this->manager);

        $template = EmployeePayrollTemplate::getOrCreateForUser(
            $this->manager->id,
            $this->organization->id
        );

        $this->assertNull(
            $template->fresh()->pt_state,
            'An admin who explicitly said their state levies no professional tax must not have '
            .'Maharashtra stamped on the next person they hire.'
        );
    }

    /**
     * The other side of the same fix, so nobody "solves" it by always
     * returning null. An organisation that has never answered has said
     * nothing, so the department's own choice is the best fact available.
     */
    public function test_an_unanswered_organisation_still_inherits_the_department_choice(): void
    {
        $this->assertProfessionalTaxIsUnanswered();
        $this->departmentTemplateChoosing('karnataka');
        $this->joinDepartment($this->manager);

        $template = EmployeePayrollTemplate::getOrCreateForUser(
            $this->manager->id,
            $this->organization->id
        );

        $this->assertSame(
            'karnataka',
            $template->fresh()->pt_state,
            'Key absent means unanswered, and a department that chose a state has answered for itself.'
        );
    }

    /**
     * An unanswered organisation whose department also chose nothing ends with
     * nothing — the path the database default used to fill in.
     */
    public function test_a_wizard_built_department_seeds_a_new_hire_with_no_state(): void
    {
        $this->assertProfessionalTaxIsUnanswered();
        $this->departmentTemplateFromTheWizard();
        $this->joinDepartment($this->manager);

        $template = EmployeePayrollTemplate::getOrCreateForUser(
            $this->manager->id,
            $this->organization->id
        );

        $this->assertNull($template->fresh()->pt_state);
    }

    /**
     * The one that matters: rupees on a processed payroll item, not a null
     * column. A null pt_state that some later path re-fabricated would still
     * pass every assertion above.
     *
     * The comparison employee is anchored at Maharashtra's ₹200 on the same
     * run, so this cannot be satisfied by breaking professional tax outright.
     */
    public function test_a_new_hire_in_an_organisation_that_answered_none_is_deducted_no_professional_tax(): void
    {
        $this->answerNoProfessionalTax();
        $this->departmentTemplateChoosing('maharashtra');
        $this->joinDepartment($this->manager);

        // The new hire, seeded through the path under test.
        EmployeePayrollTemplate::getOrCreateForUser($this->manager->id, $this->organization->id);
        DB::table('employee_payroll_templates')
            ->where('user_id', $this->manager->id)
            ->update(['annual_ctc' => 1200000]);

        // A colleague who genuinely is taxed in Maharashtra, on the same run.
        $this->giveCtc($this->employee, 1200000);
        DB::table('employee_payroll_templates')
            ->where('user_id', $this->employee->id)
            ->update(['pt_state' => 'maharashtra']);

        $run = $this->process();

        $hire = $this->itemFor($run, $this->manager);
        $this->assertNotNull($hire, 'The new hire should have been processed, not excluded.');
        $this->assertSame(
            0.0,
            (float) $hire->pt,
            'The organisation said its state levies no professional tax. ₹200 here is money taken '
            .'from an employee who owes none — ₹2,500 over a year.'
        );

        $taxed = $this->itemFor($run, $this->employee);
        $this->assertNotNull($taxed);
        $this->assertSame(
            200.0,
            (float) $taxed->pt,
            'Sanity anchor: this is the exact figure the fabricated state used to charge everybody.'
        );
    }
}
