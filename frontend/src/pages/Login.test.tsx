import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from '@/pages/Login';
import { renderWithProviders } from '@/test/renderWithProviders';

const loginMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    login: loginMock,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe('Login page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('submits credentials and navigates to dashboard on success', async () => {
    loginMock.mockResolvedValue(undefined);

    renderWithProviders(<Login />);

    fireEvent.change(screen.getByRole('textbox', { name: /email address/i }), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('admin@example.com', 'password123', { remember: false });
      expect(navigateMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('submits the live form values even when autofill does not trigger change events', async () => {
    loginMock.mockResolvedValue(undefined);

    renderWithProviders(<Login />);

    const emailInput = screen.getByRole('textbox', { name: /email address/i }) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    const emailSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

    emailSetter?.call(emailInput, ' Admin@Example.com ');
    emailSetter?.call(passwordInput, 'password123');

    fireEvent.submit(emailInput.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('Admin@Example.com', 'password123', { remember: false });
      expect(navigateMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('remembers the email address when remember me is selected', async () => {
    loginMock.mockResolvedValue(undefined);

    renderWithProviders(<Login />);

    fireEvent.change(screen.getByRole('textbox', { name: /email address/i }), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /remember me/i }));
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('admin@example.com', 'password123', { remember: true });
      expect(window.localStorage.getItem('carevance.rememberedEmail')).toBe('admin@example.com');
    });
  });

  it('shows the backend error message when login fails', async () => {
    loginMock.mockRejectedValue({
      response: { data: { message: 'Invalid credentials' } },
    });

    renderWithProviders(<Login />);

    fireEvent.change(screen.getByRole('textbox', { name: /email address/i }), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
  });
});
