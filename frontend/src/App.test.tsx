import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route, MemoryRouter, Outlet } from 'react-router-dom';
import App from '@/App';
import { render } from '@testing-library/react';

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const;

const authState = vi.hoisted(() => ({
  value: {
    isAuthenticated: false,
    isLoading: false,
    user: null,
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState.value,
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
vi.mock('@/pages/Register', () => ({ default: () => <div>Register Page</div> }));
vi.mock('@/pages/LandingPage', () => ({ default: () => <div>Landing Page</div> }));
vi.mock('@/pages/Dashboard', () => ({ default: () => <div>Dashboard Page</div> }));
vi.mock('@/pages/AdminDashboard', () => ({ default: () => <div>Admin Dashboard Page</div> }));
vi.mock('@/pages/DesktopTimerDashboard', () => ({ default: () => <div>Desktop Timer Page</div> }));
vi.mock('@/pages/Projects', () => ({ default: () => <div>Projects Page</div> }));
vi.mock('@/pages/Tasks', () => ({ default: () => <div>Tasks Page</div> }));
vi.mock('@/pages/Reports', () => ({ default: () => <div>Reports Page</div> }));
vi.mock('@/pages/Invoices', () => ({ default: () => <div>Invoices Page</div> }));
vi.mock('@/pages/Settings', () => ({ default: () => <div>Settings Page</div> }));
vi.mock('@/pages/Monitoring', () => ({ default: () => <div>Monitoring Page</div> }));
vi.mock('@/pages/Attendance', () => ({ default: () => <div>Attendance Page</div> }));
vi.mock('@/pages/Chat', () => ({ default: () => <div>Chat Page</div> }));
vi.mock('@/pages/Payroll', () => ({ default: () => <div>Payroll Page</div> }));
vi.mock('@/pages/UserManagement', () => ({ default: () => <div>User Management Page</div> }));
vi.mock('@/pages/AuditLogs', () => ({ default: () => <div>Audit Logs Page</div> }));

describe('App routes', () => {
  beforeEach(() => {
    authState.value = { isAuthenticated: false, isLoading: false, user: null };
    delete window.desktopTracker;
  });

  it('redirects unauthenticated users away from protected routes', async () => {
    render(
      <MemoryRouter future={routerFuture} initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>
    );

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

    render(
      <MemoryRouter future={routerFuture} initialEntries={['/monitoring']}>
        <Routes>
          <Route path="*" element={<App />} />
        </Routes>
      </MemoryRouter>
    );

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

    render(
      <MemoryRouter future={routerFuture} initialEntries={['/dashboard']}>
        <Routes>
          <Route path="*" element={<App />} />
        </Routes>
      </MemoryRouter>
    );

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

    render(
      <MemoryRouter future={routerFuture} initialEntries={['/time-tracker']}>
        <Routes>
          <Route path="*" element={<App />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Desktop Timer Page')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
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

    render(
      <MemoryRouter future={routerFuture} initialEntries={['/dashboard']}>
        <Routes>
          <Route path="*" element={<App />} />
        </Routes>
      </MemoryRouter>
    );

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

    render(
      <MemoryRouter future={routerFuture} initialEntries={['/']}>
        <Routes>
          <Route path="*" element={<App />} />
        </Routes>
      </MemoryRouter>
    );

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

    render(
      <MemoryRouter future={routerFuture} initialEntries={['/']}>
        <Routes>
          <Route path="*" element={<App />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Desktop Timer Page')).toBeInTheDocument();
    expect(screen.queryByText('Landing Page')).not.toBeInTheDocument();
  });
});
