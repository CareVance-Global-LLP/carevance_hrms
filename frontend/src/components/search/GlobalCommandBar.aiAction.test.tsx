import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import GlobalCommandBar from './GlobalCommandBar';
import { searchAskApi } from '@/services/api';

vi.mock('@/services/api', () => ({
  searchAskApi: { ask: vi.fn(), summary: vi.fn(), act: vi.fn() },
  // The real one, near enough: the write path's refusal carries its sentence
  // in `message`, which is the key this reads first.
  getApiErrorMessage: (error: any, fallback: string) => error?.response?.data?.message ?? fallback,
  searchApi: {
    search: vi.fn().mockResolvedValue({ data: { results: [] } }),
    query: vi.fn().mockResolvedValue({ data: { data: [] } }),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1 },
    organization: { id: 1, plan_code: 'basic_payroll', max_seats: 50, subscription_status: 'active' },
    logout: vi.fn(),
    token: 'test-token',
  }),
}));

const preview = {
  kind: 'action' as const,
  action: {
    key: 'leave_type.update',
    label: 'Update a leave type',
    target: { id: 3, label: 'Casual Leave' },
    changes: [
      { field: 'carry_forward_cap', label: 'Carry-forward cap', from: 5, to: 10, unit: 'days' },
    ],
    unchanged: [],
    impact: 'Affects 47 employees',
    token: 'signed.token',
    message: null,
  },
  plan: null, columns: [], rows: [], notes: [], summary: null, truncated: false,
};

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function setup() {
  return render(
    <MemoryRouter>
      <GlobalCommandBar open onClose={() => {}} navigation={[]} />
    </MemoryRouter>,
  );
}

async function ask(question = 'change the casual leave carry-forward to 10 days') {
  setup();
  await userEvent.click(screen.getByRole('button', { name: /ai mode/i }));
  await userEvent.type(screen.getByRole('combobox'), `${question}{Enter}`);
}

