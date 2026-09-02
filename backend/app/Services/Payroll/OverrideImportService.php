<?php

namespace App\Services\Payroll;

use App\Support\MonthYear;
use App\Models\EmployeePayrollTemplate;
use App\Models\EmployeeWorkInfo;
use App\Models\PayrollOverride;
use App\Models\User;
use App\Services\PayrollCalculatorService;
use Carbon\Carbon;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * The export → edit → import round trip.
 *
 * A payroll officer opens the export in Excel, changes two columns and uploads
 * it back. Every decision in here exists to make that safe:
 *
 *  - the writable columns are exported BLANK, so an untouched round trip reads
 *    as zero changes rather than as one edit per employee;
 *  - blank means "leave alone" and 0 means zero, which are different answers;
 *  - the match key is employee_number, never the name — names are not unique
 *    and Excel will happily let someone retype one;
 *  - a UTF-8 BOM, because without it Excel on Windows renders ₹ and Indian
 *    names as mojibake and the officer's first move is to "fix" the file.
 *
 * Validation never persists. It parks the parsed batch in the cache and hands
 * back a UUID; commit re-validates every row inside the transaction, because a
 * payroll month can close between the two calls and the cache is a convenience,
 * never the authority.
 */
class OverrideImportService
{
    /** The 17 columns, in the order the export writes them. */
    public const COLUMNS = [
        'employee_number',
        'employee_name',
        'department',
        'salary_structure',
        'annual_ctc',
        'basic_annual_current',
        'basic_annual',
        'hra_annual_current',
        'hra_annual',
        'special_allowance_annual',
        'max_basic_annual',
        'effective_from',
        'effective_to',
        'balance_mode',
        'reason',
        'existing_override_id',
        'override_status',
    ];

    /** Without these the file cannot be matched or read at all. */
    private const REQUIRED_HEADERS = ['employee_number', 'basic_annual', 'hra_annual'];

    /** The columns an officer may type into. */
    private const WRITABLE_VALUE_COLUMNS = ['basic_annual', 'hra_annual'];

    private const NOT_APPLICABLE = 'NOT_APPLICABLE';

    /**
     * What Excel needs before it will read this correctly.
     *
     * The BOM makes it render ₹ and Indian names instead of mojibake. `sep=,`
     * makes it SPLIT — Excel obeys the machine's regional list separator, not
     * the comma, so on a workstation configured for semicolons a perfectly
     * valid CSV opens with all seventeen columns crammed into column A. The
     * officer then edits that, saves, and uploads a file with no recognisable
     * headers at all, having done nothing wrong.
     *
     * `sep=` is Excel's own convention. Our parser skips the line, so an
     * untouched round trip still reads clean.
     */
    private const EXCEL_PREAMBLE = "\u{FEFF}sep=,\r\n";

    private const MAX_ROWS = 5000;
    private const MAX_BYTES = 5 * 1024 * 1024;
    private const TTL_SECONDS = 1800;

    public function __construct(
        private readonly OverrideGridService $grid,
        private readonly OverrideBalancingService $balancer,
        private readonly PayrollCalculatorService $calculator,
    ) {
    }

    // ---------------------------------------------------------------- export

    /**
     * The whole filtered set, not the current page.
     *
     * @param  array{q?: string|null, salary_template_id?: int|null}  $filters
     */
    public function export(int $organizationId, string $monthYear, array $filters = []): string
    {
        $rows = $this->grid->rows($organizationId, $monthYear, $filters);

        $lines = [$this->csvLine(self::COLUMNS)];

        foreach ($rows as $row) {
            $basic = $row['components']['basic'] ?? [];
            $hra = $row['components']['hra'] ?? [];
            $existingId = $basic['override_id'] ?? $hra['override_id'] ?? null;
            $status = $basic['status'] ?? $hra['status'] ?? null;

            $lines[] = $this->csvLine([
                $row['employee_number'],
                $row['employee_name'],
                $row['department'],
                $row['salary_structure'],
                $row['annual_ctc'],
                $basic['annual'] ?? null,
                // Writable columns ship BLANK. Pre-filling them would make an
                // unmodified round trip look like one edit per employee, which
                // is the difference between a usable format and a dangerous one.
                '',
                $hra['annual'] ?? self::NOT_APPLICABLE,
                '',
                $row['components']['special_allowance']['annual'] ?? null,
                $row['max_basic_annual'],
                '',
                '',
                '',
                '',
                $existingId,
                $status ?? 'none',
            ]);
        }

        // BOM, sep= and CRLF throughout — all three are Excel's requirements,
        // none of them ours.
        return self::EXCEL_PREAMBLE.implode("\r\n", $lines)."\r\n";
    }

