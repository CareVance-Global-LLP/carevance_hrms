<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmployeeTaxDeclaration;
use App\Models\EmployeeTaxDeclarationItem;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TaxDeclarationController extends Controller
{
    /**
     * Get employee's tax declaration for a financial year.
     */
    public function myDeclaration(Request $request): JsonResponse
    {
        $user = $request->user();
        $financialYear = $request->get('financial_year', $this->getCurrentFinancialYear());

        $declaration = EmployeeTaxDeclaration::with(['items', 'approvedBy:id,name'])
            ->where('user_id', $user->id)
            ->where('financial_year', $financialYear)
            ->first();

        if (!$declaration) {
            $declaration = EmployeeTaxDeclaration::create([
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'financial_year' => $financialYear,
                'status' => 'draft',
            ]);
        }

        return response()->json([
            'declaration' => $declaration->load('items'),
            'sections' => EmployeeTaxDeclarationItem::SECTIONS,
            'categories' => EmployeeTaxDeclarationItem::CATEGORIES_BY_SECTION,
        ]);
    }

    /**
     * Save/update declaration items.
     */
    public function saveItems(Request $request): JsonResponse
    {
        $user = $request->user();
        $financialYear = $request->get('financial_year', $this->getCurrentFinancialYear());

        $declaration = EmployeeTaxDeclaration::firstOrCreate(
            [
                'user_id' => $user->id,
                'financial_year' => $financialYear,
            ],
            [
                'organization_id' => $user->organization_id,
                'status' => 'draft',
            ]
        );

        if ($declaration->status === 'approved') {
            return response()->json([
                'success' => false,
                'message' => 'Cannot modify an approved declaration',
            ], 422);
        }

        $items = $request->input('items', []);

        // Delete removed items
        $itemIds = collect($items)->pluck('id')->filter();
        $declaration->items()->whereNotIn('id', $itemIds)->delete();

        foreach ($items as $itemData) {
            $itemData['declared_amount'] = floatval($itemData['declared_amount'] ?? 0);
            
            if (isset($itemData['id']) && $itemData['id']) {
                $item = EmployeeTaxDeclarationItem::find($itemData['id']);
                if ($item && $item->declaration_id === $declaration->id) {
                    $item->update([
                        'section' => $itemData['section'],
                        'category' => $itemData['category'],
                        'description' => $itemData['description'] ?? null,
                        'declared_amount' => $itemData['declared_amount'],
                    ]);
                }
            } else {
                $declaration->items()->create([
                    'section' => $itemData['section'],
                    'category' => $itemData['category'],
                    'description' => $itemData['description'] ?? null,
                    'declared_amount' => $itemData['declared_amount'],
                ]);
            }
        }

        $declaration->recalculateTotals();

        return response()->json([
            'success' => true,
            'message' => 'Declaration saved successfully',
            'declaration' => $declaration->fresh(['items']),
        ]);
    }

    /**
     * Submit declaration for approval.
     */
    public function submit(Request $request, int $declarationId): JsonResponse
    {
        $user = $request->user();
        $declaration = EmployeeTaxDeclaration::where('id', $declarationId)
            ->where('user_id', $user->id)
            ->firstOrFail();

        if ($declaration->status !== 'draft') {
            return response()->json([
                'success' => false,
                'message' => "Cannot submit declaration in '{$declaration->status}' status",
            ], 422);
        }

        if ($declaration->items()->count() === 0) {
            return response()->json([
                'success' => false,
                'message' => 'Add at least one declaration item before submitting',
            ], 422);
        }

        $declaration->update([
            'status' => 'submitted',
            'submitted_at' => now(),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Declaration submitted for approval',
            'declaration' => $declaration->fresh(['items']),
        ]);
    }

    /**
     * Approve or reject a declaration (admin).
     */
    public function review(Request $request, int $declarationId): JsonResponse
    {
        $request->validate([
            'action' => 'required|in:approve,reject',
            'remarks' => 'nullable|string',
            'items' => 'nullable|array',
            'items.*.id' => 'required|exists:employee_tax_declaration_items,id',
            'items.*.approved_amount' => 'required|numeric|min:0',
            'items.*.status' => 'required|in:pending,approved,rejected',
            'items.*.remarks' => 'nullable|string',
        ]);

        $declaration = EmployeeTaxDeclaration::with('items')->findOrFail($declarationId);

        if ($declaration->status !== 'submitted') {
            return response()->json([
                'success' => false,
                'message' => "Cannot review declaration in '{$declaration->status}' status",
            ], 422);
        }

        $action = $request->action;

        DB::transaction(function () use ($request, $declaration, $action) {
            // Update individual item approvals
            if ($request->has('items')) {
                foreach ($request->items as $itemData) {
                    EmployeeTaxDeclarationItem::where('id', $itemData['id'])
                        ->where('declaration_id', $declaration->id)
                        ->update([
                            'approved_amount' => $itemData['approved_amount'],
                            'status' => $itemData['status'],
                            'remarks' => $itemData['remarks'] ?? null,
                        ]);
                }
            } else {
                // Bulk approve/reject all items
                $declaration->items()->update([
                    'approved_amount' => $action === 'approve' ? DB::raw('declared_amount') : 0,
                    'status' => $action === 'approve' ? 'approved' : 'rejected',
                ]);
            }

            $declaration->update([
                'status' => $action === 'approve' ? 'approved' : 'rejected',
                'approved_by' => auth()->id(),
                'approved_at' => now(),
                'remarks' => $request->remarks,
            ]);

            $declaration->recalculateTotals();
        });

        return response()->json([
            'success' => true,
            'message' => $action === 'approve' ? 'Declaration approved' : 'Declaration rejected',
            'declaration' => $declaration->fresh(['items', 'approvedBy:id,name']),
        ]);
    }

    /**
     * List all declarations for admin review.
     */
    public function listDeclarations(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $financialYear = $request->get('financial_year', $this->getCurrentFinancialYear());
        $status = $request->get('status');

        $query = EmployeeTaxDeclaration::with(['user:id,name,email,avatar', 'items', 'approvedBy:id,name'])
            ->where('organization_id', $organizationId)
            ->where('financial_year', $financialYear);

        if ($status) {
            $query->where('status', $status);
        }

        $declarations = $query->orderBy('created_at', 'desc')->get();

        return response()->json([
            'declarations' => $declarations,
            'financial_year' => $financialYear,
        ]);
    }

    /**
     * Upload proof document for a declaration item.
     */
    public function uploadProof(Request $request, int $itemId): JsonResponse
    {
        $request->validate([
            'proof' => 'required|file|mimes:pdf,jpg,jpeg,png|max:5120',
        ]);

        $item = EmployeeTaxDeclarationItem::where('id', $itemId)
            ->whereHas('declaration', function ($q) {
                $q->where('user_id', auth()->id());
            })
            ->firstOrFail();

        $path = $request->file('proof')->store('tax-proofs/' . auth()->id(), 'public');

        $item->update([
            'proof_path' => $path,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Proof uploaded successfully',
            'proof_path' => $path,
        ]);
    }

    /**
     * Get default sections with empty items.
     */
    public function getSections(): JsonResponse
    {
        return response()->json([
            'sections' => EmployeeTaxDeclarationItem::SECTIONS,
            'categories' => EmployeeTaxDeclarationItem::CATEGORIES_BY_SECTION,
        ]);
    }

    private function getCurrentFinancialYear(): string
    {
        $year = now()->year;
        $month = now()->month;
        if ($month < 4) {
            return ($year - 1) . '-' . substr($year, 2);
        }
        return $year . '-' . substr($year + 1, 2);
    }
}
