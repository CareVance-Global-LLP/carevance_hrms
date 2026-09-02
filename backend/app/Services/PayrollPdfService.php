<?php

namespace App\Services;

use App\Models\PayrollItem;
use App\Models\User;
use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Support\Facades\Storage;

class PayrollPdfService
{
    private const EARNINGS_FIELDS = [
        'basic'              => 'Basic Salary',
        'hra'                => 'House Rent Allowance',
        'conveyance'         => 'Conveyance Allowance',
        'special_allowance'  => 'Special Allowance',
        'medical'            => 'Medical Allowance',
        'da'                 => 'Dearness Allowance',
        'cca'                => 'City Compensatory Allowance',
        'education'          => 'Education Allowance',
        'internet'           => 'Internet Allowance',
        'meal'               => 'Meal Allowance',
        'transport'          => 'Transport Allowance',
        'uniform'            => 'Uniform Allowance',
        'fuel_maintenance'   => 'Fuel & Maintenance',
        'variable_pay'       => 'Variable Pay',
        'performance_bonus'  => 'Performance Bonus',
        'retention_bonus'    => 'Retention Bonus',
        'arrears'            => 'Arrears',
        'leave_encashment'   => 'Leave Encashment',
        'notice_pay_addition'=> 'Notice Pay Addition',
        'custom_earnings'    => 'Custom Earnings',
        'shift_differential' => 'Shift Differential',
        'overtime_pay'       => 'Overtime Pay',
    ];

    private const DEDUCTION_FIELDS = [
        'pf_employee'     => 'Provident Fund',
        'esi_employee'    => 'Employee State Insurance',
        'pt'              => 'Professional Tax',
        'tds'             => 'Income Tax (TDS)',
        'nps_employee'    => 'NPS (Employee)',
        'vpf_employee'    => 'Voluntary PF',
        'lwf'             => 'Labour Welfare Fund',
        'lOP_deduction'   => 'Loss of Pay',
        'medical_insurance'=> 'Medical Insurance',
        'life_insurance'  => 'Life Insurance',
        'custom_deductions'=> 'Custom Deductions',
        'notice_pay_recovery'=> 'Notice Pay Recovery',
    ];

    /**
     * Deduction lines printed even when they come to nothing.
     *
     * Every other component is suppressed at zero, which is right — an org with
     * no labour welfare fund should not have an LWF line for a reader to skip
     * past. Income tax is the exception, because its absence is ambiguous in a
     * way no other line's is: a payslip with no tax row cannot distinguish
     * "tax was computed and came to nil under the new regime" from "tax never
     * ran". The first is a claim the employer can defend at assessment; the
     * second is the defect. A visible 0.00 makes it the first.
     */
    private const ALWAYS_SHOWN_DEDUCTIONS = ['tds'];

    /** Run states after which the figures on a payslip can no longer change. */
    private const FINAL_RUN_STATES = ['released', 'disbursed'];

    /**
     * Where a generated payslip PDF lives on disk, for a given version.
     *
     * Defined once and shared by the writer and the reader, because the one way
     * this goes wrong is the two disagreeing and a corrected month serving the
     * pre-correction file forever.
     *
     * Version 1 deliberately keeps the legacy unversioned name. Every file
     * already on disk was written before versioning existed and is by
     * definition version 1, so they all resolve without a rename — and a
     * migration that moves thousands of PDFs is a migration that can half-fail.
     *
     * A superseded payslip is NOT deleted when a correction supersedes it. That
     * is the whole divergence from Keka, whose rollback "clears and
     * regenerates" the documents: the PDF that was actually issued has to stay
     * retrievable, or the audit trail stops at the figure and never reaches the
     * document the employee was given.
     */
    public static function storagePathFor(int $userId, string $periodMonth, int $versionNo = 1): string
    {
        return $versionNo <= 1
            ? sprintf('payslips/%d/%s.pdf', $userId, $periodMonth)
            : sprintf('payslips/%d/%s-v%d.pdf', $userId, $periodMonth, $versionNo);
    }

