import { waitFor, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { isAutoStartArmed } from '@/lib/desktopTimerSession';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { renderWithProviders } from '@/test/renderWithProviders';
import { authApi, timeEntryApi } from '@/services/api';

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
    },
    timeEntryApi: {
      ...actual.timeEntryApi,
      stop: vi.fn(),
    },
  };
});

function AuthProbe() {
  const { isLoading, isAuthenticated, user, login, logout } = useAuth();

  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="user-email">{user?.email || ''}</span>
      <button type="button" onClick={() => void login('employee@example.com', 'password123')}>
        Login
      </button>
      <button type="button" onClick={() => void logout()}>
        Logout
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    delete window.desktopTracker;
    vi.clearAllMocks();
  });

  it('restores auth from session storage and refreshes the user profile', async () => {
    sessionStorage.setItem('token', 'stored-token');
    sessionStorage.setItem('user', JSON.stringify({
      id: 1,
      name: 'Stored User',
      email: 'stored@example.com',
      role: 'admin',
      organization_id: 1,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    vi.mocked(authApi.me).mockResolvedValue({
      data: {
        success: true,
        id: 1,
        name: 'Fresh User',
        email: 'fresh@example.com',
        role: 'admin',
        organization_id: 1,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    } as any);

    renderWithProviders(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      expect(screen.getByTestId('user-email')).toHaveTextContent('fresh@example.com');
    });
  });

  it('does not arm auto-start on employee login in the browser and stops the timer on logout', async () => {
    const user = userEvent.setup();

    vi.mocked(authApi.login).mockResolvedValue({
      data: {
        token: 'employee-token',
        user: {
          id: 7,
          name: 'Employee User',
          email: 'employee@example.com',
          role: 'employee',
          organization_id: 2,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        organization: null,
      },
    } as any);
    vi.mocked(authApi.logout).mockResolvedValue({ data: { success: true } } as any);
    vi.mocked(timeEntryApi.stop).mockResolvedValue({ data: null } as any);

    renderWithProviders(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await user.click(await screen.findByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });
    expect(isAutoStartArmed(7)).toBe(false);

    await user.click(screen.getByRole('button', { name: /logout/i }));

    await waitFor(() => {
      expect(timeEntryApi.stop).toHaveBeenCalledWith({ timer_slot: 'primary' });
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    });
  });

  it('arms auto-start on employee login in the desktop shell', async () => {
    const user = userEvent.setup();

    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
    };

    vi.mocked(authApi.login).mockResolvedValue({
      data: {
        token: 'employee-token',
        user: {
          id: 7,
          name: 'Employee User',
          email: 'employee@example.com',
          role: 'employee',
          organization_id: 2,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        organization: null,
      },
    } as any);

    renderWithProviders(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await user.click(await screen.findByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    expect(isAutoStartArmed(7)).toBe(true);
  });

  it('restores desktop auth from local storage and keeps it out of session storage', async () => {
    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
    };

    localStorage.setItem('token', 'desktop-token');
    localStorage.setItem('user', JSON.stringify({
      id: 9,
      name: 'Desktop User',
      email: 'desktop@example.com',
      role: 'employee',
      organization_id: 3,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    vi.mocked(authApi.me).mockResolvedValue({
      data: {
        success: true,
        id: 9,
        name: 'Desktop User',
        email: 'desktop@example.com',
        role: 'employee',
        organization_id: 3,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    } as any);

    renderWithProviders(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      expect(screen.getByTestId('user-email')).toHaveTextContent('desktop@example.com');
    });

    expect(localStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
  });

  it('stops the employee timer before the desktop shell closes', async () => {
    let prepareForCloseHandler: (() => void | Promise<void>) | null = null;
    const confirmCloseReady = vi.fn().mockResolvedValue(true);

    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
      onPrepareForClose: (callback) => {
        prepareForCloseHandler = callback;
      },
      clearPrepareForCloseListeners: vi.fn(),
      confirmCloseReady,
    };

    localStorage.setItem('token', 'desktop-token');
    localStorage.setItem('user', JSON.stringify({
      id: 7,
      name: 'Desktop Employee',
      email: 'employee@example.com',
      role: 'employee',
      organization_id: 2,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    vi.mocked(authApi.me).mockResolvedValue({
      data: {
        success: true,
        id: 7,
        name: 'Desktop Employee',
        email: 'employee@example.com',
        role: 'employee',
        organization_id: 2,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    } as any);
    vi.mocked(authApi.logout).mockResolvedValue({ data: { success: true } } as any);
    vi.mocked(timeEntryApi.stop).mockResolvedValue({ data: null } as any);

    renderWithProviders(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    await prepareForCloseHandler?.();

    expect(timeEntryApi.stop).toHaveBeenCalledWith({ timer_slot: 'primary' });
    expect(authApi.logout).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    });
    expect(confirmCloseReady).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('token')).toBeNull();
  });
});