describe('AI mode write actions', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * The diff is the server's, rendered as returned. `from` was read off the
   * live row when the preview was built and the token was signed over it, so
   * anything recomputed here would be a second opinion beside the one the
   * write is actually checked against.
   */
  it('shows the diff, the impact and an Apply button', async () => {
    mocked(searchAskApi.ask).mockResolvedValue({ data: preview });

    await ask();

    await waitFor(() => expect(screen.getByTestId('ai-action-preview')).toBeInTheDocument());

    expect(screen.getByText('Casual Leave')).toBeInTheDocument();
    expect(screen.getByText('Carry-forward cap')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('10 days')).toBeInTheDocument();
    expect(screen.getByText('Affects 47 employees')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing has changed yet/i)).toBeInTheDocument();
  });

  /**
   * THE DIRECTION OF THE DIFF IS SPOKEN, NOT ONLY DRAWN.
   *
   * The arrow is `aria-hidden` and the strike-through is CSS, so with neither
   * semantics nor words this card announced as "Carry-forward cap 5 10 days" —
   * a blind admin consenting to a write with no way to tell which number the
   * row holds today, on the one surface whose whole job is consent.
   */
  it('says which value is the old one and which is the new', async () => {
    mocked(searchAskApi.ask).mockResolvedValue({ data: preview });

    await ask();

    const card = await screen.findByTestId('ai-action-preview');
    const change = card.querySelector('dd');

    expect(change?.querySelector('del')).not.toBeNull();
    expect(change?.querySelector('ins')).not.toBeNull();
    expect(change?.textContent?.replace(/\s+/g, ' ').trim()).toBe('from 5 to 10 days');
  });

  /**
   * The summariser takes columns and rows. An action has neither, so calling it
   * posts an empty payload to something with nothing to summarise — and spends
   * a rate-limited call doing it.
   */
  it('does not summarise an action preview', async () => {
    mocked(searchAskApi.ask).mockResolvedValue({ data: preview });

    await ask();

    await waitFor(() => expect(screen.getByTestId('ai-action-preview')).toBeInTheDocument());
    expect(searchAskApi.summary).not.toHaveBeenCalled();
  });

  /** Apply posts the token and nothing else. There is nothing here to compose. */
  it('applies the previewed token and reports where to see it', async () => {
    mocked(searchAskApi.ask).mockResolvedValue({ data: preview });
    mocked(searchAskApi.act).mockResolvedValue({
      data: {
        applied: true,
        message: 'Casual Leave carry-forward cap changed from 5 to 10 days.',
        route: '/settings?pane=leave-types',
      },
    });

    await ask();
    await waitFor(() => expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() =>
      expect(screen.getByText('Casual Leave carry-forward cap changed from 5 to 10 days.')).toBeInTheDocument(),
    );

    expect(searchAskApi.act).toHaveBeenCalledWith('signed.token');
    expect(screen.getByRole('link', { name: /view it/i })).toHaveAttribute(
      'href',
      '/settings?pane=leave-types',
    );
    expect(screen.queryByRole('button', { name: /^apply$/i })).not.toBeInTheDocument();
  });

  /**
   * A refused Apply keeps the diff AND the button, and the sentence is the
   * server's verbatim. The person needs to see what was refused, and a panel
   * that hid its own control would leave them unable to retry once the cause is
   * fixed. `rejected` is the endpoint's own objection, so the diff above it is
   * still a true description of the row.
   */
  it('keeps the diff and the button when the apply is refused', async () => {
    mocked(searchAskApi.ask).mockResolvedValue({ data: preview });
    mocked(searchAskApi.act).mockRejectedValue({
      response: {
        status: 422,
        data: {
          error: 'action_refused',
          refusal: 'rejected',
          message: 'A leave type cannot carry forward more than it accrues.',
        },
      },
    });

    await ask();
    await waitFor(() => expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() =>
      expect(
        screen.getByText('A leave type cannot carry forward more than it accrues.'),
      ).toBeInTheDocument(),
    );

    expect(screen.getByText('Carry-forward cap')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing has changed yet/i)).toBeInTheDocument();

    /*
     * AND IT IS ANNOUNCED. Applying succeeds into a `role="status"` notice and
     * takes the focus with it; a refusal leaves the button where it was and
     * prints a sentence, so without a live region the one outcome where
     * NOTHING happened was the only one a screen reader could not distinguish
     * from success.
     */
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A leave type cannot carry forward more than it accrues.',
    );
  });

  /**
   * A STALE refusal makes the diff above it untrue — the row moved. Apply would
   * be a button guaranteed to refuse, so it is withdrawn and Ask again takes
   * its slot, which is where the focus goes too.
   */
  it('offers to ask again when the row moved under the preview', async () => {
    mocked(searchAskApi.ask).mockResolvedValue({ data: preview });
    mocked(searchAskApi.act).mockRejectedValue({
      response: {
        status: 422,
        data: {
          error: 'action_refused',
          refusal: 'stale',
          message: 'Carry-forward cap is now 7, not 5. Ask again for a fresh preview.',
        },
      },
    });

    await ask();
    await waitFor(() => expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    const reask = await screen.findByRole('button', { name: /ask again/i });

    expect(
      screen.getByText('Carry-forward cap is now 7, not 5. Ask again for a fresh preview.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^apply$/i })).not.toBeInTheDocument();
    // Focus followed the button that replaced Apply, rather than dropping to
    // <body> and costing a keyboard user their place.
    expect(reask).toHaveFocus();

    // Asking again re-runs the ORIGINAL question, not whatever is in the field.
    mocked(searchAskApi.ask).mockClear();
    await userEvent.click(reask);
    await waitFor(() =>
      expect(searchAskApi.ask).toHaveBeenCalledWith(
        'change the casual leave carry-forward to 10 days',
      ),
    );
  });

  /**
   * Cancel drops the proposal and nothing else. It must not post anything —
   * there is nothing to undo, because a preview writes nothing — and it must
   * not close the palette, which Escape already does.
   */
  it('discards the preview on Cancel without posting anything', async () => {
    mocked(searchAskApi.ask).mockResolvedValue({ data: preview });

    await ask();
    await waitFor(() => expect(screen.getByTestId('ai-action-preview')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => expect(screen.queryByTestId('ai-action-preview')).not.toBeInTheDocument());
    expect(searchAskApi.act).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  /**
   * Tab order follows the DOM, and the DOM follows the screen: the field, the
   * mode toggle that sits beside it, then Apply and Cancel in the card below.
   * Nothing is skipped and nothing jumps backwards, and Apply is activatable
   * without a pointer.
   */
  it('reaches Apply then Cancel by keyboard, in that order', async () => {
    mocked(searchAskApi.ask).mockResolvedValue({ data: preview });

    await ask();
    await waitFor(() => expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument());

    screen.getByRole('combobox').focus();

    // The AI toggle lives in the input row, to the right of the field.
    await userEvent.tab();
    expect(screen.getByRole('button', { name: /ai mode/i })).toHaveFocus();

    await userEvent.tab();
    expect(screen.getByRole('button', { name: /^apply$/i })).toHaveFocus();

    await userEvent.tab();
    expect(screen.getByRole('button', { name: /^cancel$/i })).toHaveFocus();

    mocked(searchAskApi.act).mockResolvedValue({
      data: { applied: true, message: 'Done.', route: null },
    });
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: /^apply$/i })).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(searchAskApi.act).toHaveBeenCalledWith('signed.token'));
  });

  /**
   * A preview with nothing to change carries no token, and therefore no button.
   * Offering one ends in "that preview has expired" for a change nobody needed.
   */
  it('offers no Apply button when the row already holds the value', async () => {
    mocked(searchAskApi.ask).mockResolvedValue({
      data: {
        ...preview,
        action: {
          ...preview.action,
          changes: [],
          unchanged: [{ field: 'carry_forward_cap', label: 'Carry-forward cap', value: 10 }],
          token: null,
          message: 'Casual Leave already has carry-forward cap set to 10.',
        },
      },
    });

    await ask();

    await waitFor(() =>
      expect(screen.getByText('Casual Leave already has carry-forward cap set to 10.')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /^apply$/i })).not.toBeInTheDocument();
  });

  /**
   * §6: a refused CHANGE is not an unanswered question. Rendering it under
   * "I can't answer that from your HR data" says the wrong thing about what
   * just happened.
   */
  it('gives a refused change its own heading', async () => {
    mocked(searchAskApi.ask).mockRejectedValue({
      response: {
        status: 422,
        data: {
          kind: 'refusal',
          error: 'action_refused',
          refusal: 'unknown_action',
          message: 'There is no action for deleting an employee.',
          detail: 'There is no action for deleting an employee.',
        },
      },
    });

    await ask('delete all employees');

    await waitFor(() =>
      expect(screen.getByText('There is no action for deleting an employee.')).toBeInTheDocument(),
    );
    expect(screen.getByText("I haven't changed anything.")).toBeInTheDocument();
    expect(screen.queryByText(/can't answer that from your HR data/i)).not.toBeInTheDocument();
  });
});
