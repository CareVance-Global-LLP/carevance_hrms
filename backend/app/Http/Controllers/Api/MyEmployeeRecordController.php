<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmployeeBankAccount;
use App\Models\EmployeeDocument;
use App\Models\EmployeeEducation;
use App\Models\EmployeeGovernmentId;
use App\Models\User;
use App\Services\Employees\EmployeeWorkspaceService;
use App\Services\Validation\IndianIdValidationService;
use Illuminate\Http\Request;

/**
 * The employee's own bank details, government IDs and documents.
 *
 * Every other write to these records lives behind `role:admin,manager` on an
 * id-addressed route. This controller is deliberately separate rather than a
 * relaxed owner check on those: `/employees/{id}/bank-accounts` takes an id, so
 * one slip in an authorization helper opens write access to somebody else's
 * PII. Nothing here accepts an id at all — the subject is always
 * `$request->user()`, which is a property of the shape rather than of a check
 * that has to stay correct. `/me/company` and `/me/team-members` already
 * establish the pattern.
 *
 * The reads are narrow on purpose. `EmployeeWorkspaceService::workspace()`
 * would serve the same three collections, but it also runs attendance and
 * leave summaries and loads salary templates — far more work than a settings
 * tab needs, and far more of the record than this screen should return.
 *
 * The writes are NOT narrow: they delegate to the same service methods the
 * admin path uses, so format validation, blind-index maintenance and the
 * one-row-per-type upsert rules cannot drift between the two surfaces. That
 * drift has already happened once here — two copies of the details UI wrote
 * `id_type` in different cases, and employee_government_ids still holds both
 * spellings for the same kind of ID.
 */
class MyEmployeeRecordController extends Controller
{
    public function __construct(
        private readonly EmployeeWorkspaceService $employeeWorkspaceService,
        private readonly IndianIdValidationService $validationService,
    ) {
    }