    /**
     * Everything the payslip template prints, resolved from a stored item.
     *
     * Split out of generatePayslip so the document can be asserted on directly.
     * A payslip is evidence, and every defect the August 2026 QA pass found was
     * in what reached the template rather than in how dompdf drew it — so this
     * is the layer worth pinning.
     *
     * @return array<string, mixed>
     */
    public function payslipViewData(PayrollItem $item): array
    {
        $user = $item->user()->with([
            'employeeProfile',
            'employeeBankAccounts',
            'employeeGovernmentIds',
            'organization',
            'employeeWorkInfo',
            'payrollProfile',
        ])->first();

        $org = $user->organization;
        $run = $item->payrollRun;
        $monthYear = $run?->month_year ?? $item->month_year ?? now()->format('Y-m');

        $addressParts = array_filter([
            $org->address_line,
            trim(($org->city ?? '') . ', ' . ($org->state ?? '') . ' ' . ($org->postal_code ?? '')),
            $org->country,
        ]);

        $earnings = $this->buildComponents($item, self::EARNINGS_FIELDS);
        $deductions = $this->itemiseCustomDeductions(
            $item,
            $this->buildComponents($item, self::DEDUCTION_FIELDS, self::ALWAYS_SHOWN_DEDUCTIONS)
        );

        $divisorDays = (float) app(\App\Services\Payroll\PayrollDayBasisResolver::class)->forStoredItem($item);
        $lopDays = (float) ($item->lOP_days ?? 0);
        $grossFullMonth = (float) ($item->gross_full_month ?: $item->gross_salary);

        $bank = $user->employeeBankAccounts->firstWhere('is_default', true)
            ?? $user->employeeBankAccounts->first();

        $periodStart = \App\Support\MonthYear::start($monthYear);

        return [
            'employerName'          => $org->name ?? 'Organization',
            'companyAddress'        => implode('<br>', $addressParts),
            'logoBase64'            => $this->loadLogoBase64($org),
            'monthYear'             => $monthYear,
            'employeeName'          => $user->name,

            /*
             * A document of record needs to say which days it covers, when the
             * money moved and what to quote when querying it. None of the three
             * was printed: the slip named a month and nothing else, so two
             * payslips for the same month — an original and a correction — were
             * indistinguishable on paper.
             */
            'payPeriod'             => $periodStart->format('d M Y') . ' to ' . $periodStart->copy()->endOfMonth()->format('d M Y'),
            'payDate'               => $run?->pay_date ? \Carbon\Carbon::parse($run->pay_date)->format('d M Y') : null,
            'slipReference'         => sprintf('PS-%s-%d-v%d', $monthYear, $item->user_id, (int) ($item->current_version_no ?? 1)),

            /*
             * Only fields that have a value. The grid printed eight fixed cells
             * with an em-dash in every empty one, so a slip for somebody with no
             * sub-department, no UAN and no PF number was a third punctuation.
             * An em-dash is not a value; the absence of a row says the same
             * thing without pretending to be data.
             */
            'identityFields'        => $this->identityFields($user, $bank),

            'workingDays'           => $item->total_working_days ?? 0,
            /*
             * Paid days is the wage period less loss of pay, so the header
             * reconciles: paidDays + lopDays = totalDays. It used to be
             * days_present — an attendance count on a different basis to the
             * divisor the salary was actually spread across, so the two never
             * added up and neither matched the ECR's NCP days.
             */
            'totalDays'             => $divisorDays,
            'lopDays'               => $lopDays,
            'paidDays'              => max(0.0, round($divisorDays - $lopDays, 2)),

            /*
             * The divisor, named. Four day counts sat side by side with nothing
             * saying which one a day of absence was actually priced against, and
             * the answer differs by a third between a 26-day and a 31-day basis.
             */
            'payBasisNote'          => $this->payBasisNote($item, $divisorDays, $grossFullMonth),


            'basic'                 => (float) ($item->basic ?? 0),
            /*
             * THE TOTALS ARE THE SUMS OF THE COLUMNS ABOVE THEM.
             *
             * They used to be the stored `gross_salary` and `total_deductions`,
             * and neither matched what was printed. The components are a FULL
             * month while `gross_salary` is what was earned after loss of pay,
             * so the earnings column summed higher than (A); and loss of pay was
             * printed as a deduction while `total_deductions` deliberately
             * excludes it, so the deductions column summed higher than (B).
             * Irbaz mavli's August slip listed ₹11,659.50 over a total of
             * ₹10,155.05 and ₹2,103.19 over a total of ₹598.74 — both columns
             * contradicting their own totals, in opposite directions, from the
             * same missing ₹1,504.45.
             *
             * Summing what is printed makes the arithmetic true by construction:
             * (A) is the full month, (B) carries loss of pay alongside the
             * statutory lines, and A − B is unchanged at the net that is paid.
             *
             * The STORED columns keep their own meanings and are untouched —
             * `total_deductions` is money withheld, which is what the ECR, the
             * register and the accounting journal need. This is a presentation
             * total, and only the payslip uses it.
             */
            'grossSalary'           => round(array_sum(array_column($earnings, 'amount')), 2),
            'grossFullMonth'        => $grossFullMonth,
            'lopAmount'             => (float) $item->lOP_deduction,
            'totalDeductions'       => round(array_sum(array_column($deductions, 'amount')), 2),
            'netPay'                => (float) ($item->net_pay ?? 0),
            'netPayWords'           => $this->numberToWords($item->net_pay ?? 0),

            /*
             * Which version of this item the figures below represent.
             *
             * A payslip is a statement of fact on a date. Once a correction can
             * supersede a figure, an uncounted payslip is ambiguous — two PDFs
             * showing different net pay for the same month, both apparently
             * authoritative. Version 1 is the figure first paid; anything above
             * it means this month was corrected, and the superseded figure is
             * still retrievable from payroll_item_versions.
             */
            'versionNo'             => (int) ($item->current_version_no ?? 1),
            'isCorrected'           => (int) ($item->current_version_no ?? 1) > 1,

            /*
             * "Provisional" used to print on every payslip ever generated,
             * including disbursed months. A document that always calls itself
             * provisional never means it, so nobody reads the word — which is
             * exactly the failure mode when it finally matters.
             */
            'isProvisional'         => ($reasons = $this->provisionalReasons($item, $run)) !== [],
            'provisionalReasons'    => $reasons,

            'earningsComponents'    => $earnings,
            'deductionsComponents'  => $deductions,
            /*
             * The same lists padded to a common length with nulls.
             *
             * dompdf has no flexbox and no grid, so two tables of different row
             * counts put "Total Earnings (A)" and "Total Deductions (B)" at
             * different heights and A minus B could not be read across the page.
             * Padding is what floors both totals on one baseline. A spacer is
             * null, never a zero-valued line — a rendered 0.00 in a column of
             * real deductions reads as a deduction.
             */
            'earningsRows'          => $this->padRows($earnings, max(count($earnings), count($deductions))),
            'deductionsRows'        => $this->padRows($deductions, max(count($earnings), count($deductions))),

            'generatedAt'           => now()->format('d M Y, h:i A'),
        ];
    }