    public function template(): string
    {
        return self::EXCEL_PREAMBLE
            .$this->csvLine(self::COLUMNS)."\r\n"
            .'# 100004,Example Employee,Care Delivery,Standard,1200000,480000,540000,240000,,416112,877015,2026-09-01,,preserve_ctc,Annual revision,,none'
            ."\r\n";
    }

    public function exportFilename(string $orgSlug, string $monthYear): string
    {
        return sprintf('component-overrides-%s-%s-%s.csv', $orgSlug, $monthYear, now()->format('YmdHi'));
    }

    // -------------------------------------------------------------- validate

    /**
     * Parse and judge a file without writing anything.
     *
     * @return array{ok: bool, status: int, payload: array<string, mixed>}
     */
    public function validate(
        int $organizationId,
        UploadedFile $file,
        ?string $defaultEffectiveFrom,
        ?string $defaultReason,
        string $monthYear
    ): array {
        $fileError = $this->checkFile($file);
        if ($fileError !== null) {
            return ['ok' => false, 'status' => 422, 'payload' => $fileError];
        }

        $raw = file_get_contents($file->getRealPath());

        if ($raw === false) {
            return ['ok' => false, 'status' => 422, 'payload' => $this->fileError(
                'F005',
                'That file could not be read. Save it as CSV UTF-8 and upload again.',
            )];
        }

        // Byte-order mark off, UTF-16 down to UTF-8 — before the encoding check,
        // because a UTF-16 file is not valid UTF-8 and would otherwise be
        // rejected as corrupt rather than simply converted.
        $raw = $this->normaliseEncoding($raw);

        if (! mb_check_encoding($raw, 'UTF-8')) {
            return ['ok' => false, 'status' => 422, 'payload' => $this->fileError(
                'F005',
                'Save the file as CSV UTF-8 and upload again.',
            )];
        }

        [$headers, $dataRows] = $this->parse($raw);

        if ($headers === []) {
            return ['ok' => false, 'status' => 422, 'payload' => $this->fileError('F004', 'The file has headers but no rows.')];
        }

        foreach (self::REQUIRED_HEADERS as $required) {
            if (! in_array($required, $headers, true)) {
                /*
                 * Names what it actually read.
                 *
                 * "Missing column: employee_number" on a file exported from
                 * this screen ten minutes earlier is unanswerable — the column
                 * is plainly there in Excel. Nine times out of ten the row
                 * arrived as one cell because the separator was a semicolon,
                 * and showing the parsed headers makes that obvious at a
                 * glance instead of requiring someone to guess.
                 */
                return ['ok' => false, 'status' => 422, 'payload' => $this->fileError(
                    'F003',
                    sprintf(
                        'Missing column: %s. The columns read from your file were: %s. '
                        .'If that looks like one long column, the file was saved with a different separator — '
                        .'re-save it as "CSV (Comma delimited)", or download the template and paste into that.',
                        $required,
                        $headers === [] ? '(none)' : implode(' | ', array_slice($headers, 0, 8)).(count($headers) > 8 ? ' …' : ''),
                    ),
                )];
            }
        }

        if ($dataRows === []) {
            return ['ok' => false, 'status' => 422, 'payload' => $this->fileError('F004', 'The file has headers but no rows.')];
        }

        if (count($dataRows) > self::MAX_ROWS) {
            return ['ok' => false, 'status' => 422, 'payload' => $this->fileError(
                'F002',
                sprintf('This file has %d rows. Split it into files of %d rows or fewer.', count($dataRows), self::MAX_ROWS),
            )];
        }

        $judged = $this->judge($organizationId, $headers, $dataRows, $defaultEffectiveFrom, $defaultReason, $monthYear);

        $batchId = (string) Str::uuid();
        Cache::put($this->cacheKey($batchId), [
            'organization_id' => $organizationId,
            'month_year' => $monthYear,
            'default_effective_from' => $defaultEffectiveFrom,
            'default_reason' => $defaultReason,
            'valid' => $judged['valid'],
        ], self::TTL_SECONDS);

        return ['ok' => true, 'status' => 200, 'payload' => [
            'success' => true,
            'batch_id' => $batchId,
            'expires_at' => now()->addSeconds(self::TTL_SECONDS)->toIso8601String(),
            'summary' => [
                'rows_read' => count($dataRows),
                'will_change' => count($judged['valid']),
                'no_change' => $judged['no_change'],
                'errors' => count($judged['errors']),
            ],
            'valid' => $judged['valid'],
            'errors' => $judged['errors'],
        ]];
    }

