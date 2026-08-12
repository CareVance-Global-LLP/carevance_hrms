import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Step1BasicInfo } from './Step1BasicInfo';
import { defaultForm, type AddUserWizardForm } from './types';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: { exists: false, incomplete: false } }) },
  payrollApi: {
    getPayGroups: vi.fn().mockResolvedValue({ data: { pay_groups: [] } }),
    getSalaryStructures: vi.fn().mockResolvedValue({ data: { data: [] } }),
  },
  groupApi: { getAll: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}));

/** The step drives its own form state, so the harness owns it the way the wizard does. */
function Harness() {
  const [form, setForm] = useState<AddUserWizardForm>({ ...defaultForm });
  const [errors, setErrors] = useState({});
  return (
    <Step1BasicInfo
      form={form}
      setForm={setForm}
      errors={errors}
      setErrors={setErrors}
      incompleteUser={null}
      setIncompleteUser={vi.fn()}
    />
  );
}

describe('Step 1 — name fields', () => {
  it('offers first, middle and last name, each bound to its label', () => {
    renderWithProviders(<Harness />);

    // getByLabelText only resolves when htmlFor/id are wired, so this also
    // covers the association Chrome's audit flagged across this form.
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/middle name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
  });

  it('marks the middle name optional rather than required', () => {
    renderWithProviders(<Harness />);

    const middle = screen.getByLabelText(/middle name/i);
    expect(middle).not.toBeRequired();
    // Plenty of people do not have one, and the PAN card is the reason it
    // exists at all — so the placeholder says where the value comes from.
    expect(middle).toHaveAttribute('placeholder', expect.stringMatching(/pan/i));
  });
});

describe('Step 1 — password requirements', () => {
  const typePassword = (value: string) =>
    fireEvent.change(screen.getByLabelText(/temporary password/i), { target: { value } });

  it('shows nothing until something is typed', () => {
    renderWithProviders(<Harness />);
    expect(screen.queryByLabelText('Password requirements')).not.toBeInTheDocument();
  });

  it('separates the blocking floor from the production-only rules', () => {
    renderWithProviders(<Harness />);
    typePassword('Short-1!'); // 8 chars: clears the floor, misses production

    const list = screen.getByLabelText('Password requirements');
    expect(list).toHaveTextContent('✓ 8+ characters');
    expect(list).toHaveTextContent('○ 12+ for production');
  });

  it('marks every requirement met for a production-grade password', () => {
    renderWithProviders(<Harness />);
    typePassword('Temp-Pass-1234!');

    const list = screen.getByLabelText('Password requirements');
    expect(list).toHaveTextContent('✓ 12+ for production');
    expect(list.textContent).not.toContain('○');
  });

  it('flags the floor itself when the password is too short for any environment', () => {
    renderWithProviders(<Harness />);
    typePassword('Shor-1!'); // 7 chars

    expect(screen.getByLabelText('Password requirements')).toHaveTextContent('○ 8+ characters');
  });
});
