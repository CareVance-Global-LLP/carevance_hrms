<?php

namespace App\Services\Validation;

/**
 * Indian Government ID and Document Format Validation Service
 * Validates format, structure, and checksums of various IDs
 */
class IndianIdValidationService
{
    /**
     * Validate Aadhaar number (12 digits with Verhoeff checksum)
     */
    public function validateAadhaar(string $aadhaar): array
    {
        $aadhaar = preg_replace('/\D/', '', $aadhaar);

        if (strlen($aadhaar) !== 12) {
            return [
                'valid' => false,
                'error' => 'Aadhaar number must be 12 digits',
                'normalized' => $aadhaar
            ];
        }

        // Check for repeated digits (common in fake IDs)
        if (preg_match('/^(\d)\1{11}$/', $aadhaar)) {
            return [
                'valid' => false,
                'error' => 'Invalid Aadhaar number (repeated digits)',
                'normalized' => $aadhaar
            ];
        }

        // Verhoeff checksum validation
        if (!$this->validateVerhoeffChecksum($aadhaar)) {
            return [
                'valid' => false,
                'error' => 'Invalid Aadhaar number (checksum failed)',
                'normalized' => $aadhaar
            ];
        }

        return [
            'valid' => true,
            'normalized' => $aadhaar,
            'masked' => substr($aadhaar, 0, 4) . 'XXXX' . substr($aadhaar, -4)
        ];
    }

    /**
     * Validate PAN number (format: ABCDE1234F)
     */
    public function validatePan(string $pan): array
    {
        $pan = strtoupper(trim($pan));

        if (!preg_match('/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/', $pan)) {
            return [
                'valid' => false,
                'error' => 'PAN must be in format: ABCDE1234F (5 letters, 4 digits, 1 letter)',
                'normalized' => $pan
            ];
        }

        // Validate 4th character (type of PAN holder)
        $validTypes = ['C', 'P', 'H', 'F', 'A', 'T', 'B', 'G', 'J', 'L', 'E'];
        $fourthChar = $pan[3];
        
        if (!in_array($fourthChar, $validTypes)) {
            return [
                'valid' => false,
                'error' => 'Invalid PAN type (4th character)',
                'normalized' => $pan
            ];
        }

        return [
            'valid' => true,
            'normalized' => $pan,
            'type' => $this->getPanTypeDescription($fourthChar),
            'masked' => substr($pan, 0, 2) . 'XXXXX' . substr($pan, -3)
        ];
    }

    /**
     * Validate Indian Passport number
     */
    public function validatePassport(string $passport): array
    {
        $passport = strtoupper(trim($passport));

        // Indian passport: 1 letter followed by 7 digits (old format) or 8 alphanumeric (new)
        if (!preg_match('/^[A-Z][0-9]{7}$/', $passport) && 
            !preg_match('/^[A-Z][0-9A-Z]{7}$/', $passport)) {
            return [
                'valid' => false,
                'error' => 'Passport must start with a letter followed by 7 alphanumeric characters',
                'normalized' => $passport
            ];
        }

        return [
            'valid' => true,
            'normalized' => $passport,
            'masked' => substr($passport, 0, 2) . 'XXXXX' . substr($passport, -2)
        ];
    }

    /**
     * Validate Driving License (basic format check - varies by state)
     */
    public function validateDrivingLicense(string $dl): array
    {
        $dl = strtoupper(trim($dl));

        // DL format varies by state, but typically: XX-00-00000000 or XX00 00000000
        // Remove spaces and dashes
        $normalized = preg_replace('/[\s\-]/', '', $dl);

        if (strlen($normalized) < 8 || strlen($normalized) > 16) {
            return [
                'valid' => false,
                'error' => 'Driving License number appears invalid (expected 8-16 characters)',
                'normalized' => $normalized
            ];
        }

        // Should start with state code (2 letters)
        if (!preg_match('/^[A-Z]{2}/', $normalized)) {
            return [
                'valid' => false,
                'error' => 'Driving License must start with state code (e.g., MH, DL, KA)',
                'normalized' => $normalized
            ];
        }

        $stateCode = substr($normalized, 0, 2);

        return [
            'valid' => true,
            'normalized' => $normalized,
            'state' => $this->getStateName($stateCode),
            'masked' => substr($normalized, 0, 4) . 'XXXX' . substr($normalized, -4)
        ];
    }

    /**
     * Validate Voter ID (EPIC number)
     */
    public function validateVoterId(string $voterId): array
    {
        $voterId = strtoupper(trim($voterId));

        // EPIC format: 3 letters followed by 7 digits (e.g., ABC1234567)
        if (!preg_match('/^[A-Z]{3}[0-9]{7}$/', $voterId)) {
            return [
                'valid' => false,
                'error' => 'Voter ID (EPIC) must be 3 letters followed by 7 digits',
                'normalized' => $voterId
            ];
        }

        return [
            'valid' => true,
            'normalized' => $voterId,
            'masked' => substr($voterId, 0, 3) . 'XXXX' . substr($voterId, -3)
        ];
    }