    /**
     * The row ladder. First failure per row wins, and the order is the spec's.
     *
     * @param  list<string>  $headers
     * @param  list<array{row: int, cells: list<string>}>  $dataRows
     * @return array{valid: list<array<string, mixed>>, errors: list<array<string, mixed>>, no_change: int}
     */
    private function judge(
        int $organizationId,
        array $headers,
        array $dataRows,
        ?string $defaultEffectiveFrom,
        ?string $defaultReason,
        string $monthYear
    ): array {
        $valid = [];
        $errors = [];
        $noChange = 0;

        $earliestOpen = $this->grid->earliestOpenMonth($organizationId);
        $overridable = $this->grid->overridableTargets($organizationId);
        $ambiguousResidual = $this->balancer->hasAmbiguousResidual($organizationId);

        $seenNumbers = [];

        foreach ($dataRows as $entry) {
            $row = $entry['row'];
            $spreadsheetRow = $row + 1;
            $cell = fn (string $header) => $this->cell($headers, $entry['cells'], $header);

            $number = trim((string) $cell('employee_number'));
            $basicRaw = trim((string) $cell('basic_annual'));
            $hraRaw = trim((string) $cell('hra_annual'));

            $fail = function (string $code, string $name, string $details, string $fix, ?string $column = null, ?int $suggested = null) use (&$errors, $row, $spreadsheetRow, $number) {
                $errors[] = array_filter([
                    'row' => $row,
                    'spreadsheet_row' => $spreadsheetRow,
                    'employee_number' => $number,
                    'code' => $code,
                    'name' => $name,
                    'details' => $details,
                    'fix' => $fix,
                    'column' => $column,
                    'suggested_value' => $suggested,
                ], fn ($v) => $v !== null);
            };

            /*
             * A row that changes nothing is neither valid nor an error —
             * unless the officer typed into the wrong column.
             *
             * The format puts the figure they want to change in a READ-ONLY
             * column and asks them to type into the blank one beside it. That
             * is backwards from how anyone edits a spreadsheet, and doing it
             * the natural way produced "0 will change, 17 unchanged" with no
             * hint that a deliberate edit had been discarded. Silently
             * ignoring a payroll change somebody made on purpose is the worst
             * outcome this importer has.
             */
            if ($basicRaw === '' && $hraRaw === '') {
                $misplaced = $this->misplacedEdit($organizationId, $number, [
                    'basic' => trim((string) $cell('basic_annual_current')),
                    'hra' => trim((string) $cell('hra_annual_current')),
                ]);

                if ($misplaced !== null) {
                    $fail('E017', 'Edited the read-only column',
                        sprintf(
                            '%s_annual_current was changed to %s. That column reports what is in force today and is ignored on import.',
                            $misplaced['target'],
                            $misplaced['typed'],
                        ),
                        sprintf(
                            'Put %s in the %s_annual column instead and clear %s_annual_current back to %s.',
                            $misplaced['typed'],
                            $misplaced['target'],
                            $misplaced['target'],
                            $misplaced['expected'],
                        ),
                        $misplaced['target'].'_annual',
                        (int) $misplaced['typed'],
                    );

                    continue;
                }

                $noChange++;

                continue;
            }

            // E003 — duplicate, checked before the lookup so the message can
            // name both rows.
            if (isset($seenNumbers[$number])) {
                $fail('E003', 'Duplicate employee in file',
                    sprintf('%s appears on rows %d and %d.', $number, $seenNumbers[$number] + 1, $spreadsheetRow),
                    'Keep one row per employee and remove the other.');

                continue;
            }
            $seenNumbers[$number] = $row;

            // E001
            $workInfo = EmployeeWorkInfo::query()
                ->where('organization_id', $organizationId)
                ->where('employee_code', $number)
                ->first();

            $employee = $workInfo
                ? User::where('organization_id', $organizationId)->find($workInfo->user_id)
                : null;

            if (! $employee) {
                $fail('E001', 'Employee number not found',
                    sprintf('No active employee with number %s in this organisation.', $number ?: '(blank)'),
                    'Check the number, or remove the row.', 'employee_number');

                continue;
            }

            // E002
            if ($workInfo->exit_date !== null || $workInfo->employment_status === 'exited') {
                $fail('E002', 'Employee has exited',
                    sprintf('%s (%s) exited on %s. Exited employees cannot be overridden.',
                        $employee->name, $number, $workInfo->exit_date?->toDateString() ?? 'an earlier date'),
                    'Remove the row, or process the change as part of full & final settlement.');

                continue;
            }

            // E004
            $template = EmployeePayrollTemplate::where('organization_id', $organizationId)
                ->where('user_id', $employee->id)
                ->first();

            if (! $template || ! $template->annual_ctc) {
                $fail('E004', 'No CTC on the payroll template',
                    sprintf('%s has no annual CTC, so there is nothing to balance against.', $number),
                    'Set the CTC on their payroll card first, then re-import.');

                continue;
            }

            $config = $this->grid->configFor($template);
            $monthlyCtc = (float) $template->annual_ctc / 12;
            $computed = $this->calculator->calculateSalaryComponents($monthlyCtc, $config);

            // E005 — a value for a component the structure does not produce.
            $hraApplicable = ($computed['hra'] ?? 0) > 0 || ($config['hra_percentage_of_basic'] ?? 0) > 0;
            if ($hraRaw !== '' && ! $hraApplicable) {
                $fail('E005', 'Component not in this structure',
                    sprintf('%s is on %s, which has no HRA component.', $number, $template->salaryTemplate?->name ?? 'their structure'),
                    'Clear the hra_annual cell, or move the employee to a structure that has it.', 'hra_annual');

                continue;
            }

            // E006 — the per-component gate.
            $gateError = null;
            if ($basicRaw !== '' && ! in_array('basic', $overridable, true)) {
                $gateError = ['basic', 'basic_annual'];
            } elseif ($hraRaw !== '' && ! in_array('hra', $overridable, true)) {
                $gateError = ['hra', 'hra_annual'];
            }

            if ($gateError !== null) {
                $fail('E006', 'Component is not overridable',
                    sprintf('%s is not enabled for employee-level override.', strtoupper($gateError[0])),
                    'Enable it in Pay Group Settings → Components, or clear the cell.', $gateError[1]);

                continue;
            }

            // E007 / E008 — numbers.
            $parsed = [];
            $numericFailure = null;
            foreach (['basic' => ['basic_annual', $basicRaw], 'hra' => ['hra_annual', $hraRaw]] as $target => [$column, $rawValue]) {
                if ($rawValue === '') {
                    continue;
                }

                if (! preg_match('/^\d+$/', $rawValue)) {
                    $numericFailure = ['E007', 'Value is not a whole number',
                        sprintf("'%s' in %s is not a number.", $rawValue, $column),
                        'Enter digits only — no ₹, no commas, no decimals. 540000, not ₹5,40,000.', $column];
                    break;
                }

                $parsed[$target] = (int) $rawValue;
            }

            if ($numericFailure !== null) {
                $fail(...$numericFailure);

                continue;
            }

            // E010 — the balancer cannot choose between two residuals.
            if ($ambiguousResidual) {
                $fail('E010', 'More than one residual component',
                    'Two or more components are marked as the residual, so the balancer cannot know which absorbs the delta.',
                    'Mark exactly one component as the residual in Pay Group Settings.');

                continue;
            }

            // E012 / E013 — dates.
            $fromRaw = trim((string) $cell('effective_from')) ?: (string) $defaultEffectiveFrom;
            $toRaw = trim((string) $cell('effective_to'));

            if ($fromRaw === '') {
                $fromRaw = MonthYear::start($earliestOpen)->toDateString();
            }

            $from = $this->parseDate($fromRaw);
            if ($from === null) {
                $fail('E012', 'Date is not readable',
                    sprintf("'%s' in effective_from is not a date.", $fromRaw),
                    'Use YYYY-MM-DD, for example 2026-09-01. Excel may have reformatted this — set the column to Text.',
                    'effective_from');

                continue;
            }

            $to = null;
            if ($toRaw !== '') {
                $to = $this->parseDate($toRaw);
                if ($to === null) {
                    $fail('E012', 'Date is not readable',
                        sprintf("'%s' in effective_to is not a date.", $toRaw),
                        'Use YYYY-MM-DD, for example 2027-03-31. Excel may have reformatted this — set the column to Text.',
                        'effective_to');

                    continue;
                }

                if ($to->lt($from)) {
                    $fail('E013', 'End date before start date',
                        sprintf('effective_to %s is before effective_from %s.', $to->toDateString(), $from->toDateString()),
                        sprintf('Clear effective_to for an open-ended override, or set it on or after %s.', $from->toDateString()),
                        'effective_to');

                    continue;
                }
            }

            // E011 — a closed month cannot be reopened by a spreadsheet.
            if ($from->format('Y-m') < $earliestOpen) {
                $fail('E011', 'Payroll for that month is closed',
                    sprintf('%s payroll is finalised. An override cannot be backdated into a closed month.', $from->format('Y-m')),
                    sprintf('Set effective_from to %s-01 or later, or reopen %s first.', $earliestOpen, $from->format('Y-m')),
                    'effective_from');

                continue;
            }

            // E015 — balance mode.
            $modeRaw = trim((string) $cell('balance_mode')) ?: OverrideBalancingService::MODE_PRESERVE_CTC;
            if (! in_array($modeRaw, [OverrideBalancingService::MODE_PRESERVE_CTC, OverrideBalancingService::MODE_INCREASE_GROSS], true)) {
                $fail('E015', 'Balance mode not recognised',
                    sprintf("'%s' is not a balance mode.", $modeRaw),
                    'Use preserve_ctc or increase_gross, or leave blank for preserve_ctc.', 'balance_mode');

                continue;
            }

            // E014 — a reason, because an override answers "what" and never "why".
            $reason = trim((string) $cell('reason')) ?: (string) $defaultReason;
            if ($reason === '') {
                $fail('E014', 'Reason is required',
                    sprintf('Row changes %s but has no reason.', implode(' and ', array_keys($parsed))),
                    'Add a reason, or set a default reason for the whole import.', 'reason');

                continue;
            }

            // A row whose values equal what is already in force changes nothing.
            $currentBasic = (int) round(($computed['basic'] ?? 0) * 12);
            $currentHra = (int) round(($computed['hra'] ?? 0) * 12);

            $changes = [];
            if (array_key_exists('basic', $parsed) && $parsed['basic'] !== $currentBasic) {
                $changes[] = ['target' => 'basic', 'from' => $currentBasic, 'to' => $parsed['basic']];
            }
            if (array_key_exists('hra', $parsed) && $parsed['hra'] !== $currentHra) {
                $changes[] = ['target' => 'hra', 'from' => $currentHra, 'to' => $parsed['hra']];
            }

            if ($changes === []) {
                $noChange++;

                continue;
            }

            /*
             * E009 — evaluated LAST, and on the row's net effect.
             *
             * A row that raises basic and lowers HRA together must be judged on
             * both together; judging basic alone would refuse a change that
             * balances perfectly well. That is the whole reason this ladder has
             * an order.
             */
            $hraPinned = array_key_exists('hra', $parsed);
            $assessConfig = $config;
            if ($hraPinned) {
                // HRA no longer follows basic, so it drops out of the
                // amplification — the delta costs 1 + p + g instead of 1+h+p+g.
                $assessConfig['hra_percentage_of_basic'] = 0.0;
            }

            $requestedBasicMonthly = array_key_exists('basic', $parsed)
                ? $parsed['basic'] / 12
                : (float) ($computed['basic'] ?? 0);

            if ($modeRaw === OverrideBalancingService::MODE_PRESERVE_CTC) {
                $residualAfter = $this->residualAfter($monthlyCtc, $assessConfig, $requestedBasicMonthly, $parsed, $computed);

                if ($residualAfter < -0.01) {
                    $max = $this->calculator->maxBasicWithinCtc($monthlyCtc, $assessConfig);
                    $fail('E009', 'Exceeds what this CTC supports',
                        sprintf('Basic of ₹%s leaves Special Allowance at −₹%s. The breakdown would not balance to CTC.',
                            $this->inr($requestedBasicMonthly * 12), $this->inr(abs($residualAfter) * 12)),
                        sprintf('Set Basic to ₹%s or below, or raise this employee\'s CTC first and re-import.',
                            $this->inr(floor($max) * 12)),
                        'basic_annual', (int) (floor($max) * 12));

                    continue;
                }
            }

            // E016 — an existing override is superseded rather than duplicated,
            // which the officer is told about rather than left to discover.
            $existing = PayrollOverride::query()
                ->where('user_id', $employee->id)
                ->where('scope', 'component')
                ->whereIn('target', array_keys($parsed))
                ->whereIn('status', [PayrollOverride::STATUS_PENDING, PayrollOverride::STATUS_APPROVED])
                ->get();

            $residualBefore = (float) ($computed['special_allowance'] ?? 0);
            $residualAfterOk = $this->residualAfter($monthlyCtc, $assessConfig, $requestedBasicMonthly, $parsed, $computed);

            $valid[] = [
                'row' => $row,
                'spreadsheet_row' => $spreadsheetRow,
                'user_id' => $employee->id,
                'employee_number' => $number,
                'employee_name' => $employee->name,
                'changes' => $changes,
                'residual_before' => (int) round($residualBefore * 12),
                'residual_after' => (int) round($residualAfterOk * 12),
                'amplification' => round($this->calculator->residualAbsorptionFactor($requestedBasicMonthly, $assessConfig), 4),
                'hra_moves_to' => $hraPinned
                    ? $parsed['hra']
                    : (int) round($requestedBasicMonthly * (float) $config['hra_percentage_of_basic'] * 12),
                'effective_from' => $from->toDateString(),
                'effective_to' => $to?->toDateString(),
                'balance_mode' => $modeRaw,
                'reason' => $reason,
                'supersedes' => $existing->pluck('id')->all(),
            ];
        }

        return ['valid' => $valid, 'errors' => $errors, 'no_change' => $noChange];
    }

