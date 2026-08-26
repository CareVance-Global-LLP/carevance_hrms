import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExitsPage from '@/pages/ExitsPage';
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
  advance: vi.fn(),
  completeItem: vi.fn().mockResolvedValue({ data: {} }),
  reopenItem: vi.fn().mockResolvedValue({ data: {} }),
  revokeAccess: vi.fn().mockResolvedValue({ data: {} }),
  saveInterview: vi.fn().mockResolvedValue({ data: {} }),
  setRehireEligibility: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => authState.value }));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { ...actual, exitApi: apiMocks };
});

const item = (over: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Collect MacBook Pro (AST-1)',
  description: null,
  owner_kind: 'it',
  owner_user_id: null,
  owner: null,
  due_date: '2026-08-30',
  requires: 'asset_return',
  is_blocking: true,
  status: 'pending',
  is_overdue: false,
  completed_at: null,
  notes: null,
  asset_assignment_id: 5,
  sort_order: 900,
  ...over,
});

const exitRecord = (over: Record<string, unknown> = {}) => ({
  id: 10,
  user_id: 2,
  resignation_id: 3,
  exit_type: 'resignation',
  exit_reason: null,
  last_working_date: '2026-08-30',
  notice_period_days: 30,
  served_days: 30,
  shortfall_days: 0,
  stage: 'clearance',
  days_remaining: 25,
  clearance_progress: { total: 4, done: 1, blocking_outstanding: 1 },
  clearance_completed_at: null,
  access_revoked_at: null,
  rehire_eligibility: 'undecided',
  rehire_note: null,
  rehire_decided_at: null,
  rejoined_at: null,
  previous_joining_date: null,
  user: { id: 2, name: 'Zara Khan', email: 'zara@example.com' },
  checklist_items: [item()],
  interview: null,
  ...over,
});

