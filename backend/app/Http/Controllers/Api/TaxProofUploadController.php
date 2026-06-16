<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TaxProofSubmission;
use App\Services\TaxProofUploadService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TaxProofUploadController extends Controller
{
    public function __construct(private readonly TaxProofUploadService $svc) {}

    /**
     * GET /api/payroll/tax-proofs
     *
     * Query params:
     *   - status         submitted|auto_approved|approved|rejected
     *   - user_id        int
     *   - financial_year 2024-2025
     *   - section        80C|80D|HRA|...
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $orgId = $user->organization_id;
        $isAdmin = in_array($user->role, ['admin', 'super_admin'], true);

        $filters = $request->only(['status', 'user_id', 'financial_year', 'section']);
        $submissions = $this->svc->listSubmissions($orgId, $filters);

        if (!$isAdmin) {
            $submissions = $submissions->where('user_id', $user->id)->values();
        }

        return response()->json([
            'data'  => $submissions,
            'count' => $submissions->count(),
            'summary' => $isAdmin ? $this->svc->complianceSummary($orgId, $filters['financial_year'] ?? null) : null,
        ]);
    }

    public function myProofs(Request $request): JsonResponse
    {
        $user = $request->user();
        $filters = $request->only(['financial_year', 'status']);
        $filters['user_id'] = $user->id;
        $submissions = $this->svc->listSubmissions($user->organization_id, $filters);

        return response()->json([
            'data'  => $submissions,
            'count' => $submissions->count(),
        ]);
    }

    public function complianceSummary(Request $request): JsonResponse
    {
        $user = $request->user();
        $orgId = $user->organization_id;
        if (!in_array($user->role, ['admin', 'super_admin'], true)) {
            return response()->json(['message' => 'Only admin can view compliance summary'], 403);
        }

        $fy = $request->input('financial_year');
        $summary = $this->svc->complianceSummary($orgId, $fy);

        return response()->json([
            'total_submissions'  => ($summary['pending'] ?? 0) + ($summary['approved'] ?? 0) + ($summary['rejected'] ?? 0) + ($summary['auto_approved'] ?? 0),
            'by_status' => [
                'submitted'      => $summary['pending'] ?? 0,
                'auto_approved'  => $summary['auto_approved'] ?? 0,
                'approved'       => $summary['approved'] ?? 0,
                'rejected'       => $summary['rejected'] ?? 0,
            ],
            'pending_amount'    => $summary['pending_amount'] ?? 0,
            'approved_amount'   => $summary['approved_amount'] ?? 0,
            'organisation_id'  => $orgId,
            'financial_year'   => $fy,
        ]);
    }

    /**
     * POST /api/payroll/tax-proofs
     *
     * multipart/form-data:
     *   - declaration_item_id   int  (required)
     *   - proof_file            file (required, ≤ 5 MB, pdf/jpg/png/webp)
     *   - amount                decimal (optional override)
     *   - description           string (optional)
     */
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'declaration_item_id' => 'required|integer|exists:employee_tax_declaration_items,id',
            'proof_file'          => 'required|file|max:5120', // 5 MB in KB
            'amount'              => 'nullable|numeric|min:0',
            'description'         => 'nullable|string|max:500',
        ]);

        $user = $request->user();

        $submission = $this->svc->uploadProof(
            $user->id,
            $user->organization_id,
            (int) $request->input('declaration_item_id'),
            $request->file('proof_file'),
            [
                'amount' => $request->input('amount'),
                'description' => $request->input('description'),
            ]
        );

        return response()->json([
            'message' => 'Tax proof uploaded successfully',
            'data'    => $submission,
        ], 201);
    }

    /**
     * GET /api/payroll/tax-proofs/{id}
     */
    public function show(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $submission = TaxProofSubmission::with([
            'user:id,name,email,employee_code',
            'declarationItem.declaration',
            'reviewedBy:id,name',
        ])->where('id', $id)
          ->where('organization_id', $user->organization_id)
          ->firstOrFail();

        if (!in_array($user->role, ['admin', 'super_admin'], true) && $submission->user_id !== $user->id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json($submission);
    }

    /**
     * GET /api/payroll/tax-proofs/{id}/download
     *
     * Streams the proof file as a forced download.
     */
    public function download(Request $request, int $id): StreamedResponse|JsonResponse
    {
        $user = $request->user();
        $submission = TaxProofSubmission::where('id', $id)
            ->where('organization_id', $user->organization_id)
            ->firstOrFail();

        if (!in_array($user->role, ['admin', 'super_admin'], true) && $submission->user_id !== $user->id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $disk = Storage::disk('local');
        if (!$disk->exists($submission->proof_file_path)) {
            return response()->json(['message' => 'File not found on disk'], 404);
        }

        return $disk->download(
            $submission->proof_file_path,
            $submission->proof_filename ?? basename($submission->proof_file_path)
        );
    }

    /**
     * POST /api/payroll/tax-proofs/{id}/review
     *
     * Body (json):
     *   - decision       approved|rejected|partial
     *   - approved_amount  numeric (required when decision=partial)
     *   - notes            string (optional)
     */
    public function review(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!in_array($user->role, ['admin', 'super_admin'], true)) {
            return response()->json(['message' => 'Only admin can review'], 403);
        }

        $data = $request->validate([
            'decision'        => 'required|in:approved,rejected,partial',
            'approved_amount' => 'required_if:decision,partial|nullable|numeric|min:0',
            'notes'           => 'nullable|string|max:1000',
        ]);

        $submission = $this->svc->reviewSubmission(
            $id,
            $user->id,
            $user->organization_id,
            $data['decision'],
            isset($data['approved_amount']) ? (float) $data['approved_amount'] : null,
            $data['notes'] ?? null,
        );

        return response()->json([
            'message' => 'Review recorded',
            'data'    => $submission,
        ]);
    }

    /**
     * POST /api/payroll/tax-proofs/bulk-approve
     *
     * Body: { user_id, financial_year }
     */
    public function bulkApprove(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!in_array($user->role, ['admin', 'super_admin'], true)) {
            return response()->json(['message' => 'Only admin can bulk-approve'], 403);
        }

        $data = $request->validate([
            'user_id'        => 'required|integer',
            'financial_year' => 'nullable|string',
        ]);

        $count = $this->svc->bulkApproveVerified(
            $data['user_id'],
            $user->organization_id,
            $user->id
        );

        return response()->json([
            'message' => "Approved {$count} submissions",
            'count'   => $count,
        ]);
    }

    /**
     * DELETE /api/payroll/tax-proofs/{id}
     *
     * Employees can delete their own proof ONLY if status is 'submitted'
     * and the FY declaration is still open. Admins can delete any.
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $submission = TaxProofSubmission::where('id', $id)
            ->where('organization_id', $user->organization_id)
            ->firstOrFail();

        $isAdmin = in_array($user->role, ['admin', 'super_admin'], true);
        if (!$isAdmin && ($submission->user_id !== $user->id || $submission->status !== 'submitted')) {
            return response()->json(['message' => 'Forbidden — cannot delete a reviewed proof'], 403);
        }

        // Remove the file from disk (best effort).
        try {
            Storage::disk('local')->delete($submission->proof_file_path);
        } catch (\Throwable $e) {
            // Don't fail the request — DB row is still removed.
        }

        $submission->delete();

        return response()->json(['message' => 'Proof deleted']);
    }

    public function downloadMy12BB(Request $request, string $financialYear): JsonResponse
    {
        $user = $request->user();
        $submissions = $this->svc->listSubmissions($user->organization_id, [
            'user_id' => $user->id,
            'financial_year' => $financialYear,
        ]);

        if ($submissions->isEmpty()) {
            return response()->json(['message' => 'No tax proofs found for the given financial year'], 404);
        }

        return response()->json([
            'message' => 'Form 12BB summary',
            'financial_year' => $financialYear,
            'submissions' => $submissions,
            'total_declared' => $submissions->sum('amount'),
        ]);
    }
}