    /**
     * Did the officer change a _current column instead of the writable one?
     *
     * The server knows what each _current column held when the file was
     * exported, so a difference is not ambiguity — it is a deliberate edit
     * placed one column to the left. Best effort throughout: an employee that
     * does not resolve, or a row with no figures, simply is not this mistake,
     * and must stay `no_change` rather than becoming a spurious error. An
     * export legitimately contains rows with a blank employee number.
     *
     * @param  array{basic: string, hra: string}  $currentCells
     * @return array{target: string, typed: string, expected: int}|null
     */
    private function misplacedEdit(int $organizationId, string $employeeNumber, array $currentCells): ?array
    {
        if ($employeeNumber === '') {
            return null;
        }

        $workInfo = EmployeeWorkInfo::query()
            ->where('organization_id', $organizationId)
            ->where('employee_code', $employeeNumber)
            ->first();

        if (! $workInfo) {
            return null;
        }

        $template = EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->where('user_id', $workInfo->user_id)
            ->first();

        if (! $template || ! $template->annual_ctc) {
            return null;
        }

        // The same builder the export used, so "what it said when you
        // downloaded it" and "what we compare against now" are one answer.
        $row = $this->grid->rows($organizationId, now()->format('Y-m'), [])
            ->firstWhere('user_id', $workInfo->user_id);

        if (! $row) {
            return null;
        }

        foreach (['basic', 'hra'] as $target) {
            $typed = $currentCells[$target] ?? '';

            if ($typed === '' || ! preg_match('/^\d+$/', $typed)) {
                continue;
            }

            $expected = $row['components'][$target]['annual'] ?? null;

            if ($expected !== null && (int) $typed !== (int) $expected) {
                return ['target' => $target, 'typed' => $typed, 'expected' => (int) $expected];
            }
        }

        return null;
    }

