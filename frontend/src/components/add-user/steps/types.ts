import { detectTimeZone } from '@/lib/timezones';

export interface OtherEarning {
  name: string;
  type: 'fixed' | 'percentage';
  value: number;
}

export interface IncompleteUserCheck {
  exists: boolean;
  incomplete: boolean;
  userId?: number;
  name?: string;
  email?: string;
  step?: number;
}

export interface AddUserWizardForm {
  // Step 1: Basic Info (Required)
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  // Set by the admin, handed to the joiner directly. This is what separates
  // "Create User" from the three invite tabs: the account is usable the moment
  // it exists, so the address is treated as verified on create rather than
  // waiting on an email the joiner may never receive.
  password: string;
  phone: string;
  role: 'employee' | 'manager' | 'admin';
  departmentIds: number[];
  designation: string;
  joiningDate: string;
  workLocation: 'office' | 'remote' | 'hybrid';
  timezone: string;
  employeeCode: string;

  // Step 1: Payroll Info (Optional)
  annualCtc: number | null;
  /*
   * Preview-only, not sent to the API.
   *
   * The breakup panel needs a basic percentage and a metro flag to show what a
   * CTC means. The engine derives both server-side at payroll time, so these
   * exist to drive the on-screen figures and nothing else.
   */
  ctcBasicPercentage: string;
  ctcIsMetroCity: boolean;
  payGroupId: number | null;
  salaryStructureId: number | null;

  // Step 2: Auto-generated (Read-only)
  userId: number | null;

  // Step 3: Profile (All Optional)
  gender: 'male' | 'female' | 'other' | '';
  dateOfBirth: string;
  personalEmail: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyRelationship: string;
  idType: 'aadhaar' | 'pan' | 'passport' | 'driving_license' | 'voter_id' | '';
  idNumber: string;
  idProofFile: File | null;
  resumeFile: File | null;
  experienceCertFile: File | null;
  educationCertFile: File | null;
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  branchName: string;
  accountType: 'savings' | 'current';
  bankProofFile: File | null;
  isDefaultAccount: boolean;
}

export const defaultForm: AddUserWizardForm = {
  // Step 1
  firstName: '',
  middleName: '',
  lastName: '',
  email: '',
  password: '',
  phone: '',
  role: 'employee',
  departmentIds: [],
  designation: '',
  joiningDate: new Date().toISOString().split('T')[0],
  workLocation: 'office',
  // Canonicalised, because Chrome reports IST as the legacy `Asia/Calcutta`
  // while the picker lists `Asia/Kolkata` — the raw value matched no option and
  // left a required field looking unset.
  timezone: detectTimeZone(),
  employeeCode: '',

  // Step 1: Payroll Info
  annualCtc: null,
  ctcBasicPercentage: '',
  ctcIsMetroCity: false,
  payGroupId: null,
  salaryStructureId: null,

  // Step 2
  userId: null,

  // Step 3
  gender: '',
  dateOfBirth: '',
  personalEmail: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  pincode: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyRelationship: '',
  idType: '',
  idNumber: '',
  idProofFile: null,
  resumeFile: null,
  experienceCertFile: null,
  educationCertFile: null,
  accountHolderName: '',
  bankName: '',
  accountNumber: '',
  ifscCode: '',
  branchName: '',
  accountType: 'savings',
  bankProofFile: null,
  isDefaultAccount: true,
};
