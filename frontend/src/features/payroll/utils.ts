import type { PayrollAdjustment, PayrollRecord, SalaryComponentMaster, SalaryTemplate, SalaryTemplateComponentItem } from '@/types';

export const formatPayrollCurrency = (amount: number, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));

export const formatPayrollDuration = (seconds: number) => {
  const safe = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${minutes}m`;
};

export const payrollStatusTone = (status?: string) => {
  switch (String(status || '').toLowerCase()) {
    case 'paid':
    case 'success':
    case 'approved':
    case 'applied':
    case 'active':
    case 'eligible':
    case 'verified':
    case 'healthy':
      return 'success' as const;
    case 'processed':
    case 'pending':
    case 'pending_approval':
    case 'finalized':
    case 'locked':
    case 'taxable':
    case 'incomplete':
    case 'unverified':
      return 'warning' as const;
    case 'failed':
    case 'rejected':
    case 'ineligible':
    case 'missing profile':
    case 'missing_profile':
      return 'danger' as const;
    case 'percentage':
      return 'info' as const;
    default:
      return 'neutral' as const;
  }
};

export const payrollStatusLabel = (status?: string | null) => {
  const normalized = String(status || 'unknown').trim().toLowerCase().replace(/\s+/g, '_');
  const mapped: Record<string, string> = {
    active: 'Active',
    applied: 'Applied',
    approved: 'Approved',
    draft: 'Draft',
    eligible: 'Eligible',
    failed: 'Failed',
    finalized: 'Finalized',
    fixed: 'Fixed amount',
    healthy: 'Healthy',
    historical: 'Historical',
    inactive: 'Inactive',
    incomplete: 'Incomplete',
    ineligible: 'Not eligible',
    locked: 'Locked',
    missing_profile: 'Missing profile',
    paid: 'Paid',
    pending: 'Pending',
    pending_approval: 'Pending approval',
    percentage: 'Percentage based',
    processed: 'Processed',
    rejected: 'Rejected',
    success: 'Successful',
    taxable: 'Taxable',
    unverified: 'Unverified',
    verified: 'Verified',
  };

  if (mapped[normalized]) {
    return mapped[normalized];
  }

  return normalized
    .split('_')
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
};

export const payrollGrossAmount = (record?: Partial<PayrollRecord> | null) =>
  Number(record?.basic_salary || 0) + Number(record?.allowances || 0) + Number(record?.bonus || 0);

export const payrollTotalDeductions = (record?: Partial<PayrollRecord> | null) =>
  Number(record?.deductions || 0) + Number(record?.tax || 0);

export const defaultPayrollMonth = () => new Date().toISOString().slice(0, 7);

export const adjustmentKindLabel = (kind: PayrollAdjustment['kind']) =>
  ({
    reimbursement: 'Reimbursement',
    bonus: 'Bonus',
    manual_deduction: 'Manual deduction',
    penalty: 'Penalty',
    one_time_adjustment: 'One-time adjustment',
  })[kind] || kind;

export const formatPayrollMonth = (value?: string | null) => {
  if (!value) return 'Current cycle';
  const normalized = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
  return new Date(`${normalized}T00:00:00`).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
};

export const maskBankAccount = (value?: string | null) => {
  if (!value) return 'Not available';
  const trimmed = value.replace(/\s+/g, '');
  if (trimmed.length <= 4) return trimmed;
  return `**** ${trimmed.slice(-4)}`;
};

export const salaryComponentCategoryLabel = (category?: SalaryComponentMaster['category'] | string) =>
  ({
    basic: 'Basic Pay',
    allowance: 'Allowance',
    overtime: 'Overtime',
    bonus: 'Bonus',
    reimbursement: 'Reimbursement',
    penalty: 'Penalty',
    tax: 'Tax',
    deduction: 'Deduction',
    other: 'Other',
  })[String(category) as SalaryComponentMaster['category']] || String(category || 'other');

export const salaryComponentCategoryGroup = (category?: SalaryComponentMaster['category'] | string) => {
  if (['basic', 'allowance', 'overtime', 'bonus', 'reimbursement', 'other'].includes(String(category))) {
    return 'earning';
  }
  return 'deduction';
};

export const salaryComponentValueTypeLabel = (valueType?: SalaryComponentMaster['value_type'] | string) =>
  ({
    fixed: 'Fixed amount',
    percentage: 'Percentage of basic',
  })[String(valueType) as SalaryComponentMaster['value_type']] || String(valueType || 'fixed');

export const sortTemplateComponents = <T extends { sort_order?: number | null; component?: { name?: string | null } | null }>(rows: T[]) =>
  [...rows].sort((left, right) => {
    const byOrder = Number(left.sort_order || 0) - Number(right.sort_order || 0);
    if (byOrder !== 0) return byOrder;
    return String(left.component?.name || '').localeCompare(String(right.component?.name || ''));
  });

export const calculateTemplatePreview = (rows: Array<SalaryTemplateComponentItem | (Partial<SalaryTemplateComponentItem> & { component?: SalaryComponentMaster | undefined })>) => {
  const summary = {
    basic_salary: 0,
    allowances: 0,
    bonus: 0,
    deductions: 0,
    tax: 0,
    net_salary: 0,
  };

  const sorted = sortTemplateComponents(rows);
  const basicRow = sorted.find((row) => row.component?.category === 'basic');
  summary.basic_salary = Number(basicRow?.value || basicRow?.component?.default_value || 0);

  sorted.forEach((row) => {
    if (!row.component || row.component.category === 'basic' || row.is_enabled === false) {
      return;
    }

    const rawValue = row.value_type === 'percentage'
      ? (summary.basic_salary * Number(row.value || 0)) / 100
      : Number(row.value ?? row.component.default_value ?? 0);
    const computed = Number.isFinite(rawValue) ? Number(rawValue) : 0;

    if (['allowance', 'overtime', 'reimbursement', 'other'].includes(row.component.category)) {
      summary.allowances += computed;
      return;
    }
    if (row.component.category === 'bonus') {
      summary.bonus += computed;
      return;
    }
    if (row.component.category === 'tax') {
      summary.tax += computed;
      return;
    }
    summary.deductions += computed;
  });

  summary.net_salary = summary.basic_salary + summary.allowances + summary.bonus - summary.deductions - summary.tax;
  return summary;
};

export const payrollCompensationSourceLabel = (source?: string | null) =>
  ({
    salary_template: 'Salary template',
    legacy_structure: 'Legacy structure',
    none: 'Not configured',
  })[String(source)] || 'Not configured';

export const templateAssignmentLabel = (template?: SalaryTemplate | null) => template?.name || 'Not assigned';