describe('ExitsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.list.mockResolvedValue({ data: { data: [exitRecord()] } });
    apiMocks.show.mockResolvedValue({ data: { data: exitRecord() } });
    apiMocks.advance.mockResolvedValue({ data: { data: exitRecord({ stage: 'settlement' }) } });
    apiMocks.setRehireEligibility.mockResolvedValue({
      data: { data: exitRecord({ rehire_eligibility: 'not_eligible' }) },
    });
  });

  it('groups exits by the stage they are actually in', async () => {
    renderWithProviders(<ExitsPage />);

    expect(await screen.findByRole('heading', { name: 'Exits' })).toBeInTheDocument();
    expect(screen.getByText('Clearance')).toBeInTheDocument();
    expect(screen.getByText('Zara Khan')).toBeInTheDocument();
  });

  it('surfaces how many exits are blocked on clearance', async () => {
    renderWithProviders(<ExitsPage />);

    expect(await screen.findByText('1 blocked on clearance')).toBeInTheDocument();
  });

  it('shows the settlement gate as a disabled control rather than letting the click fail', async () => {
    renderWithProviders(<ExitsPage />);

    fireEvent.click(await screen.findByText('Zara Khan'));

    // The drawer mounts before its detail query resolves, so wait for content.
    const gate = await screen.findByRole('button', { name: 'Blocked by clearance' });

    expect(gate).toBeDisabled();
    expect(apiMocks.advance).not.toHaveBeenCalled();
  });

  it('allows settlement once nothing blocking is outstanding', async () => {
    apiMocks.show.mockResolvedValue({
      data: {
        data: exitRecord({
          clearance_progress: { total: 4, done: 4, blocking_outstanding: 0 },
          checklist_items: [item({ status: 'done' })],
        }),
      },
    });

    renderWithProviders(<ExitsPage />);
    fireEvent.click(await screen.findByText('Zara Khan'));

    const gate = await screen.findByRole('button', { name: 'Move to settlement' });
    expect(gate).toBeEnabled();

    fireEvent.click(gate);
    await waitFor(() => expect(apiMocks.advance).toHaveBeenCalledWith(10, 'settlement'));
  });

  it('completes a clearance item from the drawer', async () => {
    renderWithProviders(<ExitsPage />);
    fireEvent.click(await screen.findByText('Zara Khan'));

    fireEvent.click(await screen.findByRole('checkbox', { name: /Complete Collect MacBook Pro/ }));

    await waitFor(() => expect(apiMocks.completeItem).toHaveBeenCalledWith(10, 1));
  });

  it('records an exit interview reason', async () => {
    renderWithProviders(<ExitsPage />);
    fireEvent.click(await screen.findByText('Zara Khan'));

    fireEvent.change(await screen.findByLabelText('Primary reason for leaving'), {
      target: { value: 'compensation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save interview' }));

    await waitFor(() =>
      expect(apiMocks.saveInterview).toHaveBeenCalledWith(10, {
        primary_reason: 'compensation',
        comments: null,
      })
    );
  });

  it('lets HR record that somebody is not eligible for rehire', async () => {
    renderWithProviders(<ExitsPage />);
    fireEvent.click(await screen.findByText('Zara Khan'));

    const control = await screen.findByLabelText('Rehire decision');
    fireEvent.change(control, { target: { value: 'not_eligible' } });
    fireEvent.change(screen.getByLabelText('Rehire note'), {
      target: { value: 'Left mid-handover with the client account open.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save rehire decision' }));

    await waitFor(() =>
      expect(apiMocks.setRehireEligibility).toHaveBeenCalledWith(10, {
        rehire_eligibility: 'not_eligible',
        note: 'Left mid-handover with the client account open.',
      })
    );
  });

  it("keeps the employer's rehire decision distinct from the leaver's own answer", async () => {
    apiMocks.show.mockResolvedValue({
      data: {
        data: exitRecord({
          rehire_eligibility: 'not_eligible',
          interview: {
            id: 4,
            primary_reason: 'compensation',
            responses: null,
            would_recommend: 8,
            would_rejoin: true,
            comments: null,
            submitted_at: '2026-08-20T00:00:00Z',
          },
        }),
      },
    });

    renderWithProviders(<ExitsPage />);
    fireEvent.click(await screen.findByText('Zara Khan'));

    /*
     * The two answers disagree here on purpose: somebody can want to come back
     * to an organisation that would not have them, and a single merged badge
     * would let an HR user read one and act on the other.
     */
    expect(await screen.findByText('Rehire decision (ours)')).toBeInTheDocument();
    // Twice over: the badge, and the selected option in the control beneath it.
    expect(screen.getAllByText('Not eligible for rehire').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Rehire decision')).toHaveValue('not_eligible');
    expect(screen.getByText(/Would they rejoin\? \(their answer\)/)).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
  });

  it('shows the earlier service start on a rehired exit', async () => {
    apiMocks.show.mockResolvedValue({
      data: {
        data: exitRecord({
          stage: 'closed',
          rehire_eligibility: 'eligible',
          rejoined_at: '2026-08-25T00:00:00Z',
          previous_joining_date: '2021-04-01',
        }),
      },
    });

    renderWithProviders(<ExitsPage />);
    fireEvent.click(await screen.findByText('Zara Khan'));

    /*
     * The rejoin re-based employee_work_infos.joining_date so gratuity's
     * five-year continuous-service clock restarts. The earlier period survives
     * on this row and nowhere else, which is why it has to be readable here.
     */
    expect(await screen.findByText(/earlier service started Apr 1, 2021/)).toBeInTheDocument();
  });

  it('does not offer the rehire control to somebody who cannot record the decision', async () => {
    authState.value = {
      ...authState.value,
      user: { ...authState.value.user, role: 'manager', hierarchy_level: 50 } as any,
    };

    try {
      renderWithProviders(<ExitsPage />);
      fireEvent.click(await screen.findByText('Zara Khan'));

      // The badge still reads — a line manager may see the decision, not take it.
      expect(await screen.findByText('Rehire decision (ours)')).toBeInTheDocument();
      expect(screen.queryByLabelText('Rehire decision')).not.toBeInTheDocument();
    } finally {
      authState.value = {
        ...authState.value,
        user: { id: 1, name: 'Admin', email: 'admin@example.com', role: 'admin', organization_id: 1 },
      };
    }
  });
});