    /**
     * Validate UAN (Universal Account Number for PF)
     */
    public function validateUan(string $uan): array
    {
        $uan = preg_replace('/\D/', '', $uan);

        if (strlen($uan) !== 12) {
            return [
                'valid' => false,
                'error' => 'UAN must be 12 digits',
                'normalized' => $uan
            ];
        }

        return [
            'valid' => true,
            'normalized' => $uan,
            'masked' => substr($uan, 0, 4) . 'XXXX' . substr($uan, -4)
        ];
    }

    /**
     * Validate ESI IP Number
     */
    public function validateEsiNumber(string $esi): array
    {
        $esi = preg_replace('/\D/', '', $esi);

        if (strlen($esi) !== 17) {
            return [
                'valid' => false,
                'error' => 'ESI IP Number must be 17 digits',
                'normalized' => $esi
            ];
        }

        return [
            'valid' => true,
            'normalized' => $esi,
            'masked' => substr($esi, 0, 4) . 'XXXXXXXXXXX' . substr($esi, -4)
        ];
    }

    /**
     * Validate IFSC code
     */
    public function validateIfsc(string $ifsc): array
    {
        $ifsc = strtoupper(trim($ifsc));

        // IFSC format: AAAA0BBBBBB (4 letters + 0 + 6 alphanumeric)
        if (!preg_match('/^[A-Z]{4}0[A-Z0-9]{6}$/', $ifsc)) {
            return [
                'valid' => false,
                'error' => 'IFSC must be 11 characters: 4 letters + 0 + 6 alphanumeric',
                'normalized' => $ifsc
            ];
        }

        $bankCode = substr($ifsc, 0, 4);

        return [
            'valid' => true,
            'normalized' => $ifsc,
            'bank' => $this->getBankName($bankCode),
            'masked' => substr($ifsc, 0, 4) . '0' . 'XXXXX' . substr($ifsc, -1)
        ];
    }

    /**
     * Validate UPI ID
     */
    public function validateUpi(string $upi): array
    {
        $upi = strtolower(trim($upi));

        // UPI format: username@bankname
        if (!preg_match('/^[a-zA-Z0-9._-]+@[a-zA-Z]{3,}$/', $upi)) {
            return [
                'valid' => false,
                'error' => 'UPI ID must be in format: username@bankname (e.g., name@upi)',
                'normalized' => $upi
            ];
        }

        $parts = explode('@', $upi);
        $username = $parts[0];
        $provider = $parts[1];

        if (strlen($username) < 3 || strlen($username) > 50) {
            return [
                'valid' => false,
                'error' => 'UPI username must be 3-50 characters',
                'normalized' => $upi
            ];
        }

        return [
            'valid' => true,
            'normalized' => $upi,
            'username' => $username,
            'provider' => $provider,
            'masked' => substr($username, 0, 2) . '****@' . $provider
        ];
    }

    /**
     * Validate bank account number (basic format check)
     */
    public function validateBankAccount(string $accountNumber): array
    {
        $accountNumber = preg_replace('/\D/', '', $accountNumber);

        if (strlen($accountNumber) < 9 || strlen($accountNumber) > 18) {
            return [
                'valid' => false,
                'error' => 'Bank account number must be 9-18 digits',
                'normalized' => $accountNumber
            ];
        }

        // Check for repeated digits (likely fake)
        if (preg_match('/^(\d)\1{8,}$/', $accountNumber)) {
            return [
                'valid' => false,
                'error' => 'Invalid account number (suspicious pattern)',
                'normalized' => $accountNumber
            ];
        }

        return [
            'valid' => true,
            'normalized' => $accountNumber,
            'masked' => str_repeat('X', strlen($accountNumber) - 4) . substr($accountNumber, -4)
        ];
    }

    /**
     * Generic validator that routes to specific validators
     */
    public function validate(string $idType, string $idNumber): array
    {
        $idType = strtolower(trim($idType));

        return match ($idType) {
            'aadhaar' => $this->validateAadhaar($idNumber),
            'pan' => $this->validatePan($idNumber),
            'passport' => $this->validatePassport($idNumber),
            'driving_license', 'dl' => $this->validateDrivingLicense($idNumber),
            'voter_id', 'voterid', 'epic' => $this->validateVoterId($idNumber),
            'uan' => $this->validateUan($idNumber),
            'esi', 'esi_ip' => $this->validateEsiNumber($idNumber),
            'ifsc' => $this->validateIfsc($idNumber),
            'upi' => $this->validateUpi($idNumber),
            'bank_account' => $this->validateBankAccount($idNumber),
            default => [
                'valid' => false,
                'error' => "Unknown ID type: {$idType}",
                'normalized' => $idNumber
            ]
        };
    }