    /**
     * The residual once every value on the row has been applied.
     *
     * Delegated to OverrideChangeAssessor so this and the grid's batch endpoint
     * cannot drift: two implementations of the same money question eventually
     * disagree, and the disagreement surfaces as a payslip.
     *
     * @param  array<string, int>  $parsed
     * @param  array<string, float>  $computed
     */
    private function residualAfter(
        float $monthlyCtc,
        array $config,
        float $basicMonthly,
        array $parsed,
        array $computed
    ): float {
        return app(OverrideChangeAssessor::class)
            ->residualAfter($monthlyCtc, $config, $basicMonthly, $parsed, $computed);
    }

    // ---------------------------------------------------------------- commit

    /** @return array{ok: bool, status: int, payload: array<string, mixed>} */
    public function batch(string $batchId): ?array
    {
        return Cache::get($this->cacheKey($batchId));
    }

    public function committedResult(string $batchId): ?array
    {
        return Cache::get($this->cacheKey($batchId).':committed');
    }

    public function rememberCommit(string $batchId, array $result): void
    {
        // Held longer than the batch itself so a duplicate submit after the
        // batch expires still returns the first answer rather than a 410.
        Cache::put($this->cacheKey($batchId).':committed', $result, self::TTL_SECONDS * 4);
    }

