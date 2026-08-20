import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminChatBubble from '@/components/AdminChatBubble';
import LandingPageChatBubble from '@/components/LandingPageChatBubble';
import { CHAT_HEADER_CLASS, CHAT_LAUNCHER_CLASS, CHAT_PANEL_CLASS } from '@/components/ui/chatChrome';
import { renderWithProviders } from '@/test/renderWithProviders';

const chat = vi.hoisted(() => vi.fn());

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { ...actual, aiChatApi: { chat } };
});

/*
 * There are two assistant bubbles — the admin one inside the app and the sales
 * one on the marketing pages — and they drifted into two different-looking
 * widgets: a bare 56px circle against a 14px rounded square, a flat header
 * against a gradient one, two bot avatars tinted differently, and two accent
 * steps (blue-600 vs primary-500) off the same brand ramp.
 *
 * They are the same product speaking in two places, so they get one chrome.
 * These assertions are what stop the next edit to one from silently forking the
 * other again: the shared classes live in ui/chatChrome and both must use them.
 */
describe('assistant bubble parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chat.mockResolvedValue({ data: { reply: 'Hello', sources: [] } });
    window.localStorage.clear();
  });

  const launcher = () => screen.getByRole('button', { name: /assistant/i });

  it('gives both bubbles the same launcher', () => {
    const { unmount } = renderWithProviders(<AdminChatBubble />);
    const adminLauncher = launcher().className;
    unmount();

    renderWithProviders(<LandingPageChatBubble />);
    const landingLauncher = launcher().className;

    expect(adminLauncher).toBe(CHAT_LAUNCHER_CLASS);
    expect(landingLauncher).toBe(CHAT_LAUNCHER_CLASS);
  });

  it('gives both bubbles the same panel and header', async () => {
    const user = userEvent.setup();

    const { unmount } = renderWithProviders(<AdminChatBubble />);
    await user.click(launcher());
    const adminPanel = screen.getByTestId('chat-panel').className;
    const adminHeader = screen.getByTestId('chat-header').className;
    unmount();

    renderWithProviders(<LandingPageChatBubble />);
    await user.click(launcher());

    expect(adminPanel).toContain(CHAT_PANEL_CLASS);
    expect(adminHeader).toBe(CHAT_HEADER_CLASS);
    expect(screen.getByTestId('chat-panel').className).toContain(CHAT_PANEL_CLASS);
    expect(screen.getByTestId('chat-header').className).toBe(CHAT_HEADER_CLASS);
  });

  it('introduces itself under the same name in both places', async () => {
    const user = userEvent.setup();

    const { unmount } = renderWithProviders(<AdminChatBubble />);
    await user.click(launcher());
    expect(screen.getByText('CareVance Assistant')).toBeInTheDocument();
    unmount();

    renderWithProviders(<LandingPageChatBubble />);
    await user.click(launcher());
    expect(screen.getByText('CareVance Assistant')).toBeInTheDocument();
  });

  /*
   * One avatar component, not two tinted copies. The tint was the most visible
   * difference between them and the easiest to reintroduce by accident.
   */
  it('uses one bot avatar in both places', async () => {
    const user = userEvent.setup();

    const { unmount } = renderWithProviders(<AdminChatBubble />);
    await user.click(launcher());
    const adminAvatar = screen.getAllByTestId('chat-bot-avatar')[0].className;
    unmount();

    renderWithProviders(<LandingPageChatBubble />);
    await user.click(launcher());

    expect(screen.getAllByTestId('chat-bot-avatar')[0].className).toBe(adminAvatar);
  });
});