    /**
     * Everything the Profile pane renders, and nothing else.
     *
     * Documents are their own uploads plus whatever HR has explicitly shared
     * through `visible_to_employee`. A record can hold a warning letter, a PIP
     * note or a background check as easily as an offer letter, and nothing else
     * on the row distinguishes them — so the flag is the boundary, and it
     * defaults to false.
     */
    public function index(Request $request)
    {
        $user = $request->user();

        return response()->json([
            'employee' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
            ],
            /*
             * The same employee_profiles row the admin panel writes.
             *
             * Settings > Profile used to read this through
             * /employees/{id}/workspace, which is gated on role:admin,manager —
             * so an employee was refused by the middleware and a manager by the
             * scope check (their own hierarchy level is not BELOW their own).
             * Only an admin ever got data; everybody else silently saw a blank
             * form, and anything HR filled in for them never arrived.
             *
             * Work info is deliberately absent: the Profile pane does not render
             * it and it is not the employee's to change.
             */
            'about' => $user->employeeProfile,
            'bank_accounts' => EmployeeBankAccount::query()
                ->with('document')
                ->where('user_id', $user->id)
                ->orderByDesc('is_default')
                ->latest()
                ->get(),
            'government_ids' => EmployeeGovernmentId::query()
                ->with(['document', 'reviewer:id,name,email'])
                ->where('user_id', $user->id)
                ->latest()
                ->get(),
            'educations' => EmployeeEducation::query()
                ->with('document')
                ->where('user_id', $user->id)
                ->orderByDesc('year_of_passing')
                ->latest()
                ->get(),
            'documents' => EmployeeDocument::query()
                ->where('user_id', $user->id)
                ->where(fn ($query) => $this->visibleToOwner($query, $user->id))
                ->latest('uploaded_at')
                ->latest()
                ->get(),
        ]);
    }

    /**
     * What of their own record the employee is allowed to see.
     *
     * Their own uploads, plus anything HR has explicitly shared. Before
     * `visible_to_employee` existed the uploader was the only boundary
     * available, which meant a person could not see their own offer letter.
     */
    private function visibleToOwner($query, int $userId)
    {
        return $query->where('uploaded_by', $userId)
            ->orWhere('visible_to_employee', true);
    }

    public function storeGovernmentId(Request $request)
    {
        $user = $request->user();

        $data = $request->validate([
            'id' => 'nullable|integer',
            'id_type' => 'required|string|max:80',
            'id_number' => 'required|string|max:255',
            'issue_date' => 'nullable|date',
            'expiry_date' => 'nullable|date',
            'notes' => 'nullable|string',
            'proof_file' => 'nullable|file|max:10240',
        ]);

        // The same validator the admin path runs, so a PAN that is refused
        // there is refused here and both store the normalised form.
        $validationResult = $this->validationService->validate(
            strtolower($data['id_type']),
            $data['id_number']
        );

        if (! $validationResult['valid']) {
            return response()->json([
                'message' => 'Invalid ID format',
                'error' => $validationResult['error'],
                'id_type' => $data['id_type'],
                'id_number' => $validationResult['normalized'] ?? $data['id_number'],
            ], 422);
        }

        $data['id_number'] = $validationResult['normalized'];

        // Self-declared, and said so. A saved record is usable immediately —
        // nothing downstream gates on this value — but the employee is never
        // their own reviewer, so `status` is not theirs to set and reviewed_by
        // stays empty. Trusting the entry is not the same as recording that
        // somebody checked it.
        $data['status'] = 'pending';
        // And the previous review goes with it. Without this the row keeps the
        // admin who verified the OLD number and reads "pending, reviewed by
        // Priya" — a review of a value that is no longer there.
        $data['reviewed_by'] = null;
        $data['reviewed_at'] = null;

        if ($request->hasFile('proof_file')) {
            $document = $this->employeeWorkspaceService->storeDocument($user, $user, [
                'title' => $data['id_type'].' proof',
                'category' => 'government_id_proof',
                'review_status' => 'pending',
                'notes' => $data['notes'] ?? null,
                // See the admin path: the proof is stored before the row that
                // links to it, so the ID type travels with the document.
                'meta' => ['id_type' => $data['id_type']],
            ], $request->file('proof_file'));
            $data['employee_document_id'] = $document->id;
        }

        /*
         * Counted rather than read off the model. The service returns
         * `$record->fresh()`, and a re-queried model always reports
         * wasRecentlyCreated === false — so asking it whether this was an
         * insert would answer "no" every time and the route would never
         * return 201.
         */
        $before = EmployeeGovernmentId::query()->where('user_id', $user->id)->count();

        $record = $this->employeeWorkspaceService->upsertGovernmentId($user, $data);

        $created = EmployeeGovernmentId::query()->where('user_id', $user->id)->count() > $before;
        $this->employeeWorkspaceService->recordActivity(
            $user,
            $user,
            'employee.government_id_self_declared',
            'Added their own government ID.',
            ['id_type' => $record->id_type]
        );

        return response()->json($record, $created ? 201 : 200);
    }

    public function storeBankAccount(Request $request)
    {
        $user = $request->user();

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
            'notes' => 'nullable|string',
            'proof_file' => 'nullable|file|max:10240',
        ]);

        $validationErrors = [];

        if (! empty($data['ifsc_swift'])) {
            $ifscResult = $this->validationService->validateIfsc($data['ifsc_swift']);
            if (! $ifscResult['valid']) {
                $validationErrors['ifsc_swift'] = $ifscResult['error'];
            } else {
                $data['ifsc_swift'] = $ifscResult['normalized'];
            }
        }

        if (! empty($data['account_number'])) {
            $accountResult = $this->validationService->validateBankAccount($data['account_number']);
            if (! $accountResult['valid']) {
                $validationErrors['account_number'] = $accountResult['error'];
            } else {
                $data['account_number'] = $accountResult['normalized'];
            }
        }

        if (! empty($data['upi_id'])) {
            $upiResult = $this->validationService->validateUpi($data['upi_id']);
            if (! $upiResult['valid']) {
                $validationErrors['upi_id'] = $upiResult['error'];
            } else {
                $data['upi_id'] = $upiResult['normalized'];
            }
        }

        if (! empty($validationErrors)) {
            return response()->json([
                'message' => 'Invalid bank details',
                'errors' => $validationErrors,
            ], 422);
        }

        // Same reasoning as the government ID above. Disbursement reads only
        // account_number and ifsc_swift, so the account is payable the moment
        // it is saved regardless of what this says.
        $data['verification_status'] = 'unverified';

        if ($request->hasFile('proof_file')) {
            $document = $this->employeeWorkspaceService->storeDocument($user, $user, [
                'title' => ($data['bank_name'] ?? 'Bank').' proof',
                'category' => 'bank_proof',
                'review_status' => 'pending',
                'notes' => $data['notes'] ?? null,
            ], $request->file('proof_file'));
            $data['employee_document_id'] = $document->id;
        }

        // Same reason as above: fresh() loses wasRecentlyCreated.
        $before = EmployeeBankAccount::query()->where('user_id', $user->id)->count();

        $record = $this->employeeWorkspaceService->upsertBankAccount($user, $data);

        $created = EmployeeBankAccount::query()->where('user_id', $user->id)->count() > $before;
        $this->employeeWorkspaceService->recordActivity(
            $user,
            $user,
            'employee.bank_account_self_declared',
            'Added their own bank details.',
            ['bank_name' => $record->bank_name]
        );

        return response()->json($record, $created ? 201 : 200);
    }

    /**
     * Record one of the employee's own qualifications.
     *
     * The admin path calls this HR-owned, "because the certificate is the
     * evidence and the person it describes should not be the one attesting to
     * it". That rule was relaxed deliberately: a joiner supplying their own
     * degree certificate is how onboarding actually proceeds, and the file is
     * still evidence anybody can open and check. Verification remains HR's job;
     * what changed is who may put the record on file.
     */
    public function storeEducation(Request $request)
    {
        $user = $request->user();

        $data = $request->validate([
            'id' => 'nullable|integer',
            'qualification' => 'required|string|max:120',
            'institution' => 'nullable|string|max:255',
            'specialisation' => 'nullable|string|max:255',
            // Same bounds as the admin path: a four-digit typo in a year is
            // silent and permanent, and nobody passed an exam in the year 200.
            'year_of_passing' => 'nullable|integer|min:1950|max:'.(int) now()->addYear()->format('Y'),
            'grade' => 'nullable|string|max:40',
            'notes' => 'nullable|string',
            'certificate_file' => 'nullable|file|max:10240',
        ]);

        if ($request->hasFile('certificate_file')) {
            $document = $this->employeeWorkspaceService->storeDocument($user, $user, [
                'title' => $data['qualification'].' certificate',
                'category' => 'education_certificate',
                'review_status' => 'pending',
                'notes' => $data['notes'] ?? null,
                // Their own certificate; hiding it from them would be absurd.
                'visible_to_employee' => true,
            ], $request->file('certificate_file'));
            $data['employee_document_id'] = $document->id;
        }

        $before = EmployeeEducation::query()->where('user_id', $user->id)->count();

        $record = $this->employeeWorkspaceService->upsertEducation($user, $data);

        $created = EmployeeEducation::query()->where('user_id', $user->id)->count() > $before;
        $this->employeeWorkspaceService->recordActivity(
            $user,
            $user,
            'employee.education_self_recorded',
            'Recorded their own qualification.',
            ['qualification' => $record->qualification]
        );

        return response()->json($record, $created ? 201 : 200);
    }

    /**
     * Remove one of their own qualifications.
     *
     * The certificate stays. It is a document in its own right, an onboarding
     * checklist item may already reference it, and deleting a file to undo a
     * typo is not recoverable.
     */
    public function destroyEducation(Request $request, int $educationId)
    {
        $user = $request->user();

        $record = EmployeeEducation::query()
            ->where('user_id', $user->id)
            ->find($educationId);

        if (! $record) {
            return response()->json(['message' => 'Education record not found'], 404);
        }

        $record->delete();

        return response()->json(['message' => 'Education record removed. The certificate stays on file.']);
    }

    public function storeDocument(Request $request)
    {
        $user = $request->user();

        $data = $request->validate([
            'title' => 'required|string|max:255',
            'category' => 'required|string|max:80',
            'notes' => 'nullable|string',
            // Which kind of ID a government_id_proof proves. The category alone
            // cannot tell a PAN card from an Aadhaar, and the checklist matcher
            // reads exactly this to decide which item the upload answers.
            'id_type' => 'nullable|string|max:80',
            'file' => 'required|file|max:15360',
        ]);

        // Not theirs to set, for the same reason as above.
        $data['review_status'] = 'pending';
        // Their own upload; hiding it from them would be absurd.
        $data['visible_to_employee'] = true;

        // Carried on the document, mirroring how the government-ID controllers
        // stamp it: the proof is written before any row that would link back to
        // it, so the type has to travel with the file.
        if (! empty($data['id_type'])) {
            $data['meta'] = ['id_type' => $data['id_type']];
        }

        $document = $this->employeeWorkspaceService->storeDocument($user, $user, $data, $request->file('file'));
        $this->employeeWorkspaceService->recordActivity(
            $user,
            $user,
            'employee.document_self_uploaded',
            'Uploaded a document to their own record.',
            ['title' => $document->title, 'category' => $document->category]
        );

        return response()->json($document, 201);
    }

    /**
     * Download one of their own uploads.
     *
     * Both clauses matter. `user_id` keeps them inside their own record;
     * `uploaded_by` keeps them out of whatever HR attached to it. A document
     * failing either test is 403 rather than 404 — the row plainly exists, and
     * pretending otherwise on a route that only ever addresses the caller's own
     * record would be a confusing lie.
     */
    public function downloadDocument(Request $request, int $documentId)
    {
        $user = $request->user();

        $document = EmployeeDocument::query()->find($documentId);

        if (! $document) {
            return response()->json(['message' => 'Document not found'], 404);
        }

        $isOwnRecord = (int) $document->user_id === (int) $user->id;
        $mayRead = $isOwnRecord
            && ((int) $document->uploaded_by === (int) $user->id || $document->visible_to_employee);

        // Moves in step with the list above. A document hidden from the list but
        // still downloadable by id would be no protection at all.
        if (! $mayRead) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return $this->employeeWorkspaceService->documentResponse($document);
    }
}