    /**
     * Verhoeff checksum validation for Aadhaar
     */
    private function validateVerhoeffChecksum(string $number): bool
    {
        $multiplication = [
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
            [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
            [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
            [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
            [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
            [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
            [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
            [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
            [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
            [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
        ];

        $permutation = [
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
            [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
            [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
            [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
            [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
            [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
            [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
            [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
        ];

        $inverse = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

        $c = 0;
        $digits = array_reverse(str_split($number));

        foreach ($digits as $i => $digit) {
            $c = $multiplication[$c][$permutation[($i % 8)][$digit]];
        }

        return $c === 0;
    }

    /**
     * Get PAN type description
     */
    private function getPanTypeDescription(string $type): string
    {
        return match ($type) {
            'C' => 'Company',
            'P' => 'Individual',
            'H' => 'Hindu Undivided Family (HUF)',
            'F' => 'Firm',
            'A' => 'Association of Persons (AOP)',
            'T' => 'Trust',
            'B' => 'Body of Individuals (BOI)',
            'G' => 'Government',
            'J' => 'Artificial Juridical Person',
            'L' => 'Local Authority',
            'E' => 'Limited Liability Partnership (LLP)',
            default => 'Unknown'
        };
    }

    /**
     * Get state name from state code
     */
    private function getStateName(string $code): string
    {
        $states = [
            'AP' => 'Andhra Pradesh', 'AR' => 'Arunachal Pradesh', 'AS' => 'Assam',
            'BR' => 'Bihar', 'CG' => 'Chhattisgarh', 'GA' => 'Goa',
            'GJ' => 'Gujarat', 'HR' => 'Haryana', 'HP' => 'Himachal Pradesh',
            'JH' => 'Jharkhand', 'KA' => 'Karnataka', 'KL' => 'Kerala',
            'MP' => 'Madhya Pradesh', 'MH' => 'Maharashtra', 'MN' => 'Manipur',
            'ML' => 'Meghalaya', 'MZ' => 'Mizoram', 'NL' => 'Nagaland',
            'OD' => 'Odisha', 'PB' => 'Punjab', 'RJ' => 'Rajasthan',
            'SK' => 'Sikkim', 'TN' => 'Tamil Nadu', 'TS' => 'Telangana',
            'TR' => 'Tripura', 'UP' => 'Uttar Pradesh', 'UK' => 'Uttarakhand',
            'WB' => 'West Bengal', 'AN' => 'Andaman & Nicobar', 'CH' => 'Chandigarh',
            'DN' => 'Dadra & Nagar Haveli', 'DD' => 'Daman & Diu',
            'DL' => 'Delhi', 'JK' => 'Jammu & Kashmir', 'LA' => 'Ladakh',
            'LD' => 'Lakshadweep', 'PY' => 'Puducherry'
        ];

        return $states[$code] ?? 'Unknown';
    }

    /**
     * Get bank name from IFSC code prefix
     */
    private function getBankName(string $code): string
    {
        $banks = [
            'SBIN' => 'State Bank of India',
            'HDFC' => 'HDFC Bank',
            'ICIC' => 'ICICI Bank',
            'UTIB' => 'Axis Bank',
            'KKBK' => 'Kotak Mahindra Bank',
            'PUNB' => 'Punjab National Bank',
            'BKID' => 'Bank of India',
            'BARB' => 'Bank of Baroda',
            'CBIN' => 'Central Bank of India',
            'UBIN' => 'Union Bank of India',
            'IDIB' => 'Indian Bank',
            'CNRB' => 'Canara Bank',
            'IOBA' => 'Indian Overseas Bank',
            'SYNB' => 'Syndicate Bank',
            'VIJB' => 'Vijaya Bank',
            'CORP' => 'Corporation Bank',
            'ANDB' => 'Andhra Bank',
            'ALLA' => 'Allahabad Bank',
            'UCBA' => 'UCO Bank',
            'ORBC' => 'Oriental Bank of Commerce',
            'INDU' => 'IndusInd Bank',
            'FDRL' => 'Federal Bank',
            'YESB' => 'Yes Bank',
            'IDFC' => 'IDFC First Bank',
            'BAND' => 'Bandhan Bank',
            'RBL'  => 'RBL Bank',
            'ESAF' => 'ESAF Small Finance Bank',
            'UJJI' => 'Ujjivan Small Finance Bank',
            'JANA' => 'Jana Small Finance Bank',
            'AUBL' => 'AU Small Finance Bank',
            'EQUI' => 'Equitas Small Finance Bank',
            'UTKS' => 'Utkarsh Small Finance Bank',
            'FINC' => 'Fincare Small Finance Bank',
            'NSPB' => 'North East Small Finance Bank',
            'SURY' => 'Suryoday Small Finance Bank',
            'CITI' => 'Citibank',
            'HSBC' => 'HSBC Bank',
            'SCBL' => 'Standard Chartered Bank',
            'CRLY' => 'Credit Lyonnais',
            'DBSS' => 'DBS Bank',
            'DEUT' => 'Deutsche Bank',
            'BOFA' => 'Bank of America',
            'BNPA' => 'BNP Paribas',
            'CHAS' => 'JP Morgan Chase',
            'MSHQ' => 'Mizuho Bank'
        ];

        return $banks[$code] ?? 'Unknown Bank';
    }
}
