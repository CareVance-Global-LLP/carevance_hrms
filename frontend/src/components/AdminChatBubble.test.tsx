import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminChatBubble from '@/components/AdminChatBubble';
import { renderWithProviders } from '@/test/renderWithProviders';

const chat = vi.hoisted(() => vi.fn());
const dialogOpen = vi.hoisted(() => ({ value: false }));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { ...actual, aiChatApi: { chat } };
});

vi.mock('@/components/ui/dialog', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/dialog')>('@/components/ui/dialog');
  return { ...actual, useAnyDialogOpen: () => dialogOpen.value };
});

const reply = (content: string, sources: Array<{ label: string; route: string }> = []) =>
  Promise.resolve({ data: { reply: content, sources } });

describe('AdminChatBubble', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogOpen.value = false;
    window.localStorage.clear();
  });

  const open = async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminChatBubble />);
    await user.click(screen.getByRole('button', { name: /assistant/i }));
    return user;
  };

  // By role, not by placeholder: the placeholder is copy and changes with the
  // design; the composer being the panel's one text field does not.
  const ask = async (user: Awaited<ReturnType<typeof open>>, question: string) => {
    await user.type(screen.getByRole('textbox'), question);
    await user.keyboard('{Enter}');
  };

  /*
   * The citation contract, at the surface where it matters. An admin told "6
   * approvals are pending" must be one click from the six records — that link
   * is the difference between a number they can act on and a number they have
   * to go and re-verify by hand.
   */
  it('renders a link to the record behind an answer', async () => {
    chat.mockReturnValue(reply('6 requests are waiting on you.', [
      { label: 'Approval Inbox', route: '/approval-inbox' },
    ]));

    const user = await open();
    await ask(user, 'How many approvals are pending?');

    const source = await screen.findByRole('link', { name: /approval inbox/i });
    expect(source).toHaveAttribute('href', '/approval-inbox');
  });

  it('renders one link per distinct source', async () => {
    chat.mockReturnValue(reply('Here is your rundown.', [
      { label: 'Approval Inbox', route: '/approval-inbox' },
      { label: 'Attendance', route: '/attendance' },
    ]));

    const user = await open();
    await ask(user, 'Give me a rundown');

    expect(await screen.findByRole('link', { name: /approval inbox/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /attendance/i })).toBeInTheDocument();
  });

  /*
   * An answer drawn from the assistant's own knowledge has no record behind it.
   * Showing a "Sources" heading with nothing under it would imply otherwise.
   */
  it('shows no source area when an answer had no tool behind it', async () => {
    chat.mockReturnValue(reply('Go to Settings → Organization to rename the company.'));

    const user = await open();
    await ask(user, 'How do I rename the company?');

    // findAllByText: the message text also matches its wrapper elements.
    await screen.findAllByText(/rename the company/i);
    expect(screen.queryByText(/^sources$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  /*
   * The bubble is pinned bottom-right at z-[100]; dialogs start at z-50. It sat
   * on top of every Modal and SlideOver footer — the corner holding the primary
   * button — and covered "Save settings" on the employee drawer. Unmounting
   * rather than dimming also keeps it out of the dialog's focus trap.
   */
  it('steps aside while a dialog is open', () => {
    dialogOpen.value = true;
    renderWithProviders(<AdminChatBubble />);

    expect(screen.queryByRole('button', { name: /assistant/i })).not.toBeInTheDocument();
  });

  it('surfaces a contactable error when the assistant cannot be reached', async () => {
    chat.mockRejectedValue(new Error('network down'));

    const user = await open();
    await ask(user, 'Anything pending?');

    await waitFor(() => {
      expect(screen.getByText(/trouble connecting/i)).toBeInTheDocument();
    });
  });
});
