<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmployeeLoan;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class LoanController extends Controller
{
    /**
     * Request a new loan or advance (employee).
     */
    public function requestLoan(Request $request): JsonResponse
    {
        $request->validate([
            'loan_type' => 'required|in:advance,loan',
            'amount' => 'required|numeric|min:100',
            'emi_amount' => 'required|numeric|min:100',
            'total_installments' => 'required|integer|min:1|max:60',
            'purpose' => 'nullable|string|max:500',
        ]);

        $user = $request->user();

        $remainingAmount = $request->amount;

        return response()->json([
            'success' => true,
            'message' => 'Loan request submitted for approval',
            'loan' => EmployeeLoan::create([
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'loan_type' => $request->loan_type,
                'amount' => $request->amount,
                'emi_amount' => $request->emi_amount,
                'total_installments' => $request->total_installments,
                'remaining_amount' => $remainingAmount,
                'purpose' => $request->purpose,
                'status' => 'pending',
            ]),
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
     */
    public function listLoans(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $status = $request->get('status');

        $query = EmployeeLoan::with(['user:id,name,email,avatar', 'approvedBy:id,name'])
            ->where('organization_id', $organizationId);

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
