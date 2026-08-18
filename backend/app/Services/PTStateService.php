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
        // --- Jurisdictions that levy NO professional tax ---
        //
        // Professional tax is state-levied and many states/UTs do not levy it
        // at all. The entries below previously carried invented slabs and were
        // deducting a tax that does not exist, from real employees, on every
        // run. They are zeroed rather than removed so that:
        //   - orgs that already selected the state keep a valid state code,
        //   - getStatesWithoutPT() reports them without a second code path,
        //   - "no PT" has exactly one representation in this file.
        //
        // Do not re-add a slab here without a citation to that state's
        // Professional Tax Act. An unset or zero state must yield 0.
        'arunachal_pradesh' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in Arunachal Pradesh
            ],
        ],
        'chhattisgarh' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in Chhattisgarh
            ],
        ],
        'goa' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in Goa
            ],
        ],
        'himachal_pradesh' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in Himachal Pradesh
            ],
        ],
        'jammu_and_kashmir' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in Jammu & Kashmir
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
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in Uttarakhand
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
        // Chandigarh levies no PT. Its previous top band of 250/month also
        // totalled 3,000 a year, breaching the Article 276(2) ceiling of
        // 2,500 that binds every state and UT -- so it was both an invented
        // tax and an unconstitutional one.
        'chandigarh' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in Chandigarh
            ],
        ],
        'andaman_and_nicobar' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in A&N
            ],
        ],
        'dadra_and_nagar_haveli' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in Dadra & Nagar Haveli
            ],
        ],
        'daman_and_diu' => [
            'monthly' => [
                ['min' => 0, 'max' => null, 'amount' => 0], // No PT in Daman & Diu
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
            // States
            ['code' => 'andhra_pradesh', 'name' => 'Andhra Pradesh', 'type' => 'state'],
            ['code' => 'arunachal_pradesh', 'name' => 'Arunachal Pradesh', 'type' => 'state'],
            ['code' => 'assam', 'name' => 'Assam', 'type' => 'state'],
            ['code' => 'bihar', 'name' => 'Bihar', 'type' => 'state'],
            ['code' => 'chhattisgarh', 'name' => 'Chhattisgarh', 'type' => 'state'],
            ['code' => 'goa', 'name' => 'Goa', 'type' => 'state'],
            ['code' => 'gujarat', 'name' => 'Gujarat', 'type' => 'state'],
            ['code' => 'haryana', 'name' => 'Haryana', 'type' => 'state'],
            ['code' => 'himachal_pradesh', 'name' => 'Himachal Pradesh', 'type' => 'state'],
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
            // Union Territories. Jammu & Kashmir has been a UT since the
            // reorganisation of Oct 2019; it was previously typed 'state'.
            ['code' => 'andaman_and_nicobar', 'name' => 'Andaman & Nicobar Islands', 'type' => 'ut'],
            ['code' => 'chandigarh', 'name' => 'Chandigarh', 'type' => 'ut'],
            ['code' => 'jammu_and_kashmir', 'name' => 'Jammu & Kashmir', 'type' => 'ut'],
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

        $amount = self::resolveSlabAmount($config['monthly'] ?? [], $monthlyGross);

        // Special month rates (e.g. Maharashtra's higher February instalment).
        //
        // This applies ONLY to the top band. The rule exists so that the top
        // band totals the statutory annual cap (11 x 200 + 300 = 2,500); an
        // employee in a lower band is already under the cap and must keep
        // paying their normal rate. The previous implementation returned the
        // special amount for ANY non-zero band, so a 9,000 earner in
        // Maharashtra was charged 300 in February instead of 175.
        if ($month !== null && isset($config['special'])) {
            $monthName = strtolower(date('F', mktime(0, 0, 0, $month, 1)));
            $special = $config['special'][$monthName] ?? null;

            if ($special !== null && $amount > 0 && $amount >= self::topBandAmount($config['monthly'] ?? [])) {
                return (float) $special;
            }
        }

        return $amount;
    }

    /**
     * Resolve the PT amount for a monthly gross.
     *
     * Matching is on the UPPER bound only, taking the first band whose max is
     * at or above the gross. The declared `min` values are one rupee above the
     * previous `max` (7500 then 7501, ...), so the original
     * `gross >= min && gross <= max` test left a hole at every boundary: a
     * gross of 7,500.50 matched no band at all and fell through to zero PT.
     * Since LOP-adjusted gross is fractional by construction, that fired
     * routinely and under-collected PT.
     *
     * @param  array<int,array{min:int|float,max:int|float|null,amount:int|float}>  $slabs
     */
    private static function resolveSlabAmount(array $slabs, float $monthlyGross): float
    {
        if ($slabs === [] || $monthlyGross <= 0) {
            return 0.0;
        }

        // Defensive ordering: ascending by upper bound, unbounded band last.
        usort($slabs, function (array $a, array $b) {
            if ($a['max'] === null) {
                return 1;
            }
            if ($b['max'] === null) {
                return -1;
            }

            return $a['max'] <=> $b['max'];
        });

        foreach ($slabs as $slab) {
            if ($slab['max'] === null || $monthlyGross <= $slab['max']) {
                return (float) $slab['amount'];
            }
        }

        return 0.0;
    }

    /**
     * Highest PT amount in a state's table.
     *
     * @param  array<int,array{min:int|float,max:int|float|null,amount:int|float}>  $slabs
     */
    private static function topBandAmount(array $slabs): float
    {
        $amounts = array_map(static fn (array $slab) => (float) $slab['amount'], $slabs);

        return $amounts === [] ? 0.0 : max($amounts);
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
     * Maximum professional tax an employee can pay across a full year in this
     * jurisdiction -- the top band, summed over all twelve months.
     *
     * Derived by running calculate() for each month rather than by multiplying
     * a maximum monthly rate by 12. The previous form folded Maharashtra's
     * February instalment of 300 into the monthly maximum and then multiplied,
     * returning 3,600 against a real annual of (11 x 200) + 300 = 2,500. A
     * figure reported here has to agree with what an employee is actually
     * charged, so it is now computed the same way they are charged -- the two
     * cannot drift apart again.
     *
     * Article 276(2) caps this at 2,500 for every state and union territory.
     *
     * @param string $stateCode State code
     * @return float Maximum annual PT
     */
    public static function getAnnualLimit(string $stateCode): float
    {
        if (!self::getConfiguration($stateCode)) {
            return 0;
        }

        // High enough to land in the top band of every configured jurisdiction.
        $topBandGross = 1_000_000_000.0;

        $annual = 0.0;
        for ($month = 1; $month <= 12; $month++) {
            $annual += self::calculate($stateCode, $topBandGross, $month);
        }

        return $annual;
    }
}