    /** The payslip as HTML, before dompdf draws it. */
    public function payslipHtml(PayrollItem $item): string
    {
        return view('pdf.payslip', $this->payslipViewData($item))->render();
    }

    public function generatePayslip(PayrollItem $item): Dompdf
    {
        $options = new Options();
        $options->set('isHtml5ParserEnabled', true);
        $options->set('isRemoteEnabled', false);
        $options->set('defaultFont', 'DejaVu Sans');

        $pdf = new Dompdf($options);
        $pdf->loadHtml($this->payslipHtml($item));
        $pdf->setPaper('A4', 'portrait');
        $pdf->render();

        return $pdf;
    }

    /**
     * The same ten rows on every payslip, in the same order.
     *
     * The account number is masked to its last four digits. Enough to recognise
     * which account was paid — the only question a payslip is asked about it —
     * and not enough to use, which matters because payslips get forwarded,
     * printed and left on desks far more freely than a bank record ever is.
     *
     * @return array<int, array{label: string, value: string}>
     */
    private function identityFields(User $user, $bank): array
    {
        $work = $user->employeeWorkInfo;
        $account = $bank?->account_number;

        $candidates = [
            'Employee Number' => $work?->employee_code,
            // `joining_date`, not `date_of_joining` — there is no such column, so
            // this row silently resolved to null and the payslip has never shown a
            // joining date. It read as an em-dash before empty fields were dropped,
            // which is why nobody noticed it was a bug rather than missing data.
            'Date Joined'     => $work?->joining_date?->format('d M Y'),
            'Designation'     => $work?->designation,
            'Department'      => $work?->department?->name ?? $work?->department_name,
            'PAN'             => $user->statutoryId('pan'),
            'UAN'             => $user->statutoryId('uan'),
            'Bank'            => $bank?->bank_name,
            'Bank Account'    => filled($account) ? $this->maskAccount((string) $account) : null,
            'IFSC'            => $bank?->ifsc_code,
            'Payment Mode'    => 'Bank Transfer (NEFT)',
        ];

        /*
         * EVERY SLIP CARRIES EVERY ROW, so two people's payslips look alike.
         *
         * Omitting empty fields reflowed the grid: somebody with a PAN on file
         * had ten values and three rows, somebody without had nine and two, and
         * everything below shifted. Two payslips from the same run did not look
         * like the same document, which is the first thing that makes a reader
         * doubt one of them.
         *
         * A missing value says so in words. That is the point of the earlier
         * change, not the fixed count: an em-dash is punctuation standing where
         * a fact should be, and a reader cannot tell it from a rendering fault.
         * "Not recorded" is a statement — it says the employer does not hold
         * this, which is true, and it is what the employee needs to read before
         * asking for it to be added.
         */
        $fields = [];
        foreach ($candidates as $label => $value) {
            $fields[] = [
                'label' => $label,
                'value' => filled($value) ? (string) $value : 'Not recorded',
            ];
        }

        return $fields;
    }

