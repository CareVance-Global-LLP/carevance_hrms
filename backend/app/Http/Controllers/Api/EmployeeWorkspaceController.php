<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmployeeDocument;
use App\Models\User;
use App\Services\Employees\EmployeeWorkspaceService;
use App\Services\Organization\EmployeeScopeResolver;
use Illuminate\Http\Request;

class EmployeeWorkspaceController extends Controller
{
    public function __construct(
        private readonly EmployeeWorkspaceService $employeeWorkspaceService,
        private readonly \App\Services\Validation\IndianIdValidationService $validationService,
        private readonly EmployeeScopeResolver $scopeResolver,
    ) {
    }

    public function show(Request $request, int|string $id)
    {
        $currentUser = $request->user();
        $employee = $this->employee($currentUser?->organization_id, $id);
        if (!$currentUser || !$employee || !$this->canManageEmployee($currentUser, $employee)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json(
            $this->employeeWorkspaceService->workspace($employee, (string) $request->get('payroll_month', now()->format('Y-m')))
        );
    }

    public function updateProfile(Request $request, int|string $id)
    {
        $currentUser = $request->user();
        $employee = $this->employee($currentUser?->organization_id, $id);
        if (!$currentUser || !$employee || !$this->canEditProfile($currentUser, $employee)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'first_name' => 'nullable|string|max:120',
            'middle_name' => 'nullable|string|max:120',
            'last_name' => 'nullable|string|max:120',
            'display_name' => 'nullable|string|max:120',
            'gender' => 'nullable|string|max:32',
            'date_of_birth' => 'nullable|date',
            'phone' => 'nullable|string|max:64',
            'personal_email' => 'nullable|email',
            'address_line' => 'nullable|string',
            'city' => 'nullable|string|max:120',
            'state' => 'nullable|string|max:120',
            'postal_code' => 'nullable|string|max:32',
            'permanent_address_line' => 'nullable|string',
            'permanent_city' => 'nullable|string|max:120',
            'permanent_state' => 'nullable|string|max:120',
            'permanent_postal_code' => 'nullable|string|max:32',
            'blood_group' => 'nullable|string|max:8',
            'emergency_contact_name' => 'nullable|string|max:120',
            'emergency_contact_number' => 'nullable|string|max:64',
            'emergency_contact_relationship' => 'nullable|string|max:120',
        ]);

        $profile = $this->employeeWorkspaceService->upsertProfile($employee, $data);
        $this->employeeWorkspaceService->recordActivity($employee, $currentUser, 'employee.profile_updated', 'Updated personal details.', $data);

        return response()->json($profile);
    }

    public function updateWorkInfo(Request $request, int|string $id)
    {
        $currentUser = $request->user();
        $employee = $this->employee($currentUser?->organization_id, $id);
        if (!$currentUser || !$employee || !$this->canManageEmployee($currentUser, $employee)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'employee_code' => 'nullable|string|max:80',
            'report_group_id' => 'nullable|integer',
            'designation' => 'nullable|string|max:120',
            'reporting_manager_id' => 'nullable|integer',
            'work_location' => 'nullable|string|max:255',
            'shift_name' => 'nullable|string|max:120',
            'attendance_policy' => 'nullable|string|max:120',
            'employment_type' => 'nullable|string|max:80',
            'joining_date' => 'nullable|date',
            'probation_status' => 'nullable|string|max:80',
            'employment_status' => 'nullable|in:active,inactive,notice,exited',
            'exit_date' => 'nullable|date',
            'work_mode' => 'nullable|in:office,remote,hybrid',
            /*
             * Both columns exist and are fillable, but neither was listed here —
             * and validate() returns only the keys it validated, so the
             * "Save Work Info" button posted them and the controller dropped
             * them on the floor. The schedule editor has never saved anything.
             */
            'expected_start_time' => 'nullable|date_format:H:i',
            'expected_timezone' => 'nullable|string|max:64',
        ]);

