import { describe, expect, it } from 'vitest';
import { defaultForm, type AddUserWizardForm } from '@/components/add-user/steps/types';
import {
  USER_FIELD_LIMITS,
  isValidPhone,
  maxDepartmentsFor,
  MIN_PASSWORD_LENGTH,
  maxJoiningDate,
  validateUserStep1,
} from './userRules';

const form = (overrides: Partial<AddUserWizardForm> = {}): AddUserWizardForm => ({
  ...defaultForm,
  firstName: 'Priya',
  email: 'priya@example.com',
  phone: '9876543210',
  designation: 'Data Analyst',
  departmentIds: [1],
  // Both became required on main: a temporary password is set at creation, and
  // the timezone field is starred in the UI.
  password: 'Temp-Pass-1234!',
  timezone: 'Asia/Kolkata',
  ...overrides,
});

describe('limits match the server', () => {
  /*
   * These are the numbers the browser is trusting. If a Laravel rule changes and
   * this file does not, the wizard starts accepting input the server rejects —
   * which is the failure QA hit. Each expectation names the rule it mirrors.
   */
  it('phone matches UserController::store max:64', () => {
    expect(USER_FIELD_LIMITS.phone).toBe(64);
  });

  it('employee code matches EmployeeWorkspaceController::updateWorkInfo max:80', () => {
    expect(USER_FIELD_LIMITS.employeeCode).toBe(80);
  });

  it('designation takes the tighter of the two endpoints', () => {
    // POST /users allows 255, PUT work-info allows 120, and the wizard sends to
    // both — so the browser must hold the client to 120.
    expect(USER_FIELD_LIMITS.designation).toBe(120);
  });

  it('email matches UserController::store max:255', () => {
    expect(USER_FIELD_LIMITS.email).toBe(255);
  });
});

describe('the inputs QA actually used', () => {
  it('rejects a phone number longer than the server accepts', () => {
    const errors = validateUserStep1(form({ phone: '9'.repeat(200) }));
    expect(errors.phone).toBe('Use 64 characters or fewer');
  });

  it('rejects an article pasted into employee code', () => {
    const errors = validateUserStep1(form({ employeeCode: 'Technology '.repeat(50) }));
    expect(errors.employeeCode).toBe('Use 80 characters or fewer');
  });

  it('rejects an article pasted into designation', () => {
    const errors = validateUserStep1(form({ designation: 'Technology '.repeat(50) }));
    expect(errors.designation).toBe('Use 120 characters or fewer');
  });

  it('rejects more than one department for an employee', () => {
    const errors = validateUserStep1(form({ role: 'employee', departmentIds: [1, 2] }));
    expect(errors.departmentIds).toContain('only one department');
  });

  it('allows more than one department for an admin', () => {
    // The server exempts admins, so the browser must too.
    const errors = validateUserStep1(form({ role: 'admin', departmentIds: [1, 2] }));
    expect(errors.departmentIds).toBeUndefined();
  });
});

describe('phone shape', () => {
  it('accepts ordinary Indian and international formats', () => {
    expect(isValidPhone('9876543210')).toBe(true);
    expect(isValidPhone('+91 98765 43210')).toBe(true);
    expect(isValidPhone('+1-555-123-4567')).toBe(true);
  });

  it('rejects too few digits', () => {
    expect(isValidPhone('12345')).toBe(false);
  });

  it('rejects a number past the server limit', () => {
    // The old regex had a floor of 10 and no ceiling at all, which is how a
    // 200-digit number reached the API.
    expect(isValidPhone('9'.repeat(65))).toBe(false);
  });

  it('rejects letters', () => {
    expect(isValidPhone('98765abcde')).toBe(false);
  });
});

describe('joining date', () => {
  it('accepts a future date, because pre-boarding is the normal path', () => {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const errors = validateUserStep1(
      form({ joiningDate: nextMonth.toISOString().split('T')[0] })
    );
    expect(errors.joiningDate).toBeUndefined();
  });

  it('accepts a past date', () => {
    const errors = validateUserStep1(form({ joiningDate: '2020-04-01' }));
    expect(errors.joiningDate).toBeUndefined();
  });

  it('flags a date far enough out to be a mistyped year', () => {
    const errors = validateUserStep1(form({ joiningDate: '2099-01-01' }));
    expect(errors.joiningDate).toContain('please check it');
  });

  it('offers a max date the input can enforce', () => {
    expect(maxJoiningDate(new Date('2026-08-11'))).toBe('2028-08-11');
  });
});

describe('required fields', () => {
  it('names each missing field', () => {
    const errors = validateUserStep1(
      form({
        firstName: '', email: '', phone: '', designation: '',
        departmentIds: [], password: '', timezone: '',
      })
    );
    expect(Object.keys(errors).sort()).toEqual(
      ['departmentIds', 'designation', 'email', 'firstName', 'password', 'phone', 'timezone'].sort()
    );
  });

  it('passes a well-formed form', () => {
    expect(validateUserStep1(form())).toEqual({});
  });

  it('rejects a malformed email', () => {
    expect(validateUserStep1(form({ email: 'not-an-email' })).email).toBe(
      'Enter a valid email address'
    );
  });
});

describe('password policy mirrors Password::defaults()', () => {
  /*
   * Production requires min(12) with letters, mixed case, numbers and symbols.
   * The browser holds to that even though dev only requires min(8): stricter
   * than the server is safe, looser means a password that works in staging is
   * refused in production.
   */
  it('requires the production minimum, not the dev one', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(validateUserStep1(form({ password: 'Short-1!' })).password).toContain('at least 12');
  });

  it('names what a long but weak password is missing', () => {
    expect(validateUserStep1(form({ password: 'aaaaaaaaaaaaaa' })).password)
      .toBe('Add an upper-case letter, a number, a symbol');
  });

  it('accepts a password meeting every requirement', () => {
    expect(validateUserStep1(form({ password: 'Temp-Pass-1234!' })).password).toBeUndefined();
  });

  it('requires a password at all', () => {
    expect(validateUserStep1(form({ password: '' })).password).toBe('Password is required');
  });
});

describe('department cap', () => {
  it('is one for employees and managers, unlimited for admins', () => {
    expect(maxDepartmentsFor('employee')).toBe(1);
    expect(maxDepartmentsFor('manager')).toBe(1);
    expect(maxDepartmentsFor('admin')).toBe(Infinity);
  });
});
