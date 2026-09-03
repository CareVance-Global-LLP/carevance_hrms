/**
 * Status option registry for the Employee Pay sub-tabs.
 *
 * Replaces the six duplicated `STATUS_OPTIONS` arrays that previously lived
 * inside each page (each with different label casing, different namespaces,
 * and at least one that leaked: e.g. FBP's filter accepted `pending/approved/
 * rejected` while the row badges could also render `active/expired`).
 *
 * `payrollStatusTone` in `payrollStatus.ts` continues to map any arbitrary
 * status string to a tone, so existing badges that don't go through this
 * registry keep working — this is the canonical source for *filter dropdowns*
 * specifically, plus an explicit registry of values that should exist in each
 * namespace.
 */

import type { PayrollBadgeTone } from './payrollStatus';

export interface PayrollStatusOption {
  value: string;
  label: string;
  tone?: PayrollBadgeTone;
}

export type PayrollStatusNamespace =
  | 'revisions'
  | 'fbp'
  | 'loans'
  | 'arrears'
  | 'reimbursements'
  | 'perquisites';

export const payrollStatusRegistry: Record<PayrollStatusNamespace, PayrollStatusOption[]> = {
  revisions: [
    { value: 'draft', label: 'Draft', tone: 'warning' },
    { value: 'generated', label: 'Generated', tone: 'info' },
    { value: 'accepted', label: 'Accepted', tone: 'success' },
    { value: 'rejected', label: 'Rejected', tone: 'danger' },
  ],
  fbp: [
    { value: 'pending', label: 'Pending', tone: 'warning' },
    { value: 'approved', label: 'Approved', tone: 'success' },
    { value: 'rejected', label: 'Rejected', tone: 'danger' },
    { value: 'active', label: 'Active', tone: 'success' },
    { value: 'expired', label: 'Expired', tone: 'neutral' },
  ],
  loans: [
    { value: 'pending', label: 'Pending', tone: 'warning' },
    { value: 'approved', label: 'Approved', tone: 'success' },
    { value: 'rejected', label: 'Rejected', tone: 'danger' },
    { value: 'closed', label: 'Closed', tone: 'neutral' },
  ],
  arrears: [
    { value: 'draft', label: 'Draft', tone: 'warning' },
    { value: 'approved', label: 'Approved', tone: 'success' },
    { value: 'rejected', label: 'Rejected', tone: 'danger' },
    { value: 'paid', label: 'Paid', tone: 'info' },
  ],
  reimbursements: [
    { value: 'pending', label: 'Pending', tone: 'warning' },
    { value: 'approved', label: 'Approved', tone: 'success' },
    { value: 'rejected', label: 'Rejected', tone: 'danger' },
    { value: 'paid', label: 'Paid', tone: 'info' },
    { value: 'removed', label: 'Removed', tone: 'neutral' },
  ],
  perquisites: [
    { value: 'active', label: 'Active', tone: 'success' },
    { value: 'inactive', label: 'Inactive', tone: 'neutral' },
  ],
};