    private function maskAccount(string $account): string
    {
        $digits = preg_replace('/\s+/', '', $account);

        return strlen($digits) <= 4
            ? $digits
            : str_repeat('X', 4) . substr($digits, -4);
    }

    /**
     * What one day of absence costs, and what it was divided by.
     *
     * The four day counts in the header are all true and all different, and
     * nothing said which one priced a loss-of-pay day. It matters: the same
     * absence costs a third more on a 26-day basis than on a 31-day one, and
     * Payment of Wages Act s.9(2) caps the deduction at the proportion the
     * absent period bears to the wage period.
     */
    private function payBasisNote(PayrollItem $item, float $divisorDays, float $grossFullMonth): string
    {
        $resolver = \App\Services\Payroll\PayrollDayBasisResolver::class;
        $basis = (string) ($item->salary_day_basis ?? '');
        $perDay = $divisorDays > 0 ? round($grossFullMonth / $divisorDays, 2) : 0.0;

        $describe = match ($basis) {
            $resolver::BASIS_FIXED_30 => 'a fixed 30-day month',
            $resolver::BASIS_FIXED_26 => 'a fixed 26 days',
            $resolver::BASIS_ATTENDANCE => sprintf('%s scheduled working days', rtrim(rtrim(number_format($divisorDays, 2), '0'), '.')),
            default => 'calendar days',
        };

        return sprintf(
            'Pay is pro-rated on %s. One loss-of-pay day is 1/%s of monthly salary (%s).',
            $describe,
            rtrim(rtrim(number_format($divisorDays, 2), '0'), '.'),
            '₹ ' . number_format($perDay, 2)
        );
    }

