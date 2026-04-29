import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MonitoringWorkspace from '@/pages/MonitoringWorkspace';
import { renderWithProviders } from '@/test/renderWithProviders';

const mocks = vi.hoisted(() => ({
  getAllUsersMock: vi.fn(),
  employeeInsightsMock: vi.fn(),
  activityGetAllMock: vi.fn(),
  screenshotGetAllMock: vi.fn(),
  screenshotGetMock: vi.fn(),
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
    reportApi: {
      ...actual.reportApi,
      employeeInsights: mocks.employeeInsightsMock,
    },
    activityApi: {
      ...actual.activityApi,
      getAll: mocks.activityGetAllMock,
    },
    screenshotApi: {
      ...actual.screenshotApi,
      getAll: mocks.screenshotGetAllMock,
      get: mocks.screenshotGetMock,
    },
  };
});

describe('MonitoringWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();

    mocks.getAllUsersMock.mockResolvedValue({
      data: [
        {
          id: 7,
          name: 'Example Employee',
          email: 'employee@example.com',
          role: 'employee',
        },
      ],
    });

    mocks.activityGetAllMock.mockResolvedValue({
      data: {
        data: [
          {
            id: 21,
            type: 'url',
            name: 'instagram.com',
            duration: 180,
            recorded_at: '2026-04-21T11:20:00.000Z',
            user: {
              id: 7,
              name: 'Example Employee',
            },
          },
        ],
      },
    });

    mocks.employeeInsightsMock.mockResolvedValue({
      data: {
        organization_summary: {},
        selected_user_tools: {
          productive: [],
          unproductive: [],
          neutral: [],
          context_dependent: [],
        },
        organization_tools: {
          productive: [],
          unproductive: [],
          neutral: [],
          context_dependent: [],
        },
        employee_rankings: {
          by_productive_duration: [],
          by_unproductive_duration: [],
        },
        recent_screenshots: [],
        live_monitoring: {
          employees_active: [],
          employees_inactive: [
            {
              user: {
                id: 7,
                name: 'Example Employee',
                email: 'employee@example.com',
                role: 'employee',
              },
              is_working: false,
              current_tool: 'instagram.com',
              tool_type: 'website',
              activity_type: 'url',
              classification: 'unproductive',
              last_activity_at: '2026-04-21T11:29:40.000Z',
              work_status: 'inactive',
              browser_tracking: {
                status: 'disconnected',
                device_label: 'DESKTOP-ALPHA',
                connection_count: 1,
                connected_connections: 0,
                browsers: ['chrome'],
                last_seen_at: '2026-04-21T11:22:00.000Z',
                last_sync_at: '2026-04-21T11:29:40.000Z',
                disconnect_reason: 'extension_missing',
                needs_attention: true,
                is_exact_tracking_active: false,
              },
            },
          ],
          employees_on_leave: [],
          selected_user: {
            user: {
              id: 7,
              name: 'Example Employee',
              email: 'employee@example.com',
              role: 'employee',
            },
            is_working: false,
            current_tool: 'instagram.com',
            tool_type: 'website',
            activity_type: 'url',
            classification: 'unproductive',
            last_activity_at: '2026-04-21T11:29:40.000Z',
            work_status: 'inactive',
            browser_tracking: {
              status: 'disconnected',
              device_label: 'DESKTOP-ALPHA',
              connection_count: 1,
              connected_connections: 0,
              browsers: ['chrome'],
              last_seen_at: '2026-04-21T11:22:00.000Z',
              last_sync_at: '2026-04-21T11:29:40.000Z',
              disconnect_reason: 'extension_missing',
              needs_attention: true,
              is_exact_tracking_active: false,
            },
          },
          all_users: [],
        },
      },
    });

    mocks.screenshotGetAllMock.mockResolvedValue({
      data: {
        data: [
          {
            id: 101,
            filename: 'capture-101.jpg',
            path: 'http://localhost:8000/api/screenshots/101/file?signature=old',
            recorded_at: '2026-04-21T11:30:00.000Z',
            user_id: 7,
          },
        ],
        total: 1,
        current_page: 1,
        last_page: 1,
      },
    });
    mocks.screenshotGetMock.mockResolvedValue({
      data: {
        id: 101,
        filename: 'capture-101.jpg',
        path: 'http://localhost:8000/api/screenshots/101/file?signature=fresh',
        recorded_at: '2026-04-21T11:30:00.000Z',
        user_id: 7,
      },
    });
  });

  it('shows browser tracking health in the selected employee live monitoring card', async () => {
    renderWithProviders(
      <MonitoringWorkspace mode="website-usage" />,
      { route: '/monitoring/website-usage?user=7' },
    );

    expect(await screen.findByRole('heading', { name: 'Website Usage', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('Live Activity')).toBeInTheDocument();
    expect(await screen.findByText('Tracking off')).toBeInTheDocument();
    expect(screen.getByText('DESKTOP-ALPHA reported extension missing')).toBeInTheDocument();
    expect(screen.getAllByText('instagram.com').length).toBeGreaterThan(0);
  });

  it('uses exact desktop app names instead of normalized aliases in app usage tables', async () => {
    mocks.activityGetAllMock.mockResolvedValue({
      data: {
        data: [
          {
            id: 77,
            type: 'app',
            name: 'Codex',
            app_name: 'Codex',
            software_name: 'vscode',
            normalized_label: 'vscode',
            duration: 180,
            recorded_at: '2026-04-22T10:20:00.000Z',
            user: {
              id: 7,
              name: 'Example Employee',
            },
          },
        ],
      },
    });

    renderWithProviders(
      <MonitoringWorkspace mode="app-usage" />,
      { route: '/monitoring/app-usage?user=7' },
    );

    expect(await screen.findByRole('heading', { name: 'App Usage', level: 1 })).toBeInTheDocument();
    expect((await screen.findAllByText('Codex')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^vscode$/i)).not.toBeInTheDocument();
  });

  it('renders screenshots and refreshes an expired signed image URL', async () => {
    renderWithProviders(
      <MonitoringWorkspace mode="screenshots" />,
      { route: '/monitoring/screenshots?user=7' },
    );

    expect(await screen.findByRole('heading', { name: 'Screenshots', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('capture-101.jpg')).toBeInTheDocument();

    const image = screen.getByAltText('capture-101.jpg') as HTMLImageElement;
    expect(image.src).toBe('http://localhost:8000/api/screenshots/101/file?signature=old');
    expect(screen.getByRole('link', { name: /open/i })).toHaveAttribute(
      'href',
      'http://localhost:8000/api/screenshots/101/file?signature=old'
    );

    fireEvent.error(image);

    await waitFor(() => {
      expect(mocks.screenshotGetMock).toHaveBeenCalledWith(101);
      expect(image.src).toBe('http://localhost:8000/api/screenshots/101/file?signature=fresh');
    });
  });
});
