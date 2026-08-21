import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileOnboardingPage from './ProfileOnboardingPage';
import { renderWithProviders } from '@/test/renderWithProviders';

/**
 * The first-login profile form.
 *
 * It shipped unsubmittable: the API required `display_name`, this page never
 * collected it, and the error handler read only `data.message` — so a joiner who
 * filled everything in was told their data was invalid, in reference to a field
 * that was not on the screen. Skip was the only way past.
 *
 * These cover the half that lives here: that a problem is named, and named
 * against the control it belongs to.
 */

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  updateOnboardingProfile: vi.fn(),
  updatePreferences: vi.fn(),
  skipOnboardingProfile: vi.fn(),
  navigate: vi.fn(),
  // Stable identities. The page has an effect keyed on `user.settings`, so a
  // fresh object per render re-runs it, sets state, re-renders — until the
  // worker runs out of memory.
  user: { id: 1, name: 'Ava', email: 'ava@acme.in', settings: {}, employee_profile: null },
  updateUser: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  settingsApi: {
    me: mocks.me,
    updateOnboardingProfile: mocks.updateOnboardingProfile,
    updatePreferences: mocks.updatePreferences,
    skipOnboardingProfile: mocks.skipOnboardingProfile,
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user, updateUser: mocks.updateUser }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

/** A profile with every required field already filled, so submit is reachable. */
const completeProfile = {
  first_name: 'Ava',
  last_name: 'Sharma',
  gender: 'female',
  date_of_birth: '1996-04-12',
  phone: '9876543210',
  personal_email: 'ava.personal@example.test',
  address_line: '12 MG Road',
  city: 'Ahmedabad',
  state: 'Gujarat',
  postal_code: '380001',
  emergency_contact_name: 'Ravi Sharma',
  emergency_contact_number: '9876500000',
  emergency_contact_relationship: 'Sibling',
};

const renderPage = () =>
  renderWithProviders(<ProfileOnboardingPage />, { route: '/onboarding/profile' });

describe('ProfileOnboardingPage — telling the joiner what is wrong', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.me.mockResolvedValue({ data: { employee_profile: null, organization: {} } });
    mocks.updateOnboardingProfile.mockResolvedValue({ data: { user: { id: 1 } } });
    mocks.updatePreferences.mockResolvedValue({ data: {} });
  });

  it('names the field when an email is malformed, as soon as you leave it', async () => {
    // The point of validating on blur: a typo is caught while the joiner is
    // still looking at the box they made it in.
    const user = userEvent.setup();
    renderPage();

    const email = await screen.findByLabelText(/personal email/i);
    await user.clear(email);
    await user.type(email, 'not-an-email');
    await user.tab();

    expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
  });

  it('clears the message once the field is fixed', async () => {
    const user = userEvent.setup();
    renderPage();

    const email = await screen.findByLabelText(/personal email/i);
    await user.clear(email);
    await user.type(email, 'nope');
    await user.tab();
    await screen.findByText(/enter a valid email address/i);

    await user.clear(email);
    await user.type(email, 'ava@example.com');
    await user.tab();

    await waitFor(() => {
      expect(screen.queryByText(/enter a valid email address/i)).not.toBeInTheDocument();
    });
  });

  it('flags a required field left empty, by its label rather than its column', async () => {
    const user = userEvent.setup();
    renderPage();

    // Seeded from the account name, so it has to be emptied to be missing.
    const firstName = await screen.findByLabelText(/first name/i);
    await user.clear(firstName);
    await user.tab();

    // "first_name is required" reads as a stack trace, not an instruction.
    expect(await screen.findByText(/first name is required/i)).toBeInTheDocument();
  });

  it('refuses a future date of birth', async () => {
    const user = userEvent.setup();
    renderPage();

    const dob = await screen.findByLabelText(/date of birth/i);
    await user.clear(dob);
    await user.type(dob, '2099-01-01');
    await user.tab();

    expect(await screen.findByText(/cannot be in the future/i)).toBeInTheDocument();
  });
});

describe('ProfileOnboardingPage — what the server says', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Pre-filled, so the client-side pass lets the request through and the
    // server response is what the test is actually about.
    mocks.me.mockResolvedValue({
      data: { employee_profile: completeProfile, organization: {} },
    });
    mocks.updatePreferences.mockResolvedValue({ data: {} });
  });

  it('puts a 422 under the control it belongs to', async () => {
    /*
     * The regression that made this page unusable. Laravel puts the useful part
     * in `errors`, keyed by field; reading only `message` produced "your data is
     * invalid" with nothing to act on — and named a field that was not on the
     * screen.
     */
    const user = userEvent.setup();
    mocks.updateOnboardingProfile.mockRejectedValue({
      response: {
        status: 422,
        data: {
          message: 'The given data was invalid.',
          errors: { phone: ['That phone number is already registered.'] },
        },
      },
    });

    renderPage();

    await waitFor(async () =>
      expect(await screen.findByLabelText(/^phone$/i)).toHaveValue('9876543210')
    );

    await user.click(screen.getByRole('button', { name: /save|complete|continue/i }));

    expect(await screen.findByText(/that phone number is already registered/i)).toBeInTheDocument();
    // The generic server sentence is replaced by something actionable.
    expect(screen.queryByText(/the given data was invalid/i)).not.toBeInTheDocument();
  });

  it('submits and moves on when everything is valid', async () => {
    const user = userEvent.setup();
    mocks.updateOnboardingProfile.mockResolvedValue({ data: { user: { id: 1 } } });

    renderPage();

    await waitFor(async () =>
      expect(await screen.findByLabelText(/^phone$/i)).toHaveValue('9876543210')
    );

    await user.click(screen.getByRole('button', { name: /save|complete|continue/i }));

    await waitFor(() => expect(mocks.updateOnboardingProfile).toHaveBeenCalled());

    // No display_name: the server derives it. Sending one from here would mean
    // this page had a field for it, which is the bug it shipped with.
    expect(mocks.updateOnboardingProfile.mock.calls[0][0]).not.toHaveProperty('display_name');
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/dashboard', { replace: true }));
  });
});
