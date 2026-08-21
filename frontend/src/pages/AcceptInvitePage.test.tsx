import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AcceptInvitePage from './AcceptInvitePage';
import { renderWithProviders } from '@/test/renderWithProviders';

/**
 * The screen where a joiner sets their very first password.
 *
 * It carried no hint of the rules at all — a bare box with the placeholder
 * "Create a password" — while the server enforced a length, four composition
 * rules and a breach check. So a new person's first act in the product was being
 * refused for a reason nobody had told them, repeatedly. That is what generated
 * the support questions; the length was only part of it.
 */

const mocks = vi.hoisted(() => ({
  getByToken: vi.fn(),
  acceptInvitation: vi.fn(),
  navigate: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  invitationApi: { getByToken: mocks.getByToken },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ acceptInvitation: mocks.acceptInvitation }),
}));

vi.mock('@/lib/analytics', () => ({
  analytics: { trackEvent: mocks.trackEvent },
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useParams: () => ({ token: 'abc123' }),
  };
});

const invitation = {
  invitation: {
    email: 'ava@acme.in',
    role: 'employee',
    organization: { name: 'Acme' },
    can_accept: true,
    status: 'pending',
  },
};

const renderPage = () =>
  renderWithProviders(<AcceptInvitePage />, { route: '/accept-invite/abc123' });

/**
 * Fill the form and press the button.
 *
 * Full Name is `required`, so leaving it empty stops the submit at the browser's
 * own validation — before any of the checks these tests are about.
 */
const submitWith = async (
  user: ReturnType<typeof userEvent.setup>,
  password: string,
  confirmation = password
) => {
  await user.type(await screen.findByPlaceholderText(/your full name/i), 'Ava Sharma');
  await user.type(screen.getByPlaceholderText(/create a password/i), password);
  await user.type(screen.getByPlaceholderText(/re-enter your password/i), confirmation);
  await user.click(screen.getByRole('button', { name: /create account/i }));
};

describe('AcceptInvitePage — the password rules are visible', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getByToken.mockResolvedValue({ data: invitation });
    mocks.acceptInvitation.mockResolvedValue({ success: true });
  });

  it('lists the requirements before anything is submitted', async () => {
    renderPage();

    // Previously nothing here said any of this.
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/upper and lower case/i)).toBeInTheDocument();
    expect(screen.getByText(/a symbol/i)).toBeInTheDocument();
    expect(screen.getByText(/checked against known data breaches/i)).toBeInTheDocument();
  });

  it('does not send a password the server would certainly refuse', async () => {
    /*
     * The round-trip this removes. A five-character password was posted, refused,
     * and the joiner was left to guess which rule they had broken — from a
     * message that named none of them.
     */
    const user = userEvent.setup();
    renderPage();

    await submitWith(user, 'abc12');

    expect(await screen.findByText(/does not meet the requirements/i)).toBeInTheDocument();
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it('still refuses a mismatch before checking strength', async () => {
    const user = userEvent.setup();
    renderPage();

    await submitWith(user, 'Abcd12!x', 'Abcd12!y');

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it('sends a compliant eight-character password', async () => {
    // Eight is the minimum now. This is the case that previously failed on
    // length alone despite meeting every other rule.
    const user = userEvent.setup();
    renderPage();

    await submitWith(user, 'Abcd12!x');

    await waitFor(() => expect(mocks.acceptInvitation).toHaveBeenCalled());
    expect(mocks.acceptInvitation.mock.calls[0][1]).toMatchObject({ password: 'Abcd12!x' });
  });

  it('shows the breach rejection the server sends back', async () => {
    // A password meeting every visible rule and still refused. Without the
    // server's own wording surfacing, this is the most baffling failure of the
    // lot.
    const user = userEvent.setup();
    mocks.acceptInvitation.mockRejectedValue({
      response: {
        status: 422,
        data: {
          message: 'The given data was invalid.',
          errors: {
            password: ['This password has appeared in a public data breach, so it is not safe to use here.'],
          },
        },
      },
    });

    renderPage();

    await submitWith(user, 'Passw0rd!');

    expect(await screen.findByText(/appeared in a public data breach/i)).toBeInTheDocument();
  });
});
