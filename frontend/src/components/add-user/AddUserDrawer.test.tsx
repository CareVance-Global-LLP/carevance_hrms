import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddUserDrawer from './AddUserDrawer';
import { renderWithProviders } from '@/test/renderWithProviders';

/*
 * Characterization tests, written before splitting the 924-line shell apart.
 *
 * Nothing rendered this component before — 20 useState calls and five effects
 * with no coverage at all. These pin the behaviour that has to survive the
 * refactor: which route is showing, what each one collects, and that switching
 * routes does not carry state across. They assert what the component DOES
 * today, not what it should do; anything wrong stays wrong here and is changed
 * deliberately in a later commit.
 */

const mocks = vi.hoisted(() => ({
  fetchGroups: vi.fn(),
  fetchProjects: vi.fn(),
  inviteByEmail: vi.fn(),
  generateInviteLink: vi.fn(),
  loadDefaults: vi.fn(),
  billingCurrent: vi.fn(),
}));

vi.mock('@/services/addUser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/addUser')>();
  return {
    ...actual,
    addUserService: {
      fetchGroups: mocks.fetchGroups,
      fetchProjects: mocks.fetchProjects,
      inviteByEmail: mocks.inviteByEmail,
      generateInviteLink: mocks.generateInviteLink,
      loadDefaults: mocks.loadDefaults,
      saveDefaults: vi.fn(),
      clearDefaults: vi.fn(),
      downloadCsvTemplate: vi.fn(),
      parseCsvFile: vi.fn(),
      importCsv: vi.fn(),
    },
  };
});

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  billingApi: { current: mocks.billingCurrent },
  organizationApi: { getMembers: vi.fn().mockResolvedValue({ data: [] }) },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    organization: { id: 1, name: 'Acme' },
    user: { id: 1, name: 'Admin', role: 'admin' },
  }),
}));

vi.mock('@/lib/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/permissions')>();
  return { ...actual, getAssignableRoles: () => ['employee', 'manager', 'admin'] };
});

// The Create User wizard is covered by its own suite and pulls a large tree.
vi.mock('@/components/add-user/CustomAddUserPanel', () => ({
  default: () => <div data-testid="create-user-panel" />,
}));

const renderDrawer = () =>
  renderWithProviders(<AddUserDrawer open onClose={vi.fn()} presentation="inline" />, {
    route: '/add-user',
  });

describe('AddUserDrawer — routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadDefaults.mockReturnValue({ groupIds: [], remember: false });
    mocks.fetchGroups.mockResolvedValue([]);
    mocks.fetchProjects.mockResolvedValue([]);
    mocks.billingCurrent.mockResolvedValue({ data: { seats: { max: 25, used: 13, remaining: 12 } } });
  });

  it('offers all four routes', () => {
    renderDrawer();

    expect(screen.getByRole('button', { name: /create user/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /invite by email/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /invite by link/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add by csv/i })).toBeInTheDocument();
  });

  it('opens on Create User', () => {
    renderDrawer();
    expect(screen.getByTestId('create-user-panel')).toBeInTheDocument();
  });

  it('describes the consequence of the selected route, not a generic blurb', async () => {
    const user = userEvent.setup();
    renderDrawer();

    // Create User: the admin sets the password, so nothing is emailed.
    expect(screen.getByText(/you set the password/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /invite by email/i }));

    // Invite by Email: the recipient sets it, and onboarding waits for accept.
    expect(await screen.findByText(/recipient sets their own password/i)).toBeInTheDocument();
  });

  it('shows the email recipient input only on the email route', async () => {
    const user = userEvent.setup();
    renderDrawer();

    expect(screen.queryByPlaceholderText(/type or paste email/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /invite by email/i }));

    expect(await screen.findByPlaceholderText(/type or paste email/i)).toBeInTheDocument();
  });

  it('shows the link generator only on the link route', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole('button', { name: /invite by link/i }));

    /*
     * Two of them today: InviteLinkPanel renders its own generate button and
     * the drawer footer renders a second one for the same action. Pinned as-is
     * — the duplicate is a real finding for the redesign, not something to
     * quietly change under a refactor.
     */
    const generateButtons = await screen.findAllByRole('button', { name: /generate invite link/i });
    expect(generateButtons).toHaveLength(2);
    expect(screen.queryByPlaceholderText(/type or paste email/i)).not.toBeInTheDocument();
  });
});