        // Setting the manager by hand marks the line explicit, so no later group
        // or department save silently recomputes it away.
        if (array_key_exists('reporting_manager_id', $data)) {
            $resolver = app(\App\Services\Organization\ReportingManagerResolver::class);
            $proposedManagerId = $data['reporting_manager_id'] === null
                ? null
                : (int) $data['reporting_manager_id'];

            if ($resolver->wouldCreateCycle((int) $employee->id, $proposedManagerId)) {
                return response()->json([
                    'message' => 'That reporting manager would create a reporting loop.',
                    'error_code' => 'REPORTING_CYCLE',
                ], 422);
            }

            if ($proposedManagerId !== null) {
                $proposedManager = \App\Models\User::query()
                    ->with('customRole')
                    ->where('organization_id', $employee->organization_id)
                    ->find($proposedManagerId);

                if (! $proposedManager) {
                    return response()->json(['message' => 'Reporting manager must be in the same organization.'], 422);
                }

                // Authority, not department. A manager may report to another
                // manager or to an admin; nobody may report to a peer or junior.
                if (! $resolver->canManage($proposedManager, $employee->loadMissing('customRole'))) {
                    return response()->json([
                        'message' => 'A reporting manager must hold more authority than the person reporting to them.',
                        'error_code' => 'INVALID_REPORTING_LINE',
                    ], 422);
                }
            }

            $data['reporting_manager_source'] = \App\Services\Organization\ReportingManagerResolver::SOURCE_EXPLICIT;
        }

        try {
            $workInfo = $this->employeeWorkspaceService->upsertWorkInfo($employee, $data);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
        $this->employeeWorkspaceService->recordActivity($employee, $currentUser, 'employee.work_info_updated', 'Updated work information.', $data);

        return response()->json($workInfo);
    }

    public function storeGovernmentId(Request $request, int|string $id)
    {
        $currentUser = $request->user();
        $employee = $this->employee($currentUser?->organization_id, $id);
        if (!$currentUser || !$employee || !$this->canManageEmployee($currentUser, $employee)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'id' => 'nullable|integer',
            'id_type' => 'required|string|max:80',
            'id_number' => 'required|string|max:255',
            'status' => 'nullable|in:verified,pending,rejected',
            'issue_date' => 'nullable|date',
            'expiry_date' => 'nullable|date',
            'notes' => 'nullable|string',
            'proof_file' => 'nullable|file|max:10240',
        ]);

        // Validate ID format before saving
        $idType = strtolower($data['id_type']);
        $validationResult = $this->validationService->validate($idType, $data['id_number']);
        
        if (!$validationResult['valid']) {
            return response()->json([
                'message' => 'Invalid ID format',
                'error' => $validationResult['error'],
                'id_type' => $data['id_type'],
                'id_number' => $validationResult['normalized'] ?? $data['id_number'],
            ], 422);
        }

        // Normalize the ID number
        $data['id_number'] = $validationResult['normalized'];

        if ($request->hasFile('proof_file')) {
            $document = $this->employeeWorkspaceService->storeDocument($employee, $currentUser, [
                'title' => ($data['id_type'] ?? 'Government ID') . ' proof',
                'category' => 'government_id_proof',
                'review_status' => $data['status'] ?? 'pending',
                'notes' => $data['notes'] ?? null,
                // A proof of the employee's OWN PAN or bank account is
                // evidence of a fact they supplied, not something HR wrote
                // about them — so who typed it in does not decide whether they
                // may look at it. Leaving this false rendered eye and download
                // buttons on their own row for a file the API then refused.
                'visible_to_employee' => true,
                // Carried on the document because this runs BEFORE the
                // employee_government_ids row that will point back at it, and
                // the checklist matcher needs to know a PAN card from an
                // Aadhaar at exactly this moment.
                'meta' => ['id_type' => $data['id_type'] ?? null],
            ], $request->file('proof_file'));
            $data['employee_document_id'] = $document->id;
        }

        $record = $this->employeeWorkspaceService->upsertGovernmentId($employee, $data + ['reviewed_by' => $currentUser->id]);
        $this->employeeWorkspaceService->recordActivity($employee, $currentUser, 'employee.government_id_saved', 'Saved a government ID record.', [
            'id_type' => $record->id_type,
            'status' => $record->status,
        ]);

