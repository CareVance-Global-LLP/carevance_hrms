<?php

namespace App\Services;

use App\Models\EmployeeTaxDeclaration;
use App\Models\EmployeeTaxDeclarationItem;
use App\Models\TaxProofSubmission;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Tax Proof Upload Service (Form 12BB workflow).
 *
 * Indian Income Tax Rule 26C and the CBDT Form 12BB requires every employee
 * to submit proof of investments (80C, 80D, HRA rent receipts, 80CCD(1B)
 * NPS contributions, home-loan interest certificate, LTA bills, etc.) so the
 * employer can deduct TDS under the OLD regime accurately.
 *
 * Workflow:
 *   1. Employee uploads proof file (PDF/JPG/PNG, ≤ 5 MB) against a declared item.
 *   2. Submission is recorded with status = "submitted" (or "auto_approved"
 *      if the file's embedded amount matches the declared amount and the
 *      section is a low-risk one).
 *   3. HR/admin reviews and either approves / partially-approves / rejects.
 *   4. On approval, the corresponding EmployeeTaxDeclarationItem is updated
 *      with the approved amount, and the parent's `proof_status` flips to
 *      "verified" — which is what the TDS calculation reads at run time.
 *
 * All proof files are stored under
 *     storage/app/private/tax-proofs/{orgId}/{userId}/{fy}/{itemId}/{filename}
 * to comply with data-localisation norms (DPDP Act 2023 §8(5)).
 */
class TaxProofUploadService
{
    /** Sections that the system can auto-approve if the file amount matches the declared amount. */
    private const AUTO_APPROVE_SECTIONS = ['80CCD1B', '80TTA'];

    /** Max upload size in bytes (5 MB). */
    public const MAX_FILE_SIZE = 5 * 1024 * 1024;

    /** Allowed MIME types. */
    public const ALLOWED_MIMES = ['pdf', 'jpg', 'jpeg', 'png', 'webp'];

    /**
     * Persist an uploaded proof file and create the submission record.
     *
     * @param  int         $userId
     * @param  int         $organizationId
     * @param  int         $declarationItemId
     * @param  UploadedFile $file
     * @param  array       $meta  description, amount (optional override)
     * @return TaxProofSubmission
     */
    public function uploadProof(
        int $userId,
        int $organizationId,
        int $declarationItemId,
        UploadedFile $file,
        array $meta = []
    ): TaxProofSubmission {
        $item = EmployeeTaxDeclarationItem::with('declaration')
            ->where('id', $declarationItemId)
            ->whereHas('declaration', fn ($q) => $q
                ->where('user_id', $userId)
                ->where('organization_id', $organizationId))
            ->firstOrFail();

        $declaration = $item->declaration;
        $fy = $declaration->financial_year;
        $orgId = $declaration->organization_id;

        // Validate file
        $this->validateFile($file);

        // Build a safe filename + path
        $ext = strtolower($file->getClientOriginalExtension());
        if (!in_array($ext, self::ALLOWED_MIMES, true)) {
            throw new \InvalidArgumentException("Unsupported file type: .{$ext}");
        }
        $safeName = sprintf(
            '%s_%d_%d_%s.%s',
            $item->section,
            $item->id,
            time(),
            bin2hex(random_bytes(4)),
            $ext
        );
        $relativePath = sprintf(
            'tax-proofs/%d/%d/%s/%d/%s',
            $orgId,
            $userId,
            $fy,
            $item->id,
            $safeName
        );

        // Store (uses the "local" disk = storage/app/private)
        Storage::disk('local')->putFileAs(
            dirname($relativePath),
            $file,
            basename($relativePath)
        );

        $declaredAmount = isset($meta['amount']) ? (float) $meta['amount'] : (float) $item->declared_amount;
        $description    = $meta['description'] ?? $item->description;

        // Decide initial status
        $status = 'submitted';
        if (
            in_array($item->section, self::AUTO_APPROVE_SECTIONS, true)
            && $declaredAmount > 0
            && (float) $item->declared_amount === $declaredAmount
        ) {
            $status = 'auto_approved';
        }

        $submission = DB::transaction(function () use (
            $orgId, $userId, $item, $fy, $declaredAmount, $description,
            $relativePath, $safeName, $status
        ) {
            $s = TaxProofSubmission::create([
                'organization_id'      => $orgId,
                'user_id'              => $userId,
                'declaration_item_id'  => $item->id,
                'financial_year'       => $fy,
                'declaration_type'     => $item->section,
                'description'          => $description,
                'amount'               => $declaredAmount,
                'proof_file_path'      => $relativePath,
                'proof_filename'       => $safeName,
                'status'               => $status,
            ]);

            // Mirror proof state on the declaration item so the
            // TaxRegimeComparator can see it without joining submissions.
            $item->update([
                'proof_status'   => $status === 'auto_approved' ? 'verified' : 'pending_review',
                'proof_submission_id' => $s->id,
                'proof_submitted_at' => now(),
            ]);

            return $s;
        });

        Log::info('Tax proof uploaded', [
            'org_id' => $orgId, 'user_id' => $userId,
            'item_id' => $item->id, 'submission_id' => $submission->id,
            'status' => $status,
        ]);

        return $submission->fresh(['declarationItem']);
    }

