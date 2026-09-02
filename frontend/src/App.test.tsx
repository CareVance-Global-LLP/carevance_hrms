import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route, MemoryRouter, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';
import App from '@/App';
import { ConsentProvider } from '@/contexts/ConsentContext';
import { render } from '@testing-library/react';

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const;

/**
 * Render inside the providers the real app mounts.
 *
 * main.tsx wraps the whole tree in ConsentProvider, and anything reaching
 * AuthPageFooter calls useConsent — which throws without it. Rendering <App />
 * bare made those routes fail on a missing provider rather than on anything the
 * test was actually asserting.
 */
const renderApp = (initialEntry: string, ui: ReactNode = <App />) =>
  render(
    <ConsentProvider>
      <MemoryRouter future={routerFuture} initialEntries={[initialEntry]}>
        {ui}
      </MemoryRouter>
    </ConsentProvider>
  );

const authState = vi.hoisted(() => ({
  value: {
    isAuthenticated: false,
    isLoading: false,
    user: null,
  },
}));

/*
 * ProtectedRoute reads more than isAuthenticated: without an `organization` it
 * sends everyone to /signup-owner, and without a completed profile it sends
 * them to /onboarding/profile. The mock returned neither, so these tests were
 * asserting against a redirect chain rather than the routes they name. Defaults
 * go underneath the spread so an individual test can still override them.
 */
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => {
    const state = authState.value;

    if (!state.isAuthenticated) {
      return { ...state, organization: null, wasOfflineRestored: false };
    }

    return {
      wasOfflineRestored: false,
      organization: { id: 1, name: 'Test Org', owner_user_id: state.user?.id },
      ...state,
      user: state.user
        ? { settings: { profile_onboarding_completed: true }, ...state.user }
        : state.user,
    };
  },
}));

vi.mock('@/components/Layout', () => ({
  default: () => (
    <div>
      App Layout
      <Outlet />
    </div>
  ),
}));
vi.mock('@/pages/Login', () => ({ default: () => <div>Login Page</div> }));
vi.mock('@/pages/LandingPage', () => ({ default: () => <div>Landing Page</div> }));
vi.mock('@/pages/Dashboard', () => ({ default: () => <div>Dashboard Page</div> }));
vi.mock('@/pages/AdminDashboard', () => ({ default: () => <div>Admin Dashboard Page</div> }));
vi.mock('@/pages/DesktopTimerDashboard', () => ({ default: () => <div>Desktop Timer Page</div> }));
vi.mock('@/pages/Projects', () => ({ default: () => <div>Projects Page</div> }));
vi.mock('@/pages/Tasks', () => ({ default: () => <div>Tasks Page</div> }));
vi.mock('@/pages/ReportsWorkspace', () => ({
  default: ({ mode }: { mode: string }) => <div>Reports Workspace {mode}</div>,
}));
vi.mock('@/pages/Invoices', () => ({ default: () => <div>Invoices Page</div> }));
vi.mock('@/pages/Settings', () => ({ default: () => <div>Settings Page</div> }));
vi.mock('@/pages/Monitoring', () => ({ default: () => <div>Monitoring Page</div> }));
vi.mock('@/pages/Attendance', () => ({ default: () => <div>Attendance Page</div> }));
vi.mock('@/pages/Chat', () => ({ default: () => <div>Chat Page</div> }));
vi.mock('@/pages/AuditLogs', () => ({ default: () => <div>Audit Logs Page</div> }));