    /**
     * Why this payslip is not final, in sentences somebody can act on.
     *
     * An empty array means final. Two things make a slip provisional and they
     * are different in kind: the run has not been released, so the figures can
     * still move; or a figure on it cannot be filed, which is a defect in the
     * record rather than in the process.
     *
     * @return array<int, string>
     */
    private function provisionalReasons(PayrollItem $item, $run): array
    {
        $reasons = [];
        $status = (string) ($run?->status ?? 'draft');

        if (! in_array($status, self::FINAL_RUN_STATES, true)) {
            $reasons[] = sprintf(
                'The payroll run for this month is %s and has not been released, so these figures may still change.',
                str_replace('_', ' ', $status)
            );
        }

        /*
         * A MISSING UAN IS NOT SAID HERE.
         *
         * PF deducted with no UAN on file cannot be filed — the monthly ECR is
         * keyed on the member's UAN — but the payslip is the wrong place to
         * raise it. It is the employee's copy of what they were paid, and a
         * warning they can do nothing about does not belong on it; the
         * readiness report is where that belongs, before the run.
         */

        return $reasons;
    }

    /**
     * @param  array<int, array{label: string, amount: float}>  $rows
     * @return array<int, array{label: string, amount: float}|null>
     */
    private function padRows(array $rows, int $to): array
    {
        return array_pad($rows, $to, null);
    }

    public function generatePayslipBase64(PayrollItem $item): string
    {
        $pdf = $this->generatePayslip($item);
        return base64_encode($pdf->output());
    }

    /**
     * Render an arbitrary Blade view to a Dompdf instance using the same
     * options as the payslip generator (no remote resources, DejaVu Sans).
     *
     * Used by the statutory filing generators (Form 12BA, Form 16 Part B,
     * Bonus Form C) that need to emit a human-readable PDF without pulling
     * in a separate PDF library.
     */
    public function renderPdf(string $view, array $data, string $paper = 'A4', string $orientation = 'portrait'): Dompdf
    {
        $options = new Options();
        $options->set('isHtml5ParserEnabled', true);
        $options->set('isRemoteEnabled', false);
        $options->set('defaultFont', 'DejaVu Sans');

        $pdf = new Dompdf($options);
        $html = view($view, $data)->render();
        $pdf->loadHtml($html);
        $pdf->setPaper($paper, $orientation);
        $pdf->render();

        return $pdf;
    }

    /**
     * Render a Blade view to a PDF and persist it to the local disk.
     * Returns the storage path; callers set `file_path`/`original_filename`
     * on the corresponding PayrollFiling record.
     */
    public function renderPdfToStorage(string $view, array $data, string $path, string $paper = 'A4', string $orientation = 'portrait'): void
    {
        $pdf = $this->renderPdf($view, $data, $paper, $orientation);
        Storage::disk('local')->put($path, $pdf->output());
    }

    private function loadLogoBase64($org): ?string
    {
        $logoUrl = $org->settings['branding']['logo_url'] ?? null;
        if (!$logoUrl) {
            return null;
        }

        // Convert /api/media/public/... to storage path
        $relativePath = preg_replace('#^/api/media/public/#', '', $logoUrl);

        if (!$relativePath || !Storage::disk('public')->exists($relativePath)) {
            return null;
        }

        $mimeType = Storage::disk('public')->mimeType($relativePath);
        $contents = Storage::disk('public')->get($relativePath);

        return 'data:' . $mimeType . ';base64,' . base64_encode($contents);
    }

