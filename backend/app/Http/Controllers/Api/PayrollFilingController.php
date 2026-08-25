<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\GenerateRunFilings;
use App\Models\EmployeeDocument;
use App\Models\EmployeePerquisite;
use App\Models\FbpAllocation;
use App\Models\FbpClaim;
use App\Models\FbpComponent;
use App\Models\Organization;
use App\Models\PayGroup;
use App\Models\EmployeeBankAccount;
use App\Models\EmployeeTaxDeclaration;
use App\Models\PayrollFiling;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\PayrollRunChecklist;
use App\Models\SalaryRevisionLetter;
use App\Models\User;
use App\Models\VariablePayAssignment;
use App\Services\Approvals\ApprovalRoutingService;
use App\Services\PayrollCalculatorService;
use App\Services\PayrollFilingService;
use App\Services\PayrollFilingValidatorService;
use App\Services\PTStateService;
use App\Services\PortalAdapter;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class PayrollFilingController extends Controller
{
    public function generatePfEcr(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generatePfEcr($run, auth()->user()->organization_id, auth()->id());

        return response()->json($filing);
    }

    public function generateEsiChallan(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generateEsiChallan($run, auth()->user()->organization_id, auth()->id());

        return response()->json($filing);
    }

    public function generateForm24Q(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generateForm24Q($run, auth()->user()->organization_id, auth()->id());

        return response()->json($filing);
    }

    public function generateForm16(Request $request, PayrollFilingService $filingService)
    {
        $data = $request->validate([
            'user_id' => 'required|exists:users,id',
            'financial_year' => 'required|string|regex:/^\d{4}-\d{4}$/',
        ]);

        // Verify the employee belongs to this organization
        $employee = User::where('id', $data['user_id'])
            ->where('organization_id', auth()->user()->organization_id)
            ->first();
        if (!$employee) {
            return response()->json([
                'message' => 'Employee not found in your organization.',
            ], 422);
        }

        try {
            $filing = $filingService->generateForm16(
                $data['user_id'],
                $data['financial_year'],
                auth()->user()->organization_id,
                auth()->id()
            );

            return response()->json($filing);
        } catch (\RuntimeException $e) {
            // Return a user-friendly error when no payroll data exists
            if (strpos($e->getMessage(), 'No payroll items found') !== false) {
                return response()->json([
                    'success' => false,
                    'message' => 'No payroll data found for this financial year. Please process payroll before generating Form 16.',
                    'error_code' => 'NO_PAYROLL_DATA',
                ], 422);
            }
            // Re-throw other runtime exceptions
            throw $e;
        }
    }

    /**
     * Upload Form 16 Part A and Part B zip files.
     * Extracts PDFs and matches them to employees by PAN.
     */
    public function uploadForm16(Request $request)
    {
        $data = $request->validate([
            'part_a_zip' => 'required|file|mimes:zip|max:102400', // 100MB max
            'part_b_zip' => 'required|file|mimes:zip|max:102400',
            'financial_year' => 'required|string|regex:/^\d{4}-\d{4}$/',
        ]);

        $orgId = auth()->user()->organization_id;
        $financialYear = $data['financial_year'];

        $unmatched = [];
        $invalidFiles = [];
        $matchedCount = 0;

        // Process Part A zip
        $partAResult = $this->processZipForForm16(
            $data['part_a_zip'],
            'A',
            $orgId,
            $financialYear
        );
        $matchedCount += $partAResult['matched'];
        $unmatched = array_merge($unmatched, $partAResult['unmatched']);
        $invalidFiles = array_merge($invalidFiles, $partAResult['invalid']);

        // Process Part B zip
        $partBResult = $this->processZipForForm16(
            $data['part_b_zip'],
            'B',
            $orgId,
            $financialYear
        );
        $matchedCount += $partBResult['matched'];
        $unmatched = array_merge($unmatched, $partBResult['unmatched']);
        $invalidFiles = array_merge($invalidFiles, $partBResult['invalid']);

        return response()->json([
            'matched' => $matchedCount,
            'unmatched' => $unmatched,
            'invalid_files' => $invalidFiles,
        ]);
    }

/**
      * Process a single zip file for Form 16 uploads.
      */
    private function processZipForForm16($zipFile, string $part, int $orgId, string $financialYear): array
    {
        $unmatched = [];
        $invalid = [];
        $matched = 0;

        $tempDir = storage_path('app/temp/form16_' . uniqid());
        if (!is_dir($tempDir)) {
            mkdir($tempDir, 0755, true);
        }

        $zipPath = $tempDir . '/upload.zip';
        
        // Move uploaded file to temp location
        $zipFile->move($tempDir, 'upload.zip');

        try {
            $zip = new \ZipArchive();
            if (!$zip->open($zipPath)) {
                return ['matched' => 0, 'unmatched' => [], 'invalid' => ['Failed to open zip file']];
            }

            for ($i = 0; $i < $zip->numFiles; $i++) {
                $entry = $zip->getNameIndex($i);
                
                // Skip directories and non-PDFs
                if (substr($entry, -1) === '/' || !str_ends_with(strtolower($entry), '.pdf')) {
                    continue;
                }

                $filename = basename($entry);
                $zip->extractTo($tempDir, $entry);
                $pdfPath = $tempDir . '/' . $entry;

                if (!file_exists($pdfPath)) {
                    continue;
                }

                // Extract PAN from filename: Form16_{FinancialYear}_{PAN}.pdf
                // e.g., Form16_2025-26_ABCDE1234F.pdf
                $pan = $this->extractPanFromFilename($filename);

                if (!$pan || !preg_match('/^[A-Z]{5}[0-9]{4}[A-Z]$/', $pan)) {
                    $invalid[] = $filename;
                    continue;
                }

                // Look up employee by PAN.
                //
                // Through the blind index, not the column: pan_number is
                // encrypted, and Laravel's encryption is randomised, so the
                // same PAN produces different ciphertext on every write and a
                // direct equality match would never find anybody.
                $employee = User::where('organization_id', $orgId)
                    ->whereHas('employeeProfile', function ($q) use ($pan) {
                        $q->wherePii('pan_number', $pan);
                    })
                    ->first();

                if (!$employee) {
                    $unmatched[] = [
                        'filename' => $filename,
                        'extracted_pan' => $pan,
                        'reason' => 'No employee found with this PAN',
                    ];
                    continue;
                }

                // Store as EmployeeDocument
                $storedPath = 'employee_documents/form16/' . $employee->id . '/part_' . $part . '/' . $filename;
                Storage::disk('local')->put($storedPath, file_get_contents($pdfPath));

                EmployeeDocument::create([
                    'organization_id' => $orgId,
                    'user_id' => $employee->id,
                    'title' => 'Form 16 Part ' . $part,
                    'category' => 'form_16',
                    'file_path' => $storedPath,
                    'file_name' => $filename,
                    'file_disk' => 'local',
                    'mime_type' => 'application/pdf',
                    'file_size' => filesize($pdfPath),
                    'uploaded_by' => auth()->id(),
                    'uploaded_at' => now(),
                    'financial_year' => $financialYear,
                    'part' => $part,
                ]);

                $matched++;
            }

            $zip->close();
        } catch (\Exception $e) {
            // Log error but continue
            \Illuminate\Support\Facades\Log::error('Form 16 upload error (part ' . $part . ')', [
                'error' => $e->getMessage(),
            ]);
        }

        // Clean up temp files
        $this->cleanupTempDir($tempDir);

        return ['matched' => $matched, 'unmatched' => $unmatched, 'invalid' => $invalid];
    }

    /**
     * Extract PAN from TRACES filename format.
     * Format: Form16_{FinancialYear}_{PAN}.pdf (e.g., Form16_2025-26_ABCDE1234F.pdf)
     */
    private function extractPanFromFilename(string $filename): ?string
    {
        // Remove extension
        $name = pathinfo($filename, PATHINFO_FILENAME);
        
        // Split by underscore and get last segment
        $parts = explode('_', $name);
        return end($parts) ?: null;
    }

/**
      * Clean up temporary directory.
      */
    private function cleanupTempDir(string $path): void
    {
        if (!is_dir($path)) {
            return;
        }
        
        $files = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($path, \RecursiveDirectoryIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );
        
        foreach ($files as $file) {
            $file->isDir() ? rmdir($file->getRealPath()) : unlink($file->getRealPath());
        }
        rmdir($path);
    }

    public function generateForm12BA(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generateForm12BA($run, auth()->user()->organization_id, auth()->id());

        return response()->json($filing);
    }

    public function generatePtReturn(Request $request, PayrollFilingService $filingService)
    {
        $data = $request->validate([
            'payroll_run_id' => 'required|exists:payroll_monthly_runs,id',
            'state' => 'required|string',
            'pay_group_id' => 'nullable|integer|exists:pay_groups,id',
        ]);
        $run = PayrollMonthlyRun::findOrFail($data['payroll_run_id']);
        $this->assertRunFileable($run);
        $filing = $filingService->generatePtReturn($run, $data['state'], auth()->user()->organization_id, auth()->id(), $data['pay_group_id'] ?? null);

        return response()->json($filing);
    }

    public function generateLwfReturn(Request $request, PayrollFilingService $filingService)
    {
        $data = $request->validate([
            'payroll_run_id' => 'required|exists:payroll_monthly_runs,id',
            'state' => 'required|string',
            'pay_group_id' => 'nullable|integer|exists:pay_groups,id',
        ]);
        $run = PayrollMonthlyRun::findOrFail($data['payroll_run_id']);
        $this->assertRunFileable($run);
        try {
            $filing = $filingService->generateLwfReturn($run, $data['state'], auth()->user()->organization_id, auth()->id(), $data['pay_group_id'] ?? null);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json($filing);
    }

    public function generateBonusFormC(Request $request, PayrollFilingService $filingService)
    {
        $data = $request->validate([
            'payroll_run_id' => 'required|exists:payroll_monthly_runs,id',
            'bonus_percent' => 'required|numeric|min:8.33|max:20',
            'financial_year' => 'nullable|string|regex:/^\d{4}-\d{4}$/',
        ]);
        $run = PayrollMonthlyRun::findOrFail($data['payroll_run_id']);
        $this->assertRunFileable($run);
        try {
            $filing = $filingService->generateBonusFormC(
                $run,
                auth()->user()->organization_id,
                auth()->id(),
                (float) $data['bonus_percent'],
                $data['financial_year'] ?? null
            );
        } catch (\InvalidArgumentException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json($filing);
    }

    public function generateBonusFormD(Request $request, PayrollFilingService $filingService)
    {
        $data = $request->validate([
            'payroll_run_id' => 'required|exists:payroll_monthly_runs,id',
            'bonus_percent' => 'required|numeric|min:8.33|max:20',
            'financial_year' => 'nullable|string|regex:/^\d{4}-\d{4}$/',
        ]);
        $run = PayrollMonthlyRun::findOrFail($data['payroll_run_id']);
        $this->assertRunFileable($run);
        try {
            $filing = $filingService->generateBonusFormD(
                $run,
                auth()->user()->organization_id,
                auth()->id(),
                (float) $data['bonus_percent'],
                $data['financial_year'] ?? null
            );
        } catch (\InvalidArgumentException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json($filing);
    }

    public function generateBonusFormE(Request $request, PayrollFilingService $filingService)
    {
        $data = $request->validate([
            'payroll_run_id' => 'required|exists:payroll_monthly_runs,id',
            'bonus_percent' => 'required|numeric|min:8.33|max:20',
            'financial_year' => 'nullable|string|regex:/^\d{4}-\d{4}$/',
        ]);
        $run = PayrollMonthlyRun::findOrFail($data['payroll_run_id']);
        $this->assertRunFileable($run);
        try {
            $filing = $filingService->generateBonusFormE(
                $run,
                auth()->user()->organization_id,
                auth()->id(),
                (float) $data['bonus_percent'],
                $data['financial_year'] ?? null
            );
        } catch (\InvalidArgumentException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json($filing);
    }

    public function generateBonusAll(Request $request, PayrollFilingService $filingService)
    {
        $data = $request->validate([
            'payroll_run_id' => 'required|exists:payroll_monthly_runs,id',
            'bonus_percent' => 'required|numeric|min:8.33|max:20',
            'financial_year' => 'nullable|string|regex:/^\d{4}-\d{4}$/',
        ]);
        $run = PayrollMonthlyRun::findOrFail($data['payroll_run_id']);
        $this->assertRunFileable($run);
        try {
            $filings = $filingService->generateBonusAll(
                $run,
                auth()->user()->organization_id,
                auth()->id(),
                (float) $data['bonus_percent'],
                $data['financial_year'] ?? null
            );
        } catch (\InvalidArgumentException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json(['filings' => $filings, 'count' => count($filings)]);
    }

    public function generateForm19(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generateForm19($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateForm31(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generateForm31($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateForm1(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generateForm1($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateForm2(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generateForm2($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateForm6(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generateForm6($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateEShramRegistration(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generateEShramRegistration($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateUanActivation(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generateUanActivation($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateSeRegistration(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generateSeRegistration($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateShramCardRegistration(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generateShramCardRegistration($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateForm124(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generateForm124($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateFullEcr(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generateFullEcr($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateAllFilings(Request $request, PayrollFilingService $filingService)
    {
        $data = $request->validate([
            'payroll_run_id' => 'required|exists:payroll_monthly_runs,id',
            'pay_group_id' => 'nullable|integer|exists:pay_groups,id',
        ]);
        $run = PayrollMonthlyRun::findOrFail($data['payroll_run_id']);
        $this->assertRunFileable($run);

        // Refuse a second pass while one is in flight: two workers would both
        // generate the same statutory files for the same run.
        if (in_array($run->filings_state, ['queued', 'running'], true)) {
            return response()->json([
                'success' => false,
                'message' => 'Filings for this run are already being generated. Watch the progress rather than starting again.',
            ], 409);
        }

        $run->update([
            'filings_state' => 'queued',
            'filings_total' => 0,
            'filings_done' => 0,
            'filings_failed' => 0,
            'filings_skipped' => 0,
            'filings_started_at' => null,
            'filings_finished_at' => null,
            'filings_message' => null,
        ]);

        GenerateRunFilings::dispatch(
            $run->id,
            (int) auth()->user()->organization_id,
            (int) auth()->id(),
            $data['pay_group_id'] ?? null
        );

        // 202: accepted, not finished. Ten to fifteen generators, each walking
        // every payroll item and multiplied by the states the organization
        // operates in, is not work to hold an HTTP request open for. Progress is
        // polled from payroll/runs/{id}/processing-status under `filings`.
        //
        // Under the `sync` queue driver the job has already run by the time we
        // reach here, so the run is re-read and the caller sees a finished state
        // immediately — the client polls identically either way.
        $run->refresh();

        return response()->json([
            'success' => true,
            'message' => 'Filing generation started. Track progress on this run.',
            'filings_state' => $run->filings_state,
            'filings_message' => $run->filings_message,
            'count' => (int) $run->filings_done,
        ], 202);
    }

    /**
     * Pre-flight validation report for a filing type against a run. Returns a
     * green/red "ready to file" checklist (errors block, warnings are advisory).
     */
    public function validateFiling(Request $request, PayrollFilingValidatorService $validator)
    {
        $data = $request->validate([
            'payroll_run_id' => 'required|exists:payroll_monthly_runs,id',
            'type' => 'required|string',
            'state' => 'nullable|string',
            'bonus_percent' => 'nullable|numeric',
            'user_id' => 'nullable|integer',
            'financial_year' => 'nullable|string',
        ]);

        $run = PayrollMonthlyRun::findOrFail($data['payroll_run_id']);
        $runStateErrors = $validator->validateRunState($run);

        $result = $validator->validate($run, $data['type'], [
            'state' => $data['state'] ?? null,
            'bonus_percent' => $data['bonus_percent'] ?? null,
            'user_id' => $data['user_id'] ?? null,
            'financial_year' => $data['financial_year'] ?? null,
        ]);

        $errors = array_merge($runStateErrors, $result['errors']);

        return response()->json([
            'type' => $data['type'],
            'ready' => $errors === [],
            'errors' => $errors,
            'warnings' => $result['warnings'],
            'run_status' => $run->status,
        ]);
    }

    /**
     * Validate the run state only (used by the UI to gate the whole Generate tab).
     */
    public function validateRun(Request $request, PayrollFilingValidatorService $validator)
    {
        $data = $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($data['payroll_run_id']);
        $errors = $validator->validateRunState($run);

        return response()->json([
            'run_status' => $run->status,
            'ready' => $errors === [],
            'errors' => $errors,
        ]);
    }

    /**
     * Submits a generated filing to the internal reviewer (maker-checker).
     * Routes the reviewer via ApprovalRoutingService, matching the payroll-run
     * approval pattern. Sets status -> submitted.
     */
    public function submitForReview(Request $request, ApprovalRoutingService $routing, int $id)
    {
        $filing = PayrollFiling::where('id', $id)
            ->where('organization_id', auth()->user()->organization_id)
            ->firstOrFail();

        if (! in_array($filing->status, ['generated', 'rejected', 'submitted'])) {
            return response()->json(['success' => false, 'message' => 'Only generated filings can be submitted for review.'], 422);
        }
        if (empty($filing->file_path)) {
            return response()->json(['success' => false, 'message' => 'This filing has no generated file. Generate it before submitting.'], 422);
        }

        $requester = auth()->user();
        $reviewerIds = $routing->reviewerUserIds($requester);

        $filing->status = 'submitted';
        $filing->submitted_at = now();
        $filing->submitted_by = $requester->id;
        $filing->reviewer_user_id = $reviewerIds->first(); // nearest reviewer
        $filing->review_note = $request->input('note');
        $filing->portal_status = 'pending_upload';
        $filing->save();

        return response()->json([
            'filing' => $filing,
            'reviewer_ids' => $reviewerIds->all(),
            'message' => 'Filing submitted for internal review.',
        ]);
    }

    /**
     * Reviewer approves the filing -> approved. Still must be filed by a human.
     */
    public function approveFiling(Request $request, int $id)
    {
        $filing = PayrollFiling::where('id', $id)
            ->where('organization_id', auth()->user()->organization_id)
            ->firstOrFail();

        if ($filing->status !== 'submitted') {
            return response()->json(['success' => false, 'message' => 'Only submitted filings can be approved.'], 422);
        }

        $filing->status = 'approved';
        $filing->approved_at = now();
        $filing->approved_by = auth()->id();
        $filing->review_note = $request->input('note', $filing->review_note);
        $filing->save();

        return response()->json(['filing' => $filing, 'message' => 'Filing approved. It is ready for the human to file on the portal.']);
    }

    /**
     * Reviewer rejects the filing -> back to generated with a note.
     */
    public function rejectFiling(Request $request, int $id)
    {
        $request->validate(['note' => 'required|string']);
        $filing = PayrollFiling::where('id', $id)
            ->where('organization_id', auth()->user()->organization_id)
            ->firstOrFail();

        if ($filing->status !== 'submitted') {
            return response()->json(['success' => false, 'message' => 'Only submitted filings can be rejected.'], 422);
        }

        $filing->status = 'generated';
        $filing->review_note = $request->input('note');
        $filing->submitted_at = null;
        $filing->submitted_by = null;
        $filing->reviewer_user_id = null;
        $filing->save();

        return response()->json(['filing' => $filing, 'message' => 'Filing rejected and returned to generated.']);
    }

    /**
     * Records that the human filed the return on the government portal. Uses the
     * already-existing acknowledgment_number / filed_by / filed_at columns.
     */
    public function markFiled(Request $request, int $id)
    {
        $data = $request->validate([
            'acknowledgment_number' => 'required|string|max:100',
            'portal_status' => 'nullable|in:pending_upload,uploaded,paid,error',
            'notes' => 'nullable|string',
            /*
             * The date it was filed ON, which is often not today: people record
             * a filing after the fact, and back-dating it correctly is the
             * difference between "filed on time" and "filed late".
             */
            'filed_on' => 'nullable|date',
            /*
             * The portal's acknowledgement, in the SAME request. Splitting it
             * into a second step means the second step gets skipped, and a
             * filing nobody can evidence is what this table exists to prevent.
             */
            'receipt' => 'nullable|file|max:10240|mimes:pdf,png,jpg,jpeg',
        ]);

        $filing = PayrollFiling::where('id', $id)
            ->where('organization_id', auth()->user()->organization_id)
            ->firstOrFail();

        if (! in_array($filing->status, \App\Models\PayrollFiling::REVIEW_STATUSES)) {
            return response()->json(['success' => false, 'message' => 'This filing cannot be marked filed in its current state.'], 422);
        }

        $filing->status = 'filed';
        $filing->filed_at = ! empty($data['filed_on'])
            ? \Carbon\Carbon::parse($data['filed_on'])
            : now();
        $filing->filed_by = auth()->id();
        $filing->acknowledgment_number = $data['acknowledgment_number'];
        $filing->portal_status = $data['portal_status'] ?? 'paid';
        if (! empty($data['notes'])) {
            $filing->notes = $data['notes'];
        }

        if ($request->hasFile('receipt')) {
            $this->storeReceipt($filing, $request->file('receipt'));
        }

        $filing->save();

        return response()->json(['filing' => $filing->fresh(), 'message' => 'Filing recorded as filed.']);
    }

    /**
     * Attach the acknowledgement the portal handed back.
     *
     * Separate from markFiled because the receipt often arrives later — EPFO
     * returns the challan immediately, ESIC sometimes the next day — and
     * forcing them into one step means people either wait (and forget to record
     * the filing at all) or record it and never come back with the evidence.
     */
    public function uploadFilingReceipt(Request $request, int $id)
    {
        $request->validate([
            'receipt' => 'required|file|max:10240|mimes:pdf,png,jpg,jpeg',
        ]);

        $filing = PayrollFiling::where('id', $id)
            ->where('organization_id', auth()->user()->organization_id)
            ->firstOrFail();

        if (! $filing->filed_at) {
            return response()->json([
                'success' => false,
                'message' => 'Record this as filed first — an acknowledgement with no filing behind it has nothing to acknowledge.',
            ], 422);
        }

        $this->storeReceipt($filing, $request->file('receipt'));
        $filing->save();

        return response()->json([
            'success' => true,
            'filing' => $filing->fresh(),
            'message' => 'Acknowledgement attached.',
        ]);
    }

    public function downloadFilingReceipt(int $id)
    {
        $filing = PayrollFiling::where('id', $id)
            ->where('organization_id', auth()->user()->organization_id)
            ->firstOrFail();

        if (! $filing->receipt_path || ! Storage::disk('local')->exists($filing->receipt_path)) {
            return response()->json(['error' => 'No acknowledgement on file'], 404);
        }

        return Storage::disk('local')->download(
            $filing->receipt_path,
            $filing->receipt_original_filename ?: 'acknowledgement.pdf'
        );
    }

    /**
     * The last state: the authority has confirmed receipt.
     *
     * `acknowledged` and `acknowledged_at` were declared on the model, cast,
     * and written by nothing in the codebase — so the lifecycle stopped at
     * "filed", and the difference between "we uploaded it" and "they accepted
     * it" could not be recorded. That difference is the entire question during
     * an inspection.
     */
    public function acknowledgeFiling(Request $request, int $id)
    {
        $data = $request->validate([
            'acknowledgment_number' => 'nullable|string|max:100',
            'acknowledged_on' => 'nullable|date',
            'notes' => 'nullable|string',
        ]);

        $filing = PayrollFiling::where('id', $id)
            ->where('organization_id', auth()->user()->organization_id)
            ->firstOrFail();

        if ($filing->status !== 'filed') {
            return response()->json([
                'success' => false,
                'message' => 'Only a filed return can be acknowledged.',
            ], 422);
        }

        $filing->status = 'acknowledged';
        $filing->acknowledged_at = ! empty($data['acknowledged_on'])
            ? \Carbon\Carbon::parse($data['acknowledged_on'])
            : now();

        // The number is often only final at acknowledgement, so allow it to be
        // corrected here rather than making somebody withdraw and refile.
        if (! empty($data['acknowledgment_number'])) {
            $filing->acknowledgment_number = $data['acknowledgment_number'];
        }

        if (! empty($data['notes'])) {
            $filing->notes = $data['notes'];
        }

        $filing->save();

        return response()->json([
            'success' => true,
            'filing' => $filing->fresh(),
            'message' => 'Filing acknowledged.',
        ]);
    }

    /**
     * Record a return that was prepared outside this system.
     *
     * A consultant-prepared 24Q is still the organisation's filing. Refusing to
     * record it does not make it go away — it means the compliance history on
     * this screen is wrong, and the one place somebody would look to answer
     * "did we file August" says no when the answer is yes.
     */
    public function uploadFiling(Request $request)
    {
        $data = $request->validate([
            'type' => 'required|string|in:'.implode(',', PayrollFiling::TYPES),
            'period_month' => 'nullable|string|max:2',
            'period_year' => 'required|integer|min:2000|max:2100',
            'period_type' => 'nullable|string|in:monthly,quarterly,annual',
            'document' => 'required|file|max:10240|mimes:pdf,txt,csv,xlsx,xls,png,jpg,jpeg',
            'notes' => 'nullable|string',
        ]);

        $organizationId = auth()->user()->organization_id;
        $file = $request->file('document');
        $stored = $file->store("filings/{$organizationId}/uploaded", 'local');

        $filing = PayrollFiling::create([
            'organization_id' => $organizationId,
            'type' => $data['type'],
            'period_type' => $data['period_type'] ?? 'monthly',
            'period_month' => $data['period_month'] ?? null,
            'period_year' => $data['period_year'],
            'status' => 'generated',
            /*
             * Never 'ready'. We did not produce this file and cannot vouch for
             * its format — claiming otherwise is exactly the overclaim this
             * column exists to prevent.
             */
            'compliance_status' => 'reference_only',
            'file_path' => $stored,
            'original_filename' => $file->getClientOriginalName(),
            'source' => 'uploaded',
            'generated_at' => now(),
            'generated_by' => auth()->id(),
            'notes' => $data['notes'] ?? null,
        ]);

        return response()->json([
            'success' => true,
            'filing' => $filing,
            'message' => 'Return recorded.',
        ], 201);
    }

    /**
     * What is due this period, and whether it has been dealt with.
     *
     * Status is joined against the real filing rows, so an empty tenant
     * correctly shows everything as not generated rather than inventing
     * progress. Deadlines come from FilingDueDates, which carries the provision
     * each date is drawn from.
     */
    public function filingCalendar(Request $request, \App\Services\Payroll\FilingDueDates $dueDates)
    {
        $data = $request->validate([
            'month_year' => 'nullable|string|regex:/^\d{4}-\d{2}$/',
        ]);

        $monthYear = $data['month_year'] ?? now()->format('Y-m');
        [$year, $month] = explode('-', $monthYear);
        $organizationId = auth()->user()->organization_id;

        /*
         * The states this organisation actually pays PT in — never a default.
         * Professional tax is state-levied and several states levy none, so
         * assuming one invents a deadline for a return that does not exist.
         */
        $ptStates = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereNotNull('pt_state')
            ->distinct()
            ->pluck('pt_state')
            ->filter()
            ->values();

        $existing = PayrollFiling::where('organization_id', $organizationId)
            ->where('period_year', (int) $year)
            ->where(function ($q) use ($month) {
                $q->where('period_month', $month)->orWhereNull('period_month');
            })
            ->get()
            ->keyBy('type');

        $registry = new \App\Services\Payroll\FilingGeneratorRegistry();
        $catalogue = $registry->all();
        $rows = [];

        foreach ($dueDates->scheduledTypes() as $type) {
            if (! isset($catalogue[$type])) {
                continue;
            }

            $state = $type === 'pt_return' ? $ptStates->first() : null;
            $filing = $existing->get($type);

            $rows[] = array_merge(
                $dueDates->assess($type, $monthYear, $state, $filing?->filed_at),
                [
                    'type' => $type,
                    'label' => $catalogue[$type]['label'],
                    'available' => $catalogue[$type]['available'],
                    'status' => $filing?->status ?? 'not_generated',
                    'filing_id' => $filing?->id,
                    'acknowledgment_number' => $filing?->acknowledgment_number,
                    'has_receipt' => (bool) $filing?->receipt_path,
                    'state' => $state,
                ]
            );
        }

        // Soonest first, but anything already overdue leads.
        usort($rows, function ($a, $b) {
            $rank = fn ($r) => match ($r['urgency']) {
                'overdue' => 0, 'critical' => 1, 'due_soon' => 2, 'scheduled' => 3, default => 4,
            };

            return [$rank($a), $a['due_date'] ?? '9999-99-99'] <=> [$rank($b), $b['due_date'] ?? '9999-99-99'];
        });

        return response()->json([
            'success' => true,
            'month_year' => $monthYear,
            'data' => $rows,
            'overdue_count' => count(array_filter($rows, fn ($r) => $r['urgency'] === 'overdue')),
        ]);
    }

    /**
     * Persist an uploaded acknowledgement against a filing.
     *
     * Deliberately NOT written to file_path: that column holds the return we
     * generated, and overwriting it would destroy the very document the
     * acknowledgement is evidence for.
     */
    private function storeReceipt(PayrollFiling $filing, $file): void
    {
        $filing->receipt_path = $file->store("filings/{$filing->organization_id}/receipts", 'local');
        $filing->receipt_original_filename = $file->getClientOriginalName();
        $filing->receipt_uploaded_at = now();
        $filing->receipt_uploaded_by = auth()->id();
    }

    /**
     * Returns the portal adapter info (upload target + instructions) for a filing.
     */
    public function portalInfo(int $id, PortalAdapter $adapter)
    {
        $filing = PayrollFiling::with(['generatedBy', 'filedBy', 'submittedBy', 'approvedBy'])
            ->where('id', $id)
            ->where('organization_id', auth()->user()->organization_id)
            ->firstOrFail();

        $org = Organization::find(auth()->user()->organization_id);
        $info = $adapter->resolve($filing, $org);

        return response()->json(array_merge($info, [
            'filing_id' => $filing->id,
            'status' => $filing->status,
            'portal_status' => $filing->portal_status,
            'file_path' => $filing->file_path,
            'has_file' => ! empty($filing->file_path),
            'can_upload' => $filing->isReadyToUpload(),
        ]));
    }

    /**
     * Reviewer queue: filings submitted and awaiting review in this org.
     */
    public function reviewQueue(Request $request)
    {
        $user = auth()->user();
        $query = PayrollFiling::with(['generatedBy', 'submittedBy'])
            ->where('organization_id', $user->organization_id)
            ->where('status', 'submitted');

        // Restrict to filings routed to this reviewer (nearest), unless admin.
        if (! in_array($user->role, ['admin', 'super_admin'])) {
            $query->where('reviewer_user_id', $user->id);
        }

        return response()->json($query->orderBy('submitted_at', 'desc')->paginate(20));
    }

    /**
     * Which statutory filings this installation can actually produce.
     *
     * The dashboard used to carry its own hardcoded array of nineteen
     * returns, every one of them marked ready — including the ten whose
     * blade templates do not exist. Serving the catalogue from the registry
     * means the screen cannot drift from the truth again, and a template
     * landing on disk is the whole act of making its filing available.
     */
    public function catalogue(\App\Services\Payroll\FilingGeneratorRegistry $registry)
    {
        return response()->json([
            'success' => true,
            'data' => [
                'filings' => collect($registry->all())
                    ->map(fn (array $meta) => [
                        'label' => $meta['label'],
                        'available' => $meta['available'],
                        'unavailable_reason' => $meta['unavailable_reason'],
                    ])
                    ->all(),
            ],
        ]);
    }

    public function listFilings(Request $request)
    {
        $query = PayrollFiling::where('organization_id', auth()->user()->organization_id);

        if ($request->type) {
            $query->where('type', $request->type);
        }
        if ($request->status) {
            $query->where('status', $request->status);
        }
        if ($request->period_year) {
            $query->where('period_year', $request->period_year);
        }

        /*
         * Counts over the WHOLE filtered set, not the page.
         *
         * The screen's metric cards used to count the rows it had been handed,
         * which is a page of twenty — so an organisation with 141 filings read
         * "Generated 20 · Awaiting filing 20" and would have read exactly that
         * for ever, however many it filed. A number that stops moving is worse
         * than no number, because people go on trusting it.
         *
         * Cloned before pagination so the filters still apply.
         */
        $counts = (clone $query)
            ->selectRaw('status, COUNT(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status');

        $page = $query->orderBy('created_at', 'desc')->paginate(20);

        return response()->json(array_merge($page->toArray(), [
            'counts' => [
                'all' => (int) $counts->sum(),
                // Produced, and still sitting with us.
                'awaiting_filing' => (int) ($counts['generated'] ?? 0)
                    + (int) ($counts['submitted'] ?? 0)
                    + (int) ($counts['approved'] ?? 0),
                'filed' => (int) ($counts['filed'] ?? 0),
                'acknowledged' => (int) ($counts['acknowledged'] ?? 0),
                'failed' => (int) ($counts['error'] ?? 0),
                'by_status' => $counts,
            ],
        ]));
    }

    public function downloadFiling(int $id)
    {
        $filing = PayrollFiling::where('id', $id)
            ->where('organization_id', auth()->user()->organization_id)
            ->firstOrFail();

        if (! $filing->file_path || ! Storage::disk('local')->exists($filing->file_path)) {
            return response()->json(['error' => 'File not found'], 404);
        }

        return Storage::disk('local')->download($filing->file_path, $filing->original_filename);
    }

    public function getFiling(int $id)
    {
        $filing = PayrollFiling::with(['generatedBy', 'filedBy', 'submittedBy', 'approvedBy'])
            ->where('organization_id', auth()->user()->organization_id)
            ->findOrFail($id);

        return response()->json($filing);
    }

    /**
     * Safety guard (Plan Phase E): a statutory filing may only be generated from
     * a run that has been locked/approved. Generating from a draft run would
     * produce returns on unverified numbers — block it server-side, not just
     * in the UI.
     */
    private function assertRunFileable(PayrollMonthlyRun $run): void
    {
        if (! in_array($run->status, ['locked', 'approved', 'released', 'disbursed'])) {
            abort(422, 'Payroll run is not approved/locked. Process, lock and approve the run before generating statutory filings.');
        }
    }

    public function storePayGroup(Request $request)
    {
        $data = $request->validate([
            'name' => 'required|string',
            'code' => 'required|string|unique:pay_groups,code',
            'description' => 'nullable|string',
            'pay_frequency' => 'required|in:monthly,weekly,biweekly,daily',
            'pay_day' => 'nullable|integer|min:1|max:31',
            'pay_day_type' => 'required|in:specific,last_working_day,last_day',
            'salary_template_id' => 'nullable|exists:salary_templates,id',
        ]);
        $data['organization_id'] = auth()->user()->organization_id;
        return response()->json(\App\Models\PayGroup::create($data), 201);
    }

    /**
     * List all active pay groups in the caller's organization with
     * per-group payroll aggregates for the requested month.
     */
    public function listPayGroups(Request $request)
    {
        $orgId = auth()->user()->organization_id;
        $monthYear = $request->get('month_year', now()->format('Y-m'));

        $payGroups = PayGroup::where('organization_id', $orgId)
            ->where('is_active', true)
            ->with(['assignments' => function ($q) {
                $q->where('is_active', true);
            }])
            ->get()
            ->map(function ($group) use ($monthYear) {
                $userIds = $group->assignments->pluck('user_id')->all();

                $items = empty($userIds)
                    ? collect()
                    : PayrollItem::whereIn('user_id', $userIds)
                        ->where('month_year', $monthYear)
                        ->get();

                $processedCount = $items
                    ->where('payment_status', '!=', 'pending')
                    ->count();
                $paidCount = $items
                    ->where('payment_status', 'paid')
                    ->count();
                $totalNetPay = (float) $items
                    ->where('payment_status', 'paid')
                    ->sum('net_pay');

                return [
                    'id' => $group->id,
                    'name' => $group->name,
                    'code' => $group->code,
                    'pay_frequency' => $group->pay_frequency,
                    'employee_count' => (int) $userIds ? count($userIds) : 0,
                    'processed_count' => $processedCount,
                    'paid_count' => $paidCount,
                    'total_net_pay' => $totalNetPay,
                ];
            })
            ->values();

        return response()->json(['pay_groups' => $payGroups]);
    }

    /**
     * Get the active employees in a pay group with their per-month
     * payroll status. Response shape mirrors getDepartmentEmployees so
     * the EmployeeCard component is shared.
     * Query: ?month_year=YYYY-MM (default: current month)
     */
    public function getPayGroupEmployees(int $id, Request $request)
    {
        $monthYear = $request->get('month_year', now()->format('Y-m'));

        $payGroup = PayGroup::where('id', $id)
            ->where('organization_id', $request->user()->organization_id)
            ->firstOrFail();

        $userIds = $payGroup->assignments()
            ->where('is_active', true)
            ->pluck('user_id')
            ->all();

        if (empty($userIds)) {
            $employees = collect();
        } else {
            $users = User::whereIn('id', $userIds)
                ->with(['employeeProfile', 'employeeWorkInfo', 'groups'])
                ->get()
                ->keyBy('id');

            $payrollItems = PayrollItem::whereIn('user_id', $userIds)
                ->where('month_year', $monthYear)
                ->get()
                ->keyBy('user_id');

            $templates = \App\Models\EmployeePayrollTemplate::where('organization_id', $request->user()->organization_id)
                ->whereIn('user_id', $userIds)
                ->get()
                ->keyBy('user_id');

            // Fetch attendance summaries in bulk for the requested month
            $attendanceService = app(\App\Services\Attendance\AttendanceService::class);
            $attendanceMap = [];
            foreach ($userIds as $uid) {
                $u = $users->get($uid);
                if (!$u) continue;
                try {
                    $summary = $attendanceService->monthlyAttendanceSummary($u, $monthYear);
                    $attendanceMap[$uid] = [
                        'working_days' => round($summary['working_days'] ?? 0),
                        'present_days' => round($summary['present_days'] ?? 0),
                        'paid_leave_days' => round($summary['paid_leave_days'] ?? 0),
                        'lop_days' => round($summary['total_lop_days'] ?? 0),
                        'overtime_hours' => round(($summary['overtime_seconds'] ?? 0) / 3600, 2),
                    ];
                } catch (\Throwable $e) {
                    $attendanceMap[$uid] = [
                        'working_days' => 26,
                        'present_days' => 26,
                        'paid_leave_days' => 0,
                        'lop_days' => 0,
                        'overtime_hours' => 0,
                    ];
                }
            }

            $employees = collect($userIds)->map(function ($uid) use ($users, $payrollItems, $templates, $attendanceMap, $monthYear) {
                $u = $users->get($uid);
                if (!$u) return null;

                $item = $payrollItems->get($uid);
                $template = $templates->get($uid);
                $group = $u->groups->first();

                // Reset step completions when the stored month doesn't
                // match the requested month. Prevents April completions
                // from showing as complete in June.
                $stepsMatch = $template && $template->steps_month_year === $monthYear;

                return [
                    'id' => $u->id,
                    'name' => $u->name,
                    'email' => $u->email,
                    'role' => $u->role,
                    'avatar' => $u->avatar,
                    'employee_code' => $u->employeeWorkInfo?->employee_code,
                    'designation' => $u->employeeWorkInfo?->designation,
                    'department' => $group?->name,
                    'annual_ctc' => (float) ($template?->annual_ctc ?? 0),
                    'attendance' => $attendanceMap[$uid] ?? null,
                    'steps_completed' => [
                        'step1' => $stepsMatch && (bool) ($template?->step1_completed),
                        'step2' => $stepsMatch && (bool) ($template?->step2_completed),
                        'step3' => $stepsMatch && (bool) ($template?->step3_completed),
                        'step4' => $stepsMatch && (bool) ($template?->step4_completed),
                        'step5' => $stepsMatch && (bool) ($template?->step5_completed),
                        'step6' => $stepsMatch && (bool) ($template?->step6_completed),
                    ],
                    'current_step' => (int) ($template?->current_step ?? 1),
                    'payroll_status' => [
                        'is_processed' => (bool) $item,
                        'net_pay' => $item ? (float) $item->net_pay : 0,
                        'payment_status' => $item?->payment_status ?? 'pending',
                        'gross_salary' => $item ? (float) $item->gross_salary : 0,
                        'total_deductions' => $item ? (float) $item->total_deductions : 0,
                    ],
                ];
            })->filter()->values();
        }

        return response()->json([
            'pay_group' => [
                'id' => $payGroup->id,
                'name' => $payGroup->name,
                'code' => $payGroup->code,
                'pay_frequency' => $payGroup->pay_frequency,
            ],
            'employees' => $employees,
        ]);
    }

    /**
     * Mark a single wizard step as complete for the given employees
     * in a pay group. Used by the Bulk Payroll Matrix view.
     *
     * Body: { step: 1..6, user_ids: number[] }
     */
    public function completeStep(Request $request, int $id): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'step' => 'required|integer|min:1|max:6',
            'user_ids' => 'required|array|min:1',
            'user_ids.*' => 'integer|exists:users,id',
            'month_year' => 'nullable|string',
        ]);

        $organizationId = $request->user()->organization_id;

        $payGroup = PayGroup::where('id', $id)
            ->where('organization_id', $organizationId)
            ->first();
        if (!$payGroup) {
            return response()->json(['success' => false, 'message' => 'Pay group not found'], 404);
        }

        $userIds = array_values(array_unique(array_map('intval', $data['user_ids'])));
        $validUserIds = \App\Models\PayGroupAssignment::where('pay_group_id', $id)
            ->where('organization_id', $organizationId)
            ->where('is_active', true)
            ->whereIn('user_id', $userIds)
            ->pluck('user_id')
            ->all();

        if (count($validUserIds) === 0) {
            return response()->json([
                'success' => false,
                'message' => 'No valid members found in this pay group',
            ], 422);
        }

        $existing = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $validUserIds)
            ->pluck('user_id')
            ->toArray();

        $missing = array_diff($validUserIds, $existing);
        if (!empty($missing)) {
            foreach ($missing as $uid) {
                \App\Models\EmployeePayrollTemplate::getOrCreateForUser($uid, $organizationId);
            }
        }

        $monthYear = $data['month_year'] ?? now()->format('Y-m');

        // When switching months, reset ALL step completions first.
        // Without this, step2_completed=true from April leaks into
        // June as soon as we write steps_month_year="2026-06".
        // Also reset when steps_month_year is null (old templates).
        $hasOldMonth = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $validUserIds)
            ->where(function ($q) use ($monthYear) {
                $q->whereNull('steps_month_year')
                  ->orWhere('steps_month_year', '')
                  ->orWhere('steps_month_year', '!=', $monthYear);
            })
            ->exists();

        $updateData = $this->buildStepUpdateData((int) $data['step'], $monthYear, $hasOldMonth);

        $updated = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $validUserIds)
            ->update($updateData);

        return response()->json([
            'success' => true,
            'step' => $data['step'],
            'updated_count' => $updated,
        ]);
    }

    /**
     * Mark a single wizard step as complete for every active member
     * of a pay group in one shot. Used by the Bulk Payroll Matrix's
     * "Done All for Step N" button.
     *
     * Body: { step: 1..6 }
     */
    public function completeAllSteps(Request $request, int $id): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'step' => 'required|integer|min:1|max:6',
            'month_year' => 'nullable|string',
        ]);

        $organizationId = $request->user()->organization_id;

        $payGroup = PayGroup::where('id', $id)
            ->where('organization_id', $organizationId)
            ->first();
        if (!$payGroup) {
            return response()->json(['success' => false, 'message' => 'Pay group not found'], 404);
        }

        $userIds = \App\Models\PayGroupAssignment::where('pay_group_id', $id)
            ->where('organization_id', $organizationId)
            ->where('is_active', true)
            ->pluck('user_id')
            ->all();

        if (count($userIds) === 0) {
            return response()->json([
                'success' => false,
                'message' => 'No active members in this pay group',
            ], 422);
        }

        $existing = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $userIds)
            ->pluck('user_id')
            ->toArray();

        $missing = array_diff($userIds, $existing);
        if (!empty($missing)) {
            foreach ($missing as $uid) {
                \App\Models\EmployeePayrollTemplate::getOrCreateForUser($uid, $organizationId);
            }
        }

        $monthYear = $data['month_year'] ?? now()->format('Y-m');

        // Same month-reset logic as completeStep.
        $hasOldMonth = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $userIds)
            ->where(function ($q) use ($monthYear) {
                $q->where('steps_month_year', '!=', $monthYear)
                  ->orWhereNull('steps_month_year');
            })
            ->exists();

        $updateData = $this->buildStepUpdateData((int) $data['step'], $monthYear, $hasOldMonth);

        $updated = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $userIds)
            ->update($updateData);

        return response()->json([
            'success' => true,
            'step' => $data['step'],
            'updated_count' => $updated,
            'total_members' => count($userIds),
        ]);
    }

    /**
     * Build the update payload for marking a wizard step complete.
     *
     * Two reset modes:
     *
     *  - Cross-month ($hasOldMonth = true): the stored steps_month_year
     *    differs from the current month, so ALL step completions are
     *    wiped first (then the current step is re-set). This is the
     *    "fresh start" when moving from April to June.
     *
     *  - Same-month ($hasOldMonth = false): completing Step N
     *    invalidates every step AFTER N (N+1..6), because those steps
     *    were derived from the now-changed Step N inputs. Steps before
     *    N are preserved. Without this, re-running Step 1 to fix
     *    attendance would leave Steps 2-6 stale (still showing green).
     */
    private function buildStepUpdateData(int $step, string $monthYear, bool $hasOldMonth): array
    {
        $column = "step{$step}_completed";
        $updateData = ['steps_month_year' => $monthYear];

        if ($hasOldMonth) {
            for ($s = 1; $s <= 6; $s++) {
                $updateData["step{$s}_completed"] = false;
            }
            $updateData[$column] = true;
        } else {
            $updateData[$column] = true;
            for ($s = $step + 1; $s <= 6; $s++) {
                $updateData["step{$s}_completed"] = false;
            }
        }

        return $updateData;
    }

    public function getStepStatus(Request $request, int $id): \Illuminate\Http\JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $payGroup = PayGroup::where('id', $id)
            ->where('organization_id', $organizationId)
            ->first();
        if (!$payGroup) {
            return response()->json(['success' => false, 'message' => 'Pay group not found'], 404);
        }

        $userIds = \App\Models\PayGroupAssignment::where('pay_group_id', $id)
            ->where('organization_id', $organizationId)
            ->where('is_active', true)
            ->pluck('user_id')
            ->all();

        $totalMembers = count($userIds);

        if ($totalMembers === 0) {
            return response()->json([
                'pay_group_id' => $id,
                'total_members' => 0,
                'steps' => array_fill(1, 6, ['completed_count' => 0, 'pending_count' => 0]),
            ]);
        }

        $rows = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $userIds)
            ->get(['user_id', 'step1_completed', 'step2_completed', 'step3_completed', 'step4_completed', 'step5_completed', 'step6_completed']);

        $steps = [];
        for ($n = 1; $n <= 6; $n++) {
            $col = "step{$n}_completed";
            $completed = $rows->where($col, true)->count();
            $steps[$n] = [
                'completed_count' => $completed,
                'pending_count' => $totalMembers - $completed,
            ];
        }

        return response()->json([
            'pay_group_id' => $id,
            'total_members' => $totalMembers,
            'steps' => $steps,
        ]);
    }

    public function compareTaxRegimes(Request $request)
    {
        $data = $request->validate([
            'user_id' => 'required|exists:users,id',
            'annual_ctc' => 'nullable|numeric|min:0',
        ]);

        try {
            $orgId = auth()->user()->organization_id;

            $employee = User::where('id', $data['user_id'])
                ->where('organization_id', $orgId)
                ->first();
            if (!$employee) {
                return response()->json(['success' => false, 'message' => 'Employee not found in your organization.'], 422);
            }

            $template = \App\Models\EmployeePayrollTemplate::where('user_id', $data['user_id'])
                ->where('organization_id', $orgId)
                ->first();

            $annualCtc = $data['annual_ctc'] ?? ($template ? (float) $template->annual_ctc : 0);
            if ($annualCtc <= 0) {
                return response()->json(['success' => false, 'message' => 'Annual CTC is required or must be set in the employee template.'], 422);
            }

            $basic = $annualCtc * 0.40;
            $hra = $annualCtc * 0.20;
            $conveyance = min(1600 * 12, $annualCtc * 0.05);
            $special = $annualCtc - $basic - $hra - $conveyance;
            $grossMonthly = $annualCtc / 12;
            $gross = $grossMonthly;

            $pfEmployee = min($basic / 12, 1800);
            $pfAnnual = $pfEmployee * 12;
            $esiMonthly = min($gross * 0.0075, 212.50);
            $esiAnnual = $esiMonthly * 12;
            $ptAnnual = $this->calculateProfessionalTax($template?->pt_state, $grossMonthly);

            // The standard deduction and cess are the engine's, not ours: it
            // knows the old regime's is 50,000 and the new regime's is 75,000,
            // and it returns a cess-inclusive total. Doing either by hand here
            // is what made this screen disagree with payroll.
            $oldRegime = $this->annualTaxBreakdown('old', $annualCtc, ['section_80c' => $pfAnnual]);
            $oldRegimeTaxable = $oldRegime['taxable_income'];
            $oldRegimeTotalTax = $oldRegime['total_tax'] + $ptAnnual + $esiAnnual;
            $oldRegimeTakeHome = $annualCtc - $oldRegimeTotalTax - $pfAnnual;

            $newRegime = $this->annualTaxBreakdown('new', $annualCtc);
            $newRegimeTaxable = $newRegime['taxable_income'];
            $newRegimeTotalTax = $newRegime['total_tax'] + $ptAnnual;
            $newRegimeTakeHome = $annualCtc - $newRegimeTotalTax - $pfAnnual - $esiAnnual;

            $oldEffective = $annualCtc > 0 ? round(($oldRegimeTotalTax / $annualCtc) * 100, 2) : 0;
            $newEffective = $annualCtc > 0 ? round(($newRegimeTotalTax / $annualCtc) * 100, 2) : 0;

            $savings = $oldRegimeTotalTax - $newRegimeTotalTax;
            $bestRegime = $savings > 0 ? 'new' : ($savings < 0 ? 'old' : 'same');

            return response()->json([
                'success' => true,
                'old_regime' => [
                    'taxable_income' => round($oldRegimeTaxable, 2),
                    'tax_amount' => round($oldRegimeTotalTax, 2),
                    'effective_rate' => $oldEffective,
                    'take_home' => round($oldRegimeTakeHome, 2),
                ],
                'new_regime' => [
                    'taxable_income' => round($newRegimeTaxable, 2),
                    'tax_amount' => round($newRegimeTotalTax, 2),
                    'effective_rate' => $newEffective,
                    'take_home' => round($newRegimeTakeHome, 2),
                ],
                'savings' => [
                    'amount' => round(abs($savings), 2),
                    'regime' => $bestRegime,
                ],
            ]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function taxWhatIf(Request $request)
    {
        $data = $request->validate([
            'user_id' => 'required|exists:users,id',
            'annual_ctc' => 'nullable|numeric|min:0',
            'hra_amount' => 'nullable|numeric|min:0',
            'section_80c' => 'nullable|numeric|min:0',
            'section_80d' => 'nullable|numeric|min:0',
            'nps_amount' => 'nullable|numeric|min:0',
        ]);

        try {
            $orgId = auth()->user()->organization_id;

            $employee = User::where('id', $data['user_id'])
                ->where('organization_id', $orgId)
                ->first();
            if (!$employee) {
                return response()->json(['success' => false, 'message' => 'Employee not found in your organization.'], 422);
            }

            $template = \App\Models\EmployeePayrollTemplate::where('user_id', $data['user_id'])
                ->where('organization_id', $orgId)
                ->first();

            $annualCtc = $data['annual_ctc'] ?? ($template ? (float) $template->annual_ctc : 0);
            if ($annualCtc <= 0) {
                return response()->json(['success' => false, 'message' => 'Annual CTC is required or must be set in the employee template.'], 422);
            }

            $basic = $annualCtc * 0.40;
            $hra = $data['hra_amount'] ?? ($annualCtc * 0.20);
            $pfEmployee = min($basic / 12, 1800) * 12;
            $grossMonthly = $annualCtc / 12;
            $esiAnnual = min($grossMonthly * 0.0075, 212.50) * 12;
            $ptAnnual = $this->calculateProfessionalTax($template?->pt_state, $grossMonthly);

            $section80c = $data['section_80c'] ?? 0;
            $section80d = $data['section_80d'] ?? 0;
            $nps = $data['nps_amount'] ?? 0;

            // Declared deductions go to the engine as a section map rather than
            // being summed into one taxable figure here. The engine caps each
            // section on its own -- 80C at 1.5L, 80D at its own limit -- which a
            // single subtraction cannot do, and which is why a what-if with a
            // 3L 80C declaration used to under-project the tax.
            $oldRegime = $this->annualTaxBreakdown('old', $annualCtc, [
                'section_80c' => $pfAnnual + $section80c,
                'section_80d' => $section80d,
                'section_80ccd_1b' => $nps,
            ]);
            $oldRegimeTaxable = $oldRegime['taxable_income'];
            $oldRegimeTotalTax = $oldRegime['total_tax'] + $ptAnnual + $esiAnnual;
            $oldRegimeTakeHome = $annualCtc - $oldRegimeTotalTax - $pfAnnual;

            $newRegime = $this->annualTaxBreakdown('new', $annualCtc);
            $newRegimeTaxable = $newRegime['taxable_income'];
            $newRegimeTotalTax = $newRegime['total_tax'] + $ptAnnual;
            $newRegimeTakeHome = $annualCtc - $newRegimeTotalTax - $pfAnnual - $esiAnnual;

            $oldEffective = $annualCtc > 0 ? round(($oldRegimeTotalTax / $annualCtc) * 100, 2) : 0;
            $newEffective = $annualCtc > 0 ? round(($newRegimeTotalTax / $annualCtc) * 100, 2) : 0;

            $savings = $oldRegimeTotalTax - $newRegimeTotalTax;
            $bestRegime = $savings > 0 ? 'new' : ($savings < 0 ? 'old' : 'same');

            return response()->json([
                'success' => true,
                'inputs' => [
                    'annual_ctc' => $annualCtc,
                    'hra_amount' => $hra,
                    'section_80c' => $section80c,
                    'section_80d' => $section80d,
                    'nps_amount' => $nps,
                ],
                'old_regime' => [
                    'taxable_income' => round($oldRegimeTaxable, 2),
                    'tax_amount' => round($oldRegimeTotalTax, 2),
                    'effective_rate' => $oldEffective,
                    'take_home' => round($oldRegimeTakeHome, 2),
                ],
                'new_regime' => [
                    'taxable_income' => round($newRegimeTaxable, 2),
                    'tax_amount' => round($newRegimeTotalTax, 2),
                    'effective_rate' => $newEffective,
                    'take_home' => round($newRegimeTakeHome, 2),
                ],
                'savings' => [
                    'amount' => round(abs($savings), 2),
                    'regime' => $bestRegime,
                ],
            ]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function calculateMonthlyTakeHome(Request $request)
    {
        $data = $request->validate([
            'user_id' => 'nullable|exists:users,id',
            'annual_ctc' => 'nullable|numeric|min:0',
            'state' => 'nullable|string',
        ]);

        try {
            $orgId = auth()->user()->organization_id;

            $annualCtc = $data['annual_ctc'] ?? 0;
            $taxRegime = 'new';
            $state = $data['state'] ?? 'maharashtra';

            if (!empty($data['user_id'])) {
                $employee = User::where('id', $data['user_id'])
                    ->where('organization_id', $orgId)
                    ->first();
                if (!$employee) {
                    return response()->json(['success' => false, 'message' => 'Employee not found in your organization.'], 422);
                }

                $template = \App\Models\EmployeePayrollTemplate::where('user_id', $data['user_id'])
                    ->where('organization_id', $orgId)
                    ->first();

                $annualCtc = $annualCtc > 0 ? $annualCtc : ($template ? (float) $template->annual_ctc : 0);
                $profile = $employee->employeeProfile;
                $state = $state ?? $profile?->pt_state ?? 'maharashtra';
                $taxRegime = $profile?->tax_regime ?? 'new';
            }

            if ($annualCtc <= 0) {
                return response()->json(['success' => false, 'message' => 'Annual CTC is required.'], 422);
            }

            $monthlyGross = $annualCtc / 12;
            $basic = $annualCtc * 0.40;
            $hra = $annualCtc * 0.20;
            $conveyance = min(1600 * 12, $annualCtc * 0.05);
            $special = $annualCtc - $basic - $hra - $conveyance;

            $pfEmployeeMonthly = min($basic / 12, 1800);
            $pfEmployerMonthly = min($basic / 12, 1800);
            $pfEmployee = $pfEmployeeMonthly * 12;

            $esiEmployeeMonthly = min($monthlyGross * 0.0075, 212.50);
            $esiEmployerMonthly = min($monthlyGross * 0.00375, 106.25);

            $ptMonthly = $this->calculateProfessionalTaxMonthly($template?->pt_state, $monthlyGross);

            $breakdown = $taxRegime === 'old'
                ? $this->annualTaxBreakdown('old', $annualCtc, ['section_80c' => $pfEmployee])
                : $this->annualTaxBreakdown('new', $annualCtc);

            $taxableIncome = $breakdown['taxable_income'];
            $cess = $breakdown['cess'];
            // total_tax already includes cess and surcharge.
            $tdsMonthly = $breakdown['total_tax'] / 12;

            $totalDeductionsMonthly = $pfEmployeeMonthly + $esiEmployeeMonthly + $ptMonthly + $tdsMonthly;
            $netPay = $monthlyGross - $totalDeductionsMonthly;

            $totalDeductionsAnnual = $pfEmployee + ($esiEmployeeMonthly * 12) + ($ptMonthly * 12) + $tax + $cess;

            return response()->json([
                'success' => true,
                'monthly' => [
                    'gross' => round($monthlyGross, 2),
                    'basic' => round($basic / 12, 2),
                    'hra' => round($hra / 12, 2),
                    'conveyance' => round($conveyance / 12, 2),
                    'special_allowance' => round($special / 12, 2),
                    'deductions_breakdown' => [
                        'pf_employee' => round($pfEmployeeMonthly, 2),
                        'pf_employer' => round($pfEmployerMonthly, 2),
                        'esi_employee' => round($esiEmployeeMonthly, 2),
                        'esi_employer' => round($esiEmployerMonthly, 2),
                        'professional_tax' => round($ptMonthly, 2),
                        'tds' => round($tdsMonthly, 2),
                    ],
                    'total_deductions' => round($totalDeductionsMonthly, 2),
                    'net_pay' => round($netPay, 2),
                ],
                'annual' => [
                    'gross' => round($annualCtc, 2),
                    'total_deductions' => round($totalDeductionsAnnual, 2),
                    'net_pay' => round($annualCtc - $totalDeductionsAnnual, 2),
                ],
                'tax_regime' => $taxRegime,
                'state' => $state,
            ]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    /**
     * Annual income tax for a regime — surcharge, 87A rebate and cess included.
     *
     * These endpoints used to carry their own slab tables. They were on
     * FY 2024-25, had no 87A rebate, no surcharge and no cess; their callers
     * bolted 4% cess on afterwards and subtracted a standard deduction of
     * 75,000 for BOTH regimes, where the old regime's is 50,000. So the regime
     * comparison an employee elects on disagreed with the payroll run that
     * would actually pay them — on the slabs, on the rebate, and on the
     * deduction.
     *
     * Every product in this market resolves the comparison and the payroll from
     * one computation, for exactly this reason: Keka's regime comparison and
     * its monthly TDS both read the same IT statement, as do Zoho's Tax
     * Computation and greytHR's Income Tax Statement. A simulator that
     * disagrees with payroll is worse than no simulator, because s.115BAC makes
     * the election consequential and the employee makes it on this screen.
     *
     * Takes annual GROSS, not taxable income. Applying the standard deduction
     * is the engine's job precisely because it is regime-dependent, and every
     * caller that did it by hand got the old regime wrong.
     *
     * @return array{taxable_income: float, total_tax: float, cess: float, rebate_87a: float, surcharge: float}
     */
    private function annualTaxBreakdown(string $regime, float $annualGross, array $exemptions = []): array
    {
        $calculator = app(PayrollCalculatorService::class);
        $gross = max(0, $annualGross);

        $result = $regime === 'old'
            ? $calculator->calculateOldRegimeTax($gross, $exemptions)
            : $calculator->calculateNewRegimeTax($gross, $exemptions);

        if (! is_array($result)) {
            // Defensive: the old-regime path has historically returned a bare
            // float in some versions. Report what we can rather than fatal.
            return [
                'taxable_income' => $gross,
                'total_tax' => (float) $result,
                'cess' => 0.0,
                'rebate_87a' => 0.0,
                'surcharge' => 0.0,
            ];
        }

        return [
            'taxable_income' => (float) ($result['taxable_income'] ?? 0),
            'total_tax' => (float) ($result['total_tax'] ?? 0),
            'cess' => (float) ($result['cess'] ?? 0),
            'rebate_87a' => (float) ($result['rebate_87a'] ?? 0),
            'surcharge' => (float) ($result['surcharge'] ?? 0),
        ];
    }

    /**
     * Annual professional tax, from the employee's own state.
     *
     * What was here was a fabricated national slab table that ignored the state
     * entirely and topped out at 6,000 a year — 2.4x the Article 276(2) ceiling
     * of 2,500 that binds every state and union territory. Professional tax is
     * state-levied and roughly half of India's states and UTs levy none at all,
     * so a nationwide table is wrong for every employee: it invented a tax in
     * the states that do not levy one and got the amount wrong in the ones that
     * do.
     *
     * Delegates to PTStateService, the same source the payroll run and the
     * payslip use. An unknown or unset state yields 0 — per the house rule, a
     * missing state must never fall back to a real one.
     */
    private function calculateProfessionalTax(?string $stateCode, float $monthlyGross): float
    {
        $annual = 0.0;
        for ($month = 1; $month <= 12; $month++) {
            $annual += PTStateService::calculate($stateCode ?: '', $monthlyGross, $month);
        }

        return $annual;
    }

    /**
     * Professional tax for one month. $month matters: several states levy a
     * higher instalment in a single month (Maharashtra's February), so a flat
     * twelfth of the annual figure is wrong in that month and in the other
     * eleven.
     */
    private function calculateProfessionalTaxMonthly(?string $stateCode, float $monthlyGross, ?int $month = null): float
    {
        return PTStateService::calculate($stateCode ?: '', $monthlyGross, $month);
    }

    public function listDailyWageStructures(Request $request)
    {
        $orgId = auth()->user()->organization_id;
        $structures = \DB::table('daily_wage_structures')
            ->where('organization_id', $orgId)
            ->where('is_active', true)
            ->get();

        return response()->json(['success' => true, 'data' => $structures]);
    }

    public function listCtcBands(Request $request)
    {
        $orgId = auth()->user()->organization_id;
        $bands = \DB::table('ctc_bands')
            ->where('organization_id', $orgId)
            ->where('is_active', true)
            ->get();

        return response()->json(['success' => true, 'data' => $bands]);
    }

    public function findCtcBand(Request $request)
    {
        $data = $request->validate([
            'annual_ctc' => 'required|numeric|min:0',
        ]);

        $orgId = auth()->user()->organization_id;
        $annualCtc = $data['annual_ctc'];

        $band = \DB::table('ctc_bands')
            ->where('organization_id', $orgId)
            ->where('is_active', true)
            ->where('min_ctc', '<=', $annualCtc)
            ->where('max_ctc', '>=', $annualCtc)
            ->first();

        return response()->json([
            'success' => true,
            'annual_ctc' => $annualCtc,
            'band' => $band ? [
                'id' => $band->id,
                'name' => $band->name,
                'min_ctc' => $band->min_ctc,
                'max_ctc' => $band->max_ctc,
            ] : null,
        ]);
    }

    public function getFbpComponents(Request $request)
    {
        try {
            $orgId = auth()->user()->organization_id;
            $components = FbpComponent::where('organization_id', $orgId)
                ->where('is_active', true)
                ->get();

            return response()->json(['success' => true, 'data' => $components, 'message' => 'FBP components retrieved successfully.']);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function getFbpAllocation(Request $request, $userId)
    {
        try {
            $orgId = auth()->user()->organization_id;
            $financialYear = $request->get('financial_year', $this->currentFinancialYear());

            $allocations = FbpAllocation::where('organization_id', $orgId)
                ->where('user_id', $userId)
                ->where('financial_year', $financialYear)
                ->with('component')
                ->get();

            return response()->json(['success' => true, 'data' => $allocations, 'message' => 'FBP allocations retrieved successfully.']);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function allocateFbp(Request $request)
    {
        try {
            $orgId = auth()->user()->organization_id;

            $data = $request->validate([
                'user_id' => 'required|exists:users,id',
                'allocations' => 'required|array|min:1',
                'allocations.*.fbp_component_id' => 'required|exists:fbp_components,id',
                'allocations.*.allocated_amount' => 'required|numeric|min:0',
            ]);

            $financialYear = $request->get('financial_year', $this->currentFinancialYear());
            $saved = [];

            foreach ($data['allocations'] as $allocation) {
                $saved[] = FbpAllocation::updateOrCreate(
                    [
                        'organization_id' => $orgId,
                        'user_id' => $data['user_id'],
                        'fbp_component_id' => $allocation['fbp_component_id'],
                        'financial_year' => $financialYear,
                    ],
                    [
                        'allocated_amount' => $allocation['allocated_amount'],
                    ]
                );
            }

            return response()->json(['success' => true, 'data' => $saved, 'message' => 'FBP allocations saved successfully.']);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function submitFbpClaim(Request $request)
    {
        try {
            $orgId = auth()->user()->organization_id;

            $data = $request->validate([
                'fbp_component_id' => 'required|exists:fbp_components,id',
                'amount' => 'required|numeric|min:0.01',
                'claim_date' => 'required|date',
                'description' => 'nullable|string',
            ]);

            $claim = FbpClaim::create([
                'organization_id' => $orgId,
                'user_id' => auth()->id(),
                'fbp_component_id' => $data['fbp_component_id'],
                'amount' => $data['amount'],
                'claim_date' => $data['claim_date'],
                'description' => $data['description'] ?? null,
                'status' => 'submitted',
            ]);

            return response()->json(['success' => true, 'data' => $claim, 'message' => 'FBP claim submitted successfully.'], 201);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function approveFbpClaim(Request $request, $id)
    {
        try {
            $orgId = auth()->user()->organization_id;

            $claim = FbpClaim::where('id', $id)
                ->where('organization_id', $orgId)
                ->firstOrFail();

            $claim->status = 'approved';
            $claim->reviewer_id = auth()->id();
            $claim->reviewer_notes = $request->input('reviewer_notes');
            $claim->reviewed_at = now();
            $claim->save();

            return response()->json(['success' => true, 'data' => $claim, 'message' => 'FBP claim approved successfully.']);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function rejectFbpClaim(Request $request, $id)
    {
        try {
            $orgId = auth()->user()->organization_id;

            $request->validate([
                'reviewer_notes' => 'required|string',
            ]);

            $claim = FbpClaim::where('id', $id)
                ->where('organization_id', $orgId)
                ->firstOrFail();

            $claim->status = 'rejected';
            $claim->reviewer_id = auth()->id();
            $claim->reviewer_notes = $request->input('reviewer_notes');
            $claim->reviewed_at = now();
            $claim->save();

            return response()->json(['success' => true, 'data' => $claim, 'message' => 'FBP claim rejected successfully.']);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function createPerquisite(Request $request)
    {
        try {
            $orgId = auth()->user()->organization_id;

            $data = $request->validate([
                'user_id' => 'required|exists:users,id',
                'perquisite_type' => 'required|string',
                'annual_value' => 'required|numeric|min:0',
                'taxable_value' => 'required|numeric|min:0',
                'financial_year' => 'required|string',
                'description' => 'nullable|string',
            ]);

            $perquisite = EmployeePerquisite::create([
                'organization_id' => $orgId,
                'user_id' => $data['user_id'],
                'perquisite_type' => $data['perquisite_type'],
                'annual_value' => $data['annual_value'],
                'taxable_value' => $data['taxable_value'],
                'financial_year' => $data['financial_year'],
                'description' => $data['description'] ?? null,
                'status' => 'active',
            ]);

            return response()->json(['success' => true, 'data' => $perquisite, 'message' => 'Perquisite created successfully.'], 201);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function getUserPerquisites(Request $request, $userId)
    {
        try {
            $orgId = auth()->user()->organization_id;
            $financialYear = $request->get('financial_year');

            $query = EmployeePerquisite::where('organization_id', $orgId)
                ->where('user_id', $userId);

            if ($financialYear) {
                $query->where('financial_year', $financialYear);
            }

            $perquisites = $query->get();

            return response()->json(['success' => true, 'data' => $perquisites, 'message' => 'Perquisites retrieved successfully.']);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    private function currentFinancialYear(): string
    {
        $now = now();
        $year = (int) $now->format('Y');
        $month = (int) $now->format('m');

        if ($month >= 4) {
            return $year . '-' . ($year + 1);
        }

        return ($year - 1) . '-' . $year;
    }

    public function runPayrollValidation(Request $request)
    {
        try {
            $orgId = auth()->user()->organization_id;
            $data = $request->validate([
                'run_id' => 'required|exists:payroll_monthly_runs,id',
            ]);

            $run = PayrollMonthlyRun::where('id', $data['run_id'])
                ->where('organization_id', $orgId)
                ->firstOrFail();

            $employeeIds = PayrollItem::where('payroll_run_id', $run->id)
                ->where('organization_id', $orgId)
                ->pluck('user_id')
                ->unique()
                ->all();

            $checks = [];
            $blockingIssues = 0;

            $templates = \App\Models\EmployeePayrollTemplate::where('organization_id', $orgId)
                ->whereIn('user_id', $employeeIds)
                ->pluck('user_id')
                ->toArray();

            $missingTemplates = array_diff($employeeIds, $templates);
            $checks[] = [
                'name' => 'employee_templates',
                'status' => empty($missingTemplates) ? 'passed' : 'failed',
                'message' => empty($missingTemplates) ? 'All employees have payroll templates.' : count($missingTemplates) . ' employee(s) missing payroll templates.',
            ];
            if (!empty($missingTemplates)) {
                $blockingIssues++;
            }

            $bankAccounts = EmployeeBankAccount::where('organization_id', $orgId)
                ->whereIn('user_id', $employeeIds)
                ->where('is_default', true)
                ->pluck('user_id')
                ->toArray();

            $missingBank = array_diff($employeeIds, $bankAccounts);
            $checks[] = [
                'name' => 'bank_details',
                'status' => empty($missingBank) ? 'passed' : 'failed',
                'message' => empty($missingBank) ? 'All employees have bank details on file.' : count($missingBank) . ' employee(s) missing bank details.',
            ];
            if (!empty($missingBank)) {
                $blockingIssues++;
            }

            $pendingDeclarations = EmployeeTaxDeclaration::where('organization_id', $orgId)
                ->whereIn('user_id', $employeeIds)
                ->where('status', 'pending')
                ->count();

            $checks[] = [
                'name' => 'tax_declarations',
                'status' => $pendingDeclarations === 0 ? 'passed' : 'failed',
                'message' => $pendingDeclarations === 0 ? 'No pending tax declarations.' : $pendingDeclarations . ' employee(s) have pending tax declarations.',
            ];
            if ($pendingDeclarations > 0) {
                $blockingIssues++;
            }

            $valid = $blockingIssues === 0;

            return response()->json([
                'success' => true,
                'data' => [
                    'valid' => $valid,
                    'checks' => $checks,
                    'blocking_issues' => $blockingIssues,
                ],
            ]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function getChecklistStatus(Request $request, $runId)
    {
        try {
            $orgId = auth()->user()->organization_id;

            $run = PayrollMonthlyRun::where('id', $runId)
                ->where('organization_id', $orgId)
                ->firstOrFail();

            $items = PayrollRunChecklist::where('payroll_run_id', $runId)
                ->where('organization_id', $orgId)
                ->with('checklistItem')
                ->get()
                ->map(function ($item) {
                    return [
                        'id' => $item->id,
                        'name' => $item->checklistItem?->label ?? $item->message,
                        'status' => $item->status,
                        'checked_at' => $item->resolved_at,
                        'notes' => $item->resolution,
                    ];
                });

            $totalCount = $items->count();
            $completedCount = $items->whereIn('status', ['passed', 'resolved'])->count();

            return response()->json([
                'success' => true,
                'data' => [
                    'items' => $items,
                    'completed_count' => $completedCount,
                    'total_count' => $totalCount,
                ],
            ]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function resolveCheck(Request $request)
    {
        try {
            $orgId = auth()->user()->organization_id;

            $data = $request->validate([
                'check_id' => 'required|exists:payroll_run_checklists,id',
                'notes' => 'required|string',
            ]);

            $check = PayrollRunChecklist::where('id', $data['check_id'])
                ->where('organization_id', $orgId)
                ->firstOrFail();

            $check->status = 'resolved';
            $check->resolved_at = now();
            $check->resolved_by = auth()->id();
            $check->resolution = $data['notes'];
            $check->is_resolved = true;
            $check->save();

            return response()->json([
                'success' => true,
                'data' => $check,
                'message' => 'Checklist item resolved successfully.',
            ]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function detectCtcArrears(Request $request, $userId)
    {
        try {
            $orgId = auth()->user()->organization_id;

            $employee = User::where('id', $userId)
                ->where('organization_id', $orgId)
                ->firstOrFail();

            $template = \App\Models\EmployeePayrollTemplate::where('user_id', $userId)
                ->where('organization_id', $orgId)
                ->first();

            $revisions = SalaryRevisionLetter::where('user_id', $userId)
                ->where('organization_id', $orgId)
                ->where('status', 'accepted')
                ->where('effective_from', '<=', now())
                ->orderBy('effective_from', 'desc')
                ->get();

            $arrears = [];
            $totalArrear = 0;

            foreach ($revisions as $revision) {
                $effectiveDate = \Carbon\Carbon::parse($revision->effective_from);
                $monthsElapsed = $effectiveDate->diffInMonths(now());

                if ($monthsElapsed > 0 && (float) $revision->new_ctc > (float) $revision->old_ctc) {
                    $monthlyDifference = ((float) $revision->new_ctc - (float) $revision->old_ctc) / 12;
                    $arrearAmount = $monthlyDifference * $monthsElapsed;

                    $arrears[] = [
                        'revision_id' => $revision->id,
                        'old_ctc' => (float) $revision->old_ctc,
                        'new_ctc' => (float) $revision->new_ctc,
                        'effective_date' => $revision->effective_from->format('Y-m-d'),
                        'months_elapsed' => $monthsElapsed,
                        'arrear_amount' => round($arrearAmount, 2),
                    ];
                    $totalArrear += $arrearAmount;
                }
            }

            return response()->json([
                'success' => true,
                'data' => [
                    'user_id' => $userId,
                    'arrears' => $arrears,
                    'total_arrear' => round($totalArrear, 2),
                ],
            ]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function calculateArrear(Request $request)
    {
        try {
            $data = $request->validate([
                'user_id' => 'required|exists:users,id',
                'old_ctc' => 'required|numeric|min:0',
                'new_ctc' => 'required|numeric|min:0',
                'effective_date' => 'required|date',
                'apply_date' => 'required|date|after_or_equal:effective_date',
            ]);

            $effectiveDate = \Carbon\Carbon::parse($data['effective_date']);
            $applyDate = \Carbon\Carbon::parse($data['apply_date']);
            $monthsElapsed = $effectiveDate->diffInMonths($applyDate);

            $monthlyDifference = ((float) $data['new_ctc'] - (float) $data['old_ctc']) / 12;
            $totalArrear = $monthlyDifference * $monthsElapsed;

            return response()->json([
                'success' => true,
                'data' => [
                    'monthly_difference' => round($monthlyDifference, 2),
                    'months_elapsed' => $monthsElapsed,
                    'total_arrear' => round($totalArrear, 2),
                ],
            ]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function calculateVariablePay(Request $request)
    {
        try {
            $orgId = auth()->user()->organization_id;

            $data = $request->validate([
                'user_ids' => 'required|array|min:1',
                'user_ids.*' => 'integer|exists:users,id',
                'month_year' => 'required|string',
                'default_amount' => 'nullable|numeric|min:0',
            ]);

            $userIds = $data['user_ids'];
            $monthYear = $data['month_year'];
            $defaultAmount = $data['default_amount'] ?? null;

            $items = PayrollItem::where('organization_id', $orgId)
                ->whereIn('user_id', $userIds)
                ->where('month_year', $monthYear)
                ->get();

            $processed = 0;
            $results = [];

            foreach ($items as $item) {
                $assignment = VariablePayAssignment::where('user_id', $item->user_id)
                    ->where('organization_id', $orgId)
                    ->where('month_year', $monthYear)
                    ->where('is_active', true)
                    ->first();

                $variablePay = $defaultAmount;
                if ($assignment) {
                    if ($assignment->fixed_amount > 0) {
                        $variablePay = (float) $assignment->fixed_amount;
                    } elseif ($assignment->percentage > 0) {
                        $variablePay = round(((float) $item->gross_salary * (float) $assignment->percentage) / 100, 2);
                    }
                }

                if ($variablePay !== null) {
                    $item->variable_pay = $variablePay;
                    $item->save();
                    $processed++;
                    $results[] = [
                        'user_id' => $item->user_id,
                        'variable_pay' => $variablePay,
                        'updated_net_pay' => (float) $item->fresh()->net_pay,
                    ];
                }
            }

            return response()->json([
                'success' => true,
                'data' => [
                    'processed' => $processed,
                    'items' => $results,
                ],
                'message' => $processed . ' employee(s) variable pay calculated successfully.',
            ]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function generateRevisionLetter(Request $request)
    {
        try {
            $data = $request->validate([
                'user_id' => 'required|exists:users,id',
                'new_ctc' => 'required|numeric|min:0',
                'effective_date' => 'nullable|date',
                'generate_arrears' => 'nullable|boolean',
            ]);

            $orgId = auth()->user()->organization_id;

            $employee = User::where('id', $data['user_id'])
                ->where('organization_id', $orgId)
                ->first();

            if (!$employee) {
                return response()->json(['success' => false, 'message' => 'Employee not found in your organization.'], 422);
            }

            $template = \App\Models\EmployeePayrollTemplate::where('user_id', $data['user_id'])
                ->where('organization_id', $orgId)
                ->first();

            $oldCtc = $template ? (float) $template->annual_ctc : 0;
            $newCtc = (float) $data['new_ctc'];
            $effectiveDate = !empty($data['effective_date']) ? \Carbon\Carbon::parse($data['effective_date']) : now();
            $arrearAmount = 0;

            if (!empty($data['generate_arrears']) && $oldCtc > 0 && $effectiveDate->lessThan(now())) {
                $monthsElapsed = (int) $effectiveDate->diffInMonths(now()->startOfMonth());
                $arrearAmount = ($newCtc - $oldCtc) * $monthsElapsed;
            }

            $revisionPct = $oldCtc > 0 ? round((($newCtc - $oldCtc) / $oldCtc) * 100, 2) : 0;

            $letter = \App\Models\SalaryRevisionLetter::create([
                'organization_id' => $orgId,
                'user_id' => $data['user_id'],
                'old_ctc' => $oldCtc,
                'new_ctc' => $newCtc,
                'arrear_amount' => max(0, $arrearAmount),
                'revision_percentage' => $revisionPct,
                'revision_type' => 'correction',
                'effective_from' => $effectiveDate->format('Y-m-d'),
                'status' => 'draft',
                'generated_by' => auth()->id(),
            ]);

            return response()->json(['success' => true, 'message' => 'Revision letter generated successfully.', 'data' => $letter], 201);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function getRevisionLetters(Request $request)
    {
        try {
            $orgId = auth()->user()->organization_id;
            $query = \App\Models\SalaryRevisionLetter::with('user:id,name,email')
                ->where('organization_id', $orgId);

            if ($request->has('user_id')) {
                $query->where('user_id', $request->user_id);
            }

            if ($request->has('status')) {
                $query->where('status', $request->status);
            }

            $letters = $query->orderBy('created_at', 'desc')->paginate(20);

            return response()->json(['success' => true, 'data' => $letters]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function acceptRevisionLetter(Request $request, $id)
    {
        try {
            $orgId = auth()->user()->organization_id;

            $letter = \App\Models\SalaryRevisionLetter::where('id', $id)
                ->where('organization_id', $orgId)
                ->firstOrFail();

            if ($letter->status !== 'draft') {
                return response()->json(['success' => false, 'message' => 'Only draft revision letters can be accepted.'], 422);
            }

            $letter->update([
                'status' => 'accepted',
                'accepted_at' => now(),
            ]);

            $template = \App\Models\EmployeePayrollTemplate::where('user_id', $letter->user_id)
                ->where('organization_id', $orgId)
                ->first();

            if ($template) {
                $template->update(['annual_ctc' => $letter->new_ctc]);
            }

            return response()->json(['success' => true, 'message' => 'Revision letter accepted successfully.', 'data' => $letter->fresh()]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function rejectRevisionLetter(Request $request, $id)
    {
        try {
            $data = $request->validate([
                'rejection_reason' => 'required|string',
            ]);

            $orgId = auth()->user()->organization_id;

            $letter = \App\Models\SalaryRevisionLetter::where('id', $id)
                ->where('organization_id', $orgId)
                ->firstOrFail();

            if ($letter->status !== 'draft') {
                return response()->json(['success' => false, 'message' => 'Only draft revision letters can be rejected.'], 422);
            }

            $letter->update([
                'status' => 'rejected',
                'rejected_at' => now(),
                'rejection_reason' => $data['rejection_reason'],
            ]);

            return response()->json(['success' => true, 'message' => 'Revision letter rejected.', 'data' => $letter->fresh()]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function createTransferBatch(Request $request)
    {
        try {
            $orgId = auth()->user()->organization_id;

            $data = $request->validate([
                'payroll_run_id' => 'required|exists:payroll_monthly_runs,id',
                'bank_name' => 'nullable|string',
            ]);

            $run = PayrollMonthlyRun::where('id', $data['payroll_run_id'])
                ->where('organization_id', $orgId)
                ->firstOrFail();

            $paidItems = PayrollItem::where('payroll_run_id', $run->id)
                ->where('organization_id', $orgId)
                ->where('payment_status', 'paid')
                ->with('user.employeeBankAccounts')
                ->get();

            if ($paidItems->isEmpty()) {
                return response()->json(['success' => false, 'message' => 'No paid payroll items found for this run.'], 422);
            }

            $totalAmount = (float) $paidItems->sum('net_pay');
            $totalEmployees = $paidItems->pluck('user_id')->unique()->count();
            $bankName = $data['bank_name'] ?? 'Multiple Banks';
            $batchName = 'Batch_' . $run->month_year . '_' . now()->format('YmdHis');

            $batch = \App\Models\BankTransferBatch::create([
                'organization_id' => $orgId,
                'payroll_run_id' => $run->id,
                'batch_name' => $batchName,
                'bank_name' => $bankName,
                'total_amount' => $totalAmount,
                'total_employees' => $totalEmployees,
                'status' => \App\Models\BankTransferBatch::STATUS_PENDING,
                'created_by' => auth()->id(),
            ]);

            $employeeDetails = $paidItems->map(function ($item) {
                $bankAccount = $item->user->employeeBankAccounts->first();
                return [
                    'user_id' => $item->user_id,
                    'name' => $item->user->name,
                    'net_pay' => (float) $item->net_pay,
                    'account_number' => $bankAccount?->account_number,
                    'ifsc_code' => $bankAccount?->ifsc_swift,
                    'bank_name' => $bankAccount?->bank_name,
                ];
            });

            return response()->json(['success' => true, 'data' => $batch->fresh(), 'employees' => $employeeDetails, 'message' => 'Transfer batch created successfully.'], 201);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function listBatches(Request $request)
    {
        $orgId = auth()->user()->organization_id;

        $batches = \App\Models\BankTransferBatch::where('organization_id', $orgId)
            ->with('payrollRun')
            ->orderByDesc('created_at')
            ->get()
            ->map(function ($batch) {
                return [
                    'id' => $batch->id,
                    'batch_reference' => $batch->batch_reference,
                    'bank_name' => $batch->bank_name,
                    'total_amount' => $batch->total_amount,
                    'total_employees' => $batch->total_employees,
                    'employee_count' => $batch->total_employees,
                    'status' => $batch->status,
                    'payroll_run_id' => $batch->payroll_run_id,
                    'month_year' => $batch->payrollRun->month_year ?? null,
                    'created_at' => $batch->created_at,
                ];
            });

        return response()->json(['success' => true, 'data' => $batches]);
    }

    public function processBatch(Request $request, $batchId)
    {
        try {
            $orgId = auth()->user()->organization_id;

            $batch = \App\Models\BankTransferBatch::where('id', $batchId)
                ->where('organization_id', $orgId)
                ->firstOrFail();

            if ($batch->status !== \App\Models\BankTransferBatch::STATUS_PENDING) {
                return response()->json(['success' => false, 'message' => 'Only pending batches can be processed. Current status: ' . $batch->status], 422);
            }

            $batch->update([
                'status' => \App\Models\BankTransferBatch::STATUS_PROCESSING,
            ]);

            $batch->update([
                'status' => \App\Models\BankTransferBatch::STATUS_COMPLETED,
                'processed_at' => now(),
            ]);

            return response()->json(['success' => true, 'data' => $batch->fresh(), 'message' => 'Batch processed successfully.']);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function generateBankFile(Request $request, $batchId)
    {
        try {
            $orgId = auth()->user()->organization_id;

            $batch = \App\Models\BankTransferBatch::where('id', $batchId)
                ->where('organization_id', $orgId)
                ->firstOrFail();

            $items = PayrollItem::where('payroll_run_id', $batch->payroll_run_id)
                ->where('organization_id', $orgId)
                ->where('payment_status', 'paid')
                ->with('user.employeeBankAccounts')
                ->get();

            if ($items->isEmpty()) {
                return response()->json(['success' => false, 'message' => 'No paid payroll items found for this batch.'], 422);
            }

            $totalAmount = 0;
            $csvLines = [
                'Employee Name,Account Number,IFSC Code,Bank Name,Amount',
            ];

            foreach ($items as $item) {
                $bankAccount = $item->user->employeeBankAccounts->first();
                $amount = round((float) $item->net_pay, 2);
                $totalAmount += $amount;

                $csvLines[] = implode(',', [
                    $item->user->name,
                    $bankAccount?->account_number ?? '',
                    $bankAccount?->ifsc_swift ?? '',
                    $bankAccount?->bank_name ?? '',
                    $amount,
                ]);
            }

            $csvLines[] = "Total,,,," . round($totalAmount, 2);
            $csvContent = implode("\n", $csvLines);

            return response()->json([
                'success' => true,
                'data' => [
                    'batch_id' => $batch->id,
                    'file_content' => $csvContent,
                    'employee_count' => $items->pluck('user_id')->unique()->count(),
                    'total_amount' => round($totalAmount, 2),
                ],
                'message' => 'Bank file generated successfully.',
            ]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function initiatePaymentReversal(Request $request)
    {
        try {
            $orgId = auth()->user()->organization_id;

            $data = $request->validate([
                'payroll_item_id' => 'required|exists:payroll_items,id',
                'reason' => 'required|string',
            ]);

            $payrollItem = PayrollItem::where('id', $data['payroll_item_id'])
                ->where('organization_id', $orgId)
                ->firstOrFail();

            if ($payrollItem->payment_status !== 'paid') {
                return response()->json(['success' => false, 'message' => 'Only paid payroll items can be reversed. Current status: ' . $payrollItem->payment_status], 422);
            }

            $reversal = \App\Models\PaymentReversal::create([
                'payroll_item_id' => $payrollItem->id,
                'organization_id' => $orgId,
                'user_id' => $payrollItem->user_id,
                'amount' => $payrollItem->net_pay,
                'reason' => $data['reason'],
                'requested_by' => auth()->id(),
                'status' => 'pending',
            ]);

            $payrollItem->update(['payment_status' => 'reversal_pending']);

            return response()->json(['success' => true, 'data' => $reversal, 'message' => 'Payment reversal initiated successfully.'], 201);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function getPayrollRegister(Request $request)
    {
        try {
            $data = $request->validate([
                'month_year' => 'required|string',
                'pay_group_id' => 'nullable|exists:pay_groups,id',
            ]);

            $orgId = auth()->user()->organization_id;
            $monthYear = $data['month_year'];

            $query = PayrollItem::where('payroll_items.organization_id', $orgId)
                ->where('payroll_items.month_year', $monthYear)
                ->join('users', 'payroll_items.user_id', '=', 'users.id')
                ->leftJoin('groups', 'payroll_items.department_id', '=', 'groups.id')
                ->select(
                    'payroll_items.user_id',
                    'users.name',
                    'groups.name as department',
                    'payroll_items.gross_salary',
                    'payroll_items.pf_employee',
                    'payroll_items.pf_employer',
                    'payroll_items.esi_employee',
                    'payroll_items.esi_employer',
                    'payroll_items.tds',
                    'payroll_items.pt',
                    'payroll_items.custom_deductions',
                    'payroll_items.net_pay'
                );

            if (!empty($data['pay_group_id'])) {
                $userIds = \App\Models\PayGroupAssignment::where('pay_group_id', $data['pay_group_id'])
                    ->where('organization_id', $orgId)
                    ->where('is_active', true)
                    ->pluck('user_id')
                    ->all();

                $query->whereIn('payroll_items.user_id', $userIds);
            }

            $items = $query->get();

            $employees = $items->map(function ($item) {
                return [
                    'user_id' => $item->user_id,
                    'name' => $item->name,
                    'department' => $item->department ?? '',
                    'gross' => round((float) $item->gross_salary, 2),
                    'pf_employee' => round((float) $item->pf_employee, 2),
                    'pf_employer' => round((float) $item->pf_employer, 2),
                    'esi_employee' => round((float) $item->esi_employee, 2),
                    'esi_employer' => round((float) $item->esi_employer, 2),
                    'tds' => round((float) $item->tds, 2),
                    'pt' => round((float) $item->pt, 2),
                    'other_deductions' => round((float) $item->custom_deductions, 2),
                    'net_pay' => round((float) $item->net_pay, 2),
                ];
            });

            $totals = [
                'gross' => round((float) $items->sum('gross_salary'), 2),
                'pf_employee' => round((float) $items->sum('pf_employee'), 2),
                'pf_employer' => round((float) $items->sum('pf_employer'), 2),
                'esi_employee' => round((float) $items->sum('esi_employee'), 2),
                'esi_employer' => round((float) $items->sum('esi_employer'), 2),
                'tds' => round((float) $items->sum('tds'), 2),
                'pt' => round((float) $items->sum('pt'), 2),
                'other_deductions' => round((float) $items->sum('custom_deductions'), 2),
                'net_pay' => round((float) $items->sum('net_pay'), 2),
                'employee_count' => $items->count(),
            ];

            return response()->json([
                'success' => true,
                'data' => [
                    'month_year' => $monthYear,
                    'employees' => $employees,
                    'totals' => $totals,
                ],
                'message' => 'Payroll register retrieved successfully.',
            ]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function getStatutoryRegister(Request $request)
    {
        try {
            $data = $request->validate([
                'month_year' => 'required|string',
            ]);

            $orgId = auth()->user()->organization_id;
            $monthYear = $data['month_year'];

            $items = PayrollItem::where('organization_id', $orgId)
                ->where('month_year', $monthYear)
                ->join('users', 'payroll_items.user_id', '=', 'users.id')
                ->select(
                    'payroll_items.user_id',
                    'users.name',
                    'payroll_items.gross_salary',
                    'payroll_items.pf_employee',
                    'payroll_items.pf_employer',
                    'payroll_items.esi_employee',
                    'payroll_items.esi_employer',
                    'payroll_items.tds'
                )
                ->get();

            $pfEmployees = $items->filter(fn($i) => (float) $i->pf_employee > 0);
            $esiEmployees = $items->filter(fn($i) => (float) $i->esi_employee > 0);

            $pf = [
                'total_employees' => $pfEmployees->count(),
                'total_pf_employee' => round((float) $pfEmployees->sum('pf_employee'), 2),
                'total_pf_employer' => round((float) $pfEmployees->sum('pf_employer'), 2),
                'total_epf' => round((float) $pfEmployees->sum('pf_employee') + (float) $pfEmployees->sum('pf_employer'), 2),
            ];

            $esi = [
                'total_employees' => $esiEmployees->count(),
                'total_esi_employee' => round((float) $esiEmployees->sum('esi_employee'), 2),
                'total_esi_employer' => round((float) $esiEmployees->sum('esi_employer'), 2),
                'total_esi' => round((float) $esiEmployees->sum('esi_employee') + (float) $esiEmployees->sum('esi_employer'), 2),
            ];

            $tds = [
                'total_tds' => round((float) $items->sum('tds'), 2),
            ];

            $breakdown = $items->map(function ($item) {
                return [
                    'user_id' => $item->user_id,
                    'name' => $item->name,
                    'pf_wages' => round((float) $item->gross_salary, 2),
                    'pf_employee' => round((float) $item->pf_employee, 2),
                    'pf_employer' => round((float) $item->pf_employer, 2),
                    'esi_wages' => round((float) $item->gross_salary, 2),
                    'esi_employee' => round((float) $item->esi_employee, 2),
                    'esi_employer' => round((float) $item->esi_employer, 2),
                    'tds' => round((float) $item->tds, 2),
                ];
            });

            return response()->json([
                'success' => true,
                'data' => [
                    'month_year' => $monthYear,
                    'pf' => $pf,
                    'esi' => $esi,
                    'tds' => $tds,
                    'breakdown' => $breakdown,
                ],
                'message' => 'Statutory register retrieved successfully.',
            ]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function getBankReconciliation(Request $request)
    {
        try {
            $data = $request->validate([
                'month_year' => 'required|string',
            ]);

            $orgId = auth()->user()->organization_id;
            $monthYear = $data['month_year'];

            $paidItems = PayrollItem::where('payroll_items.organization_id', $orgId)
                ->where('payroll_items.month_year', $monthYear)
                ->where('payroll_items.payment_status', 'paid')
                ->join('users', 'payroll_items.user_id', '=', 'users.id')
                ->leftJoin('employee_bank_accounts', function ($j) use ($orgId) {
                    $j->on('payroll_items.user_id', '=', 'employee_bank_accounts.user_id')
                        ->where('employee_bank_accounts.organization_id', '=', $orgId)
                        ->where('employee_bank_accounts.is_default', '=', true);
                })
                ->select(
                    'payroll_items.user_id',
                    'users.name',
                    'payroll_items.net_pay',
                    'employee_bank_accounts.bank_name',
                    'employee_bank_accounts.account_number',
                    'employee_bank_accounts.ifsc_swift'
                )
                ->get();

            $bankGroups = $paidItems->groupBy('bank_name');

            $banks = $bankGroups->map(function ($group, $bankName) {
                $employees = $group->map(function ($item) {
                    return [
                        'user_id' => $item->user_id,
                        'name' => $item->name,
                        'amount' => round((float) $item->net_pay, 2),
                        'account_number' => $item->account_number ?? '',
                        'ifsc' => $item->ifsc_swift ?? '',
                    ];
                });

                return [
                    'bank_name' => $bankName ?? 'Unknown',
                    'employee_count' => $group->count(),
                    'total_amount' => round((float) $group->sum('net_pay'), 2),
                    'employees' => $employees,
                ];
            })->values();

            $unmatched = $paidItems->filter(function ($item) {
                return empty($item->bank_name);
            })->count();

            return response()->json([
                'success' => true,
                'data' => [
                    'month_year' => $monthYear,
                    'total_paid' => round((float) $paidItems->sum('net_pay'), 2),
                    'banks' => $banks,
                    'unmatched' => $unmatched,
                ],
                'message' => 'Bank reconciliation report retrieved successfully.',
            ]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    public function evaluateFormula(Request $request)
    {
        try {
            $data = $request->validate([
                'formula_expression' => 'required|string',
                'variables' => 'nullable|array',
            ]);

            $expression = $data['formula_expression'];
            $variables = $data['variables'] ?? [];

            $validation = $this->validateFormulaExpression($expression);
            if (!$validation['valid']) {
                return response()->json([
                    'success' => false,
                    'data' => [
                        'expression' => $expression,
                        'variables_used' => [],
                        'result' => null,
                        'error' => $validation['errors'][0]['message'] ?? 'Invalid expression.',
                    ],
                    'message' => 'Invalid formula expression.',
                ], 422);
            }

            $variablesUsed = [];
            foreach ($variables as $key => $value) {
                if (preg_match('/\b' . preg_quote($key, '/') . '\b/', $expression)) {
                    $variablesUsed[$key] = (float) $value;
                }
            }

            $evalExpression = $expression;
            foreach ($variablesUsed as $key => $value) {
                $evalExpression = preg_replace('/\b' . preg_quote($key, '/') . '\b/', '(' . $value . ')', $evalExpression);
            }

            $result = $this->safeEval($evalExpression);

            return response()->json([
                'success' => true,
                'data' => [
                    'expression' => $expression,
                    'variables_used' => $variablesUsed,
                    'result' => $result,
                    'error' => null,
                ],
                'message' => 'Formula evaluated successfully.',
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'data' => [
                    'expression' => $data['formula_expression'] ?? '',
                    'variables_used' => $variables ?? [],
                    'result' => null,
                    'error' => $e->getMessage(),
                ],
                'message' => 'Formula evaluation failed.',
            ], 422);
        }
    }

    public function validateFormula(Request $request)
    {
        try {
            $data = $request->validate([
                'formula_expression' => 'required|string',
            ]);

            $result = $this->validateFormulaExpression($data['formula_expression']);

            return response()->json([
                'success' => true,
                'data' => $result,
                'message' => $result['valid'] ? 'Formula is valid.' : 'Formula has errors.',
            ]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 500);
        }
    }

    private function validateFormulaExpression(string $expression): array
    {
        $errors = [];

        if (preg_match('/\b(sin|cos|tan|log|ln|exp|sqrt|pow|abs|exec|system|passthru|shell|popen|proc_open|eval|file_get_contents|file_put_contents|include|require|require_once|include_once)\s*\(/i', $expression, $matches)) {
            $errors[] = ['message' => 'Function "' . $matches[1] . '" is not allowed.', 'position' => strpos($expression, $matches[0])];
        }

        $parenDepth = 0;
        for ($i = 0; $i < strlen($expression); $i++) {
            $ch = $expression[$i];
            if ($ch === '(') {
                $parenDepth++;
            } elseif ($ch === ')') {
                $parenDepth--;
                if ($parenDepth < 0) {
                    $errors[] = ['message' => 'Unmatched closing parenthesis.', 'position' => $i];
                }
            }
        }
        if ($parenDepth > 0) {
            $errors[] = ['message' => 'Unmatched opening parenthesis.', 'position' => strlen($expression) - 1];
        }

        return [
            'valid' => empty($errors),
            'errors' => $errors,
        ];
    }

    private function safeEval(string $expression): float
    {
        $expression = trim($expression);
        $tokens = $this->tokenize($expression);
        $result = $this->parseExpression($tokens, 0);
        return round($result['value'], 2);
    }

    private function tokenize(string $expression): array
    {
        $tokens = [];
        $i = 0;
        $len = strlen($expression);

        while ($i < $len) {
            if ($expression[$i] === ' ') {
                $i++;
                continue;
            }

            if (ctype_digit($expression[$i]) || $expression[$i] === '.') {
                $num = '';
                while ($i < $len && (ctype_digit($expression[$i]) || $expression[$i] === '.')) {
                    $num .= $expression[$i++];
                }
                $tokens[] = ['type' => 'number', 'value' => (float) $num];
                continue;
            }

            if (in_array($expression[$i], ['+', '-', '*', '/', '(', ')'])) {
                $tokens[] = ['type' => 'operator', 'value' => $expression[$i]];
                $i++;
                continue;
            }

            $i++;
        }

        return $tokens;
    }

    private function parseExpression(array $tokens, int $pos): array
    {
        return $this->parseAddSub($tokens, $pos);
    }

    private function parseAddSub(array $tokens, int $pos): array
    {
        $left = $this->parseMulDiv($tokens, $pos);

        while ($left['pos'] < count($tokens) && in_array($tokens[$left['pos']]['value'] ?? '', ['+', '-'])) {
            $op = $tokens[$left['pos']]['value'];
            $right = $this->parseMulDiv($tokens, $left['pos'] + 1);
            if ($op === '+') {
                $left = ['value' => $left['value'] + $right['value'], 'pos' => $right['pos']];
            } else {
                $left = ['value' => $left['value'] - $right['value'], 'pos' => $right['pos']];
            }
        }

        return $left;
    }

    private function parseMulDiv(array $tokens, int $pos): array
    {
        $left = $this->parseUnary($tokens, $pos);

        while ($left['pos'] < count($tokens) && in_array($tokens[$left['pos']]['value'] ?? '', ['*', '/'])) {
            $op = $tokens[$left['pos']]['value'];
            $right = $this->parseUnary($tokens, $left['pos'] + 1);
            if ($op === '*') {
                $left = ['value' => $left['value'] * $right['value'], 'pos' => $right['pos']];
            } else {
                if ($right['value'] == 0) {
                    throw new \RuntimeException('Division by zero.');
                }
                $left = ['value' => $left['value'] / $right['value'], 'pos' => $right['pos']];
            }
        }

        return $left;
    }

    private function parseUnary(array $tokens, int $pos): array
    {
        if ($pos < count($tokens) && $tokens[$pos]['value'] === '-') {
            $result = $this->parsePrimary($tokens, $pos + 1);
            return ['value' => -$result['value'], 'pos' => $result['pos']];
        }
        return $this->parsePrimary($tokens, $pos);
    }

    private function parsePrimary(array $tokens, int $pos): array
    {
        if ($pos >= count($tokens)) {
            throw new \RuntimeException('Unexpected end of expression.');
        }

        $token = $tokens[$pos];

        if ($token['type'] === 'number') {
            return ['value' => $token['value'], 'pos' => $pos + 1];
        }

        if ($token['type'] === 'operator' && $token['value'] === '(') {
            $result = $this->parseExpression($tokens, $pos + 1);
            if ($result['pos'] < count($tokens) && $tokens[$result['pos']]['value'] === ')') {
                $result['pos']++;
            } else {
                throw new \RuntimeException('Missing closing parenthesis.');
            }
            return $result;
        }

        throw new \RuntimeException('Unexpected token at position ' . $pos . '.');
    }
}
