import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from '@/pages/Login';
import { renderWithProviders } from '@/test/renderWithProviders';

const loginMock = vi.fn();
const completeMfaChallengeMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    login: loginMock,
    completeMfaChallenge: completeMfaChallengeMock,
  }),
}));

vi.mock('@/services/api', () => ({
  authApi: {
    checkEmail: vi.fn().mockResolvedValue({ data: { exists: true } }),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

/**
 * Signing in when the account has a second factor.
 *
 * The load-bearing property: a correct password that returns no token must
 * hand over to the code step, not read as a failed login. Without that branch
 * anyone who enrolled in two-factor could never sign in again.
 */
describe('Login page — two-factor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  const submitPassword = async () => {
    renderWithProviders(<Login />);

    fireEvent.change(screen.getByRole('textbox', { name: /email address/i }), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
  };

  it('shows the code step instead of navigating when a second factor is required', async () => {
    loginMock.mockResolvedValue({ mfaRequired: true, challenge: 'chal-123' });

    await submitPassword();

    await waitFor(() => {
      expect(screen.getByLabelText(/authentication code/i)).toBeInTheDocument();
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('does not treat a missing token as a failed login', async () => {
    loginMock.mockResolvedValue({ mfaRequired: true, challenge: 'chal-123' });

    await submitPassword();

    await waitFor(() => {
      expect(screen.getByLabelText(/authentication code/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/invalid email or password/i)).not.toBeInTheDocument();
  });

  it('exchanges the code for a session and navigates', async () => {
    loginMock.mockResolvedValue({ mfaRequired: true, challenge: 'chal-123' });
    completeMfaChallengeMock.mockResolvedValue(undefined);

    await submitPassword();

    const codeInput = await screen.findByLabelText(/authentication code/i);
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    await waitFor(() => {
      expect(completeMfaChallengeMock).toHaveBeenCalledWith('chal-123', '123456');
      expect(navigateMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  /**
   * The accessibility decision, pinned. Six separate boxes break SMS and
   * password-manager autofill, screen-reader navigation, undo and paste.
   */
  it('uses a single accessible input rather than one box per digit', async () => {
    loginMock.mockResolvedValue({ mfaRequired: true, challenge: 'chal-123' });

    await submitPassword();

    const codeInput = (await screen.findByLabelText(/authentication code/i)) as HTMLInputElement;

    expect(codeInput.getAttribute('autocomplete')).toBe('one-time-code');
    expect(codeInput.getAttribute('inputmode')).toBe('numeric');
    expect(codeInput.maxLength).toBe(6);
  });

  it('accepts a pasted code and strips anything that could not be part of one', async () => {
    loginMock.mockResolvedValue({ mfaRequired: true, challenge: 'chal-123' });

    await submitPassword();

    const codeInput = (await screen.findByLabelText(/authentication code/i)) as HTMLInputElement;

    // A code copied out of an app, with the spacing it usually carries.
    fireEvent.change(codeInput, { target: { value: '123 456' } });

    expect(codeInput.value).toBe('123456');
  });

  it('offers a recovery code for someone locked out of their phone', async () => {
    loginMock.mockResolvedValue({ mfaRequired: true, challenge: 'chal-123' });
    completeMfaChallengeMock.mockResolvedValue(undefined);

    await submitPassword();

    fireEvent.click(await screen.findByRole('button', { name: /can't reach my authenticator/i }));

    const recoveryInput = (await screen.findByLabelText(/recovery code/i)) as HTMLInputElement;
    fireEvent.change(recoveryInput, { target: { value: 'abcde-12345' } });

    expect(recoveryInput.value).toBe('ABCDE-12345');

    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    await waitFor(() => {
      expect(completeMfaChallengeMock).toHaveBeenCalledWith('chal-123', 'ABCDE-12345');
    });
  });

  it('keeps the user on the code step when the code is wrong', async () => {
    loginMock.mockResolvedValue({ mfaRequired: true, challenge: 'chal-123' });
    completeMfaChallengeMock.mockRejectedValue({
      response: { data: { error_code: 'MFA_CODE_INVALID', message: 'That code is not correct.' } },
    });

    await submitPassword();

    const codeInput = await screen.findByLabelText(/authentication code/i);
    fireEvent.change(codeInput, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/that code is not correct/i)).toBeInTheDocument();
    });

    // A mistyped digit must not throw away an accepted password.
    expect(screen.getByLabelText(/authentication code/i)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  /**
   * An expired challenge has nothing left to retry against, so leaving the
   * user typing codes into it is a dead end.
   */
  it('returns to the password form when the challenge has expired', async () => {
    loginMock.mockResolvedValue({ mfaRequired: true, challenge: 'chal-123' });
    completeMfaChallengeMock.mockRejectedValue({
      response: { data: { error_code: 'MFA_CHALLENGE_EXPIRED' } },
    });

    await submitPassword();

    const codeInput = await screen.findByLabelText(/authentication code/i);
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/timed out/i)).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });

  it('still signs in normally when no second factor is enrolled', async () => {
    loginMock.mockResolvedValue({ mfaRequired: false });

    await submitPassword();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/dashboard');
    });

    expect(screen.queryByLabelText(/authentication code/i)).not.toBeInTheDocument();
  });
});
