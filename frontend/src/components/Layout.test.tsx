import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from '@/components/Layout';
import { renderWithProviders } from '@/test/renderWithProviders';

const authState = vi.hoisted(() => ({
  value: {
    user: null,
    logout: vi.fn(),
    token: 'test-token',
  },
}));

const apiMocks = vi.hoisted(() => ({
  getUnreadSummary: vi.fn().mockResolvedValue({ data: { unread_messages: 0, unread_conversations: 0, unread_senders: 0 } }),
  leaveList: vi.fn().mockResolvedValue({ data: { data: [] } }),
  attendanceTimeEditList: vi.fn().mockResolvedValue({ data: { data: [] } }),
  notificationList: vi.fn().mockResolvedValue({ data: { data: [], unread_count: 0 } }),
  markAllRead: vi.fn().mockResolvedValue({}),
  markRead: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState.value,
}));

vi.mock('@/hooks/useDesktopTracker', () => ({
  useDesktopTracker: () => undefined,
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    chatApi: { getUnreadSummary: apiMocks.getUnreadSummary },
    leaveApi: { list: apiMocks.leaveList },
    attendanceTimeEditApi: { list: apiMocks.attendanceTimeEditList },
    notificationApi: {
      list: apiMocks.notificationList,
      markAllRead: apiMocks.markAllRead,
      markRead: apiMocks.markRead,
    },
  };
});