    public function forget(string $batchId): void
    {
        Cache::forget($this->cacheKey($batchId));
    }

    private function cacheKey(string $batchId): string
    {
        return 'payroll-override-import:'.$batchId;
    }

    // ----------------------------------------------------------------- utils

    private function checkFile(UploadedFile $file): ?array
    {
        $extension = strtolower((string) $file->getClientOriginalExtension());

        if ($extension !== 'csv') {
            return $this->fileError('F001', 'Upload a .csv file. Excel workbooks (.xlsx) must be saved as CSV first.');
        }

        if ($file->getSize() > self::MAX_BYTES) {
            return $this->fileError('F002', sprintf('This file is larger than %d MB. Split it into smaller files.', self::MAX_BYTES / 1024 / 1024));
        }

        return null;
    }

    private function fileError(string $code, string $message): array
    {
        return ['success' => false, 'code' => $code, 'message' => $message];
    }

    /**
     * @return array{0: list<string>, 1: list<array{row: int, cells: list<string>}>}
     */
    /**
     * The delimiter this file actually uses.
     *
     * Excel writes the SYSTEM LIST SEPARATOR, not a comma — on a machine
     * configured for it, "Save as CSV" produces semicolons and every row
     * arrives as a single cell, so the header check fails on a file the
     * officer exported from this very screen minutes earlier. Tabs turn up
     * too, from "Unicode Text" and from anything pasted out of Sheets.
     *
     * Counted on the header line only, and outside quotes, because a name like
     * "Rao, Priya" would otherwise cast a vote for the comma.
     */
    private function sniffDelimiter(string $raw): string
    {
        $firstLine = strtok($raw, "\r\n");

        if ($firstLine === false) {
            return ',';
        }

        /*
         * An explicit sep= directive is the file telling us outright, so it
         * beats counting. Our own export writes one, and Excel preserves it
         * on a re-save — which means a round trip states its own separator
         * rather than leaving us to infer it.
         */
        if (preg_match('/^sep=(.)\s*$/i', $firstLine, $matches)) {
            return $matches[1];
        }

        $unquoted = preg_replace('/"[^"]*"/', '', $firstLine) ?? $firstLine;

        $counts = [
            ',' => substr_count($unquoted, ','),
            ';' => substr_count($unquoted, ';'),
            "\t" => substr_count($unquoted, "\t"),
            '|' => substr_count($unquoted, '|'),
        ];

        arsort($counts);
        $best = array_key_first($counts);

        // No separator at all means a single-column file; comma is the honest
        // default and the header check will report what it found.
        return $counts[$best] > 0 ? $best : ',';
    }