    /**
     * Replace the lumped "Custom Deductions" line with what it is made of.
     *
     * `custom_deductions` mixes loan and advance recovery with deductions typed
     * into the run wizard, so the number alone cannot be decomposed even by
     * inference — somebody repaying two loans saw one figure and no way to tell
     * which of the two it went against, or how much was left on either. The run
     * already writes the breakdown to `deduction_lines` for exactly this
     * purpose; the payslip simply never read it.
     *
     * The outstanding balance rides on the label because it is the one thing a
     * borrower wants off a payslip, and the template has no third column.
     *
     * TWO CASES DELIBERATELY KEEP THE LUMP. An item written before this column
     * existed has no lines at all; and a set of lines whose amounts do not add
     * up to the stored total would, if printed, make the deductions column stop
     * reconciling to Total Deductions (B). A vague label is a poor payslip; a
     * payslip that contradicts its own total is a broken one.
     *
     * @param  array<int, array{label: string, amount: float}>  $deductions
     * @return array<int, array{label: string, amount: float}>
     */
    private function itemiseCustomDeductions(PayrollItem $item, array $deductions): array
    {
        $lumped = round((float) ($item->custom_deductions ?? 0), 2);
        $lines = is_array($item->deduction_lines) ? $item->deduction_lines : [];

        if ($lumped <= 0 || $lines === []) {
            return $deductions;
        }

        $itemised = [];
        foreach ($lines as $line) {
            $amount = round((float) ($line['amount'] ?? 0), 2);
            if ($amount <= 0) {
                continue;
            }

            /*
             * The instalment is named; the remaining balance is NOT printed.
             *
             * An outstanding figure is a second statement of account on a
             * document whose subject is one month, and it dates the instant it
             * is rendered — so a payslip reprinted six months later would
             * contradict the copy the employee is holding, with both looking
             * equally authoritative. The loan screen answers "how much is
             * left"; this answers "what came out this month".
             */
            $label = trim((string) ($line['label'] ?? 'Deduction')) ?: 'Deduction';

            $itemised[] = ['label' => $label, 'amount' => $amount];
        }

        if ($itemised === [] || round(array_sum(array_column($itemised, 'amount')), 2) !== $lumped) {
            return $deductions;
        }

        $out = [];
        foreach ($deductions as $component) {
            if ($component['label'] === self::DEDUCTION_FIELDS['custom_deductions']) {
                array_push($out, ...$itemised);
                continue;
            }
            $out[] = $component;
        }

        return $out;
    }

    /**
     * @param  array<string, string>  $fieldMap
     * @param  array<int, string>  $alwaysShow  Fields printed even at zero.
     * @return array<int, array{label: string, amount: float}>
     */
    private function buildComponents(PayrollItem $item, array $fieldMap, array $alwaysShow = []): array
    {
        $components = [];
        foreach ($fieldMap as $field => $label) {
            $amount = (float) ($item->{$field} ?? 0);
            if ($amount > 0 || in_array($field, $alwaysShow, true)) {
                $components[] = [
                    'label'  => $label,
                    'amount' => $amount,
                ];
            }
        }
        return $components;
    }

    private function numberToWords(float $number): string
    {
        $number = round($number, 2);
        $whole = (int) $number;
        $fraction = round(($number - $whole) * 100);

        if ($whole === 0 && $fraction === 0) {
            return 'Zero Rupees Only';
        }

        $ones = [
            '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
            'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
            'Seventeen', 'Eighteen', 'Nineteen',
        ];
        $tens = [
            '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
        ];

        $convert = function ($num) use ($ones, $tens, &$convert) {
            if ($num === 0) return '';
            if ($num < 20) return $ones[$num];
            if ($num < 100) return $tens[(int)($num / 10)] . ($num % 10 ? ' ' . $ones[$num % 10] : '');
            if ($num < 1000) return $ones[(int)($num / 100)] . ' Hundred' . ($num % 100 ? ' and ' . $convert($num % 100) : '');
            if ($num < 100000) return $convert((int)($num / 1000)) . ' Thousand' . ($num % 1000 ? ' ' . $convert($num % 1000) : '');
            if ($num < 10000000) return $convert((int)($num / 100000)) . ' Lakh' . ($num % 100000 ? ' ' . $convert($num % 100000) : '');
            return $convert((int)($num / 10000000)) . ' Crore' . ($num % 10000000 ? ' ' . $convert($num % 10000000) : '');
        };

        $words = $convert($whole) . ' Rupees';
        if ($fraction > 0) {
            $words .= ' and ' . $convert($fraction) . ' Paise';
        }
        $words .= ' Only';

        return $words;
    }
}