describe('Layout navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete window.desktopTracker;
    window.localStorage.clear();
    apiMocks.getUnreadSummary.mockResolvedValue({ data: { unread_messages: 0, unread_conversations: 0, unread_senders: 0 } });
    apiMocks.leaveList.mockResolvedValue({ data: { data: [] } });
    apiMocks.attendanceTimeEditList.mockResolvedValue({ data: { data: [] } });
    apiMocks.notificationList.mockResolvedValue({ data: { data: [], unread_count: 0 } });
    apiMocks.markAllRead.mockResolvedValue({});
    apiMocks.markRead.mockResolvedValue({});
    authState.value = {
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
      logout: vi.fn(),
      token: 'test-token',
    };
  });

  it('shows admin-only navigation items for admins', async () => {
    renderWithProviders(<Layout />, { route: '/dashboard' });

    expect((await screen.findAllByText('Reports')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Payroll').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tasks').length).toBeGreaterThan(0);
    expect(screen.queryByText('Add Employee')).not.toBeInTheDocument();

    expect(await screen.findByText('Employees')).toBeInTheDocument();
    expect(screen.getByText('Leave')).toBeInTheDocument();
    expect(screen.getByText('Audit Logs')).toBeInTheDocument();
  });

  it('highlights only the selected settings subpage', async () => {
    renderWithProviders(<Layout />, { route: '/settings/integrations' });

    const integrationLinks = await screen.findAllByRole('link', { name: /^integrations$/i });
    const settingsLinks = screen.getAllByRole('link', { name: /^settings$/i });
    const customFieldLinks = screen.getAllByRole('link', { name: /^custom fields$/i });

    expect(integrationLinks.some((link) => link.className.includes('bg-blue-600'))).toBe(true);
    expect(settingsLinks.some((link) => link.className.includes('bg-blue-600'))).toBe(false);
    expect(customFieldLinks.some((link) => link.className.includes('bg-blue-600'))).toBe(false);
  });

  it('keeps projects and tasks navigation states separate', async () => {
    renderWithProviders(<Layout />, { route: '/projects' });

    const projectLinks = await screen.findAllByRole('link', { name: /^projects$/i });
    const taskLinks = screen.getAllByRole('link', { name: /^tasks$/i });

    expect(projectLinks.some((link) => link.className.includes('bg-blue-600'))).toBe(true);
    expect(taskLinks.some((link) => link.className.includes('bg-blue-600'))).toBe(false);
  });

  it('highlights departments without also highlighting employees', async () => {
    renderWithProviders(<Layout />, { route: '/employees/teams' });

    const employeeLinks = await screen.findAllByRole('link', { name: /^employees$/i });
    const departmentLinks = screen.getAllByRole('link', { name: /^departments$/i });

    expect(departmentLinks.some((link) => link.className.includes('bg-blue-600'))).toBe(true);
    expect(employeeLinks.some((link) => link.className.includes('bg-blue-600'))).toBe(false);
  });

  it('shows contextual report links in attendance and payroll sections', async () => {
    renderWithProviders(<Layout />, { route: '/dashboard' });

    expect(await screen.findByRole('link', { name: /^attendance report$/i })).toHaveAttribute('href', '/reports/attendance');
    expect(screen.getByRole('link', { name: /^payroll report$/i })).toHaveAttribute('href', '/payroll/reports');
  });

  it('does not highlight the generic reports link when attendance report is active', async () => {
    renderWithProviders(<Layout />, { route: '/reports/attendance' });

    const attendanceReportLink = await screen.findByRole('link', { name: /^attendance report$/i });
    const genericReportLinks = screen.getAllByRole('link', { name: /^reports$/i });

    expect(attendanceReportLink.className).toContain('bg-blue-600');
    expect(genericReportLinks.some((link) => link.className.includes('bg-blue-600'))).toBe(false);
  });

  it('hides admin-only navigation items for employees', async () => {
    authState.value = {
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
      logout: vi.fn(),
      token: 'test-token',
    };

    renderWithProviders(<Layout />, { route: '/dashboard' });

    expect((await screen.findAllByText('Attendance')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Attendance').length).toBeGreaterThan(0);
    expect(screen.queryByText('Reports')).not.toBeInTheDocument();
    expect(screen.queryByText('Payroll')).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /employee/i }));

    expect(await screen.findByText('Settings')).toBeInTheDocument();
    expect(screen.queryByText('Employees')).not.toBeInTheDocument();
    expect(screen.queryByText('Approval Inbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Audit Logs')).not.toBeInTheDocument();
  });

  it('hides edit time navigation when employee time edits are disabled', async () => {
    authState.value = {
      user: {
        id: 2,
        name: 'Employee',
        email: 'employee@example.com',
        role: 'employee',
        organization_id: 1,
        is_active: true,
        settings: {
          can_edit_time: false,
        },
        created_at: '',
        updated_at: '',
      },
      logout: vi.fn(),
      token: 'test-token',
    };

    renderWithProviders(<Layout />, { route: '/dashboard' });

    expect(await screen.findByRole('link', { name: /attendance/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /attendance/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Edit Time')).not.toBeInTheDocument();
  });

  it('hides edit time navigation in desktop shell when employee time edits are disabled', async () => {
    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
      getUpdateState: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn(),
      onUpdateState: vi.fn(),
      clearUpdateStateListeners: vi.fn(),
    };
    authState.value = {
      user: {
        id: 2,
        name: 'Employee',
        email: 'employee@example.com',
        role: 'employee',
        organization_id: 1,
        is_active: true,
        settings: {
          can_edit_time: false,
        },
        created_at: '',
        updated_at: '',
      },
      logout: vi.fn(),
      token: 'test-token',
    };

    renderWithProviders(<Layout />, { route: '/dashboard' });

    expect(await screen.findByRole('link', { name: /attendance/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /attendance/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Edit Time')).not.toBeInTheDocument();
  });

  it('hides attendance overview but keeps edit time when only attendance monitoring is disabled', async () => {
    authState.value = {
      user: {
        id: 2,
        name: 'Employee',
        email: 'employee@example.com',
        role: 'employee',
        organization_id: 1,
        is_active: true,
        settings: {
          attendance_monitoring: false,
          can_edit_time: true,
        },
        created_at: '',
        updated_at: '',
      },
      logout: vi.fn(),
      token: 'test-token',
    };

    renderWithProviders(<Layout />, { route: '/dashboard' });

    expect(await screen.findByRole('link', { name: /overtime/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /attendance/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Attendance Overview')).not.toBeInTheDocument();
  });

  it('hides attendance overview but keeps edit time in desktop shell when only attendance monitoring is disabled', async () => {
    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
      getUpdateState: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn(),
      onUpdateState: vi.fn(),
      clearUpdateStateListeners: vi.fn(),
    };
    authState.value = {
      user: {
        id: 2,
        name: 'Employee',
        email: 'employee@example.com',
        role: 'employee',
        organization_id: 1,
        is_active: true,
        settings: {
          attendance_monitoring: false,
          can_edit_time: true,
        },
        created_at: '',
        updated_at: '',
      },
      logout: vi.fn(),
      token: 'test-token',
    };

    renderWithProviders(<Layout />, { route: '/dashboard' });

    expect(await screen.findByRole('link', { name: /edit time/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /attendance/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Attendance Overview')).not.toBeInTheDocument();
  });

  it('keeps attendance dropdown when employee can access attendance and edit time', async () => {
    authState.value = {
      user: {
        id: 2,
        name: 'Employee',
        email: 'employee@example.com',
        role: 'employee',
        organization_id: 1,
        is_active: true,
        settings: {
          attendance_monitoring: true,
          can_edit_time: true,
        },
        created_at: '',
        updated_at: '',
      },
      logout: vi.fn(),
      token: 'test-token',
    };

    renderWithProviders(<Layout />, { route: '/dashboard' });

    expect(await screen.findByRole('link', { name: /^attendance$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /overtime/i })).toBeInTheDocument();
    expect(screen.queryByText('Attendance Overview')).not.toBeInTheDocument();
  });

  it('hides the add user button for managers', async () => {
    authState.value = {
      user: {
        id: 3,
        name: 'Manager',
        email: 'manager@example.com',
        role: 'manager',
        organization_id: 1,
        is_active: true,
        created_at: '',
        updated_at: '',
      },
      logout: vi.fn(),
      token: 'test-token',
    };

    renderWithProviders(<Layout />, { route: '/dashboard' });

    await screen.findAllByText('Reports');
    expect(screen.queryByRole('button', { name: /add user/i })).not.toBeInTheDocument();
  });

  it('shows the unread chat badge on the chat navigation item', async () => {
    apiMocks.getUnreadSummary.mockResolvedValue({ data: { unread_messages: 4, unread_conversations: 2, unread_senders: 2 } });

    renderWithProviders(<Layout />, { route: '/dashboard' });

    await waitFor(() => {
      const chatLink = screen.getByRole('link', { name: /chat/i });
      expect(within(chatLink).getByText('4')).toBeInTheDocument();
    });
  });

  it('toggles the desktop notification menu from the bell button', async () => {
    const user = userEvent.setup();
    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
      getUpdateState: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn(),
      onUpdateState: vi.fn(),
      clearUpdateStateListeners: vi.fn(),
    };
    apiMocks.notificationList.mockResolvedValue({
      data: {
        unread_count: 1,
        data: [
          {
            id: 101,
            title: 'Leave request pending',
            message: 'A leave request needs review.',
            type: 'leave_request',
            is_read: false,
            created_at: '2026-04-28T09:00:00.000Z',
          },
        ],
      },
    });

    renderWithProviders(<Layout />, { route: '/dashboard' });

    const bellButton = await screen.findByRole('button', { name: /notifications/i });
    await user.click(bellButton);

    expect(await screen.findByText('Leave request pending')).toBeInTheDocument();

    await user.click(bellButton);

    await waitFor(() => {
      expect(screen.queryByText('Leave request pending')).not.toBeInTheDocument();
    });
  });

  it('shows desktop updates inside the profile menu and opens the update panel', async () => {
    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
      getUpdateState: vi.fn().mockResolvedValue({
        enabled: true,
        status: 'current',
        currentVersion: '1.0.2',
        message: 'You are already on the latest desktop version.',
        releaseNotes: '',
        releaseDate: null,
        availableVersion: null,
        downloadedVersion: null,
        progressPercent: 0,
      }),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn(),
      onUpdateState: vi.fn(),
      clearUpdateStateListeners: vi.fn(),
    };

    authState.value = {
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
      logout: vi.fn(),
      token: 'test-token',
    };

    renderWithProviders(<Layout />, { route: '/dashboard' });

    fireEvent.click(await screen.findByRole('button', { name: /employee/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^updates$/i }));

    expect(await screen.findByText(/desktop updates/i)).toBeInTheDocument();
    expect(screen.getByText(/carevance tracker v1.0.2/i)).toBeInTheDocument();
  });

  it('shows the desktop update dot on the profile name until updates are opened', async () => {
    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
      getUpdateState: vi.fn().mockResolvedValue({
        enabled: true,
        status: 'available',
        currentVersion: '1.0.1',
        message: 'Version 1.0.2 is available.',
        releaseNotes: 'Update polish',
        releaseDate: '2026-04-15T00:00:00.000Z',
        availableVersion: '1.0.2',
        downloadedVersion: null,
        progressPercent: 0,
      }),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn(),
      onUpdateState: vi.fn(),
      clearUpdateStateListeners: vi.fn(),
    };

    authState.value = {
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
      logout: vi.fn(),
      token: 'test-token',
    };

    renderWithProviders(<Layout />, { route: '/dashboard' });

    const profileButton = await screen.findByRole('button', { name: /desktop update available/i });
    fireEvent.click(profileButton);
    fireEvent.click(await screen.findByRole('button', { name: /^updates$/i }));

    expect(await screen.findByText(/desktop updates/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^employee$/i })).toBeInTheDocument();
    });
    expect(window.localStorage.getItem('carevance.desktopUpdate.seen.2')).toBe('1.0.2:2026-04-15T00:00:00.000Z');
  });

  it('shows a direct payroll navigation item in desktop shell for admins only', async () => {
    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
      getUpdateState: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn(),
      onUpdateState: vi.fn(),
      clearUpdateStateListeners: vi.fn(),
    };
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    const { rerender } = renderWithProviders(<Layout />, { route: '/dashboard' });

    fireEvent.click(await screen.findByRole('button', { name: /payroll/i }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining('/payroll?desktop_token=test-token'),
        '_blank',
        'noopener,noreferrer'
      );
    });

    authState.value = {
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
      logout: vi.fn(),
      token: 'test-token',
    };

    rerender(<Layout />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /payroll/i })).not.toBeInTheDocument();
    });

    openSpy.mockRestore();
  });
});
