import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NewHiresPage from '@/pages/NewHiresPage';
import { renderWithProviders } from '@/test/renderWithProviders';

const authState = vi.hoisted(() => ({
  value: {
    user: { id: 1, name: 'Admin', email: 'admin@example.com', role: 'admin', organization_id: 1 },
    isLoading: false,
    isAuthenticated: true,
  },
}));

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  show: vi.fn(),
  create: vi.fn(),
  update: vi.fn().mockResolvedValue({ data: {} }),
  completeItem: vi.fn().mockResolvedValue({ data: {} }),
  reopenItem: vi.fn().mockResolvedValue({ data: {} }),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => authState.value }));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { ...actual, onboardingApi: apiMocks };
});

const journey = (over: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: null,
  candidate_name: 'Priya Shah',
  candidate_email: 'priya@example.com',
  job_title: 'Backend Engineer',
  joining_date: '2026-08-20',
  stage: 'preboarding',
  days_until_joining: 15,
  readiness: { total: 10, done: 4, overdue: 0, blocking_overdue: 0 },
  manager: null,
  buddy: null,
  group: null,
  user: null,
  checklist_items: [],
  notes: null,
  ...over,
});

describe('NewHiresPage onboarding timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.list.mockResolvedValue({ data: { data: [journey()] } });
    apiMocks.show.mockResolvedValue({ data: { data: journey() } });
    apiMocks.create.mockResolvedValue({ data: { data: journey({ id: 2, candidate_name: 'New Person' }) } });
  });

  it('groups joiners by when they arrive rather than a status column', async () => {
    apiMocks.list.mockResolvedValue({
      data: {
        data: [
          journey({ id: 1, candidate_name: 'Soon Person', days_until_joining: 3 }),
          journey({ id: 2, candidate_name: 'Later Person', days_until_joining: 40 }),
        ],
      },
    });

    renderWithProviders(<NewHiresPage />);

    expect(await screen.findByText('Joining this week')).toBeInTheDocument();
    expect(screen.getByText('Joining later')).toBeInTheDocument();
    expect(screen.getByText('Soon Person')).toBeInTheDocument();
  });

  it('promotes a joiner with blocking work overdue above the date bands', async () => {
    apiMocks.list.mockResolvedValue({
      data: {
        data: [
          journey({
            id: 3,
            candidate_name: 'At Risk',
            days_until_joining: 30,
            readiness: { total: 10, done: 2, overdue: 3, blocking_overdue: 2 },
          }),
        ],
      },
    });

    renderWithProviders(<NewHiresPage />);

    // Thirty days out, but blocking work is late — that outranks the calendar.
    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    // One joiner needs attention; two of their items are blocking.
    expect(screen.getByText('1 needs attention')).toBeInTheDocument();
    expect(screen.getByText('2 blocking')).toBeInTheDocument();
    expect(screen.queryByText('Joining later')).not.toBeInTheDocument();
  });

  it('starts a journey before the person has an account', async () => {
    renderWithProviders(<NewHiresPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Start onboarding/ }));

    fireEvent.change(await screen.findByLabelText('Candidate name'), { target: { value: 'New Person' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Joining date'), { target: { value: '2026-09-01' } });

    fireEvent.click(screen.getAllByRole('button', { name: 'Start onboarding' }).slice(-1)[0]);

    await waitFor(() =>
      expect(apiMocks.create).toHaveBeenCalledWith({
        candidate_name: 'New Person',
        candidate_email: 'new@example.com',
        joining_date: '2026-09-01',
        job_title: undefined,
      })
    );
  });

  it('opens a joiner and completes one of their checklist items', async () => {
    apiMocks.show.mockResolvedValue({
      data: {
        data: journey({
          checklist_items: [
            {
              id: 7,
              title: 'Upload PAN card',
              description: null,
              owner_kind: 'employee',
              owner_user_id: null,
              owner: null,
              due_date: '2026-08-13',
              requires: 'document',
              is_blocking: true,
              status: 'pending',
              is_overdue: false,
              completed_at: null,
              notes: null,
              asset_assignment_id: null,
              sort_order: 10,
            },
          ],
        }),
      },
    });

    renderWithProviders(<NewHiresPage />);
    fireEvent.click(await screen.findByText('Priya Shah'));

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete Upload PAN card' }));

    await waitFor(() => expect(apiMocks.completeItem).toHaveBeenCalledWith(1, 7));
  });

  it('filters joiners by name', async () => {
    apiMocks.list.mockResolvedValue({
      data: {
        data: [
          journey({ id: 1, candidate_name: 'Priya Shah' }),
          journey({ id: 2, candidate_name: 'Arjun Bose' }),
        ],
      },
    });

    renderWithProviders(<NewHiresPage />);

    fireEvent.change(await screen.findByLabelText('Search joiners'), { target: { value: 'arjun' } });

    await waitFor(() => {
      expect(screen.getByText('Arjun Bose')).toBeInTheDocument();
      expect(screen.queryByText('Priya Shah')).not.toBeInTheDocument();
    });
  });
});
