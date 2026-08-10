import { describe, expect, it } from 'vitest';
import {
  PROFILE_FIELDS,
  groupMissing,
  profileCompleteness,
} from '@/lib/employeeProfileFields';

const complete = {
  employee_profile: {
    first_name: 'Priya',
    last_name: 'Shah',
    gender: 'female',
    date_of_birth: '1994-04-02',
    phone: '9000000000',
    personal_email: 'priya@personal.com',
    address_line: '12 Residency Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    postal_code: '560025',
    emergency_contact_name: 'Anil Shah',
    emergency_contact_number: '9000000001',
    emergency_contact_relationship: 'Father',
  },
  employee_work_info: {
    employee_code: 'EMP-0001',
    designation: 'Backend Engineer',
    joining_date: '2026-01-05',
    work_location: 'Bengaluru',
  },
  government_ids: [{ id_type: 'PAN', id_number: 'ABCDE1234F' }],
  bank_accounts: [{ id: 1 }],
};

describe('employee profile registry', () => {
  it('treats a fully populated record as complete', () => {
    const result = profileCompleteness(complete);

    expect(result.isComplete).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.percentage).toBe(100);
    expect(result.filled).toBe(PROFILE_FIELDS.length);
  });

  it('counts more than bank and PAN, which is what the old check missed', () => {
    // Bank and PAN present, everything else absent. The previous two-field rule
    // called this complete.
    const result = profileCompleteness({
      government_ids: [{ id_type: 'PAN', id_number: 'ABCDE1234F' }],
      bank_accounts: [{ id: 1 }],
    });

    expect(result.isComplete).toBe(false);
    expect(result.missing.length).toBeGreaterThan(10);
    expect(result.missing.map((field) => field.key)).not.toContain('pan');
    expect(result.missing.map((field) => field.key)).not.toContain('bank_account');
  });

  it('reads profile details under either casing the API might return', () => {
    const camel = profileCompleteness({ employeeProfile: { first_name: 'Ada' } });
    const snake = profileCompleteness({ employee_profile: { first_name: 'Ada' } });

    expect(camel.filled).toBe(1);
    expect(snake.filled).toBe(1);
  });

  it('does not hold a joiner responsible for fields only HR can supply', () => {
    const employeeScope = profileCompleteness(
      { employee_profile: complete.employee_profile, government_ids: complete.government_ids, bank_accounts: complete.bank_accounts },
      { owner: 'employee' }
    );

    // Employee code, designation, joining date and work location are all absent
    // here, but they belong to HR — the joiner is done.
    expect(employeeScope.isComplete).toBe(true);
    expect(employeeScope.missing).toHaveLength(0);
  });

  it('separates out what payroll specifically cannot run without', () => {
    const result = profileCompleteness({ employee_profile: { first_name: 'Ada' } });
    const payrollKeys = result.missingForPayroll.map((field) => field.key).sort();

    expect(payrollKeys).toEqual(['bank_account', 'date_of_birth', 'joining_date', 'pan']);
  });

  it('treats blank strings and empty arrays as missing', () => {
    const result = profileCompleteness({
      employee_profile: { first_name: '   ', last_name: '' },
      bank_accounts: [],
    });

    const missingKeys = result.missing.map((field) => field.key);
    expect(missingKeys).toContain('first_name');
    expect(missingKeys).toContain('last_name');
    expect(missingKeys).toContain('bank_account');
  });

  it('groups what is missing in a stable, renderable order', () => {
    const grouped = groupMissing(profileCompleteness({}).missing);

    expect(grouped.map((entry) => entry.group)).toEqual([
      'identity',
      'contact',
      'address',
      'emergency',
      'employment',
      'statutory',
    ]);
  });

  it('scopes payroll-only completeness to the four fields that matter', () => {
    const result = profileCompleteness(complete, { payrollOnly: true });

    expect(result.total).toBe(4);
    expect(result.isComplete).toBe(true);
  });
});