describe('AddUserDrawer — email recipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadDefaults.mockReturnValue({ groupIds: [], remember: false });
    mocks.fetchGroups.mockResolvedValue([]);
    mocks.fetchProjects.mockResolvedValue([]);
    mocks.billingCurrent.mockResolvedValue({ data: { seats: { max: 25, used: 13, remaining: 12 } } });
  });

  const goToEmail = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /invite by email/i }));
    return screen.findByPlaceholderText(/type or paste email/i);
  };

  it('turns a typed address into a recipient chip', async () => {
    const user = userEvent.setup();
    renderDrawer();

    const input = await goToEmail(user);
    await user.type(input, 'asha@acme.in{Enter}');

    // findAllByText, not findByText: the address is rendered twice on purpose —
    // once as the chip and once as the label of its employee-code row.
    expect(await screen.findAllByText('asha@acme.in')).not.toHaveLength(0);
  });

  it('shows the access level on the chip instead of a per-recipient control', async () => {
    const user = userEvent.setup();
    renderDrawer();

    const input = await goToEmail(user);
    await user.type(input, 'asha@acme.in{Enter}');
    await user.type(input, 'ravi@acme.in{Enter}');

    /*
     * There used to be a <select> on every chip. It contradicted the Access
     * Level control above it — two places setting the same thing — and could
     * only ever offer the three built-in roles, so choosing an admin-defined
     * role above and then touching a chip silently discarded it. One control
     * owns the decision now and the chips report it read-only.
     */
    expect(screen.queryByRole('combobox', { name: /role for asha@acme\.in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /role for ravi@acme\.in/i })).not.toBeInTheDocument();

    // One label per chip, naming the level every recipient will be invited at.
    expect(screen.getAllByText('Employee').length).toBeGreaterThanOrEqual(2);
  });

  it('gives every recipient an employee-code field of their own', async () => {
    const user = userEvent.setup();
    renderDrawer();

    const input = await goToEmail(user);
    await user.type(input, 'asha@acme.in{Enter}');
    await user.type(input, 'ravi@acme.in{Enter}');

    // The code identifies the person, so unlike every other field in this
    // drawer it cannot be shared across the batch.
    const asha = screen.getByRole('textbox', { name: /employee code for asha@acme\.in/i });
    await user.type(asha, 'EMP-001');

    expect(asha).toHaveValue('EMP-001');
    expect(screen.getByRole('textbox', { name: /employee code for ravi@acme\.in/i })).toHaveValue('');
  });

  it('drops a recipient and their employee code together', async () => {
    const user = userEvent.setup();
    renderDrawer();

    const input = await goToEmail(user);
    await user.type(input, 'asha@acme.in{Enter}');
    await user.click(screen.getByRole('button', { name: /remove asha@acme\.in/i }));

    await waitFor(() => {
      // Both renderings must go — chip and employee-code row alike.
      expect(screen.queryAllByText('asha@acme.in')).toHaveLength(0);
    });
  });
});

describe('AddUserDrawer — a batch that is not all the same', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadDefaults.mockReturnValue({ groupIds: [], remember: false });
    mocks.fetchGroups.mockResolvedValue([
      { id: 1, name: 'Operations', description: '3 members' },
      { id: 2, name: 'Sales', description: '1 member' },
    ]);
    mocks.fetchProjects.mockResolvedValue([]);
    mocks.billingCurrent.mockResolvedValue({ data: { seats: { max: 25, used: 13, remaining: 12 } } });
    mocks.inviteByEmail.mockResolvedValue({ invitedCount: 2, failed: [], deferredAssignments: [] });
  });

  const goToEmail = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /invite by email/i }));
    return screen.findByPlaceholderText(/type or paste email/i);
  };

  it('sends two departments and two access levels in one go', async () => {
    // This is the loop the table exists to close: two joiners in different
    // departments used to be two separate trips through the whole form.
    const user = userEvent.setup();
    renderDrawer();

    const input = await goToEmail(user);
    await user.type(input, 'asha@acme.in{Enter}');
    await user.type(input, 'ravi@acme.in{Enter}');

    await user.click(await screen.findByRole('button', { name: 'Department for ravi@acme.in' }));
    await user.click(await screen.findByRole('option', { name: 'Sales' }));

    await user.click(screen.getByRole('button', { name: 'Access level for ravi@acme.in' }));
    await user.click(await screen.findByRole('option', { name: 'Manager' }));

    await user.type(screen.getByRole('textbox', { name: 'Employee code for asha@acme.in' }), 'EMP-001');

    await user.click(screen.getByRole('button', { name: /send 2 invites/i }));

    await waitFor(() => expect(mocks.inviteByEmail).toHaveBeenCalledTimes(1));
    expect(mocks.inviteByEmail.mock.calls[0][0]).toMatchObject({
      emails: ['asha@acme.in', 'ravi@acme.in'],
      role: 'employee',
      overridesByEmail: { 'ravi@acme.in': { groupId: 2, role: 'manager' } },
      employeeCodeByEmail: { 'asha@acme.in': 'EMP-001' },
    });
  });

  it('shows the override on the chip so it cannot contradict the row below', async () => {
    const user = userEvent.setup();
    renderDrawer();

    const input = await goToEmail(user);
    await user.type(input, 'ravi@acme.in{Enter}');

    await user.click(await screen.findByRole('button', { name: 'Access level for ravi@acme.in' }));
    await user.click(await screen.findByRole('option', { name: 'Admin' }));

    // Anchored on the chip's own remove button, because the address is also
    // rendered in the table row and the select below reads 'Admin' as well.
    await waitFor(() => {
      const chip = screen.getByRole('button', { name: /remove ravi@acme\.in/i }).closest('span');
      expect(chip).toHaveTextContent('Admin');
    });
  });

  it('clears the overrides once the batch has been sent', async () => {
    // A stale override would silently apply to whoever is invited next.
    const user = userEvent.setup();
    renderDrawer();

    const input = await goToEmail(user);
    await user.type(input, 'asha@acme.in{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Department for asha@acme.in' }));
    await user.click(await screen.findByRole('option', { name: 'Sales' }));
    await user.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => expect(mocks.inviteByEmail).toHaveBeenCalled());

    await user.type(await screen.findByPlaceholderText(/type or paste email/i), 'later@acme.in{Enter}');

    expect(await screen.findByRole('button', { name: 'Department for later@acme.in' }))
      .toHaveTextContent('Use default');
  });
});
