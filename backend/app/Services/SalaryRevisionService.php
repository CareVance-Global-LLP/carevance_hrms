<?php

namespace App\Services;

use App\Models\SalaryRevisionLetter;
use App\Models\EmployeePayrollTemplate;
use App\Models\User;
use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Support\Facades\View;

class SalaryRevisionService
{
    protected PayrollCalculatorService $calculator;

    public function __construct(PayrollCalculatorService $calculator)
    {
        $this->calculator = $calculator;
    }

    public function generateLetter(int $userId, int $orgId, float $newCtc, string $revisionType, string $reason, int $generatedBy): SalaryRevisionLetter
    {
        $template = EmployeePayrollTemplate::where('user_id', $userId)
            ->where('organization_id', $orgId)
            ->firstOrFail();

        $oldCtc = (float) $template->annual_ctc;
        $revisionPercentage = $oldCtc > 0 ? round(($newCtc - $oldCtc) / $oldCtc * 100, 2) : 0;

        // The template stores percentages as whole numbers (40 = 40%); the
        // calculator's config takes fractions.
        $config = [
            'basic_percentage' => (float) ($template->basic_percentage ?? 40) / 100,
            'hra_percentage_of_basic' => (float) ($template->hra_percentage ?? 50) / 100,
            'conveyance_allowance' => (float) ($template->conveyance_allowance ?? 1600),
        ];

        $oldBreakdown = $this->calculator->calculatePayroll(
            annualCtc: $oldCtc,
            stateCode: $template->pt_state ?: '',
            isMetroCity: $template->is_metro_city ?? true,
            taxRegime: $template->tax_regime ?? 'new',
            customConfig: $config,
        );

        $newBreakdown = $this->calculator->calculatePayroll(
            annualCtc: $newCtc,
            stateCode: $template->pt_state ?: '',
            isMetroCity: $template->is_metro_city ?? true,
            taxRegime: $template->tax_regime ?? 'new',
            customConfig: $config,
        );

        $letter = SalaryRevisionLetter::create([
            'organization_id' => $orgId,
            'user_id' => $userId,
            'old_ctc' => $oldCtc,
            'new_ctc' => $newCtc,
            'revision_percentage' => $revisionPercentage,
            'revision_type' => $revisionType,
            'effective_from' => now()->startOfMonth(),
            'reason' => $reason,
            'old_breakdown' => $oldBreakdown,
            'new_breakdown' => $newBreakdown,
            'status' => 'draft',
            'generated_by' => $generatedBy,
        ]);

        $this->generateLetterPdf($letter);

        return $letter;
    }

    private function generateLetterPdf(SalaryRevisionLetter $letter): void
    {
        $user = User::with('employeeWorkInfo')->find($letter->user_id);
        $org = \App\Models\Organization::find($letter->organization_id);

        $options = new Options();
        $options->set('isHtml5ParserEnabled', true);
        $options->set('defaultFont', 'DejaVu Sans');

        $pdf = new Dompdf($options);
        $html = View::make('pdf.salary_revision', [
            'employee' => $user,
            'organization' => $org,
            'letter' => $letter,
            'oldBreakdown' => $letter->old_breakdown,
            'newBreakdown' => $letter->new_breakdown,
        ])->render();

        $pdf->loadHtml($html);
        $pdf->setPaper('A4', 'portrait');
        $pdf->render();

        $filename = sprintf('salary_revision_%s_%s.pdf', $user->id, $letter->id);
        $path = "revisions/{$letter->organization_id}/{$filename}";
        \Illuminate\Support\Facades\Storage::disk('local')->put($path, $pdf->output());

        $letter->update([
            'letter_file_path' => $path,
            'status' => 'generated',
        ]);
    }

    public function getLetterHistory(int $userId, int $orgId): array
    {
        return SalaryRevisionLetter::where('user_id', $userId)
            ->where('organization_id', $orgId)
            ->orderBy('created_at', 'desc')
            ->get()
            ->toArray();
    }

    public function acceptLetter(int $letterId, int $userId): SalaryRevisionLetter
    {
        $letter = SalaryRevisionLetter::where('id', $letterId)
            ->where('user_id', $userId)
            ->firstOrFail();

        $letter->update([
            'status' => 'accepted',
            'accepted_at' => now(),
        ]);

        EmployeePayrollTemplate::where('user_id', $userId)
            ->where('organization_id', $letter->organization_id)
            ->update(['annual_ctc' => $letter->new_ctc]);

        return $letter->fresh();
    }

    public function rejectLetter(int $letterId, int $userId): SalaryRevisionLetter
    {
        $letter = SalaryRevisionLetter::where('id', $letterId)
            ->where('user_id', $userId)
            ->firstOrFail();

        $letter->update([
            'status' => 'rejected',
            'rejected_at' => now(),
        ]);

        return $letter->fresh();
    }
}
