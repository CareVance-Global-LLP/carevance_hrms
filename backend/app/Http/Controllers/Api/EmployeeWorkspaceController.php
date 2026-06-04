<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmployeeDocument;
use App\Models\User;
use App\Services\Employees\EmployeeWorkspaceService;
use Illuminate\Http\Request;

class EmployeeWorkspaceController extends Controller
{
    public function __construct(
        private readonly EmployeeWorkspaceService $employeeWorkspaceService,
        private readonly \App\Services\Validation\IndianIdValidationService $validationService,
    ) {
    }

    public function show(Request $request, int $id)
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

    public function updateProfile(Request $request, int $id)
    {
        $currentUser = $request->user();
        $employee = $this->employee($currentUser?->organization_id, $id);
        if (!$currentUser || !$employee || !$this->canEditProfile($currentUser, $employee)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'first_name' => 'nullable|string|max:120',
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
            'emergency_contact_name' => 'nullable|string|max:120',
            'emergency_contact_number' => 'nullable|string|max:64',
            'emergency_contact_relationship' => 'nullable|string|max:120',
        ]);

        $profile = $this->employeeWorkspaceService->upsertProfile($employee, $data);
        $this->employeeWorkspaceService->recordActivity($employee, $currentUser, 'employee.profile_updated', 'Updated personal details.', $data);

        return response()->json($profile);
    }

    public function updateWorkInfo(Request $request, int $id)
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
        ]);

        $workInfo = $this->employeeWorkspaceService->upsertWorkInfo($employee, $data);
        $this->employeeWorkspaceService->recordActivity($employee, $currentUser, 'employee.work_info_updated', 'Updated work information.', $data);

        return response()->json($workInfo);
    }

    public function storeGovernmentId(Request $request, int $id)
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

    public function storeBankAccount(Request $request, int $id)
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

    public function storeDocument(Request $request, int $id)
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
            'file' => 'required|file|max:15360',
        ]);

        $document = $this->employeeWorkspaceService->storeDocument($employee, $currentUser, $data, $request->file('file'));
        $this->employeeWorkspaceService->recordActivity($employee, $currentUser, 'employee.document_uploaded', 'Uploaded a document.', [
            'title' => $document->title,
            'category' => $document->category,
        ]);

        return response()->json($document, 201);
    }

    public function downloadDocument(Request $request, int $id, int $documentId)
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

    private function employee(?int $organizationId, int $id): ?User
    {
        if (!$organizationId) {
            return null;
        }

        return User::query()
            ->where('organization_id', $organizationId)
            ->find($id);
    }

    private function canManage(User $user): bool
    {
        return $user->getHierarchyLevel() < 100;
    }

    private function canManageEmployee(User $actor, User $employee): bool
    {
        if (!$this->canManage($actor)) {
            return false;
        }

        $actorLevel = $actor->getHierarchyLevel();
        $employeeLevel = $employee->getHierarchyLevel();

        if ($actorLevel <= 10) {
            return true;
        }

        if ($employeeLevel <= $actorLevel) {
            return false;
        }

        $groupIds = $actor->groups()->pluck('groups.id')->all();
        if (empty($groupIds)) {
            return false;
        }

        return $employee->groups()->whereIn('groups.id', $groupIds)->exists();
    }

    private function canEditProfile(User $actor, User $employee): bool
    {
        return $actor->id === $employee->id;
    }
}
