import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomAddUserPanel from '@/components/add-user/CustomAddUserPanel';
import { renderWithProviders } from '@/test/renderWithProviders';

/*
 * The point of these tests is *when* the network call happens, not what it
 * returns.
 *
 * The wizard creates the account from an effect that runs when step 3 mounts,
 * so before this fix an over-long phone number typed on step 1 was accepted by
 * the browser, carried through step 2, and only rejected by the server once the
 * user reached step 3 — the error appearing two steps from the field that
 * caused it. Each test below asserts that invalid input never reaches the API.
 */

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  default: {
    post: mocks.post,
    get: mocks.get,
    put: mocks.put,
    patch: mocks.patch,
    delete: mocks.del,
  },
  payrollApi: {
    getPayGroups: vi.fn().mockResolvedValue({ data: { pay_groups: [] } }),
    getSalaryStructures: vi.fn().mockResolvedValue({ data: { data: [] } }),
  },
  groupApi: {
    getAll: vi.fn().mockResolvedValue({
      data: {
        data: [
          { id: 1, name: 'Recruitment' },
          { id: 2, name: 'Engineering' },
        ],
      },
    }),
  },
}));

// Step 3 fetches an employee workspace that does not exist yet; not the subject.
vi.mock('@/components/EmployeeDetailsSection', () => ({ default: () => null }));

const fillValidStep1 = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByPlaceholderText("John"), 'Priya');
  await user.type(screen.getByPlaceholderText("john@company.com"), 'priya@example.com');
  await user.type(screen.getByPlaceholderText("+91 98765 43210"), '9876543210');
  await user.type(screen.getByPlaceholderText("e.g., Software Engineer"), 'Data Analyst');
  await user.click(screen.getByRole('button', { name: /recruitment/i }));
};

const clickNext = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /create account|continue/i }));
};

describe('Add User wizard — validation happens before the network', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The wizard persists its step and form to localStorage and restores them
    // on mount, so without this each test would resume the previous one's draft.
    localStorage.clear();
    mocks.get.mockResolvedValue({ data: { exists: false, incomplete: false } });
    mocks.post.mockResolvedValue({ data: { id: 42, userId: 42 } });
  });

  it('does not call the API when the phone number is longer than the server allows', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CustomAddUserPanel organizationId={1} allowedRoles={["employee","manager","admin"]} onSuccess={vi.fn()} onError={vi.fn()} />);

    await fillValidStep1(user);

    const phone = screen.getByPlaceholderText('+91 98765 43210') as HTMLInputElement;
    await user.clear(phone);

    /*
     * Forced past the field's maxLength with a direct change event, because the
     * test DOM does not enforce maxLength the way a browser does. That is the
     * point: maxLength is the first line of defence, and the validator is the
     * one that has to hold when something gets around it.
     */
    fireEvent.change(phone, { target: { value: '9'.repeat(120) } });

    await clickNext(user);

    expect(await screen.findByText('Use 64 characters or fewer')).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalledWith('/users', expect.anything());
  });

  it('blocks step 1 and names the field when required details are missing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CustomAddUserPanel organizationId={1} allowedRoles={["employee","manager","admin"]} onSuccess={vi.fn()} onError={vi.fn()} />);

    await clickNext(user);

    expect(await screen.findByText('First name is required')).toBeInTheDocument();
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Designation is required')).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('keeps an employee in a single department', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CustomAddUserPanel organizationId={1} allowedRoles={["employee","manager","admin"]} onSuccess={vi.fn()} onError={vi.fn()} />);

    await fillValidStep1(user);
    await user.click(screen.getByRole('button', { name: /engineering/i }));

    // Selecting a second department replaces the first rather than being
    // accepted and rejected later by assertSingleGroupMembershipLimit.
    await clickNext(user);
    await waitFor(() => {
      expect(screen.queryByText(/only one department/i)).not.toBeInTheDocument();
    });
  });

  it('shows one error when creation fails, not two contradictory ones', async () => {
    // A 500 leaves no field to blame, so it falls through to the single banner.
    mocks.post.mockRejectedValueOnce({ response: { status: 500, data: {} } });

    const user = userEvent.setup();
    renderWithProviders(<CustomAddUserPanel organizationId={1} allowedRoles={["employee","manager","admin"]} onSuccess={vi.fn()} onError={vi.fn()} />);

    await fillValidStep1(user);
    await clickNext(user);           // step 1 -> 2
    await clickNext(user);           // step 2 -> 3, which fires the create

    const failure = await screen.findByText(/something went wrong on our end/i);
    expect(failure).toBeInTheDocument();

    /*
     * The Complete button used to stay live through a failed create, and
     * pressing it raised "Account is still being created" — which then sat
     * stacked on top of the failure message, telling the user two opposite
     * things at once. It is now disabled, so the second message is unreachable.
     */
    const complete = screen.getByRole('button', { name: /complete/i });
    expect(complete).toBeDisabled();
    expect(screen.queryByText(/still being created/i)).not.toBeInTheDocument();
  });

  it('sends a server field error back to the field that caused it', async () => {
    mocks.post.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { errors: { phone: ['The phone field must not be greater than 64 characters.'] } },
      },
    });

    const user = userEvent.setup();
    renderWithProviders(<CustomAddUserPanel organizationId={1} allowedRoles={["employee","manager","admin"]} onSuccess={vi.fn()} onError={vi.fn()} />);

    await fillValidStep1(user);
    await clickNext(user);
    await clickNext(user);

    // Back on step 1, with the message attached to the offending input — rather
    // than as anonymous red text on step 3, two steps from the field.
    expect(
      await screen.findByText('The phone field must not be greater than 64 characters.')
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('+91 98765 43210')).toBeInTheDocument();
  });

  it('accepts a future joining date, because pre-boarding is the normal path', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CustomAddUserPanel organizationId={1} allowedRoles={["employee","manager","admin"]} onSuccess={vi.fn()} onError={vi.fn()} />);

    await fillValidStep1(user);

    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    // Selected by type: the "Joining Date" label is not associated with its
    // input, so getByLabelText cannot reach it.
    const joining = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(joining, { target: { value: nextMonth.toISOString().split('T')[0] } });

    await clickNext(user);

    // Previously Next did nothing here and showed no error at all, because the
    // gate demanded a date on or before today while the validator allowed two
    // years out — so it produced no message to display.
    await waitFor(() => {
      expect(screen.getByText(/review details/i)).toBeInTheDocument();
    });
  });
});
