<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmployeeDocument;
use App\Models\Organization;
use App\Models\PayGroup;
use App\Models\PayrollFiling;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\Approvals\ApprovalRoutingService;
use App\Services\PayrollFilingService;
use App\Services\PayrollFilingValidatorService;
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

                // Look up employee by PAN
                $employee = User::where('organization_id', $orgId)
                    ->whereHas('employeeProfile', function ($q) use ($pan) {
                        $q->where('pan_number', $pan);
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
        $request->validate([
            'payroll_run_id' => 'required|exists:payroll_monthly_runs,id',
            'state' => 'required|string',
        ]);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filing = $filingService->generatePtReturn($run, $request->state, auth()->user()->organization_id, auth()->id());

        return response()->json($filing);
    }

    public function generateLwfReturn(Request $request, PayrollFilingService $filingService)
    {
        $data = $request->validate([
            'payroll_run_id' => 'required|exists:payroll_monthly_runs,id',
            'state' => 'required|string',
        ]);
        $run = PayrollMonthlyRun::findOrFail($data['payroll_run_id']);
        $this->assertRunFileable($run);
        try {
            $filing = $filingService->generateLwfReturn($run, $data['state'], auth()->user()->organization_id, auth()->id());
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

    public function generateAllFilings(Request $request, PayrollFilingService $filingService, ApprovalRoutingService $routing)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $this->assertRunFileable($run);
        $filings = $filingService->generateAllFilings($run, auth()->user()->organization_id, auth()->id());

        // Auto-route each generated filing to the internal reviewer (maker-checker),
        // matching the payroll-run approval pattern.
        $requester = auth()->user();
        $reviewerIds = $routing->reviewerUserIds($requester);
        $reviewerId = $reviewerIds->first();

        foreach ($filings as $filing) {
            if (! empty($filing->file_path) && $filing->status === 'generated') {
                $filing->status = 'submitted';
                $filing->submitted_at = now();
                $filing->submitted_by = $requester->id;
                $filing->reviewer_user_id = $reviewerId;
                $filing->portal_status = 'pending_upload';
                $filing->save();
            }
        }

        return response()->json([
            'filings' => $filings,
            'count' => count($filings),
            'reviewer_ids' => $reviewerIds->all(),
        ]);
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
        ]);

        $filing = PayrollFiling::where('id', $id)
            ->where('organization_id', auth()->user()->organization_id)
            ->firstOrFail();

        if (! in_array($filing->status, ['approved', 'submitted', 'generated'])) {
            return response()->json(['success' => false, 'message' => 'This filing cannot be marked filed in its current state.'], 422);
        }

        $filing->status = 'filed';
        $filing->filed_at = now();
        $filing->filed_by = auth()->id();
        $filing->acknowledgment_number = $data['acknowledgment_number'];
        $filing->portal_status = $data['portal_status'] ?? 'paid';
        if (! empty($data['notes'])) {
            $filing->notes = $data['notes'];
        }
        $filing->save();

        return response()->json(['filing' => $filing, 'message' => 'Filing recorded as filed.']);
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

        return response()->json($query->orderBy('created_at', 'desc')->paginate(20));
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

            $employees = collect($userIds)->map(function ($uid) use ($users, $payrollItems, $templates) {
                $u = $users->get($uid);
                if (!$u) return null;

                $item = $payrollItems->get($uid);
                $template = $templates->get($uid);
                $group = $u->groups->first();

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
                    'steps_completed' => [
                        'step1' => (bool) ($template?->step1_completed),
                        'step2' => (bool) ($template?->step2_completed),
                        'step3' => (bool) ($template?->step3_completed),
                        'step4' => (bool) ($template?->step4_completed),
                        'step5' => (bool) ($template?->step5_completed),
                        'step6' => (bool) ($template?->step6_completed),
                    ],
                    'current_step' => (int) ($template?->current_step ?? 1),
                    'payroll_status' => [
                        'is_processed' => $item && $item->payment_status !== 'pending',
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

        $column = "step{$data['step']}_completed";

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

        $updated = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $validUserIds)
            ->update([$column => true]);

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

        $column = "step{$data['step']}_completed";

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

        $updated = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $userIds)
            ->update([$column => true]);

        return response()->json([
            'success' => true,
            'step' => $data['step'],
            'updated_count' => $updated,
            'total_members' => count($userIds),
        ]);
    }

    /**
     * Get the per-step completion count for a pay group. Returns the
     * number of members who have completed each step. Used by the
     * Bulk Payroll Matrix footer to show "X of Y employees on this
     * step".
     */
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
}