describe('App routes', () => {
  beforeEach(() => {
    authState.value = { isAuthenticated: false, isLoading: false, user: null };
    delete window.desktopTracker;
  });

  it('redirects unauthenticated users away from protected routes', async () => {
    renderApp('/dashboard');

    expect(await screen.findByText('Login Page')).toBeInTheDocument();
  });

  it('redirects non-admin users away from admin routes', async () => {
    authState.value = {
      isAuthenticated: true,
      isLoading: false,
      user: {
        id: 2,
        name: 'Employee',
        email: 'employee@example.com',
        role: 'employee',
        organization_id: 1,
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    };

    renderApp('/monitoring', <><Routes>
          <Route path="*" element={<App />} />
        </Routes></>);

    expect(await screen.findByText('App Layout')).toBeInTheDocument();
    expect(screen.queryByText('Monitoring Page')).not.toBeInTheDocument();
  });

  it('renders the dashboard page for employees on /dashboard', async () => {
    authState.value = {
      isAuthenticated: true,
      isLoading: false,
      user: {
        id: 2,
        name: 'Employee',
        email: 'employee@example.com',
        role: 'employee',
        organization_id: 1,
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    };

    renderApp('/dashboard', <><Routes>
          <Route path="*" element={<App />} />
        </Routes></>);

    expect(await screen.findByText('Dashboard Page')).toBeInTheDocument();
    expect(screen.queryByText('Reports Page')).not.toBeInTheDocument();
    expect(screen.queryByText('Desktop Timer Page')).not.toBeInTheDocument();
  });

  it('renders the time tracker page on /time-tracker', async () => {
    authState.value = {
      isAuthenticated: true,
      isLoading: false,
      user: {
        id: 2,
        name: 'Employee',
        email: 'employee@example.com',
        role: 'employee',
        organization_id: 1,
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    };

    renderApp('/time-tracker', <><Routes>
          <Route path="*" element={<App />} />
        </Routes></>);

    expect(await screen.findByText('Desktop Timer Page')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
  });

  it('keeps projects and tasks routes on separate pages', async () => {
    authState.value = {
      isAuthenticated: true,
      isLoading: false,
      user: {
        id: 2,
        name: 'Employee',
        email: 'employee@example.com',
        role: 'employee',
        organization_id: 1,
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    };

    const { unmount } = renderApp('/projects', <><Routes>
          <Route path="*" element={<App />} />
        </Routes></>);

    expect(await screen.findByText('Projects Page')).toBeInTheDocument();
    expect(screen.queryByText('Tasks Page')).not.toBeInTheDocument();
    unmount();

    renderApp('/tasks', <><Routes>
          <Route path="*" element={<App />} />
        </Routes></>);

    expect(await screen.findByText('Tasks Page')).toBeInTheDocument();
    expect(screen.queryByText('Projects Page')).not.toBeInTheDocument();
  });

  it('keeps reports and analytics on distinct admin hub routes', async () => {
    authState.value = {
      isAuthenticated: true,
      isLoading: false,
      user: {
        id: 1,
        name: 'Admin',
        email: 'admin@example.com',
        role: 'admin',
        organization_id: 1,
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    };

    const { unmount } = renderApp('/reports', <><Routes>
          <Route path="*" element={<App />} />
        </Routes></>);

    expect(await screen.findByText('Reports Workspace reports-hub')).toBeInTheDocument();
    expect(screen.queryByText('Reports Workspace analytics-hub')).not.toBeInTheDocument();
    unmount();

    renderApp('/analytics', <><Routes>
          <Route path="*" element={<App />} />
        </Routes></>);

    expect(await screen.findByText('Reports Workspace analytics-hub')).toBeInTheDocument();
    expect(screen.queryByText('Reports Workspace reports-hub')).not.toBeInTheDocument();
  });

  it('renders the admin dashboard for admins on /dashboard', async () => {
    authState.value = {
      isAuthenticated: true,
      isLoading: false,
      user: {
        id: 1,
        name: 'Admin',
        email: 'admin@example.com',
        role: 'admin',
        organization_id: 1,
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    };

    renderApp('/dashboard', <><Routes>
          <Route path="*" element={<App />} />
        </Routes></>);

    expect(await screen.findByText('Admin Dashboard Page')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
  });

  it('redirects desktop shell launches from / to the login page when unauthenticated', async () => {
    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
    };

    renderApp('/', <><Routes>
          <Route path="*" element={<App />} />
        </Routes></>);

    expect(await screen.findByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Landing Page')).not.toBeInTheDocument();
  });

  it('redirects authenticated desktop shell launches from / to the timer dashboard', async () => {
    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
    };
    authState.value = {
      isAuthenticated: true,
      isLoading: false,
      user: {
        id: 2,
        name: 'Employee',
        email: 'employee@example.com',
        role: 'employee',
        organization_id: 1,
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    };

    renderApp('/', <><Routes>
          <Route path="*" element={<App />} />
        </Routes></>);

    expect(await screen.findByText('Desktop Timer Page')).toBeInTheDocument();
    expect(screen.queryByText('Landing Page')).not.toBeInTheDocument();
  });
});
