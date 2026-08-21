/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source of truth: backend/app/Services/PTStateService.php
 * Regenerate with:  node scripts/sync-pt-states.mjs
 *
 * 37 states and union territories, of which 20 actually levy
 * professional tax. The 17 that do not are included deliberately:
 * a calculator that silently omits them leaves the reader guessing, and the
 * product's own behaviour is to return ₹0 rather than default to a neighbour.
 */

export interface PtSlab {
  min: number;
  /** null = no upper bound. */
  max: number | null;
  amount: number;
}

export interface PtState {
  code: string;
  name: string;
  type: 'state' | 'ut';
  slabs: PtSlab[];
  /** Some states levy a higher instalment in February. */
  februaryAmount: number | null;
  levies: boolean;
}

export const PT_STATES: readonly PtState[] = [
  {
    "code": "andaman_and_nicobar",
    "name": "Andaman & Nicobar Islands",
    "type": "ut",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "andhra_pradesh",
    "name": "Andhra Pradesh",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 15000,
        "amount": 0
      },
      {
        "min": 15001,
        "max": 20000,
        "amount": 150
      },
      {
        "min": 20001,
        "max": null,
        "amount": 200
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "arunachal_pradesh",
    "name": "Arunachal Pradesh",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "assam",
    "name": "Assam",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 10000,
        "amount": 0
      },
      {
        "min": 10001,
        "max": 15000,
        "amount": 150
      },
      {
        "min": 15001,
        "max": 25000,
        "amount": 180
      },
      {
        "min": 25001,
        "max": null,
        "amount": 208
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "bihar",
    "name": "Bihar",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 25000,
        "amount": 0
      },
      {
        "min": 25001,
        "max": 41666,
        "amount": 83
      },
      {
        "min": 41667,
        "max": 83333,
        "amount": 167
      },
      {
        "min": 83334,
        "max": null,
        "amount": 208
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "chandigarh",
    "name": "Chandigarh",
    "type": "ut",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "chhattisgarh",
    "name": "Chhattisgarh",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "dadra_and_nagar_haveli",
    "name": "Dadra & Nagar Haveli",
    "type": "ut",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "daman_and_diu",
    "name": "Daman & Diu",
    "type": "ut",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "delhi",
    "name": "Delhi",
    "type": "ut",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "goa",
    "name": "Goa",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "gujarat",
    "name": "Gujarat",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 5999,
        "amount": 0
      },
      {
        "min": 6000,
        "max": 8999,
        "amount": 80
      },
      {
        "min": 9000,
        "max": 11999,
        "amount": 150
      },
      {
        "min": 12000,
        "max": null,
        "amount": 200
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "haryana",
    "name": "Haryana",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "himachal_pradesh",
    "name": "Himachal Pradesh",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "jammu_and_kashmir",
    "name": "Jammu & Kashmir",
    "type": "ut",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "jharkhand",
    "name": "Jharkhand",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 25000,
        "amount": 0
      },
      {
        "min": 25001,
        "max": 41666,
        "amount": 100
      },
      {
        "min": 41667,
        "max": 66666,
        "amount": 150
      },
      {
        "min": 66667,
        "max": 83333,
        "amount": 175
      },
      {
        "min": 83334,
        "max": null,
        "amount": 208
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "karnataka",
    "name": "Karnataka",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 15000,
        "amount": 0
      },
      {
        "min": 15001,
        "max": null,
        "amount": 200
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "kerala",
    "name": "Kerala",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 1999,
        "amount": 0
      },
      {
        "min": 2000,
        "max": 2999,
        "amount": 20
      },
      {
        "min": 3000,
        "max": 4999,
        "amount": 30
      },
      {
        "min": 5000,
        "max": 7499,
        "amount": 50
      },
      {
        "min": 7500,
        "max": 9999,
        "amount": 75
      },
      {
        "min": 10000,
        "max": 12499,
        "amount": 100
      },
      {
        "min": 12500,
        "max": 16666,
        "amount": 125
      },
      {
        "min": 16667,
        "max": 20833,
        "amount": 167
      },
      {
        "min": 20834,
        "max": null,
        "amount": 208
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "ladakh",
    "name": "Ladakh",
    "type": "ut",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "lakshadweep",
    "name": "Lakshadweep",
    "type": "ut",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "madhya_pradesh",
    "name": "Madhya Pradesh",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 18750,
        "amount": 0
      },
      {
        "min": 18751,
        "max": 25000,
        "amount": 125
      },
      {
        "min": 25001,
        "max": 33333,
        "amount": 167
      },
      {
        "min": 33334,
        "max": null,
        "amount": 208
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "maharashtra",
    "name": "Maharashtra",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 7500,
        "amount": 0
      },
      {
        "min": 7501,
        "max": 10000,
        "amount": 175
      },
      {
        "min": 10001,
        "max": null,
        "amount": 200
      }
    ],
    "februaryAmount": 300,
    "levies": true
  },
  {
    "code": "manipur",
    "name": "Manipur",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 10000,
        "amount": 0
      },
      {
        "min": 10001,
        "max": 20000,
        "amount": 100
      },
      {
        "min": 20001,
        "max": null,
        "amount": 200
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "meghalaya",
    "name": "Meghalaya",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 10000,
        "amount": 0
      },
      {
        "min": 10001,
        "max": 15000,
        "amount": 100
      },
      {
        "min": 15001,
        "max": 25000,
        "amount": 150
      },
      {
        "min": 25001,
        "max": null,
        "amount": 200
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "mizoram",
    "name": "Mizoram",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 10000,
        "amount": 0
      },
      {
        "min": 10001,
        "max": 15000,
        "amount": 150
      },
      {
        "min": 15001,
        "max": 25000,
        "amount": 200
      },
      {
        "min": 25001,
        "max": null,
        "amount": 208
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "nagaland",
    "name": "Nagaland",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 12000,
        "amount": 0
      },
      {
        "min": 12001,
        "max": 15000,
        "amount": 115
      },
      {
        "min": 15001,
        "max": 25000,
        "amount": 160
      },
      {
        "min": 25001,
        "max": null,
        "amount": 200
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "odisha",
    "name": "Odisha",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 13304,
        "amount": 0
      },
      {
        "min": 13305,
        "max": 25000,
        "amount": 125
      },
      {
        "min": 25001,
        "max": 33333,
        "amount": 167
      },
      {
        "min": 33334,
        "max": null,
        "amount": 200
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "puducherry",
    "name": "Puducherry",
    "type": "ut",
    "slabs": [
      {
        "min": 0,
        "max": 9999,
        "amount": 0
      },
      {
        "min": 10000,
        "max": 14999,
        "amount": 100
      },
      {
        "min": 15000,
        "max": 19999,
        "amount": 150
      },
      {
        "min": 20000,
        "max": 24999,
        "amount": 175
      },
      {
        "min": 25000,
        "max": null,
        "amount": 208
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "punjab",
    "name": "Punjab",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "rajasthan",
    "name": "Rajasthan",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "sikkim",
    "name": "Sikkim",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 10000,
        "amount": 0
      },
      {
        "min": 10001,
        "max": 15000,
        "amount": 100
      },
      {
        "min": 15001,
        "max": 20000,
        "amount": 150
      },
      {
        "min": 20001,
        "max": 25000,
        "amount": 175
      },
      {
        "min": 25001,
        "max": null,
        "amount": 200
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "tamil_nadu",
    "name": "Tamil Nadu",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 3500,
        "amount": 0
      },
      {
        "min": 3501,
        "max": 5000,
        "amount": 22
      },
      {
        "min": 5001,
        "max": 7500,
        "amount": 52
      },
      {
        "min": 7501,
        "max": 10000,
        "amount": 115
      },
      {
        "min": 10001,
        "max": 12500,
        "amount": 171
      },
      {
        "min": 12501,
        "max": null,
        "amount": 208
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "telangana",
    "name": "Telangana",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 15000,
        "amount": 0
      },
      {
        "min": 15001,
        "max": 20000,
        "amount": 150
      },
      {
        "min": 20001,
        "max": null,
        "amount": 200
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "tripura",
    "name": "Tripura",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 7500,
        "amount": 0
      },
      {
        "min": 7501,
        "max": 15000,
        "amount": 130
      },
      {
        "min": 15001,
        "max": 25000,
        "amount": 150
      },
      {
        "min": 25001,
        "max": null,
        "amount": 208
      }
    ],
    "februaryAmount": null,
    "levies": true
  },
  {
    "code": "uttar_pradesh",
    "name": "Uttar Pradesh",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "uttarakhand",
    "name": "Uttarakhand",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": null,
        "amount": 0
      }
    ],
    "februaryAmount": null,
    "levies": false
  },
  {
    "code": "west_bengal",
    "name": "West Bengal",
    "type": "state",
    "slabs": [
      {
        "min": 0,
        "max": 10000,
        "amount": 0
      },
      {
        "min": 10001,
        "max": 15000,
        "amount": 110
      },
      {
        "min": 15001,
        "max": 25000,
        "amount": 130
      },
      {
        "min": 25001,
        "max": 40000,
        "amount": 150
      },
      {
        "min": 40001,
        "max": null,
        "amount": 200
      }
    ],
    "februaryAmount": null,
    "levies": true
  }
] as const;