    /**
     * Strip whatever byte-order mark the spreadsheet left, and normalise
     * UTF-16 down to UTF-8.
     *
     * Our own export writes a UTF-8 BOM deliberately, so Excel renders ₹ and
     * Indian names correctly — which means the importer must expect one back.
     * Excel's "Unicode Text" save produces UTF-16 instead, which is not
     * decodable as UTF-8 at all and would otherwise be rejected as a corrupt
     * file rather than converted.
     */
    private function normaliseEncoding(string $raw): string
    {
        // UTF-16, little- and big-endian. Converted first, because everything
        // below assumes it is looking at UTF-8 bytes.
        if (str_starts_with($raw, "\xFF\xFE")) {
            $raw = (string) mb_convert_encoding(substr($raw, 2), 'UTF-8', 'UTF-16LE');
        } elseif (str_starts_with($raw, "\xFE\xFF")) {
            $raw = (string) mb_convert_encoding(substr($raw, 2), 'UTF-8', 'UTF-16BE');
        }

        /*
         * Then the BOM, unconditionally rather than as an else-branch: a
         * UTF-16 file usually carries one as its first CHARACTER too, which
         * survives the conversion above as UTF-8 bytes and would otherwise
         * make the first header read "\u{FEFF}employee_number".
         *
         * Stripped as raw bytes rather than by a /u-modified regex, which
         * returns null outright on any invalid sequence later in the file and
         * would blank the whole upload.
         */
        if (str_starts_with($raw, "\xEF\xBB\xBF")) {
            $raw = substr($raw, 3);
        }

        return $raw;
    }

