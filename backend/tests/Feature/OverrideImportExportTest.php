<?php

namespace Tests\Feature;

use App\Models\EmployeePayrollTemplate;
use App\Models\EmployeeWorkInfo;
use App\Models\Organization;
use App\Models\PayrollOverride;
use App\Models\SalaryComponent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * The export → edit → import round trip.
 *
 * The acceptance gate is the first test: exporting and uploading the same bytes
 * back must report zero changes. A format that fails that is wrong, and the fix
 * is the format — never a special case in the importer.
 *
 * The rest pin the row ladder. Each error code exists because a payroll officer
 * will hit it in Excel with no idea what the system wants, so each one is
 * checked for the code AND for carrying something actionable.
 */
class OverrideImportExportTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;

    private float $annualCtc = 1200000.0;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        // Basic and HRA both open to employee-level override.
        foreach ([['Basic Salary', 'BASIC', 'basic'], ['House Rent Allowance', 'HRA', 'allowance']] as [$name, $code, $category]) {
            SalaryComponent::create([
                'organization_id' => $this->organization->id,
                'name' => $name,
                'code' => $code,
                'category' => $category,
                'impact' => 'earning',
                'value_type' => 'percentage',
                'default_value' => 40,
                'is_taxable' => true,
                'is_active' => true,
                'allow_employee_override' => true,
            ]);
        }
    }

    private function employee(string $number, array $template = []): User
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        EmployeeWorkInfo::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'employee_code' => $number,
        ]);

        EmployeePayrollTemplate::create(array_merge([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'annual_ctc' => $this->annualCtc,
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_allowance' => 1600,
            'is_metro_city' => true,
            'is_active' => true,
        ], $template));

        return $user;
    }

    private function exportCsv(): string
    {
        return $this->actingAs($this->admin)
            ->get('/api/payroll/operations/overrides/export')
            ->assertStatus(200)
            ->getContent();
    }

    private function validateCsv(string $csv, array $extra = [])
    {
        return $this->actingAs($this->admin)->post('/api/payroll/operations/overrides/import/validate', array_merge([
            'file' => UploadedFile::fake()->createWithContent('overrides.csv', $csv),
        ], $extra));
    }

    /** Replace one cell on the data row for a given employee number. */
    private function withCell(string $csv, string $employeeNumber, string $header, string $value): string
    {
        $lines = explode("\r\n", trim($csv));
        $headerAt = $this->headerIndex($lines);
        $headers = str_getcsv(preg_replace('/^\x{EF}\x{BB}\x{BF}|^\x{FEFF}/u', '', $lines[$headerAt]));
        $index = array_search($header, $headers, true);
        $this->assertNotFalse($index, "Header {$header} is missing from the export.");

        foreach ($lines as $i => $line) {
            if ($i <= $headerAt) {
                continue;
            }

            $cells = str_getcsv($line);
            if (($cells[0] ?? null) === $employeeNumber) {
                $cells[$index] = $value;
                $lines[$i] = implode(',', array_map(
                    fn ($c) => preg_match('/[",\r\n]/', (string) $c) ? '"'.str_replace('"', '""', (string) $c).'"' : (string) $c,
                    $cells,
                ));
            }
        }

        return implode("\r\n", $lines)."\r\n";
    }

    /**
     * The header row's index, skipping the Excel preamble.
     *
     * The export opens with `sep=,` so Excel splits on commas regardless of
     * the machine's regional list separator. Line 0 is therefore no longer the
     * header, and a fixture that assumed it was would edit the directive.
     */
    private function headerIndex(array $lines): int
    {
        foreach ($lines as $i => $line) {
            $first = trim(preg_replace('/^\x{EF}\x{BB}\x{BF}|^\x{FEFF}/u', '', $line));
            if ($first !== '' && ! preg_match('/^sep=.?$/i', $first) && ! str_starts_with($first, '#')) {
                return $i;
            }
        }

        return 0;
    }

    /** withCell, for a file whose separator is not a comma. */
    private function withSeparator(string $csv, string $sep, string $employeeNumber, string $header, string $value): string
    {
        $lines = explode("\r\n", trim($csv));
        $headerAt = $this->headerIndex($lines);
        $headers = str_getcsv(preg_replace('/^\x{EF}\x{BB}\x{BF}|^\x{FEFF}/u', '', $lines[$headerAt]), $sep);
        $index = array_search($header, $headers, true);
        $this->assertNotFalse($index, "Header {$header} is missing from the export.");

        foreach ($lines as $i => $line) {
            if ($i <= $headerAt) {
                continue;
            }

            $cells = str_getcsv($line, $sep);
            if (($cells[0] ?? null) === $employeeNumber) {
                $cells[$index] = $value;
                $lines[$i] = implode($sep, $cells);
            }
        }

        return implode("\r\n", $lines)."\r\n";
    }

    /**
     * §6.5 — the acceptance gate for the whole format.
     *
     * If this fails the format is wrong. Pre-filling the writable columns is
     * the usual cause: it makes an untouched round trip read as one edit per
     * employee.
     */
    #[Test]
    public function an_unmodified_round_trip_reports_no_changes(): void
    {
        $this->employee('100001');
        $this->employee('100002');
        $this->employee('100003');

        $response = $this->validateCsv($this->exportCsv())->assertStatus(200);

        $response->assertJsonPath('summary.will_change', 0);
        $response->assertJsonPath('summary.errors', 0);
        $response->assertJsonPath('summary.no_change', 3);
    }

    /** Excel on Windows renders ₹ and Indian names as mojibake without it. */
    #[Test]
    public function the_export_carries_a_utf8_bom_and_crlf_endings(): void
    {
        $this->employee('100001');

        $csv = $this->exportCsv();

        $this->assertStringStartsWith("\u{FEFF}", $csv, 'The export must open with a UTF-8 BOM.');
        $this->assertStringContainsString("\r\n", $csv);
    }

    /**
     * Excel obeys the machine's regional list separator, not the comma.
     *
     * Without this directive a valid comma-delimited CSV opens on a
     * semicolon-configured workstation with all seventeen columns crammed into
     * column A. The officer edits that, saves, and uploads a file with no
     * recognisable headers — having done nothing wrong at any point.
     */
    #[Test]
    public function the_export_tells_excel_which_separator_it_uses(): void
    {
        $this->employee('100001');

        $csv = $this->exportCsv();

        // After the BOM, before the headers — where Excel looks for it.
        $this->assertStringStartsWith("\u{FEFF}sep=,\r\n", $csv);
    }

    /** And our own parser must skip it, or the round trip reads it as a header. */
    #[Test]
    public function the_separator_directive_is_not_mistaken_for_a_header_row(): void
    {
        $this->employee('100001');

        $this->validateCsv($this->exportCsv())
            ->assertStatus(200)
            ->assertJsonPath('summary.rows_read', 1)
            ->assertJsonPath('summary.no_change', 1);
    }

    #[Test]
    public function the_writable_columns_are_exported_blank(): void
    {
        $this->employee('100001');

        $lines = explode("\r\n", trim($this->exportCsv()));
        $headerAt = $this->headerIndex($lines);
        $headers = str_getcsv(preg_replace('/^\x{FEFF}/u', '', $lines[$headerAt]));
        $cells = str_getcsv($lines[$headerAt + 1]);

        $this->assertSame('', $cells[array_search('basic_annual', $headers, true)]);
        $this->assertSame('', $cells[array_search('hra_annual', $headers, true)]);
        // ...while the _current columns carry the figures the officer reads.
        $this->assertSame('480000', $cells[array_search('basic_annual_current', $headers, true)]);
    }

    #[Test]
    public function a_real_edit_is_reported_as_a_change_with_its_consequence(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');
        $csv = $this->withCell($csv, '100001', 'reason', 'Annual revision FY 2026-27');

        $response = $this->validateCsv($csv, ['default_effective_from' => '2026-09-01'])->assertStatus(200);

        $response->assertJsonPath('summary.will_change', 1);
        $response->assertJsonPath('valid.0.changes.0.target', 'basic');
        $response->assertJsonPath('valid.0.changes.0.from', 480000);
        $response->assertJsonPath('valid.0.changes.0.to', 540000);

        // HRA follows basic when it is not itself overridden — §3.1.
        $response->assertJsonPath('valid.0.hra_moves_to', 270000);
    }

    /** The officer reads the Excel gutter, not a zero-indexed data row. */
    #[Test]
    public function the_spreadsheet_row_is_one_more_than_the_data_row(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');
        $csv = $this->withCell($csv, '100001', 'reason', 'Revision');

        $response = $this->validateCsv($csv, ['default_effective_from' => '2026-09-01'])->assertStatus(200);

        $this->assertSame(1, $response->json('valid.0.row'));
        $this->assertSame(2, $response->json('valid.0.spreadsheet_row'));
    }

    /** Blank means "leave alone"; 0 means zero and is a real edit. */
    #[Test]
    public function a_zero_is_an_edit_and_a_blank_is_not(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '0');
        $csv = $this->withCell($csv, '100001', 'reason', 'Reduced to zero deliberately');

        $response = $this->validateCsv($csv, ['default_effective_from' => '2026-09-01'])->assertStatus(200);

        $this->assertSame(1, $response->json('summary.will_change'));
        $this->assertSame(0, $response->json('valid.0.changes.0.to'));
    }

    /**
     * The mistake the format invites.
     *
     * `basic_annual_current` holds the figure the officer wants to change, and
     * `basic_annual` — the one they must type into — is blank beside it.
     * Editing the column that shows the number is the natural thing to do, and
     * it used to produce "0 will change, 17 unchanged": a deliberate payroll
     * edit discarded without a word.
     */
    #[Test]
    public function editing_the_read_only_column_is_reported_rather_than_ignored(): void
    {
        $this->employee('100001');

        // 480000 is what the structure produces; the officer types over it.
        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual_current', '540000');

        $response = $this->validateCsv($csv)->assertStatus(200);

        $response->assertJsonPath('summary.no_change', 0);
        $response->assertJsonPath('errors.0.code', 'E017');
        $response->assertJsonPath('errors.0.column', 'basic_annual');
        $response->assertJsonPath('errors.0.suggested_value', 540000);

        $this->assertStringContainsString('basic_annual column instead', $response->json('errors.0.fix'));
    }

    #[Test]
    public function the_same_guard_covers_the_hra_column(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'hra_annual_current', '300000');

        $this->validateCsv($csv)
            ->assertStatus(200)
            ->assertJsonPath('errors.0.code', 'E017')
            ->assertJsonPath('errors.0.column', 'hra_annual');
    }

    /** An untouched _current column must never be mistaken for an edit. */
    #[Test]
    public function an_unedited_current_column_stays_no_change(): void
    {
        $this->employee('100001');

        $this->validateCsv($this->exportCsv())
            ->assertStatus(200)
            ->assertJsonPath('summary.errors', 0)
            ->assertJsonPath('summary.no_change', 1);
    }

    /** Typing into the right column still wins, whatever the left one says. */
    #[Test]
    public function a_correct_edit_is_unaffected_by_the_guard(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');
        $csv = $this->withCell($csv, '100001', 'reason', 'Revision');

        $this->validateCsv($csv, ['default_effective_from' => '2026-09-01'])
            ->assertStatus(200)
            ->assertJsonPath('summary.will_change', 1)
            ->assertJsonPath('summary.errors', 0);
    }

    #[Test]
    public function an_unknown_employee_number_is_e001(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'employee_number', '999999');
        $csv = $this->withCell($csv, '999999', 'basic_annual', '540000');
        $csv = $this->withCell($csv, '999999', 'reason', 'Revision');

        $response = $this->validateCsv($csv)->assertStatus(200);

        $response->assertJsonPath('errors.0.code', 'E001');
        $this->assertNotEmpty($response->json('errors.0.fix'));
    }

    #[Test]
    public function an_employee_with_no_ctc_is_e004(): void
    {
        $this->employee('100001', ['annual_ctc' => 0]);

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');
        $csv = $this->withCell($csv, '100001', 'reason', 'Revision');

        $this->validateCsv($csv)->assertStatus(200)->assertJsonPath('errors.0.code', 'E004');
    }

    #[Test]
    public function an_ungated_component_is_e006(): void
    {
        $this->employee('100001');
        SalaryComponent::query()->update(['allow_employee_override' => false]);

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');
        $csv = $this->withCell($csv, '100001', 'reason', 'Revision');

        $this->validateCsv($csv)->assertStatus(200)->assertJsonPath('errors.0.code', 'E006');
    }

    #[Test]
    public function a_formatted_amount_is_e007_and_says_what_to_type(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '"5,40,000"');
        $csv = $this->withCell($csv, '100001', 'reason', 'Revision');

        $response = $this->validateCsv($csv)->assertStatus(200);

        $response->assertJsonPath('errors.0.code', 'E007');
        $this->assertStringContainsString('540000', $response->json('errors.0.fix'));
    }

    /**
     * The refusal that has to carry a number. "Invalid" is not actionable;
     * "set it to 8,51,000 or below" is.
     */
    #[Test]
    public function a_value_beyond_the_ceiling_is_e009_with_a_suggestion(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '9600000');
        $csv = $this->withCell($csv, '100001', 'reason', 'Revision');

        $response = $this->validateCsv($csv)->assertStatus(200);

        $response->assertJsonPath('errors.0.code', 'E009');
        $this->assertNotNull($response->json('errors.0.suggested_value'));
        $this->assertGreaterThan(0, $response->json('errors.0.suggested_value'));
    }

    /**
     * §6.3 — E009 is judged on the row's NET effect. Raising basic while
     * pinning HRA costs the residual far less, and a ladder that judged basic
     * alone would refuse a change that balances perfectly well.
     */
    #[Test]
    public function pinning_hra_lowers_the_cost_of_raising_basic(): void
    {
        $this->employee('100001');

        $basicOnly = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '700000');
        $basicOnly = $this->withCell($basicOnly, '100001', 'reason', 'Revision');
        $withoutPin = $this->validateCsv($basicOnly)->json('valid.0.amplification');

        $bothPinned = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '700000');
        $bothPinned = $this->withCell($bothPinned, '100001', 'hra_annual', '240000');
        $bothPinned = $this->withCell($bothPinned, '100001', 'reason', 'Revision');
        $withPin = $this->validateCsv($bothPinned)->json('valid.0.amplification');

        $this->assertNotNull($withoutPin);
        $this->assertNotNull($withPin);
        $this->assertLessThan($withoutPin, $withPin, 'Pinning HRA must reduce what a rupee of basic costs the residual.');
    }

    #[Test]
    public function a_change_without_a_reason_is_e014(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');

        $this->validateCsv($csv)->assertStatus(200)->assertJsonPath('errors.0.code', 'E014');
    }

    #[Test]
    public function a_default_reason_satisfies_every_row(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');

        $this->validateCsv($csv, ['default_reason' => 'Annual revision FY 2026-27'])
            ->assertStatus(200)
            ->assertJsonPath('summary.errors', 0);
    }

    #[Test]
    public function an_unreadable_date_is_e012(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');
        $csv = $this->withCell($csv, '100001', 'reason', 'Revision');
        $csv = $this->withCell($csv, '100001', 'effective_from', '01/09/2026');

        $this->validateCsv($csv)->assertStatus(200)->assertJsonPath('errors.0.code', 'E012');
    }

    #[Test]
    public function an_end_before_the_start_is_e013(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');
        $csv = $this->withCell($csv, '100001', 'reason', 'Revision');
        $csv = $this->withCell($csv, '100001', 'effective_from', '2026-09-01');
        $csv = $this->withCell($csv, '100001', 'effective_to', '2026-08-01');

        $this->validateCsv($csv)->assertStatus(200)->assertJsonPath('errors.0.code', 'E013');
    }

    #[Test]
    public function an_unknown_balance_mode_is_e015(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');
        $csv = $this->withCell($csv, '100001', 'reason', 'Revision');
        $csv = $this->withCell($csv, '100001', 'balance_mode', 'whatever');

        $this->validateCsv($csv)->assertStatus(200)->assertJsonPath('errors.0.code', 'E015');
    }

    #[Test]
    public function two_residual_components_are_e010(): void
    {
        $this->employee('100001');

        SalaryComponent::query()->update(['is_residual' => true]);

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');
        $csv = $this->withCell($csv, '100001', 'reason', 'Revision');

        $this->validateCsv($csv)->assertStatus(200)->assertJsonPath('errors.0.code', 'E010');
    }

    #[Test]
    public function a_non_csv_upload_is_refused_before_any_row_is_read(): void
    {
        $this->employee('100001');

        $this->actingAs($this->admin)
            ->post('/api/payroll/operations/overrides/import/validate', [
                'file' => UploadedFile::fake()->create('overrides.xlsx', 10),
            ])
            ->assertStatus(422)
            ->assertJsonPath('code', 'F001');
    }

    /**
     * Excel writes the SYSTEM LIST SEPARATOR, not a comma.
     *
     * On a machine configured for semicolons, "Save as CSV" turns every row
     * into a single cell — and the officer is told a column is missing from a
     * file they exported from this very screen, with the column plainly
     * visible in front of them.
     */
    #[Test]
    public function a_semicolon_delimited_file_is_read_rather_than_refused(): void
    {
        $this->employee('100001');

        $csv = str_replace(',', ';', $this->exportCsv());
        $csv = $this->withSeparator($csv, ';', '100001', 'basic_annual', '540000');
        $csv = $this->withSeparator($csv, ';', '100001', 'reason', 'Revision');

        $this->validateCsv($csv, ['default_effective_from' => '2026-09-01'])
            ->assertStatus(200)
            ->assertJsonPath('summary.will_change', 1);
    }

    #[Test]
    public function a_tab_delimited_file_is_read_rather_than_refused(): void
    {
        $this->employee('100001');

        $csv = str_replace(',', "\t", $this->exportCsv());

        $this->validateCsv($csv)
            ->assertStatus(200)
            ->assertJsonPath('summary.no_change', 1);
    }

    /** Excel's "Unicode Text" save is UTF-16, which is not valid UTF-8 at all. */
    #[Test]
    public function a_utf16_file_is_converted_rather_than_called_corrupt(): void
    {
        $this->employee('100001');

        $utf16 = "\xFF\xFE".mb_convert_encoding($this->exportCsv(), 'UTF-16LE', 'UTF-8');

        $this->validateCsv($utf16)
            ->assertStatus(200)
            ->assertJsonPath('summary.no_change', 1);
    }

    /**
     * The refusal has to be answerable. Naming only the column it wanted, on a
     * file that visibly contains that column, leaves nowhere to go.
     */
    #[Test]
    public function a_header_failure_reports_what_it_actually_read(): void
    {
        $response = $this->actingAs($this->admin)
            ->post('/api/payroll/operations/overrides/import/validate', [
                'file' => UploadedFile::fake()->createWithContent('overrides.csv', "surname,department\r\nA,B\r\n"),
            ])
            ->assertStatus(422)
            ->assertJsonPath('code', 'F003');

        $this->assertStringContainsString('surname', $response->json('message'));
        $this->assertStringContainsString('department', $response->json('message'));
    }

    #[Test]
    public function a_missing_required_header_is_f003(): void
    {
        $this->actingAs($this->admin)
            ->post('/api/payroll/operations/overrides/import/validate', [
                'file' => UploadedFile::fake()->createWithContent('overrides.csv', "employee_name,department\r\nA,B\r\n"),
            ])
            ->assertStatus(422)
            ->assertJsonPath('code', 'F003');
    }

    /** An officer's own working columns must not break their upload. */
    #[Test]
    public function unknown_extra_headers_are_ignored(): void
    {
        $this->employee('100001');

        $csv = $this->exportCsv();
        $lines = explode("\r\n", trim($csv));
        $headerAt = $this->headerIndex($lines);
        $lines[$headerAt] .= ',my_working_note';
        $lines[$headerAt + 1] .= ',check with finance';

        $this->validateCsv(implode("\r\n", $lines)."\r\n")
            ->assertStatus(200)
            ->assertJsonPath('summary.errors', 0);
    }

    // ------------------------------------------------------------- committing

    /**
     * The provenance an import has to leave behind: which upload produced this
     * row, and which line of the officer's file it came from. Both are
     * unanswerable without them, and "which line did this?" is the first thing
     * anyone asks when a figure looks wrong.
     */
    #[Test]
    public function committing_records_where_each_override_came_from(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');
        $csv = $this->withCell($csv, '100001', 'reason', 'Annual revision');

        $batchId = $this->validateCsv($csv, ['default_effective_from' => '2026-09-01'])
            ->assertStatus(200)
            ->json('batch_id');

        $this->actingAs($this->admin)
            ->postJson('/api/payroll/operations/overrides/import/commit', [
                'batch_id' => $batchId,
                'skip_errors' => true,
            ])
            ->assertStatus(200)
            ->assertJsonPath('created', 1);

        $override = PayrollOverride::firstOrFail();

        $this->assertSame('import', $override->source);
        $this->assertSame(2, (int) $override->source_row, 'The spreadsheet row is what an officer can look up.');
        $this->assertNotNull($override->import_batch_id);
        // Stored monthly, like every other override.
        $this->assertEqualsWithDelta(45000.0, (float) $override->value, 0.01);
    }

    /**
     * An override that arrived by spreadsheet is not a different kind of
     * decision from one typed into the grid.
     *
     * Imports used to land pending while the grid released immediately, so the
     * same change needed a different number of clicks depending on how it was
     * entered — and a bulk import of fifty rows left fifty things to approve
     * one at a time.
     */
    #[Test]
    public function an_imported_override_is_released_on_the_same_terms_as_a_typed_one(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');
        $csv = $this->withCell($csv, '100001', 'reason', 'Annual revision');

        $batchId = $this->validateCsv($csv, ['default_effective_from' => '2026-09-01'])->json('batch_id');

        $this->actingAs($this->admin)
            ->postJson('/api/payroll/operations/overrides/import/commit', [
                'batch_id' => $batchId, 'skip_errors' => true,
            ])
            ->assertStatus(200)
            ->assertJsonPath('overrides.0.status', PayrollOverride::STATUS_APPROVED);

        $this->assertSame(PayrollOverride::STATUS_APPROVED, PayrollOverride::firstOrFail()->status);
    }

    /** And with a second admin present, an import waits for them. */
    #[Test]
    public function an_import_still_waits_when_another_admin_could_review_it(): void
    {
        User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'admin']);
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');
        $csv = $this->withCell($csv, '100001', 'reason', 'Annual revision');

        $batchId = $this->validateCsv($csv, ['default_effective_from' => '2026-09-01'])->json('batch_id');

        $this->actingAs($this->admin)
            ->postJson('/api/payroll/operations/overrides/import/commit', [
                'batch_id' => $batchId, 'skip_errors' => true,
            ])
            ->assertStatus(200);

        $this->assertSame(PayrollOverride::STATUS_PENDING, PayrollOverride::firstOrFail()->status);
    }

    /** A double-click must not double-apply a raise. */
    #[Test]
    public function committing_the_same_batch_twice_writes_once(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');
        $csv = $this->withCell($csv, '100001', 'reason', 'Annual revision');

        $batchId = $this->validateCsv($csv, ['default_effective_from' => '2026-09-01'])->json('batch_id');

        $first = $this->actingAs($this->admin)->postJson('/api/payroll/operations/overrides/import/commit', [
            'batch_id' => $batchId, 'skip_errors' => true,
        ])->assertStatus(200);

        $second = $this->actingAs($this->admin)->postJson('/api/payroll/operations/overrides/import/commit', [
            'batch_id' => $batchId, 'skip_errors' => true,
        ])->assertStatus(200);

        $this->assertSame($first->json('batch_id'), $second->json('batch_id'));
        $this->assertSame(1, PayrollOverride::count());
    }

    #[Test]
    public function an_expired_batch_is_gone(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/payroll/operations/overrides/import/commit', [
                'batch_id' => (string) \Illuminate\Support\Str::uuid(),
                'skip_errors' => true,
            ])
            ->assertStatus(410);
    }

    /** An import from another tenant's session must not resolve here. */
    #[Test]
    public function a_batch_from_another_organisation_is_not_found(): void
    {
        $this->employee('100001');

        $csv = $this->withCell($this->exportCsv(), '100001', 'basic_annual', '540000');
        $csv = $this->withCell($csv, '100001', 'reason', 'Annual revision');
        $batchId = $this->validateCsv($csv, ['default_effective_from' => '2026-09-01'])->json('batch_id');

        $otherOrg = Organization::factory()->create();
        $stranger = User::factory()->create(['organization_id' => $otherOrg->id, 'role' => 'admin']);

        $this->actingAs($stranger)
            ->postJson('/api/payroll/operations/overrides/import/commit', [
                'batch_id' => $batchId, 'skip_errors' => true,
            ])
            ->assertStatus(404);

        $this->assertSame(0, PayrollOverride::withoutOrganizationScope()->count());
    }

    #[Test]
    public function the_export_only_contains_this_organisations_employees(): void
    {
        $this->employee('100001');

        $otherOrg = Organization::factory()->create();
        $stranger = User::factory()->create(['organization_id' => $otherOrg->id, 'role' => 'employee']);
        EmployeeWorkInfo::create([
            'organization_id' => $otherOrg->id,
            'user_id' => $stranger->id,
            'employee_code' => '900001',
        ]);
        EmployeePayrollTemplate::create([
            'organization_id' => $otherOrg->id,
            'user_id' => $stranger->id,
            'annual_ctc' => 900000,
            'is_active' => true,
        ]);

        $csv = $this->exportCsv();

        $this->assertStringContainsString('100001', $csv);
        $this->assertStringNotContainsString('900001', $csv);
    }

    #[Test]
    public function the_template_carries_every_header_and_a_skipped_example(): void
    {
        $body = $this->actingAs($this->admin)
            ->get('/api/payroll/operations/overrides/template')
            ->assertStatus(200)
            ->getContent();

        foreach (\App\Services\Payroll\OverrideImportService::COLUMNS as $header) {
            $this->assertStringContainsString($header, $body);
        }

        $this->assertStringContainsString('#', $body);

        // The commented example must not parse as a row.
        $this->validateCsv($body)->assertStatus(422)->assertJsonPath('code', 'F004');
    }

    #[Test]
    public function an_employee_cannot_export_the_override_sheet(): void
    {
        $employee = $this->employee('100001');

        $this->actingAs($employee)
            ->get('/api/payroll/operations/overrides/export')
            ->assertStatus(403);
    }
}