export const PT_STATE_COUNT = 37;
export const PT_LEVYING_COUNT = 20;
export const PT_NIL_COUNT = 17;

/**
 * Monthly professional tax, mirroring PTStateService::calculate().
 *
 * The February rule applies only to the TOP band — a state's higher instalment
 * exists so the annual total reaches the statutory ceiling, and applying it to
 * a lower slab would overcharge someone the ceiling was never about.
 */
export function professionalTax(
  stateCode: string,
  monthlyGross: number,
  month?: number
): number {
  const state = PT_STATES.find((s) => s.code === stateCode.toLowerCase());
  if (!state) return 0;

  const slab = state.slabs.find(
    (sl) => monthlyGross >= sl.min && (sl.max === null || monthlyGross <= sl.max)
  );
  if (!slab) return 0;

  const isTopBand = state.slabs[state.slabs.length - 1] === slab;
  if (month === 2 && state.februaryAmount !== null && isTopBand) {
    return state.februaryAmount;
  }

  return slab.amount;
}

/** Annual professional tax, accounting for any February special rate. */
export function annualProfessionalTax(stateCode: string, monthlyGross: number): number {
  let total = 0;
  for (let month = 1; month <= 12; month++) {
    total += professionalTax(stateCode, monthlyGross, month);
  }
  return total;
}

export function getPtState(code: string): PtState | undefined {
  return PT_STATES.find((s) => s.code === code.toLowerCase());
}