    private function parse(string $raw): array
    {
        $delimiter = $this->sniffDelimiter($raw);

        $handle = fopen('php://temp', 'r+');
        fwrite($handle, $raw);
        rewind($handle);

        $headers = [];
        $rows = [];
        $dataRow = 0;

        while (($cells = fgetcsv($handle, 0, $delimiter)) !== false) {
            if ($cells === [null] || $cells === []) {
                continue;
            }

            $first = trim((string) ($cells[0] ?? ''));

            // The template ships a commented example; the parser skips it so
            // the officer can fill the file in underneath without deleting it.
            if (str_starts_with($first, '#')) {
                continue;
            }

            // The sep= directive our own export writes for Excel. Skipped
            // before headers are taken, or it would BE the header row.
            if ($headers === [] && preg_match('/^sep=.?$/i', $first)) {
                continue;
            }

            if ($headers === []) {
                $headers = array_map(fn ($h) => strtolower(trim((string) $h)), $cells);

                continue;
            }

            // A row of nothing but separators is Excel's trailing blank line.
            if (implode('', array_map(fn ($c) => trim((string) $c), $cells)) === '') {
                continue;
            }

            $dataRow++;
            $rows[] = ['row' => $dataRow, 'cells' => $cells];
        }

        fclose($handle);

        return [$headers, $rows];
    }

    /**
     * @param  list<string>  $headers
     * @param  list<string>  $cells
     */
    private function cell(array $headers, array $cells, string $header): ?string
    {
        $index = array_search($header, $headers, true);

        if ($index === false) {
            return null;
        }

        return $cells[$index] ?? null;
    }

    private function parseDate(string $value): ?Carbon
    {
        try {
            return Carbon::createFromFormat('Y-m-d', trim($value))->startOfDay();
        } catch (\Throwable) {
            return null;
        }
    }

    /** RFC 4180: quote only when the value contains a comma, quote or newline. */
    private function csvLine(array $values): string
    {
        return implode(',', array_map(function ($value) {
            $string = $value === null ? '' : (string) $value;

            if (preg_match('/[",\r\n]/', $string)) {
                return '"'.str_replace('"', '""', $string).'"';
            }

            return $string;
        }, $values));
    }

    /** en-IN grouping, for the human-readable half of an error only. */
    private function inr(float $amount): string
    {
        $rounded = (string) (int) round($amount);
        $negative = str_starts_with($rounded, '-');
        $digits = ltrim($rounded, '-');

        if (strlen($digits) <= 3) {
            return ($negative ? '-' : '').$digits;
        }

        $last3 = substr($digits, -3);
        $rest = substr($digits, 0, -3);
        $rest = preg_replace('/\B(?=(\d{2})+(?!\d))/', ',', $rest);

        return ($negative ? '-' : '').$rest.','.$last3;
    }
}
