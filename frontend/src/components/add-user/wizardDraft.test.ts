import { describe, it, expect, beforeEach } from 'vitest';
import {
  WIZARD_DRAFT_KEY,
  clearWizardDraft,
  hasMeaningfulInput,
  loadWizardDraft,
  restoreDraft,
  saveWizardDraft,
} from './wizardDraft';
import { defaultForm, type AddUserWizardForm } from './steps/types';

const filledForm = (overrides: Partial<AddUserWizardForm> = {}): AddUserWizardForm => ({
  ...defaultForm,
  firstName: 'Riya',
  lastName: 'Sharma',
  email: 'riya@example.test',
  password: 'TempPass12345',
  phone: '+91 90000 11122',
  designation: 'QA Engineer',
  employeeCode: 'EMP-QA-01',
  departmentIds: [3],
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
});

describe('saveWizardDraft', () => {
  it('never writes the password to storage', () => {
    saveWizardDraft({ step: 2, form: filledForm(), completedSteps: [1] });

    const raw = localStorage.getItem(WIZARD_DRAFT_KEY) ?? '';

    expect(raw).not.toContain('TempPass12345');
    expect(JSON.parse(raw).form).not.toHaveProperty('password');
  });

  it('drops File fields, which JSON turns into a truthy empty object', () => {
    const form = filledForm({
      resumeFile: new File(['cv'], 'cv.pdf'),
      bankProofFile: new File(['x'], 'passbook.pdf'),
    });

    saveWizardDraft({ step: 1, form, completedSteps: [] });

    const stored = JSON.parse(localStorage.getItem(WIZARD_DRAFT_KEY) ?? '{}');
    expect(stored.form).not.toHaveProperty('resumeFile');
    expect(stored.form).not.toHaveProperty('bankProofFile');
  });

  it('round-trips the fields an admin actually typed', () => {
    saveWizardDraft({ step: 1, form: filledForm(), completedSteps: [] });

    const draft = loadWizardDraft();

    expect(draft?.form).toMatchObject({
      firstName: 'Riya',
      email: 'riya@example.test',
      designation: 'QA Engineer',
      departmentIds: [3],
    });
  });

  it('keeps userId, so a refresh after creation can resume into the account', () => {
    saveWizardDraft({ step: 3, form: filledForm({ userId: 412 }), completedSteps: [1, 2] });

    expect(loadWizardDraft()?.form.userId).toBe(412);
  });
});

describe('loadWizardDraft', () => {
  it('drops a draft older than 24 hours', () => {
    saveWizardDraft({ step: 1, form: filledForm(), completedSteps: [] });

    const stored = JSON.parse(localStorage.getItem(WIZARD_DRAFT_KEY) ?? '{}');
    stored.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify(stored));

    expect(loadWizardDraft()).toBeNull();
    expect(localStorage.getItem(WIZARD_DRAFT_KEY)).toBeNull();
  });

  it('keeps a draft saved within the window', () => {
    saveWizardDraft({ step: 1, form: filledForm(), completedSteps: [] });
    expect(loadWizardDraft()).not.toBeNull();
  });

  it('discards corrupt JSON instead of throwing', () => {
    localStorage.setItem(WIZARD_DRAFT_KEY, '{not json');

    expect(loadWizardDraft()).toBeNull();
    expect(localStorage.getItem(WIZARD_DRAFT_KEY)).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(loadWizardDraft()).toBeNull();
  });
});

describe('restoreDraft', () => {
  it('rewinds to step 1 when the account does not exist yet', () => {
    // The password is never stored, and POST /users enforces min:8 — resuming
    // straight onto step 2 would walk into a 422 the admin cannot see coming.
    saveWizardDraft({ step: 2, form: filledForm(), completedSteps: [1] });

    const restored = restoreDraft(loadWizardDraft());

    expect(restored?.step).toBe(1);
    expect(restored?.needsPasswordReentry).toBe(true);
    expect(restored?.form.password).toBe('');
    expect(restored?.form.email).toBe('riya@example.test');
  });

  it('resumes at the saved step once the account exists', () => {
    saveWizardDraft({ step: 3, form: filledForm({ userId: 412 }), completedSteps: [1, 2] });

    const restored = restoreDraft(loadWizardDraft());

    expect(restored?.step).toBe(3);
    expect(restored?.completedSteps).toEqual([1, 2]);
    expect(restored?.needsPasswordReentry).toBe(false);
    expect(restored?.passwordUnavailable).toBe(true);
  });

  it('fills unsaved fields from the defaults', () => {
    saveWizardDraft({ step: 1, form: filledForm(), completedSteps: [] });

    const restored = restoreDraft(loadWizardDraft());

    expect(restored?.form.workLocation).toBe(defaultForm.workLocation);
    expect(restored?.form.accountType).toBe(defaultForm.accountType);
  });

  it('returns null for no draft', () => {
    expect(restoreDraft(null)).toBeNull();
  });
});

describe('hasMeaningfulInput', () => {
  it('is false for a form the admin has only looked at', () => {
    expect(hasMeaningfulInput({ ...defaultForm })).toBe(false);
  });

  it('is false when only the auto-populated defaults are set', () => {
    // Mounting pre-selects a salary structure and stamps today's joining date,
    // so "differs from defaultForm" is not the same as "the admin typed".
    expect(hasMeaningfulInput({ ...defaultForm, salaryStructureId: 1 })).toBe(false);
  });

  it('is true once any identifying field is filled', () => {
    expect(hasMeaningfulInput({ ...defaultForm, firstName: 'Riya' })).toBe(true);
    expect(hasMeaningfulInput({ ...defaultForm, email: 'r@example.test' })).toBe(true);
    expect(hasMeaningfulInput({ ...defaultForm, departmentIds: [1] })).toBe(true);
  });

  it('is true when an account was created, even with an otherwise empty form', () => {
    expect(hasMeaningfulInput({ ...defaultForm, userId: 412 })).toBe(true);
  });
});

describe('clearWizardDraft', () => {
  it('removes the stored draft', () => {
    saveWizardDraft({ step: 1, form: filledForm(), completedSteps: [] });
    clearWizardDraft();

    expect(localStorage.getItem(WIZARD_DRAFT_KEY)).toBeNull();
  });
});
