<?php

namespace App\Services;

/**
 * Professional Tax State Service
 * 
 * Handles state-wise Professional Tax calculations for Indian payroll.
 * Each state has different PT slabs and rates.
 */
class PTStateService
{
    /**
     * PT configurations for each state.
     * Format: state_code => [monthly_slab => amount]
     */
    protected const STATE_CONFIGS = [
        'maharashtra' => [
            'monthly' => [
                ['min' => 0, 'max' => 7500, 'amount' => 0],
                ['min' => 7501, 'max' => 10000, 'amount' => 175],
                ['min' => 10001, 'max' => null, 'amount' => 200],
            ],
            'special' => [
                'february' => 300, // February has higher PT
            ],
        ],
        'karnataka' => [
            'monthly' => [
                ['min' => 0, 'max' => 15000, 'amount' => 0],
                ['min' => 15001, 'max' => null, 'amount' => 200],
            ],
        ],
        'tamil_nadu' => [
            'monthly' => [
                ['min' => 0, 'max' => 3500, 'amount' => 0],
                ['min' => 3501, 'max' => 5000, 'amount' => 22],
                ['min' => 5001, 'max' => 7500, 'amount' => 52],
                ['min' => 7501, 'max' => 10000, 'amount' => 115],
                ['min' => 10001, 'max' => 12500, 'amount' => 171],
                ['min' => 12501, 'max' => null, 'amount' => 208],
            ],
        ],
        'west_bengal' => [
            'monthly' => [
                ['min' => 0, 'max' => 10000, 'amount' => 0],
                ['min' => 10001, 'max' => 15000, 'amount' => 110],
                ['min' => 15001, 'max' => 25000, 'amount' => 130],
                ['min' => 25001, 'max' => 40000, 'amount' => 150],
                ['min' => 40001, 'max' => null, 'amount' => 200],
            ],
        ],
        'telangana' => [
            'monthly' => [
                ['min' => 0, 'max' => 15000, 'amount' => 0],
                ['min' => 15001, 'max' => 20000, 'amount' => 150],
                ['min' => 20001, 'max' => null, 'amount' => 200],
            ],
        ],
        'andhra_pradesh' => [
            'monthly' => [
                ['min' => 0, 'max' => 15000, 'amount' => 0],
                ['min' => 15001, 'max' => 20000, 'amount' => 150],
                ['min' => 20001, 'max' => null, 'amount' => 200],
            ],
        ],
        'madhya_pradesh' => [
            'monthly' => [
                ['min' => 0, 'max' => 18750, 'amount' => 0],
                ['min' => 18751, 'max' => 25000, 'amount' => 125],
                ['min' => 25001, 'max' => 33333, 'amount' => 167],
                ['min' => 33334, 'max' => null, 'amount' => 208],
            ],
        ],
        'gujarat' => [
            'monthly' => [
                ['min' => 0, 'max' => 5999, 'amount' => 0],
                ['min' => 6000, 'max' => 8999, 'amount' => 80],
                ['min' => 9000, 'max' => 11999, 'amount' => 150],
                ['min' => 12000, 'max' => null, 'amount' => 200],
            ],
        ],
        'delhi' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in Delhi
            ],
        ],
        'rajasthan' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in Rajasthan
            ],
        ],
        'haryana' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in Haryana
            ],
        ],
        'punjab' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in Punjab
            ],
        ],
        'uttar_pradesh' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in UP
            ],
        ],
        'bihar' => [
            'monthly' => [
                ['min' => 0, 'max' => 25000, 'amount' => 0],
                ['min' => 25001, 'max' => 41666, 'amount' => 83],
                ['min' => 41667, 'max' => 83333, 'amount' => 167],
                ['min' => 83334, 'max' => null, 'amount' => 208],
            ],
        ],
        'odisha' => [
            'monthly' => [
                ['min' => 0, 'max' => 13304, 'amount' => 0],
                ['min' => 13305, 'max' => 25000, 'amount' => 125],
                ['min' => 25001, 'max' => 33333, 'amount' => 167],
                ['min' => 33334, 'max' => null, 'amount' => 200],
            ],
        ],
        'kerala' => [
            'monthly' => [
                ['min' => 0, 'max' => 1999, 'amount' => 0],
                ['min' => 2000, 'max' => 2999, 'amount' => 20],
                ['min' => 3000, 'max' => 4999, 'amount' => 30],
                ['min' => 5000, 'max' => 7499, 'amount' => 50],
                ['min' => 7500, 'max' => 9999, 'amount' => 75],
                ['min' => 10000, 'max' => 12499, 'amount' => 100],
                ['min' => 12500, 'max' => 16666, 'amount' => 125],
                ['min' => 16667, 'max' => 20833, 'amount' => 167],
                ['min' => 20834, 'max' => null, 'amount' => 208],
            ],
        ],
        'assam' => [
            'monthly' => [
                ['min' => 0, 'max' => 10000, 'amount' => 0],
                ['min' => 10001, 'max' => 15000, 'amount' => 150],
                ['min' => 15001, 'max' => 25000, 'amount' => 180],
                ['min' => 25001, 'max' => null, 'amount' => 208],
            ],
        ],
        'jharkhand' => [
            'monthly' => [
                ['min' => 0, 'max' => 25000, 'amount' => 0],
                ['min' => 25001, 'max' => 41666, 'amount' => 100],
                ['min' => 41667, 'max' => 66666, 'amount' => 150],
                ['min' => 66667, 'max' => 83333, 'amount' => 175],
                ['min' => 83334, 'max' => null, 'amount' => 208],
            ],
        ],
        // --- Newly added states (FY 2024-25) ---
        'chhattisgarh' => [
            'monthly' => [
                ['min' => 0, 'max' => 12500, 'amount' => 0],
                ['min' => 12501, 'max' => 17000, 'amount' => 150],
                ['min' => 17001, 'max' => 25000, 'amount' => 180],
                ['min' => 25001, 'max' => null, 'amount' => 208],
            ],
        ],
        'goa' => [
            'monthly' => [
                ['min' => 0, 'max' => 15000, 'amount' => 0],
                ['min' => 15001, 'max' => 25000, 'amount' => 150],
                ['min' => 25001, 'max' => null, 'amount' => 200],
            ],
        ],
        'himachal_pradesh' => [
            'monthly' => [
                ['min' => 0, 'max' => 7500, 'amount' => 0],
                ['min' => 7501, 'max' => 10000, 'amount' => 100],
                ['min' => 10001, 'max' => 15000, 'amount' => 150],
                ['min' => 15001, 'max' => 20000, 'amount' => 200],
                ['min' => 20001, 'max' => null, 'amount' => 200],
            ],
        ],
        'jammu_and_kashmir' => [
            'monthly' => [
                ['min' => 0, 'max' => 15000, 'amount' => 0],
                ['min' => 15001, 'max' => 20000, 'amount' => 100],
                ['min' => 20001, 'max' => 30000, 'amount' => 150],
                ['min' => 30001, 'max' => null, 'amount' => 200],
            ],
        ],
        'ladakh' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // PT not yet levied
            ],
        ],
        'manipur' => [
            'monthly' => [
                ['min' => 0, 'max' => 10000, 'amount' => 0],
                ['min' => 10001, 'max' => 20000, 'amount' => 100],
                ['min' => 20001, 'max' => null, 'amount' => 200],
            ],
        ],
        'meghalaya' => [
            'monthly' => [
                ['min' => 0, 'max' => 10000, 'amount' => 0],
                ['min' => 10001, 'max' => 15000, 'amount' => 100],
                ['min' => 15001, 'max' => 25000, 'amount' => 150],
                ['min' => 25001, 'max' => null, 'amount' => 200],
            ],
        ],
        'mizoram' => [
            'monthly' => [
                ['min' => 0, 'max' => 10000, 'amount' => 0],
                ['min' => 10001, 'max' => 15000, 'amount' => 150],
                ['min' => 15001, 'max' => 25000, 'amount' => 200],
                ['min' => 25001, 'max' => null, 'amount' => 208],
            ],
        ],
        'nagaland' => [
            'monthly' => [
                ['min' => 0, 'max' => 12000, 'amount' => 0],
                ['min' => 12001, 'max' => 15000, 'amount' => 115],
                ['min' => 15001, 'max' => 25000, 'amount' => 160],
                ['min' => 25001, 'max' => null, 'amount' => 200],
            ],
        ],
        'sikkim' => [
            'monthly' => [
                ['min' => 0, 'max' => 10000, 'amount' => 0],
                ['min' => 10001, 'max' => 15000, 'amount' => 100],
                ['min' => 15001, 'max' => 20000, 'amount' => 150],
                ['min' => 20001, 'max' => 25000, 'amount' => 175],
                ['min' => 25001, 'max' => null, 'amount' => 200],
            ],
        ],
        'tripura' => [
            'monthly' => [
                ['min' => 0, 'max' => 7500, 'amount' => 0],
                ['min' => 7501, 'max' => 15000, 'amount' => 130],
                ['min' => 15001, 'max' => 25000, 'amount' => 150],
                ['min' => 25001, 'max' => null, 'amount' => 208],
            ],
        ],
        'uttarakhand' => [
            'monthly' => [
                ['min' => 0, 'max' => 10000, 'amount' => 0],
                ['min' => 10001, 'max' => 15000, 'amount' => 100],
                ['min' => 15001, 'max' => 20000, 'amount' => 150],
                ['min' => 20001, 'max' => 25000, 'amount' => 175],
                ['min' => 25001, 'max' => null, 'amount' => 200],
            ],
        ],
        // --- Union Territories ---
        'puducherry' => [
            'monthly' => [
                ['min' => 0, 'max' => 9999, 'amount' => 0],
                ['min' => 10000, 'max' => 14999, 'amount' => 100],
                ['min' => 15000, 'max' => 19999, 'amount' => 150],
                ['min' => 20000, 'max' => 24999, 'amount' => 175],
                ['min' => 25000, 'max' => null, 'amount' => 208],
            ],
        ],
        'chandigarh' => [
            'monthly' => [
                ['min' => 0, 'max' => 12000, 'amount' => 0],
                ['min' => 12001, 'max' => 15000, 'amount' => 100],
                ['min' => 15001, 'max' => 20000, 'amount' => 150],
                ['min' => 20001, 'max' => 25000, 'amount' => 200],
                ['min' => 25001, 'max' => null, 'amount' => 250],
            ],
        ],
        'andaman_and_nicobar' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in A&N
            ],
        ],
        'dadra_and_nagar_haveli' => [
            'monthly' => [
                ['min' => 0, 'max' => 10000, 'amount' => 0],
                ['min' => 10001, 'max' => 15000, 'amount' => 100],
                ['min' => 15001, 'max' => 25000, 'amount' => 150],
                ['min' => 25001, 'max' => null, 'amount' => 200],
            ],
        ],
        'daman_and_diu' => [
            'monthly' => [
                ['min' => 0, 'max' => 10000, 'amount' => 0],
                ['min' => 10001, 'max' => 15000, 'amount' => 100],
                ['min' => 15001, 'max' => 25000, 'amount' => 150],
                ['min' => 25001, 'max' => null, 'amount' => 200],
            ],
        ],
        'lakshadweep' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in Lakshadweep
            ],
        ],
    ];

    /**
     * List of all available states.
     */
    public static function getStates(): array
    {
        return [
            // States (28)
            ['code' => 'andhra_pradesh', 'name' => 'Andhra Pradesh', 'type' => 'state'],
            ['code' => 'assam', 'name' => 'Assam', 'type' => 'state'],
            ['code' => 'bihar', 'name' => 'Bihar', 'type' => 'state'],
            ['code' => 'chhattisgarh', 'name' => 'Chhattisgarh', 'type' => 'state'],
            ['code' => 'goa', 'name' => 'Goa', 'type' => 'state'],
            ['code' => 'gujarat', 'name' => 'Gujarat', 'type' => 'state'],
            ['code' => 'haryana', 'name' => 'Haryana', 'type' => 'state'],
            ['code' => 'himachal_pradesh', 'name' => 'Himachal Pradesh', 'type' => 'state'],
            ['code' => 'jammu_and_kashmir', 'name' => 'Jammu & Kashmir', 'type' => 'state'],
            ['code' => 'jharkhand', 'name' => 'Jharkhand', 'type' => 'state'],
            ['code' => 'karnataka', 'name' => 'Karnataka', 'type' => 'state'],
            ['code' => 'kerala', 'name' => 'Kerala', 'type' => 'state'],
            ['code' => 'madhya_pradesh', 'name' => 'Madhya Pradesh', 'type' => 'state'],
            ['code' => 'maharashtra', 'name' => 'Maharashtra', 'type' => 'state'],
            ['code' => 'manipur', 'name' => 'Manipur', 'type' => 'state'],
            ['code' => 'meghalaya', 'name' => 'Meghalaya', 'type' => 'state'],
            ['code' => 'mizoram', 'name' => 'Mizoram', 'type' => 'state'],
            ['code' => 'nagaland', 'name' => 'Nagaland', 'type' => 'state'],
            ['code' => 'odisha', 'name' => 'Odisha', 'type' => 'state'],
            ['code' => 'punjab', 'name' => 'Punjab', 'type' => 'state'],
            ['code' => 'rajasthan', 'name' => 'Rajasthan', 'type' => 'state'],
            ['code' => 'sikkim', 'name' => 'Sikkim', 'type' => 'state'],
            ['code' => 'tamil_nadu', 'name' => 'Tamil Nadu', 'type' => 'state'],
            ['code' => 'telangana', 'name' => 'Telangana', 'type' => 'state'],
            ['code' => 'tripura', 'name' => 'Tripura', 'type' => 'state'],
            ['code' => 'uttar_pradesh', 'name' => 'Uttar Pradesh', 'type' => 'state'],
            ['code' => 'uttarakhand', 'name' => 'Uttarakhand', 'type' => 'state'],
            ['code' => 'west_bengal', 'name' => 'West Bengal', 'type' => 'state'],
            // Union Territories (8)
            ['code' => 'andaman_and_nicobar', 'name' => 'Andaman & Nicobar Islands', 'type' => 'ut'],
            ['code' => 'chandigarh', 'name' => 'Chandigarh', 'type' => 'ut'],
            ['code' => 'dadra_and_nagar_haveli', 'name' => 'Dadra & Nagar Haveli', 'type' => 'ut'],
            ['code' => 'daman_and_diu', 'name' => 'Daman & Diu', 'type' => 'ut'],
            ['code' => 'delhi', 'name' => 'Delhi', 'type' => 'ut'],
            ['code' => 'lakshadweep', 'name' => 'Lakshadweep', 'type' => 'ut'],
            ['code' => 'ladakh', 'name' => 'Ladakh', 'type' => 'ut'],
            ['code' => 'puducherry', 'name' => 'Puducherry', 'type' => 'ut'],
        ];
    }

    /**
     * Get list of states with PT.
     */
    public static function getStatesWithPT(): array
    {
        $states = self::getStates();
        return array_filter($states, function ($state) {
            $config = self::STATE_CONFIGS[$state['code']] ?? null;
            if (!$config) return false;
            
            // Check if any slab has amount > 0
            foreach ($config['monthly'] as $slab) {
                if ($slab['amount'] > 0) {
                    return true;
                }
            }
            return false;
        });
    }

    /**
     * Get list of states without PT.
     */
    public static function getStatesWithoutPT(): array
    {
        $states = self::getStates();
        return array_filter($states, function ($state) {
            $config = self::STATE_CONFIGS[$state['code']] ?? null;
            if (!$config) return true;
            
            // Check if all slabs have amount = 0
            foreach ($config['monthly'] as $slab) {
                if ($slab['amount'] > 0) {
                    return false;
                }
            }
            return true;
        });
    }

    /**
     * Calculate PT for a given state and monthly gross salary.
     * 
     * @param string $stateCode State code (e.g., 'maharashtra', 'karnataka')
     * @param float $monthlyGross Monthly gross salary
     * @param int|null $month Month number (1-12), null for current month
     * @return float Professional Tax amount
     */
    public static function calculate(string $stateCode, float $monthlyGross, ?int $month = null): float
    {
        $stateCode = strtolower($stateCode);
        $config = self::STATE_CONFIGS[$stateCode] ?? null;

        if (!$config) {
            return 0; // Unknown state, no PT
        }

        // Check for special month rates (e.g., Maharashtra February)
        if ($month !== null && isset($config['special'])) {
            $monthName = strtolower(date('F', mktime(0, 0, 0, $month, 1)));
            if (isset($config['special'][$monthName])) {
                // Check if special rate applies based on gross
                foreach ($config['monthly'] as $slab) {
                    if ($monthlyGross >= $slab['min'] && ($slab['max'] === null || $monthlyGross <= $slab['max'])) {
                        if ($slab['amount'] > 0) {
                            return $config['special'][$monthName];
                        }
                    }
                }
            }
        }

        // Regular calculation
        foreach ($config['monthly'] as $slab) {
            if ($monthlyGross >= $slab['min'] && ($slab['max'] === null || $monthlyGross <= $slab['max'])) {
                return $slab['amount'];
            }
        }

        return 0;
    }

    /**
     * Get PT configuration for a state.
     * 
     * @param string $stateCode State code
     * @return array|null PT configuration
     */
    public static function getConfiguration(string $stateCode): ?array
    {
        $stateCode = strtolower($stateCode);
        return self::STATE_CONFIGS[$stateCode] ?? null;
    }

    /**
     * Check if state has PT.
     * 
     * @param string $stateCode State code
     * @return bool True if state has PT
     */
    public static function hasPT(string $stateCode): bool
    {
        $config = self::getConfiguration($stateCode);
        
        if (!$config) {
            return false;
        }

        foreach ($config['monthly'] as $slab) {
            if ($slab['amount'] > 0) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get annual PT limit for a state.
     * 
     * @param string $stateCode State code
     * @return float Maximum annual PT
     */
    public static function getAnnualLimit(string $stateCode): float
    {
        $config = self::getConfiguration($stateCode);
        
        if (!$config) {
            return 0;
        }

        $maxMonthly = 0;
        foreach ($config['monthly'] as $slab) {
            if ($slab['amount'] > $maxMonthly) {
                $maxMonthly = $slab['amount'];
            }
        }

        // Check for special months
        if (isset($config['special'])) {
            foreach ($config['special'] as $amount) {
                if ($amount > $maxMonthly) {
                    $maxMonthly = $amount;
                }
            }
        }

        return $maxMonthly * 12;
    }
}