    /**
     * Review a submission (approve / partial / reject).
     */
    public function reviewSubmission(
        int $submissionId,
        int $reviewerId,
        int $organizationId,
        string $decision,
        ?float $approvedAmount = null,
        ?string $notes = null
    ): TaxProofSubmission {
        if (!in_array($decision, ['approved', 'rejected', 'partial'], true)) {
            throw new \InvalidArgumentException("Invalid decision: {$decision}");
        }

        $submission = TaxProofSubmission::with('declarationItem.declaration')
            ->where('id', $submissionId)
            ->where('organization_id', $organizationId)
            ->firstOrFail();

        $item = $submission->declarationItem;
        $declaration = $item->declaration;
        $itemUpdate = [];
        $declarationUpdate = [];

        switch ($decision) {
            case 'approved':
                $itemUpdate = [
                    'proof_status' => 'verified',
                    'approved_amount' => (float) $submission->amount,
                    'status' => 'approved',
                ];
                $declarationUpdate = ['proof_status' => 'verified'];
                break;

            case 'partial':
                $approved = max(0, min((float) ($approvedAmount ?? 0), (float) $submission->amount));
                $itemUpdate = [
                    'proof_status' => 'verified',
                    'approved_amount' => $approved,
                    'status' => 'approved',
                ];
                $declarationUpdate = ['proof_status' => 'verified'];
                break;

            case 'rejected':
                $itemUpdate = [
                    'proof_status' => 'rejected',
                    'approved_amount' => 0,
                    'status' => 'rejected',
                ];
                $declarationUpdate = ['proof_status' => 'rejected'];
                break;
        }

        DB::transaction(function () use ($submission, $reviewerId, $decision, $notes, $item, $itemUpdate, $declaration) {
            $submission->update([
                'status'        => $decision === 'partial' ? 'approved' : $decision,
                'reviewed_by'   => $reviewerId,
                'reviewed_at'   => now(),
                'review_notes'  => $notes,
            ]);
            $item->update($itemUpdate);
            $declaration->update($declarationUpdate);
        });

        Log::info('Tax proof reviewed', [
            'submission_id' => $submission->id, 'reviewer_id' => $reviewerId,
            'decision' => $decision, 'amount' => $itemUpdate['approved_amount'] ?? null,
        ]);

        return $submission->fresh(['declarationItem.declaration', 'reviewedBy']);
    }

    /**
     * List submissions, optionally filtered.
     */
    public function listSubmissions(int $organizationId, array $filters = [])
    {
        $q = TaxProofSubmission::with([
            'user:id,name,email,employee_code',
            'declarationItem',
            'reviewedBy:id,name',
        ])->where('organization_id', $organizationId);

        if (!empty($filters['status'])) {
            $q->where('status', $filters['status']);
        }
        if (!empty($filters['user_id'])) {
            $q->where('user_id', (int) $filters['user_id']);
        }
        if (!empty($filters['financial_year'])) {
            $q->where('financial_year', $filters['financial_year']);
        }
        if (!empty($filters['section'])) {
            $q->where('declaration_type', $filters['section']);
        }

        return $q->orderByDesc('created_at')->get();
    }

    /**
     * Bulk-review (used by "approve all verified items for this user" button).
     */
    public function bulkApproveVerified(int $userId, int $organizationId, int $reviewerId): int
    {
        $submissions = TaxProofSubmission::with('declarationItem')
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->where('status', 'submitted')
            ->get();

        $count = 0;
        foreach ($submissions as $s) {
            $this->reviewSubmission($s->id, $reviewerId, $organizationId, 'approved', null, 'Bulk auto-approve');
            $count++;
        }
        return $count;
    }

    /**
     * Compliance summary: count of pending proofs across the org.
     */
    public function complianceSummary(int $organizationId, ?string $financialYear = null): array
    {
        $q = TaxProofSubmission::where('organization_id', $organizationId);
        if ($financialYear) $q->where('financial_year', $financialYear);

        $byStatus = $q->selectRaw('status, COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total')
            ->groupBy('status')
            ->pluck('cnt', 'status')
            ->toArray();
        $byStatusTotal = $q->selectRaw('status, COALESCE(SUM(amount), 0) as total')
            ->groupBy('status')
            ->pluck('total', 'status')
            ->toArray();

        return [
            'pending'      => (int) ($byStatus['submitted'] ?? 0),
            'auto_approved'=> (int) ($byStatus['auto_approved'] ?? 0),
            'approved'     => (int) ($byStatus['approved'] ?? 0),
            'rejected'     => (int) ($byStatus['rejected'] ?? 0),
            'pending_amount'    => round((float) ($byStatusTotal['submitted'] ?? 0), 2),
            'approved_amount'   => round((float) (($byStatusTotal['approved'] ?? 0) + ($byStatusTotal['auto_approved'] ?? 0)), 2),
        ];
    }

    private function validateFile(UploadedFile $file): void
    {
        if (!$file->isValid()) {
            throw new \RuntimeException('Invalid upload: ' . $file->getErrorMessage());
        }
        if ($file->getSize() > self::MAX_FILE_SIZE) {
            throw new \RuntimeException('File too large; max 5 MB allowed.');
        }
        $ext = strtolower($file->getClientOriginalExtension());
        if (!in_array($ext, self::ALLOWED_MIMES, true)) {
            throw new \RuntimeException("Unsupported file type: .{$ext}");
        }
    }
}
