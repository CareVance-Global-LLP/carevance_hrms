import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MonitoringWorkspace from '@/pages/MonitoringWorkspace';
import { renderWithProviders } from '@/test/renderWithProviders';

const mocks = vi.hoisted(() => ({
  getAllUsersMock: vi.fn(),
  employeeInsightsMock: vi.fn(),
  reportOverallMock: vi.fn(),
  activityGetAllMock: vi.fn(),
  screenshotGetAllMock: vi.fn(),
  screenshotGetMock: vi.fn(),
  screenshotFetchFileObjectUrlMock: vi.fn(),
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
      overall: mocks.reportOverallMock,
    },
    activityApi: {
      ...actual.activityApi,
      getAll: mocks.activityGetAllMock,
    },
    screenshotApi: {
      ...actual.screenshotApi,
      getAll: mocks.screenshotGetAllMock,
      get: mocks.screenshotGetMock,
      fetchFileObjectUrl: mocks.screenshotFetchFileObjectUrlMock,
    },
  };
});

const insightsPayload = () => ({
  data: {
    organization_summary: {
      tracked_duration: 7200,
      working_duration: 6600,
      idle_duration: 600,
      break_seconds: 0,
      productive_duration: 4200,
      neutral_duration: 1200,
      context_dependent_duration: 300,
      unproductive_duration: 900,
      productive_share: 63.6,
      unproductive_share: 13.6,
      neutral_share: 18.2,
      context_dependent_share: 4.5,
    },
    selected_user_tools: { productive: [], unproductive: [], neutral: [], context_dependent: [] },
    organization_tools: { productive: [], unproductive: [], neutral: [], context_dependent: [] },
    employee_rankings: {
      by_productive_duration: [
        {
          user: { id: 7, name: 'Example Employee', email: 'employee@example.com', role: 'employee' },
          productive_duration: 4200,
          neutral_duration: 1200,
          context_dependent_duration: 300,
          unproductive_duration: 900,
          total_duration: 7200,
          tracked_duration: 7200,
          idle_duration: 600,
          break_seconds: 0,
        },
      ],
      by_unproductive_duration: [],
    },
    team_rankings: { by_efficiency: [{ group: { id: 1, name: 'Engineering' }, efficiency_score: 82 }] },
    recent_screenshots: [],
    live_monitoring: {
      // True totals — deliberately larger than anything in the capped arrays,
      // to prove tiles read counts and never array lengths.
      counts: { all: 14, active: 12, idle: 0, on_break: 0, on_leave: 2, inactive: 0, working_now: 12 },
      status_by_user: { '7': 'active' },
      selected_user: null,
      working_now: [],
      all_users: [],
      employees_active: [],
      employees_inactive: [],
      employees_on_leave: [],
      employees_on_break: [],
    },
  },
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

    mocks.employeeInsightsMock.mockResolvedValue(insightsPayload());
    mocks.reportOverallMock.mockResolvedValue({
      data: {
        by_day: [
          { date: '2026-08-05', total_duration: 7200, working_duration: 6600, idle_duration: 600 },
        ],
      },
    });
    mocks.activityGetAllMock.mockResolvedValue({ data: { data: [] } });

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

  it('reads presence from the true server counts, never the capped arrays', async () => {
    renderWithProviders(
      <MonitoringWorkspace mode="productive-time" />,
      { route: '/monitoring/productive-time' },
    );

    // counts.active = 12 while employees_active is an empty (capped) array.
    const activeSegment = await screen.findByRole('button', { name: 'Active 12' });
    expect(activeSegment).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'On leave 2' })).toBeInTheDocument();

    // The org share bar headline + legend carry all four classes, not one number.
    expect(screen.getByText('63.6%')).toBeInTheDocument();
    expect(screen.getAllByText(/Unproductive/).length).toBeGreaterThan(0);
  });

  it('filters the people list through a presence segment', async () => {
    renderWithProviders(
      <MonitoringWorkspace mode="productive-time" />,
      { route: '/monitoring/productive-time' },
    );

    expect(await screen.findByText('Example Employee')).toBeInTheDocument();

    // "On leave" has count 2 but no ranked/mapped people → the list empties
    // with an explanation instead of silently hiding rows.
    fireEvent.click(screen.getByRole('button', { name: 'On leave 2' }));
    expect(await screen.findByText(/Nobody is on leave right now/)).toBeInTheDocument();

    // Active still maps to Example Employee via status_by_user.
    fireEvent.click(screen.getByRole('button', { name: 'On leave 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Active 12' }));
    expect(await screen.findByText('Example Employee')).toBeInTheDocument();
  });

  it('opens the person drawer and rescopes insights to that employee', async () => {
    renderWithProviders(
      <MonitoringWorkspace mode="productive-time" />,
      { route: '/monitoring/productive-time' },
    );

    fireEvent.click(await screen.findByText('Example Employee'));

    const drawer = await screen.findByRole('dialog', { name: 'Example Employee' });
    expect(within(drawer).getByRole('button', { name: /View screenshots/ })).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.employeeInsightsMock).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 7 })
      );
    });
  });

  it('renders screenshots through an authenticated blob fetch rather than a bare signed URL', async () => {
    // The file endpoint requires an Authorization header, so an <img> can no
    // longer point at the signed URL directly — the browser would send no token
    // and get a 401. The bytes come through the api client and are rendered as
    // an object URL. (jsdom has no IntersectionObserver, so lazy tiles load
    // immediately — the same code path a visible tile takes.)
    mocks.screenshotFetchFileObjectUrlMock.mockResolvedValue('blob:mock/101');

    renderWithProviders(
      <MonitoringWorkspace mode="screenshots" />,
      { route: '/monitoring/screenshots?user=7' },
    );

    expect(await screen.findByRole('heading', { name: 'Screenshots', level: 1 })).toBeInTheDocument();
    // Grouped person → hour with an honest count line.
    expect(await screen.findByText(/screenshot in range/)).toBeInTheDocument();
    expect(await screen.findByText('Example Employee')).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.screenshotFetchFileObjectUrlMock).toHaveBeenCalledWith(
        'http://localhost:8000/api/screenshots/101/file?signature=old'
      );
    });

    const image = await screen.findByAltText(/Screenshot at/) as HTMLImageElement;
    expect(image.src).toBe('blob:mock/101');
  });

  it('re-mints the signed link and retries when the screenshot fetch fails', async () => {
    mocks.screenshotFetchFileObjectUrlMock
      .mockRejectedValueOnce(new Error('expired'))
      .mockResolvedValue('blob:mock/101-fresh');

    renderWithProviders(
      <MonitoringWorkspace mode="screenshots" />,
      { route: '/monitoring/screenshots?user=7' },
    );

    expect(await screen.findByRole('heading', { name: 'Screenshots', level: 1 })).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.screenshotGetMock).toHaveBeenCalledWith(101);
    });

    await waitFor(() => {
      expect(mocks.screenshotFetchFileObjectUrlMock).toHaveBeenCalledWith(
        'http://localhost:8000/api/screenshots/101/file?signature=fresh'
      );
    });
  });

  it('opens the lightbox from a tile instead of launching a raw blob tab', async () => {
    mocks.screenshotFetchFileObjectUrlMock.mockResolvedValue('blob:mock/101');

    renderWithProviders(
      <MonitoringWorkspace mode="screenshots" />,
      { route: '/monitoring/screenshots?user=7' },
    );

    // Wait for the tile's blob to arrive so the viewer opens with the image.
    await screen.findByAltText(/Screenshot at/);
    const tile = await screen.findByRole('button', { name: /Open screenshot/ });
    fireEvent.click(tile);

    const viewer = await screen.findByRole('dialog', { name: 'Screenshot viewer' });
    expect(within(viewer).getByAltText('Screenshot enlarged')).toBeInTheDocument();
    expect(within(viewer).getByText(/Esc to close/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Screenshot viewer' })).not.toBeInTheDocument();
    });
  });

  it('does not call employee insights at all in screenshots mode', async () => {
    renderWithProviders(
      <MonitoringWorkspace mode="screenshots" />,
      { route: '/monitoring/screenshots?user=7' },
    );

    expect(await screen.findByRole('heading', { name: 'Screenshots', level: 1 })).toBeInTheDocument();
    expect(mocks.employeeInsightsMock).not.toHaveBeenCalled();
  });
});
