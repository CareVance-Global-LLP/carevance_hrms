import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReportsWorkspace from '@/pages/ReportsWorkspace';
import { renderWithProviders } from '@/test/renderWithProviders';

const mocks = vi.hoisted(() => ({
  getAllUsersMock: vi.fn(),
  groupsListMock: vi.fn(),
  overallMock: vi.fn(),
  attendanceMock: vi.fn(),
  activityGetAllMock: vi.fn(),
  activityGetAllPagesMock: vi.fn(),
  authUser: {
    id: 1,
    name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
    organization_id: 1,
    is_active: true,
    created_at: '',
    updated_at: '',
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mocks.authUser,
  }),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    userApi: {
      ...actual.userApi,
      getAll: mocks.getAllUsersMock,
    },
    reportGroupApi: {
      ...actual.reportGroupApi,
      list: mocks.groupsListMock,
    },
    reportApi: {
      ...actual.reportApi,
      overall: mocks.overallMock,
      attendance: mocks.attendanceMock,
    },
    activityApi: {
      ...actual.activityApi,
      getAll: mocks.activityGetAllMock,
      getAllPages: mocks.activityGetAllPagesMock,
    },
  };
});

describe('ReportsWorkspace timeline navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();

    mocks.getAllUsersMock.mockResolvedValue({
      data: [
        {
          id: 1,
          name: 'Irbaz Mavli',
          email: 'irbaz@example.com',
          role: 'employee',
        },
      ],
    });

    mocks.groupsListMock.mockResolvedValue({
      data: {
        data: [],
      },
    });

    mocks.overallMock.mockResolvedValue({
      data: {
        summary: {
          total_duration: 3600,
          idle_duration: 600,
          active_users: 1,
          users_count: 1,
        },
        by_user: [],
        by_day: [],
      },
    });
    mocks.attendanceMock.mockResolvedValue({
      data: {
        data: [
          {
            user: { id: 1, name: 'Irbaz Mavli', email: 'irbaz@example.com' },
            days_present: 8,
            leave_days: 1,
            worked_seconds: 115200,
            calendar_days_in_range: 10,
            working_days_in_range: 10,
            attendance_rate: 80,
            is_working: true,
          },
          {
            user: { id: 2, name: 'Riya Shah', email: 'riya@example.com', department: 'Finance' },
            days_present: 5,
            leave_days: 0,
            worked_seconds: 72000,
            calendar_days_in_range: 10,
            working_days_in_range: 10,
            attendance_rate: 50,
            is_working: false,
          },
        ],
      },
    });

    mocks.activityGetAllPagesMock.mockResolvedValue([
      {
        id: 11,
        type: 'app',
        name: 'Visual Studio Code',
        app_name: 'Visual Studio Code',
        software_name: 'vscode',
        normalized_label: 'vscode',
        tool_type: 'software',
        duration: 180,
        recorded_at: '2026-04-14T09:30:00.000Z',
        user: {
          id: 1,
          name: 'Irbaz Mavli',
        },
      },
    ]);
    mocks.activityGetAllMock.mockImplementation(async (params) => {
      const rows = await mocks.activityGetAllPagesMock(params);
      return {
        data: {
          data: rows,
          current_page: Number(params?.page || 1),
          last_page: 1,
          total: rows.length,
          has_more: false,
        },
      };
    });
  });

  it('renders timeline safely when switching from another report mode', async () => {
    const { rerender } = renderWithProviders(<ReportsWorkspace mode="productivity" />);

    expect(await screen.findByText('Productivity Summary')).toBeInTheDocument();
    expect(await screen.findByText('Tracked Time')).toBeInTheDocument();

    rerender(<ReportsWorkspace mode="timeline" />);

    expect(await screen.findByText('Timeline')).toBeInTheDocument();
    expect(await screen.findByText('Activity Timeline')).toBeInTheDocument();
    expect(await screen.findByText('All timeline events')).toBeInTheDocument();
    expect(screen.getByText('Visual Studio Code')).toBeInTheDocument();
  });

  it('shows a reports hub with every report entry point', async () => {
    renderWithProviders(<ReportsWorkspace mode={'reports-hub' as any} />);

    expect(await screen.findByText('Reports Center')).toBeInTheDocument();
    expect(screen.getByText('Attendance Report')).toBeInTheDocument();
    expect(screen.getByText('Hours Tracked')).toBeInTheDocument();
    expect(screen.getByText('Task Overview')).toBeInTheDocument();
    expect(screen.getByText('Payroll Report')).toBeInTheDocument();
    expect(screen.getByText('Custom Export')).toBeInTheDocument();
    expect(screen.queryByText('Analytics Center')).not.toBeInTheDocument();
  });

  it('shows an analytics hub with every analytics entry point', async () => {
    renderWithProviders(<ReportsWorkspace mode={'analytics-hub' as any} />);

    expect(await screen.findByText('Analytics Center')).toBeInTheDocument();
    expect(screen.getByText('Productivity Summary')).toBeInTheDocument();
    expect(screen.getByText('Web & App Usage')).toBeInTheDocument();
    expect(screen.getByText('Productive Time')).toBeInTheDocument();
    expect(screen.getByText('Unproductive Time')).toBeInTheDocument();
    expect(screen.getByText('Screenshots')).toBeInTheDocument();
    expect(screen.queryByText('Reports Center')).not.toBeInTheDocument();
  });

  it('renders detailed report-specific attendance analysis', async () => {
    renderWithProviders(<ReportsWorkspace mode="attendance" />);

    expect(await screen.findByText('Attendance Report')).toBeInTheDocument();
    expect(screen.getByText('Report Specific Analysis')).toBeInTheDocument();
    expect(screen.getByText('Attendance Risk Radar')).toBeInTheDocument();
    expect(screen.getByText('Employee Day Matrix')).toBeInTheDocument();
    expect(screen.queryByText('Payroll Cost Waterfall')).not.toBeInTheDocument();
    expect(screen.getByText('Department Attendance Detail')).toBeInTheDocument();
    expect(screen.getByText('Attendance Exceptions')).toBeInTheDocument();
  });

  it('keeps hours tracked available when the optional group filter request fails', async () => {
    mocks.groupsListMock.mockRejectedValueOnce({
      response: {
        data: {
          message: 'Server error',
        },
      },
    });

    renderWithProviders(<ReportsWorkspace mode="hours-tracked" />);

    expect(await screen.findByText('Employee Hours')).toBeInTheDocument();
    expect(screen.getByText('Tracked Time')).toBeInTheDocument();
    expect(mocks.overallMock).toHaveBeenCalled();
    expect(mocks.getAllUsersMock).toHaveBeenCalledWith({ simple: 1 });
    expect(mocks.groupsListMock).toHaveBeenCalledWith({ simple: 1 });
  });

  it('renders canonical website and software labels from backend activity fields', async () => {
    mocks.activityGetAllPagesMock.mockResolvedValue([
      {
        id: 1,
        type: 'url',
        name: 'GitHub',
        normalized_label: 'github.com',
        normalized_domain: 'github.com',
        tool_type: 'website',
        duration: 1,
        recorded_at: '2026-04-20T10:00:01.000Z',
        user: { id: 1, name: 'Irbaz Mavli' },
      },
      {
        id: 2,
        type: 'app',
        name: 'Slack',
        normalized_label: 'slack',
        software_name: 'slack',
        tool_type: 'software',
        duration: 1,
        recorded_at: '2026-04-20T10:00:02.000Z',
        user: { id: 1, name: 'Irbaz Mavli' },
      },
    ]);

    renderWithProviders(<ReportsWorkspace mode="timeline" />);

    expect(await screen.findByText('github.com')).toBeInTheDocument();
    expect(await screen.findByText('Slack')).toBeInTheDocument();
  });

  it('requests processed activity rows for the timeline so durations stay aligned with usage summaries', async () => {
    renderWithProviders(<ReportsWorkspace mode="timeline" />);

    await screen.findByText('Timeline');

    expect(mocks.activityGetAllPagesMock).toHaveBeenCalledWith(expect.objectContaining({
      processed: true,
    }));
  });

  it('prefers exact desktop app labels over normalized aliases in the timeline', async () => {
    mocks.activityGetAllPagesMock.mockResolvedValue([
      {
        id: 44,
        type: 'app',
        name: 'Codex',
        app_name: 'Codex',
        software_name: 'vscode',
        normalized_label: 'vscode',
        tool_type: 'software',
        duration: 90,
        recorded_at: '2026-04-22T10:32:26.000Z',
        user: {
          id: 1,
          name: 'Irbaz Mavli',
        },
      },
    ]);

    renderWithProviders(<ReportsWorkspace mode="timeline" />);

    expect(await screen.findByText('Codex')).toBeInTheDocument();
    expect(screen.queryByText(/^vscode$/i)).not.toBeInTheDocument();
  });

  it('prefers the explorer window title over the generic explorer app name in the timeline', async () => {
    mocks.activityGetAllPagesMock.mockResolvedValue([
      {
        id: 55,
        type: 'app',
        name: 'This PC',
        app_name: 'Windows Explorer',
        window_title: 'This PC',
        software_name: 'windows explorer',
        normalized_label: 'windows explorer',
        tool_type: 'software',
        duration: 19,
        recorded_at: '2026-04-22T11:14:04.000Z',
        user: {
          id: 1,
          name: 'Irbaz Mavli',
        },
      },
    ]);

    renderWithProviders(<ReportsWorkspace mode="timeline" />);

    expect(await screen.findByText('This PC')).toBeInTheDocument();
    expect(screen.queryByText(/^Windows Explorer$/i)).not.toBeInTheDocument();
  });

  it('hydrates the employee and date range filters from scoped dashboard links', async () => {
    renderWithProviders(<ReportsWorkspace mode="hours-tracked" />, {
      route: '/reports/hours-tracked?user=1&start=2026-04-10&end=2026-04-14',
    });

    await screen.findByText('Hours Tracked');

    expect(mocks.overallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        start_date: '2026-04-10',
        end_date: '2026-04-14',
        user_ids: [1],
      })
    );
  });
});
