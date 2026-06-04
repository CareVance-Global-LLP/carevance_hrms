<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Validation\IndianIdValidationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DocumentValidationController extends Controller
{
    public function __construct(
        private readonly IndianIdValidationService $validationService
    ) {
    }

    /**
     * Validate a government ID format
     */
    public function validateGovernmentId(Request $request): JsonResponse
    {
        $request->validate([
            'id_type' => 'required|string|in:AADHAAR,PAN,PASSPORT,DRIVING_LICENSE,VOTER_ID,UAN,ESI',
            'id_number' => 'required|string',
        ]);

        $idType = strtolower($request->id_type);
        $idNumber = $request->id_number;

        $result = $this->validationService->validate($idType, $idNumber);

        return response()->json([
            'valid' => $result['valid'],
            'error' => $result['error'] ?? null,
            'normalized' => $result['normalized'] ?? null,
            'masked' => $result['masked'] ?? null,
            'type' => $result['type'] ?? null,
            'state' => $result['state'] ?? null,
            'bank' => $result['bank'] ?? null,
        ]);
    }

    /**
     * Validate bank account details
     */
    public function validateBankDetails(Request $request): JsonResponse
    {
        $request->validate([
            'ifsc' => 'nullable|string',
            'account_number' => 'nullable|string',
            'upi_id' => 'nullable|string',
        ]);

        $response = [];

        if ($request->filled('ifsc')) {
            $response['ifsc'] = $this->validationService->validate('ifsc', $request->ifsc);
        }

        if ($request->filled('account_number')) {
            $response['account_number'] = $this->validationService->validate('bank_account', $request->account_number);
        }

        if ($request->filled('upi_id')) {
            $response['upi_id'] = $this->validationService->validate('upi', $request->upi_id);
        }

        return response()->json($response);
    }

    /**
     * Bulk validate multiple IDs
     */
    public function bulkValidate(Request $request): JsonResponse
    {
        $request->validate([
            'documents' => 'required|array',
            'documents.*.id_type' => 'required|string',
            'documents.*.id_number' => 'required|string',
        ]);

        $results = [];
        $allValid = true;

        foreach ($request->documents as $document) {
            $idType = strtolower($document['id_type']);
            $idNumber = $document['id_number'];

            $result = $this->validationService->validate($idType, $idNumber);
            $results[] = [
                'id_type' => $document['id_type'],
                'valid' => $result['valid'],
                'error' => $result['error'] ?? null,
                'normalized' => $result['normalized'] ?? null,
                'masked' => $result['masked'] ?? null,
            ];

            if (!$result['valid']) {
                $allValid = false;
            }
        }

        return response()->json([
            'all_valid' => $allValid,
            'results' => $results,
        ]);
    }

    /**
     * Get validation rules and examples
     */
    public function getValidationRules(): JsonResponse
    {
        return response()->json([
            'rules' => [
                'AADHAAR' => [
                    'format' => '12 digits',
                    'example' => '123456789012',
                    'description' => 'Indian Unique Identification Number'
                ],
                'PAN' => [
                    'format' => 'ABCDE1234F (5 letters + 4 digits + 1 letter)',
                    'example' => 'ABCDE1234F',
                    'description' => 'Permanent Account Number for tax'
                ],
                'PASSPORT' => [
                    'format' => 'Letter followed by 7 alphanumeric',
                    'example' => 'A1234567',
                    'description' => 'Indian Passport Number'
                ],
                'DRIVING_LICENSE' => [
                    'format' => 'State code followed by numbers (varies by state)',
                    'example' => 'MH01 20210001234',
                    'description' => 'Indian Driving License'
                ],
                'VOTER_ID' => [
                    'format' => '3 letters followed by 7 digits',
                    'example' => 'ABC1234567',
                    'description' => 'EPIC Number (Voter ID)'
                ],
                'UAN' => [
                    'format' => '12 digits',
                    'example' => '123456789012',
                    'description' => 'Universal Account Number (Provident Fund)'
                ],
                'ESI' => [
                    'format' => '17 digits',
                    'example' => '12345678901234567',
                    'description' => 'ESI IP Number (Health Insurance)'
                ],
            ],
            'bank_rules' => [
                'IFSC' => [
                    'format' => 'AAAA0BBBBBB (4 letters + 0 + 6 alphanumeric)',
                    'example' => 'HDFC0001234',
                    'description' => 'Indian Financial System Code'
                ],
                'Account_Number' => [
                    'format' => '9-18 digits',
                    'description' => 'Bank Account Number'
                ],
                'UPI' => [
                    'format' => 'username@bankname',
                    'example' => 'name@upi',
                    'description' => 'Unified Payments Interface ID'
                ],
            ]
        ]);
    }
}
