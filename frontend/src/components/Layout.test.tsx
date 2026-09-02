import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from '@/components/Layout';
import { renderWithProviders } from '@/test/renderWithProviders';

import { BRAND, brandLabel, brandPrefix } from '@/config/brand';
/*
 * Nav visibility is plan-gated as well as role-gated: usePlan reads
 * organization.plan_code off useAuth, and with no organization it falls back to
 * basic_tracking — which hides Payroll however much of an admin you are. The
 * mock supplied no organization at all, so tests named after admin nav were
 * really asserting the tracking plan's nav.
 */
const authState = vi.hoisted(() => ({
  value: {
    user: null,
    organization: {
      id: 1,
      name: 'Test Org',
      plan_code: 'basic_payroll',
      max_seats: 50,
      subscription_status: 'active',
    },
    logout: vi.fn(),
    token: 'test-token',
  },
}));

const apiMocks = vi.hoisted(() => ({
  getUnreadSummary: vi.fn().mockResolvedValue({ data: { unread_messages: 0, unread_conversations: 0, unread_senders: 0 } }),
  leaveList: vi.fn().mockResolvedValue({ data: { data: [] } }),
  attendanceTimeEditList: vi.fn().mockResolvedValue({ data: { data: [] } }),
  userGetAll: vi.fn().mockResolvedValue({ data: [] }),
  searchQuery: vi.fn().mockResolvedValue({ data: { data: [] } }),
  notificationList: vi.fn().mockResolvedValue({ data: { data: [], unread_count: 0 } }),
  markAllRead: vi.fn().mockResolvedValue({}),
  markRead: vi.fn().mockResolvedValue({}),
  // The rail owns a timer now, and an unmocked endpoint here does not fail
  // fast - axios retries and holds the whole render empty past the timeout,
  // which reads as a navigation bug rather than a missing mock.
  timerActive: vi.fn().mockResolvedValue({ data: null }),
  timerStop: vi.fn().mockResolvedValue({}),
  reimbursementInboxCount: vi.fn().mockResolvedValue({ data: { manager_inbox: 0, admin_inbox: 0 } }),
  billingCurrent: vi.fn().mockResolvedValue({ data: null }),
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
    userApi: { getAll: apiMocks.userGetAll },
    searchApi: { query: apiMocks.searchQuery },
    timeEntryApi: { ...actual.timeEntryApi, active: apiMocks.timerActive, stop: apiMocks.timerStop },
    payrollApi: { ...actual.payrollApi, reimbursementInboxCount: apiMocks.reimbursementInboxCount },
    billingApi: { ...actual.billingApi, current: apiMocks.billingCurrent },
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
    apiMocks.userGetAll.mockResolvedValue({ data: [] });
    apiMocks.searchQuery.mockResolvedValue({ data: { data: [] } });
    apiMocks.notificationList.mockResolvedValue({ data: { data: [], unread_count: 0 } });
    apiMocks.markAllRead.mockResolvedValue({});
    apiMocks.markRead.mockResolvedValue({});
    apiMocks.timerActive.mockResolvedValue({ data: null });
    apiMocks.timerStop.mockResolvedValue({});
    apiMocks.reimbursementInboxCount.mockResolvedValue({ data: { manager_inbox: 0, admin_inbox: 0 } });
    apiMocks.billingCurrent.mockResolvedValue({ data: null });
    authState.value = {
      organization: { id: 1, name: 'Test Org', plan_code: 'basic_payroll', max_seats: 50, subscription_status: 'active' },
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
    expect(screen.getByText('Approval Inbox')).toBeInTheDocument();
    expect(screen.getByText('Audit Logs')).toBeInTheDocument();
  });

  it('opens the command bar from the header trigger and finds a page', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Layout />, { route: '/dashboard' });

    const trigger = await screen.findByRole('button', { name: /search or jump to/i });
    await user.click(trigger);

    const input = await screen.findByRole('combobox', { name: new RegExp(`search ${brandLabel}`, 'i') });
    await user.type(input, 'atendance');

    // Typo-tolerant, and it never asks the server for a page it already knows.
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent).join(' ')).toContain('Attendance');
  });

  /*
   * Below lg the aside is display:none and there used to be nothing else — a
   * tablet had zero nav links and no menu button. The drawer is that missing
   * surface, so the guarantee worth testing is that the button exists and opens
   * a navigable, focus-trapped dialog.
   */
  it('offers a menu button that opens navigation in a dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Layout />, { route: '/dashboard' });

    const opener = await screen.findByRole('button', { name: /open navigation/i });
    expect(opener).toHaveAttribute('aria-expanded', 'false');

    await user.click(opener);

    const drawer = await screen.findByRole('dialog', { name: /navigation/i });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(within(drawer).getAllByRole('link').length).toBeGreaterThan(5);
  });

  it('closes the navigation drawer on Escape and restores focus', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Layout />, { route: '/dashboard' });

    const opener = await screen.findByRole('button', { name: /open navigation/i });
    opener.focus();
    await user.click(opener);
    await screen.findByRole('dialog', { name: /navigation/i });

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /navigation/i })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /open navigation/i }));
  });

  it('shows only one CareVance wordmark at any one breakpoint', async () => {
    renderWithProviders(<Layout />, { route: '/dashboard' });
    await screen.findByRole('navigation', { name: 'Main' });

    // Both used to render unconditionally, so two identical logos sat on screen
    // together. The header copy is now lg:hidden — it only appears at the widths
    // where the rail itself is hidden. jsdom applies no media queries, so assert
    // the class rather than visibility.
    const wordmarks = screen.queryAllByAltText(brandLabel).filter((img) => img.getAttribute('src')?.includes('full'));

    /*
     * Un-branded there is no artwork to duplicate, and BrandLogo renders its
     * box with no image at all. Asserting the absence is worth as much as
     * asserting the rule: it is what stops a stray literal logo creeping back
     * into a white-label build.
     */
    if (!BRAND.enabled) {
      expect(wordmarks).toHaveLength(0);
      return;
    }

    const alwaysVisible = wordmarks.filter((img) => !img.parentElement?.className.includes('lg:hidden'));

    expect(wordmarks).toHaveLength(2);
    expect(alwaysVisible).toHaveLength(1);
  });

  it('uses the same logo artwork as the favicon', async () => {
    renderWithProviders(<Layout />, { route: '/dashboard' });
    await screen.findByRole('navigation', { name: 'Main' });
    // The public/ SVGs are much smaller but draw a different monogram; the
    // favicon points at the PNG, so the app has to as well.
    screen.queryAllByAltText(brandLabel).forEach((img) => {
      expect(img.getAttribute('src')).toMatch(/\.png$/);
    });
  });

  it('does not fetch the employee directory on mount', async () => {
    renderWithProviders(<Layout />, { route: '/dashboard' });

    await waitFor(() => expect(apiMocks.notificationList).toHaveBeenCalled());
    // The old header search downloaded every employee on every mount.
    expect(apiMocks.userGetAll).not.toHaveBeenCalled();
    expect(apiMocks.searchQuery).not.toHaveBeenCalled();
  });

  it('queries the server only once the command bar is open and a query is typed', async () => {
    const user = userEvent.setup();
    apiMocks.searchQuery.mockResolvedValue({
      data: {
        data: [
          { type: 'person', id: 17, title: 'Zeel', subtitle: 'zeel@test.com · Quality Assurance', url: '/employees/17' },
        ],
      },
    });

    renderWithProviders(<Layout />, { route: '/dashboard' });

    await user.click(await screen.findByRole('button', { name: /search or jump to/i }));
    expect(apiMocks.searchQuery).not.toHaveBeenCalled();

    await user.type(await screen.findByRole('combobox', { name: new RegExp(`search ${brandLabel}`, 'i') }), 'zeel');

    await waitFor(() => expect(apiMocks.searchQuery).toHaveBeenCalled());
    expect(await screen.findByText('Zeel')).toBeInTheDocument();
    expect(screen.getByText('zeel@test.com · Quality Assurance')).toBeInTheDocument();
  });

  /*
   * Removed: 'highlights only the selected settings subpage'.
   *
   * Integrations and Custom Fields are panes inside the Settings screen now,
   * not sidebar entries, so there is no subpage link left to highlight. The
   * rule it was really protecting - that /settings matches EXACTLY and does not
   * stay lit while you are inside it - moved to Sidebar.test.tsx, next to the
   * matcher that implements it.
   */
  it('keeps projects and tasks navigation states separate', async () => {
    renderWithProviders(<Layout />, { route: '/projects' });

    const projectLinks = await screen.findAllByRole('link', { name: /^projects$/i });
    const taskLinks = screen.getAllByRole('link', { name: /^tasks$/i });

    expect(projectLinks.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true);
    expect(taskLinks.some((link) => link.getAttribute('aria-current') === 'page')).toBe(false);
  });

  it('highlights departments without also highlighting employees', async () => {
    renderWithProviders(<Layout />, { route: '/employees/teams' });

    const employeeLinks = await screen.findAllByRole('link', { name: /^employees$/i });
    const departmentLinks = screen.getAllByRole('link', { name: /^department$/i });

    expect(departmentLinks.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true);
    expect(employeeLinks.some((link) => link.getAttribute('aria-current') === 'page')).toBe(false);
  });

  it('shows contextual report links in attendance and payroll sections', async () => {
    renderWithProviders(<Layout />, { route: '/dashboard' });

    expect(await screen.findByRole('link', { name: /^screenshots$/i })).toHaveAttribute('href', '/monitoring/screenshots');
    expect(await screen.findByRole('link', { name: /^attendance report$/i })).toHaveAttribute('href', '/reports/attendance');
    // Payroll reports moved inside the Payroll screen's own tabs, so there is
    // no longer a contextual nav entry for them to assert.
  });

  it('does not highlight the generic reports link when attendance report is active', async () => {
    renderWithProviders(<Layout />, { route: '/reports/attendance' });

    const attendanceReportLink = await screen.findByRole('link', { name: /^attendance report$/i });
    const genericReportLinks = screen.getAllByRole('link', { name: /^reports$/i });

    expect(attendanceReportLink.getAttribute('aria-current')).toBe('page');
    expect(genericReportLinks.some((link) => link.getAttribute('aria-current') === 'page')).toBe(false);
  });

  it('hides admin-only navigation items for employees', async () => {
    authState.value = {
      organization: { id: 1, name: 'Test Org', plan_code: 'basic_payroll', max_seats: 50, subscription_status: 'active' },
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
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();

    // The Payroll *group* is not admin-only — it also holds "My Payroll", which
    // an employee is meant to reach. What must stay hidden is the admin payroll
    // page itself, so assert on the destination rather than on the word.
    expect(document.querySelector('a[href="/payroll"]')).toBeNull();
    expect(document.querySelector('a[href="/my-payroll"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /employee/i }));

    expect(await screen.findByText('Settings')).toBeInTheDocument();
    expect(screen.queryByText('Employees')).not.toBeInTheDocument();
    expect(screen.queryByText('Approval Inbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Audit Logs')).not.toBeInTheDocument();
  });

  it('hides edit time navigation when employee time edits are disabled', async () => {
    authState.value = {
      organization: { id: 1, name: 'Test Org', plan_code: 'basic_payroll', max_seats: 50, subscription_status: 'active' },
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
    /*
     * Attendance is a GROUP in the rail now, so a button by that name is
     * expected rather than forbidden - the old assertion described a flat list
     * of links. What still matters is that the entry itself is gone: the label
     * was renamed from Edit Time to Overtime, and checking only the old name
     * would pass while the link sat there in plain sight.
     */
    expect(screen.queryByText('Edit Time')).not.toBeInTheDocument();
    expect(screen.queryByText('Overtime')).not.toBeInTheDocument();
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
      organization: { id: 1, name: 'Test Org', plan_code: 'basic_payroll', max_seats: 50, subscription_status: 'active' },
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
      organization: { id: 1, name: 'Test Org', plan_code: 'basic_payroll', max_seats: 50, subscription_status: 'active' },
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
    // The group button by that name stays - it is the section, not the page.
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
      organization: { id: 1, name: 'Test Org', plan_code: 'basic_payroll', max_seats: 50, subscription_status: 'active' },
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
      organization: { id: 1, name: 'Test Org', plan_code: 'basic_payroll', max_seats: 50, subscription_status: 'active' },
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
      organization: { id: 1, name: 'Test Org', plan_code: 'basic_payroll', max_seats: 50, subscription_status: 'active' },
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

  it('hides the add user button for admins in the desktop shell', async () => {
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

    renderWithProviders(<Layout />, { route: '/dashboard' });

    await screen.findByRole('button', { name: /notifications/i });
    expect(screen.queryByRole('button', { name: /add user/i })).not.toBeInTheDocument();
  });

  it('shows the unread chat badge on the chat navigation item', async () => {
    apiMocks.getUnreadSummary.mockResolvedValue({ data: { unread_messages: 4, unread_conversations: 2, unread_senders: 2 } });

    renderWithProviders(<Layout />, { route: '/dashboard' });

    await waitFor(() => {
      const chatLink = screen.getByRole('link', { name: /chat/i });
      const badge = within(chatLink).getByText('4');
      // The count is the promise; its colour is a theme token now, and a
      // class-name probe here tested the palette rather than the badge.
      expect(badge).toBeInTheDocument();
    });
  });

  it('excludes chat messages from notification center and desktop notification polling', async () => {
    const user = userEvent.setup();
    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
      showNotification: vi.fn(),
      getUpdateState: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn(),
      onUpdateState: vi.fn(),
      clearUpdateStateListeners: vi.fn(),
    };
    apiMocks.notificationList.mockResolvedValue({
      data: {
        unread_count: 2,
        data: [
          {
            id: 201,
            title: 'New message from Example',
            message: 'hello',
            type: 'message',
            meta: { route: '/chat?threadType=direct&threadId=1' },
            is_read: false,
            created_at: '2026-05-01T05:00:00.000Z',
          },
          {
            id: 202,
            title: 'Leave request pending',
            message: 'A leave request needs review.',
            type: 'leave_request',
            is_read: false,
            created_at: '2026-05-01T05:01:00.000Z',
          },
        ],
      },
    });

    renderWithProviders(<Layout />, { route: '/dashboard' });

    /*
     * Excluded SERVER-side rather than filtered out of the reply: the limit is
     * applied before the filter, so a busy chat thread would otherwise fill the
     * page and leave the panel empty with approvals still waiting.
     *
     * This used to assert two calls, back when a second poller fed the desktop
     * popups. One request feeds both now, so the count was describing the
     * plumbing rather than the promise.
     */
    await waitFor(() => {
      expect(apiMocks.notificationList).toHaveBeenCalledWith({
        limit: 20,
        exclude_types: ['chat_direct_message', 'chat_group_message', 'chat_message', 'direct_message', 'group_message'],
      });
    });

    // And no native popup for a chat message - chat has its own screen, and an
    // OS notification per message is what makes people mute the app.
    expect(window.desktopTracker?.showNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message' })
    );

    await user.click(await screen.findByRole('button', { name: /notifications/i }));

    expect(await screen.findByText('Leave request pending')).toBeInTheDocument();
    expect(screen.queryByText('New message from Example')).not.toBeInTheDocument();
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

  it('clears the notification badge when the desktop notification panel is viewed', async () => {
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
            id: 301,
            title: 'Leave request pending',
            message: 'A leave request needs review.',
            type: 'leave_request',
            is_read: false,
            created_at: '2026-05-01T05:01:00.000Z',
          },
        ],
      },
    });

    renderWithProviders(<Layout />, { route: '/dashboard' });

    expect(await screen.findByText('1')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /notifications/i }));

    /*
     * Opening the panel no longer marks everything read on its own - both
     * shells now require the explicit button, so a glance at the bell does not
     * silently clear items nobody looked at. The chat exclusion is the part
     * that still matters: chat is read in the chat screen, and sweeping it up
     * here would mark messages read that were never opened.
     */
    await user.click(await screen.findByRole('button', { name: /mark all read/i }));

    await waitFor(() => {
      expect(apiMocks.markAllRead).toHaveBeenCalledWith({
        exclude_types: ['chat_direct_message', 'chat_group_message', 'chat_message', 'direct_message', 'group_message'],
      });
    });
    expect(screen.queryByText('1')).not.toBeInTheDocument();
    expect(await screen.findByText('Leave request pending')).toBeInTheDocument();
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
      organization: { id: 1, name: 'Test Org', plan_code: 'basic_payroll', max_seats: 50, subscription_status: 'active' },
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
    expect(screen.getByText(new RegExp(`${brandPrefix}tracker v1.0.2`, 'i'))).toBeInTheDocument();
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
      organization: { id: 1, name: 'Test Org', plan_code: 'basic_payroll', max_seats: 50, subscription_status: 'active' },
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
      organization: { id: 1, name: 'Test Org', plan_code: 'basic_payroll', max_seats: 50, subscription_status: 'active' },
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

/*
 * The assistant reads organisation-wide attendance, payroll and headcount, so
 * it is an administrative surface. It used to mount unconditionally for every
 * signed-in user — role was consulted only to pick which suggestion chips to
 * show, never to decide whether the bubble appeared at all.
 *
 * The gate is hasStrictAdminAccess(): super_admin (0) and admin (10), custom
 * roles included via hierarchy_level. AiChatController enforces the same rule
 * server-side; this is the half that stops a manager from ever seeing it.
 */
describe('Layout AI assistant visibility', () => {
  const setRole = (role: string, hierarchyLevel?: number) => {
    authState.value = {
      ...authState.value,
      user: {
        id: 1,
        name: 'Someone',
        email: 'someone@example.com',
        role,
        organization_id: 1,
        is_active: true,
        created_at: '',
        updated_at: '',
        ...(hierarchyLevel === undefined ? {} : { hierarchy_level: hierarchyLevel }),
      },
    };
  };

  const assistantButton = () => screen.queryByRole('button', { name: /assistant/i });

  it('offers the assistant to an admin', async () => {
    setRole('admin');
    renderWithProviders(<Layout />, { route: '/dashboard' });

    await screen.findByRole('main');
    expect(assistantButton()).toBeInTheDocument();
  });

  it('offers the assistant to a super admin', async () => {
    setRole('super_admin');
    renderWithProviders(<Layout />, { route: '/dashboard' });

    await screen.findByRole('main');
    expect(assistantButton()).toBeInTheDocument();
  });

  it('hides the assistant from an employee', async () => {
    setRole('employee');
    renderWithProviders(<Layout />, { route: '/dashboard' });

    await screen.findByRole('main');
    expect(assistantButton()).not.toBeInTheDocument();
  });

  it('hides the assistant from a manager', async () => {
    setRole('manager');
    renderWithProviders(<Layout />, { route: '/dashboard' });

    await screen.findByRole('main');
    expect(assistantButton()).not.toBeInTheDocument();
  });

  /*
   * A custom role carries its own hierarchy_level, which outranks the role
   * string. An org that builds an "Ops Lead" role at level 30 must not get the
   * assistant just because someone named the role something admin-sounding.
   */
  it('hides the assistant from a custom role below admin level', async () => {
    setRole('admin', 30);
    renderWithProviders(<Layout />, { route: '/dashboard' });

    await screen.findByRole('main');
    expect(assistantButton()).not.toBeInTheDocument();
  });
});
