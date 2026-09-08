/**
 * Centralised list of Indian states used in the PT-state dropdowns of
 * EmployeePayrollCards and SalaryBreakdownCards. The two pages previously
 * shipped their own near-identical arrays with different "Not set"
 * placeholder wording.
 *
 * `payrollApi.getPTStates()` exists on the backend but wasn't called from the
 * frontend. Callers should prefer it via `usePTStates()` once the endpoint
 * shape is confirmed; this list is the safe fallback used while the API is
 * not yet wired in.
 */
export const INDIAN_STATES: { value: string; label: string }[] = [
  { value: 'andhra_pradesh', label: 'Andhra Pradesh' },
  { value: 'assam', label: 'Assam' },
  { value: 'bihar', label: 'Bihar' },
  { value: 'chhattisgarh', label: 'Chhattisgarh' },
  { value: 'delhi', label: 'Delhi' },
  { value: 'goa', label: 'Goa' },
  { value: 'gujarat', label: 'Gujarat' },
  { value: 'haryana', label: 'Haryana' },
  { value: 'himachal_pradesh', label: 'Himachal Pradesh' },
  { value: 'jammu_kashmir', label: 'Jammu & Kashmir' },
  { value: 'jharkhand', label: 'Jharkhand' },
  { value: 'karnataka', label: 'Karnataka' },
  { value: 'kerala', label: 'Kerala' },
  { value: 'madhya_pradesh', label: 'Madhya Pradesh' },
  { value: 'maharashtra', label: 'Maharashtra' },
  { value: 'meghalaya', label: 'Meghalaya' },
  { value: 'odisha', label: 'Odisha' },
  { value: 'punjab', label: 'Punjab' },
  { value: 'sikkim', label: 'Sikkim' },
  { value: 'tamil_nadu', label: 'Tamil Nadu' },
  { value: 'telangana', label: 'Telangana' },
  { value: 'tripura', label: 'Tripura' },
  { value: 'uttar_pradesh', label: 'Uttar Pradesh' },
  { value: 'uttarakhand', label: 'Uttarakhand' },
  { value: 'west_bengal', label: 'West Bengal' },
];

export const PT_STATE_NOT_SET_VALUE = 'none';
export const PT_STATE_NOT_SET_LABEL = 'Not set (no PT deduction)';
