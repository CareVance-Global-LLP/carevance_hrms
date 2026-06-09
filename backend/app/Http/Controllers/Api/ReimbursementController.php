<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Reimbursement;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReimbursementController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        
        $query = Reimbursement::with(['employee:id,name', 'approver:id,name']);
        
        if (!$isAdmin) {
            $query->where('employee_id', $user->id);
        }
        
        if ($request->has('status')) {
            $query->where('status', $request->status);
        }
        
        if ($request->has('category')) {
            $query->where('category', $request->category);
        }
        
        $reimbursements = $query->orderBy('created_at', 'desc')->get();
        
        return response()->json($reimbursements);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'category' => 'required|string|in:travel,meals,office_supplies,training,medical,other',
            'amount' => 'required|numeric|min:0.01',
            'currency' => 'required|string|size:3',
            'expense_date' => 'required|date',
            'description' => 'required|string|max:1000',
            'receipt_url' => 'nullable|string',
            'merchant_name' => 'nullable|string|max:255',
            'location' => 'nullable|string|max:255',
        ]);

        $user = $request->user();

        $reimbursement = Reimbursement::create([
            'organization_id' => $user->organization_id,
            'employee_id' => $user->id,
            'category' => $request->category,
            'amount' => $request->amount,
            'currency' => $request->currency,
            'expense_date' => $request->expense_date,
            'description' => $request->description,
            'receipt_url' => $request->receipt_url,
            'merchant_name' => $request->merchant_name,
            'location' => $request->location,
            'status' => 'pending',
        ]);

        return response()->json([
            'message' => 'Reimbursement request submitted successfully.',
            'reimbursement' => $reimbursement->load(['employee:id,name']),
        ], 201);
    }

    public function show(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $reimbursement = Reimbursement::with(['employee:id,name', 'approver:id,name'])->findOrFail($id);
        
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        
        if (!$isAdmin && $reimbursement->employee_id !== $user->id) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        return response()->json($reimbursement);
    }

    public function update(int $id, Request $request): JsonResponse
    {
        $request->validate([
            'category' => 'nullable|string|in:travel,meals,office_supplies,training,medical,other',
            'amount' => 'nullable|numeric|min:0.01',
            'currency' => 'nullable|string|size:3',
            'expense_date' => 'nullable|date',
            'description' => 'nullable|string|max:1000',
            'receipt_url' => 'nullable|string',
            'merchant_name' => 'nullable|string|max:255',
            'location' => 'nullable|string|max:255',
        ]);

        $user = $request->user();
        $reimbursement = Reimbursement::findOrFail($id);
        
        // Only employee can update their own pending reimbursement
        if ($reimbursement->employee_id !== $user->id) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }
        
        if ($reimbursement->status !== 'pending') {
            return response()->json(['message' => 'Cannot update reimbursement that is not pending.'], 422);
        }

        $reimbursement->update($request->all());

        return response()->json([
            'message' => 'Reimbursement updated successfully.',
            'reimbursement' => $reimbursement->fresh()->load(['employee:id:name']),
        ]);
    }

    public function destroy(int $id, Request $request): JsonResponse
    {
        $user = $request->user();
        $reimbursement = Reimbursement::findOrFail($id);
        
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        
        if (!$isAdmin && $reimbursement->employee_id !== $user->id) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }
        
        if (!$isAdmin && $reimbursement->status !== 'pending') {
            return response()->json(['message' => 'Cannot delete reimbursement that is not pending.'], 422);
        }

        $reimbursement->delete();

        return response()->json(['message' => 'Reimbursement deleted successfully.']);
    }

    public function approve(int $id, Request $request): JsonResponse
    {
        $request->validate([
            'notes' => 'nullable|string|max:1000',
        ]);

        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        
        if (!$isAdmin) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $reimbursement = Reimbursement::findOrFail($id);
        
        if ($reimbursement->status !== 'pending') {
            return response()->json(['message' => 'Reimbursement is not pending.'], 422);
        }

        $reimbursement->update([
            'status' => 'approved',
            'approver_id' => $user->id,
            'approved_at' => now(),
            'notes' => $request->notes,
        ]);

        return response()->json([
            'message' => 'Reimbursement approved successfully.',
            'reimbursement' => $reimbursement->fresh()->load(['employee:id,name', 'approver:id,name']),
        ]);
    }

    public function reject(int $id, Request $request): JsonResponse
    {
        $request->validate([
            'notes' => 'required|string|max:1000',
        ]);

        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        
        if (!$isAdmin) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $reimbursement = Reimbursement::findOrFail($id);
        
        if ($reimbursement->status !== 'pending') {
            return response()->json(['message' => 'Reimbursement is not pending.'], 422);
        }

        $reimbursement->update([
            'status' => 'rejected',
            'approver_id' => $user->id,
            'approved_at' => now(),
            'notes' => $request->notes,
        ]);

        return response()->json([
            'message' => 'Reimbursement rejected.',
            'reimbursement' => $reimbursement->fresh()->load(['employee:id,name', 'approver:id,name']),
        ]);
    }

    public function getSummary(Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->role === 'admin' || $user->role === 'super_admin';
        
        $query = Reimbursement::query();
        
        if (!$isAdmin) {
            $query->where('employee_id', $user->id);
        }
        
        $totalCount = $query->count();
        $totalAmount = $query->sum('amount');
        $pendingCount = (clone $query)->where('status', 'pending')->count();
        $pendingAmount = (clone $query)->where('status', 'pending')->sum('amount');
        $approvedCount = (clone $query)->where('status', 'approved')->count();
        $approvedAmount = (clone $query)->where('status', 'approved')->sum('amount');
        
        // Group by category
        $byCategory = (clone $query)
            ->selectRaw('category, COUNT(*) as count, SUM(amount) as total')
            ->groupBy('category')
            ->get();

        return response()->json([
            'total_count' => $totalCount,
            'total_amount' => $totalAmount,
            'pending_count' => $pendingCount,
            'pending_amount' => $pendingAmount,
            'approved_count' => $approvedCount,
            'approved_amount' => $approvedAmount,
            'by_category' => $byCategory,
        ]);
    }
}
