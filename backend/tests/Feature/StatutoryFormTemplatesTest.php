<?php

namespace Tests\Feature;

use App\Services\Payroll\FilingGeneratorRegistry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The ten declaration-form templates.
 *
 * Writing the blade view IS the act of shipping one of these filings - the
 * registry resolves availability from the filesystem, so a missing template is
 * the only reason a form is unavailable.
 *
 * Two failure modes are worth pinning. A template that throws takes down a
 * batch that has already written PF ECR, ESI and 24Q (which is what used to
 * happen). And a template that renders only when there is data breaks on the
 * ordinary month where nobody left - Form 19's normal state is empty, and a
 * form that looked broken then would train people to ignore it in the month
 * somebody did leave.
 */
class StatutoryFormTemplatesTest extends TestCase
{
    use RefreshDatabase;

    /** @return array<int, string> */
    private function templates(): array
    {
        return [
            'form1', 'form2', 'form6', 'form19', 'form31', 'form124',
            'eshram_registration', 'uan_activation', 'se_registration', 'shram_card_registration',
        ];
    }

    /** @return array<string, mixed> */
    private function data(array $entries): array
    {
        return [
            'employer' => (object) ['name' => 'CareVance Manufacturing', 'address' => 'Plot 4, Bengaluru'],
            'run' => (object) ['month_year' => '2026-08'],
            'generatedAt' => now(),
            'entries' => $entries,
            'totalSettlement' => 125000.0,
            'totalGratuity' => 48000.0,
            'totals' => [
                'gross' => 85000.0, 'pf_employee' => 1800.0, 'pf_employer' => 1800.0,
                'esi_employee' => 0.0, 'esi_employer' => 0.0, 'tds' => 7200.0,
            ],
            'activated' => 1,
            'pending' => 0,
        ];
    }

    /** @return array<string, mixed> */
    private function entry(array $over = []): array
    {
        return array_merge([
            'employee' => 'Priya Nair',
            'pan' => 'AAAPZ1234C',
            'uan' => '100200300400',
            'esi_ip' => '3100123456',
            'last_working_date' => '31/08/2026',
            'net_settlement' => 125000.0,
            'gratuity' => 48000.0,
            'exit_type' => 'resignation',
            'designation' => 'Engineer',
            'employment_status' => 'active',
            'exit_date' => '',
            'joining_date' => '01/04/2021',
            'gross_salary' => 85000.0,
            'department' => 'Engineering',
            'gross' => 85000.0,
            'pf_employee' => 1800.0,
            'pf_employer' => 1800.0,
            'esi_employee' => 0.0,
            'esi_employer' => 0.0,
            'tds' => 7200.0,
            'uan_status' => 'Allotted',
            'organization_name' => 'CareVance Manufacturing',
        ], $over);
    }

    public function test_the_registry_now_reports_all_ten_as_available(): void
    {
        $registry = new FilingGeneratorRegistry();

        foreach ([
            'form_1', 'form_2', 'form_6', 'form_19', 'form_31', 'form_124',
            'eshram_registration', 'uan_activation', 'se_registration', 'shram_card_registration',
        ] as $type) {
            $this->assertTrue(
                $registry->isAvailable($type),
                "{$type} is still reported unavailable — its template is missing or misnamed.",
            );
        }
    }

    public function test_every_template_renders_with_data(): void
    {
        foreach ($this->templates() as $template) {
            $html = view("filings.{$template}", $this->data([$this->entry()]))->render();

            $this->assertStringContainsString('<html', $html, "{$template} did not render");
            $this->assertStringContainsString('CareVance Manufacturing', $html);
        }
    }

    public function test_every_template_renders_with_nothing_to_report(): void
    {
        /*
         * The ordinary month. Form 19 is empty whenever nobody has left, and a
         * template that only works with rows breaks precisely when it is being
         * used correctly.
         */
        foreach ($this->templates() as $template) {
            $html = view("filings.{$template}", $this->data([]))->render();

            $this->assertStringContainsString('<html', $html, "{$template} broke on an empty period");
        }
    }

    public function test_a_missing_identifier_is_shown_as_missing_rather_than_blank(): void
    {
        $html = view('filings.form2', $this->data([
            $this->entry(['uan' => '', 'pan' => '', 'esi_ip' => '']),
        ]))->render();

        /*
         * A blank cell reads as "nothing to see" where the truth is "this
         * member cannot be processed until it is filled in".
         */
        $this->assertStringContainsString('Not on record', $html);
    }

    public function test_a_missing_pan_names_the_consequence_on_the_tds_statement(): void
    {
        $html = view('filings.form124', $this->data([$this->entry(['pan' => ''])]))->render();

        // Section 206AA: without a PAN, tax is deductible at the higher of the
        // normal rate or 20%. Saying so is more use than an empty cell.
        $this->assertStringContainsString('206AA', $html);
    }

    public function test_every_form_carries_its_provenance(): void
    {
        foreach ($this->templates() as $template) {
            $html = view("filings.{$template}", $this->data([$this->entry()]))->render();

            /*
             * A statutory document that cannot say what produced it, from which
             * period, and when, is one an inspector will not accept — and it is
             * what stops a printout being mistaken for a signed original.
             */
            $this->assertStringContainsString('Generated by CareVance HRMS', $html, "{$template} has no provenance");
            $this->assertStringContainsString('not valid without signature', $html, "{$template} has no signature caveat");
        }
    }

    public function test_the_eshram_schedule_says_it_is_not_a_return(): void
    {
        $html = view('filings.eshram_registration', $this->data([$this->entry()]))->render();

        /*
         * e-SHRAM covers UNORGANISED workers, so most people on a payroll that
         * deducts PF are excluded. A schedule that looked like a return would
         * have somebody registering their whole workforce into the wrong
         * database.
         */
        $this->assertStringContainsString('not itself a registration or a return', $html);
        $this->assertStringContainsString('No — EPFO member', $html);
    }

    public function test_registration_forms_leave_unknown_fields_blank_rather_than_guessing(): void
    {
        $html = view('filings.form1', $this->data([$this->entry()]))->render();

        // A registration form carrying a guessed identifier is worse than an
        // empty one, because nobody checks a field that already looks answered.
        $this->assertStringContainsString('must not invent', $html);
    }
}
