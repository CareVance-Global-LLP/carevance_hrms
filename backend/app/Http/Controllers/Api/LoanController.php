<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmployeeLoan;
use App\Services\Payroll\LoanAffordability;
use App\Support\LoanSchedule;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class LoanController extends Controller
{
    /**
     * Request a new loan or advance.
     *
     * Self-service by default: the borrower is the caller. An admin may pass
     * `user_id` to raise one on an employee's behalf — without that, the only
     * create button in the UI had to be hidden from admins, so an admin
     * recording an advance they had already paid out had nowhere to do it.
     *
     * `user_id` from a non-privileged caller is ignored rather than rejected:
     * the borrower is still resolved to the caller, so this endpoint keeps the
     * "resolves its subject from the caller" guarantee its route group relies
     * on for anyone who is not an admin.
     */
    public function requestLoan(Request $request): JsonResponse
    {
        $request->validate([
            'loan_type' => 'required|in:advance,loan',
            'amount' => 'required|numeric|min:100',
            'emi_amount' => 'required|numeric|min:100',
            'total_installments' => 'required|integer|min:1|max:60',
            'purpose' => 'nullable|string|max:500',
            'user_id' => 'nullable|integer|exists:users,id',
        ]);

        $actor = $request->user();
        $borrower = $actor;

        if ($request->filled('user_id') && in_array($actor->role, ['admin', 'super_admin'], true)) {
            /*
             * User is deliberately outside BelongsToOrganization (the scope
             * resolves the acting user through Auth), so the tenant check here
             * is explicit: an admin may only borrow-on-behalf within their own
             * organization.
             */
            $borrower = User::where('id', $request->user_id)
                ->where('organization_id', $actor->organization_id)
                ->first();

            if (! $borrower) {
                return response()->json([
                    'success' => false,
                    'message' => 'Employee not found in your organization.',
                ], 404);
            }
        }

        /*
         * The instalment has to be lawful before it is recorded.
         *
         * Nothing here previously compared the EMI to the salary it would be
         * recovered from, at request or at approval, which is how a ₹15,000
         * monthly instalment was agreed against ₹8,542 of gross and surfaced
         * three months later as a negative net pay.
         */
        $affordability = app(LoanAffordability::class)->check($borrower, (float) $request->emi_amount);

        if (! $affordability['allowed']) {
            return response()->json([
                'success' => false,
                'message' => $affordability['message'],
                'affordability' => $affordability['assessment'],
            ], 422);
        }

        /*
         * The stored schedule is derived, never trusted from the client. Three
         * free-text fields could disagree — a ₹40,000 loan at ₹6,000 over four
         * instalments leaves ₹16,000 that would never be collected.
         */
        $schedule = LoanSchedule::fromEmi((float) $request->amount, (float) $request->emi_amount);
        $remainingAmount = $request->amount;

        return response()->json([
            'success' => true,
            'message' => 'Loan request submitted for approval',
            'schedule' => $schedule,
            'loan' => EmployeeLoan::create([
                'organization_id' => $borrower->organization_id,
                'user_id' => $borrower->id,
                'loan_type' => $request->loan_type,
                'amount' => $request->amount,
                'emi_amount' => $request->emi_amount,
                // Derived, so amount / EMI / count can never disagree.
                'total_installments' => $schedule['instalments'],
                'remaining_amount' => $remainingAmount,
                'purpose' => $request->purpose,
                'status' => 'pending',
            ]),
        ]);
    }

    /**
     * What this employee can afford, for the request form.
     *
     * Resolved from the token, never a route parameter — somebody's borrowing
     * capacity is derived from their salary, so an id in the URL would let one
     * employee read another's pay. Same shape as the other `my/*` routes.
     */
    public function myLoanEligibility(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'eligibility' => app(LoanAffordability::class)->maxEmiFor($request->user()),
        ]);
    }

    /**
     * List employee's own loans.
     */
    public function myLoans(Request $request): JsonResponse
    {
        $loans = EmployeeLoan::where('user_id', $request->user()->id)
            ->orderBy('created_at', 'desc')
            ->get();

        $activeLoan = $loans->first(fn($l) => $l->isActive());

        return response()->json([
            'loans' => $loans,
            'active_loan' => $activeLoan,
        ]);
    }

    /**
     * List all loans for admin review.
     * Supports filtering by user_id (employee scope) and status.
     */
    public function listLoans(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $status = $request->get('status');
        $userId = $request->get('user_id');

        $query = EmployeeLoan::with(['user:id,name,email,avatar', 'approvedBy:id,name'])
            ->where('organization_id', $organizationId);

        if ($userId) {
            $query->where('user_id', (int) $userId);
        }

        if ($status) {
            $query->where('status', $status);
        }

        $loans = $query->orderBy('created_at', 'desc')->get();

        return response()->json([
            'loans' => $loans,
        ]);
    }

    /**
     * Approve a loan request (admin).
     */
    public function approveLoan(Request $request, int $loanId): JsonResponse
    {
        $loan = EmployeeLoan::where('id', $loanId)
            ->where('organization_id', $request->user()->organization_id)
            ->firstOrFail();

        if ($loan->status !== 'pending') {
            return response()->json([
                'success' => false,
                'message' => "Cannot approve loan in '{$loan->status}' status",
            ], 422);
        }

        // Maker-checker. The route is admin/manager-gated, but that still left
        // an approver able to raise a loan for themselves and approve it in the
        // next request — money out of the company on one person's say-so, with
        // approved_by pointing at the same person who requested it.
        if ((int) $loan->user_id === (int) $request->user()->id) {
            return response()->json([
                'success' => false,
                'message' => 'You cannot approve your own loan request. Ask another approver.',
            ], 403);
        }

        /*
         * Checked again at approval, not only at request. A salary revision or
         * another loan approved in between can turn an affordable instalment
         * into an unlawful one, and approval is the moment the commitment
         * becomes real.
         */
        $recheck = app(LoanAffordability::class)
            ->check($loan->user, (float) $loan->emi_amount, $loan->id);

        if (! $recheck['allowed']) {
            return response()->json([
                'success' => false,
                'message' => $recheck['message'],
                'affordability' => $recheck['assessment'],
            ], 422);
        }

        $loan->update([
            'status' => 'approved',
            'approved_by' => auth()->id(),
            'approved_at' => now(),
            'disbursed_at' => now(),
            'notes' => $request->notes,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Loan approved and disbursed',
            'loan' => $loan->fresh(['user:id,name,email', 'approvedBy:id,name']),
        ]);
    }

    /**
     * Reject a loan request (admin).
     */
    public function rejectLoan(Request $request, int $loanId): JsonResponse
    {
        $loan = EmployeeLoan::where('id', $loanId)
            ->where('organization_id', $request->user()->organization_id)
            ->firstOrFail();

        if ($loan->status !== 'pending') {
            return response()->json([
                'success' => false,
                'message' => "Cannot reject loan in '{$loan->status}' status",
            ], 422);
        }

        $request->validate(['rejection_reason' => 'required|string|max:1000']);

        $loan->update([
            'status' => 'rejected',
            'approved_by' => auth()->id(),
            'approved_at' => now(),
            'rejection_reason' => $request->rejection_reason,
            'notes' => $request->notes,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Loan request rejected',
            'loan' => $loan->fresh(['user:id,name,email', 'approvedBy:id,name']),
        ]);
    }

    /**
     * Close a loan (mark as fully paid).
     */
    public function closeLoan(Request $request, int $loanId): JsonResponse
    {
        $loan = EmployeeLoan::where('id', $loanId)
            ->where('organization_id', $request->user()->organization_id)
            ->firstOrFail();

        if (!$loan->isActive()) {
            return response()->json([
                'success' => false,
                'message' => 'Loan is not active',
            ], 422);
        }

        $loan->update([
            'status' => 'closed',
            'remaining_amount' => 0,
            'paid_installments' => $loan->total_installments,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Loan closed successfully',
            'loan' => $loan->fresh(),
        ]);
    }
}