        return response()->json($record, isset($data['id']) ? 200 : 201);
    }

    public function storeBankAccount(Request $request, int|string $id)
    {
        $currentUser = $request->user();
        $employee = $this->employee($currentUser?->organization_id, $id);
        if (!$currentUser || !$employee || !$this->canManageEmployee($currentUser, $employee)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'id' => 'nullable|integer',
            'account_holder_name' => 'nullable|string|max:255',
            'bank_name' => 'nullable|string|max:255',
            'account_number' => 'nullable|string|max:255',
            'ifsc_swift' => 'nullable|string|max:120',
            'branch' => 'nullable|string|max:255',
            'account_type' => 'nullable|string|max:80',
            'upi_id' => 'nullable|string|max:255',
            'payment_email' => 'nullable|email',
            'payout_method' => 'nullable|string|max:32',
            'is_default' => 'nullable|boolean',
            'verification_status' => 'nullable|in:verified,unverified,pending,rejected',
            'notes' => 'nullable|string',
            'proof_file' => 'nullable|file|max:10240',
        ]);

        // Validate bank details
        $validationErrors = [];

        if (!empty($data['ifsc_swift'])) {
            $ifscResult = $this->validationService->validateIfsc($data['ifsc_swift']);
            if (!$ifscResult['valid']) {
                $validationErrors['ifsc_swift'] = $ifscResult['error'];
            } else {
                $data['ifsc_swift'] = $ifscResult['normalized'];
            }
        }

        if (!empty($data['account_number'])) {
            $accountResult = $this->validationService->validateBankAccount($data['account_number']);
            if (!$accountResult['valid']) {
                $validationErrors['account_number'] = $accountResult['error'];
            } else {
                $data['account_number'] = $accountResult['normalized'];
            }
        }

        if (!empty($data['upi_id'])) {
            $upiResult = $this->validationService->validateUpi($data['upi_id']);
            if (!$upiResult['valid']) {
                $validationErrors['upi_id'] = $upiResult['error'];
            } else {
                $data['upi_id'] = $upiResult['normalized'];
            }
        }

        if (!empty($validationErrors)) {
            return response()->json([
                'message' => 'Invalid bank details',
                'errors' => $validationErrors,
            ], 422);
        }

        if ($request->hasFile('proof_file')) {
            $document = $this->employeeWorkspaceService->storeDocument($employee, $currentUser, [
                'title' => (($data['bank_name'] ?? 'Bank') . ' proof'),
                'category' => 'bank_proof',
                'review_status' => $data['verification_status'] ?? 'pending',
                'notes' => $data['notes'] ?? null,
                // A proof of the employee's OWN PAN or bank account is
                // evidence of a fact they supplied, not something HR wrote
                // about them — so who typed it in does not decide whether they
                // may look at it. Leaving this false rendered eye and download
                // buttons on their own row for a file the API then refused.
                'visible_to_employee' => true,
            ], $request->file('proof_file'));
            $data['employee_document_id'] = $document->id;
        }

        $record = $this->employeeWorkspaceService->upsertBankAccount($employee, $data);
        $this->employeeWorkspaceService->recordActivity($employee, $currentUser, 'employee.bank_account_saved', 'Saved bank details.', [
            'bank_name' => $record->bank_name,
            'payout_method' => $record->payout_method,
        ]);

        return response()->json($record, isset($data['id']) ? 200 : 201);
    }

    /**
     * Record a qualification, with its certificate.
     *
     * Shaped exactly like storeGovernmentId: an optional `id` makes it an
     * upsert, and a file on the request becomes an EmployeeDocument that the
     * row then references. Reusing that path is what keeps the certificate on
     * the private employee_documents disk, behind the one authenticated,
     * org-scoped download route, rather than acquiring storage of its own.
     */
    public function storeEducation(Request $request, int|string $id)
    {
        $currentUser = $request->user();
        $employee = $this->employee($currentUser?->organization_id, $id);
        if (!$currentUser || !$employee || !$this->canManageEmployee($currentUser, $employee)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'id' => 'nullable|integer',
            'qualification' => 'required|string|max:120',
            'institution' => 'nullable|string|max:255',
            'specialisation' => 'nullable|string|max:255',
            // Bounded rather than free: a four-digit typo in a year is silent
            // and permanent, and nobody passed an exam in the year 200.
            'year_of_passing' => 'nullable|integer|min:1950|max:'.(int) now()->addYear()->format('Y'),
            'grade' => 'nullable|string|max:40',
            'notes' => 'nullable|string',
            'certificate_file' => 'nullable|file|max:10240',
        ]);

        if ($request->hasFile('certificate_file')) {
            $document = $this->employeeWorkspaceService->storeDocument($employee, $currentUser, [
                'title' => $data['qualification'].' certificate',
                'category' => 'education_certificate',
                'review_status' => 'pending',
                'notes' => $data['notes'] ?? null,
            ], $request->file('certificate_file'));
            $data['employee_document_id'] = $document->id;
        }

        $record = $this->employeeWorkspaceService->upsertEducation($employee, $data);
        $this->employeeWorkspaceService->recordActivity($employee, $currentUser, 'employee.education_saved', 'Saved an education record.', [
            'qualification' => $record->qualification,
            'institution' => $record->institution,
        ]);

        return response()->json($record, isset($data['id']) ? 200 : 201);
    }

    /**
     * Remove a qualification.
     *
     * The certificate is left in place. It is an employee document in its own
     * right, it may already be referenced by an onboarding checklist item, and
     * deleting a file to undo a data-entry mistake is not recoverable.
     */
    public function destroyEducation(Request $request, int|string $id, int $educationId)
    {
        $currentUser = $request->user();
        $employee = $this->employee($currentUser?->organization_id, $id);
        if (!$currentUser || !$employee || !$this->canManageEmployee($currentUser, $employee)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $record = \App\Models\EmployeeEducation::query()
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->find($educationId);

        if (!$record) {
            return response()->json(['message' => 'Education record not found'], 404);
        }

        $qualification = $record->qualification;
        $record->delete();

        $this->employeeWorkspaceService->recordActivity($employee, $currentUser, 'employee.education_removed', 'Removed an education record.', [
            'qualification' => $qualification,
        ]);

        return response()->json(['message' => 'Education record removed']);
    }

    public function storeDocument(Request $request, int|string $id)
    {
        $currentUser = $request->user();
        $employee = $this->employee($currentUser?->organization_id, $id);
        if (!$currentUser || !$employee || !$this->canManageEmployee($currentUser, $employee)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'title' => 'required|string|max:255',
            'category' => 'required|string|max:80',
            'review_status' => 'nullable|in:pending,verified,rejected',
            'notes' => 'nullable|string',
            // Off unless HR says otherwise. An offer letter or a Form 16 is
            // meant for the employee; a warning letter on the same record is
            // not, and the row itself cannot tell them apart.
            'visible_to_employee' => 'nullable|boolean',
            // Which kind of ID a government_id_proof proves. The category alone
            // cannot tell a PAN card from an Aadhaar, and the checklist matcher
            // reads exactly this to decide which item the upload answers.
            'id_type' => 'nullable|string|max:80',
            'file' => 'required|file|max:15360',
        ]);

        // Carried on the document, mirroring how the government-ID controllers
        // stamp it: the proof is written before any row that would link back to
        // it, so the type has to travel with the file.
        if (! empty($data['id_type'])) {
            $data['meta'] = ['id_type' => $data['id_type']];
        }

        $document = $this->employeeWorkspaceService->storeDocument($employee, $currentUser, $data, $request->file('file'));
        $this->employeeWorkspaceService->recordActivity($employee, $currentUser, 'employee.document_uploaded', 'Uploaded a document.', [
            'title' => $document->title,
            'category' => $document->category,
        ]);

        return response()->json($document, 201);
    }

    public function downloadDocument(Request $request, int|string $id, int $documentId)
    {
        $currentUser = $request->user();
        $employee = $this->employee($currentUser?->organization_id, $id);
        if (!$currentUser || !$employee || !$this->canManageEmployee($currentUser, $employee)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $document = EmployeeDocument::query()
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->find($documentId);

        if (!$document) {
            return response()->json(['message' => 'Document not found'], 404);
        }

        return $this->employeeWorkspaceService->documentResponse($document);
    }

    private function employee(?int $organizationId, int|string $id): ?User
    {
        if (!$organizationId) {
            return null;
        }

        $byCode = User::query()
            ->where('organization_id', $organizationId)
            ->whereHas('employeeWorkInfo', fn ($q) => $q->where('employee_code', $id))
            ->first();

        if ($byCode) {
            return $byCode;
        }

        if (is_numeric($id)) {
            return User::query()
                ->where('organization_id', $organizationId)
                ->find((int) $id);
        }

        return User::query()
            ->where('organization_id', $organizationId)
            ->find($id);
    }

    private function canManage(User $user): bool
    {
        return $this->scopeResolver->canManageAnyone($user);
    }

    private function canManageEmployee(User $actor, User $employee): bool
    {
        return $this->scopeResolver->canActOn($actor, $employee);
    }

    private function canEditProfile(User $actor, User $employee): bool
    {
        if ($actor->id === $employee->id) {
            return true;
        }

        return $this->canManageEmployee($actor, $employee);
    }
}
