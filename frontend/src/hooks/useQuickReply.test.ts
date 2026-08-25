import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const sendMessage = vi.fn();
const sendGroupMessage = vi.fn();

vi.mock('@/services/api', () => ({
  chatApi: {
    sendMessage: (...a: unknown[]) => sendMessage(...a),
    sendGroupMessage: (...a: unknown[]) => sendGroupMessage(...a),
  },
}));

import { useQuickReply } from '@/hooks/useQuickReply';

/**
 * The desktop shell collects a reply; this side sends it.
 *
 * The split exists because the shell has no session — no token, no axios
 * instance, none of the interceptors. These pin the contract between the two,
 * because the failure mode is a reply box that looks like it worked while
 * nothing was sent.
 */
describe('useQuickReply', () => {
  let handler: ((payload: unknown) => void) | null = null;
  const sendQuickReplyResult = vi.fn();
  const unsubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    handler = null;
    sendMessage.mockResolvedValue({ data: {} });
    sendGroupMessage.mockResolvedValue({ data: {} });

    (window as unknown as { desktopTracker?: unknown }).desktopTracker = {
      onQuickReplySend: (cb: (payload: unknown) => void) => {
        handler = cb;
        return unsubscribe;
      },
      sendQuickReplyResult,
    };
  });

  afterEach(() => {
    delete (window as unknown as { desktopTracker?: unknown }).desktopTracker;
  });

  it('sends a direct reply and reports success', async () => {
    renderHook(() => useQuickReply(true));

    handler?.({ requestId: 1, threadType: 'direct', threadId: 42, text: 'On my way' });

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { body: 'On my way' }));
    await waitFor(() => expect(sendQuickReplyResult).toHaveBeenCalledWith({ requestId: 1, ok: true }));
  });

  it('uses the group endpoint for a group thread', async () => {
    renderHook(() => useQuickReply(true));

    handler?.({ requestId: 2, threadType: 'group', threadId: 7, text: 'Noted' });

    await waitFor(() => expect(sendGroupMessage).toHaveBeenCalledWith(7, { body: 'Noted' }));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  /**
   * A reply sent while signed out would 401 — or worse, be sent as whoever
   * signs in next on this machine.
   */
  it('does not listen while signed out', () => {
    renderHook(() => useQuickReply(false));

    expect(handler).toBeNull();
  });

  it('does nothing on web, where there is no shell', () => {
    delete (window as unknown as { desktopTracker?: unknown }).desktopTracker;

    expect(() => renderHook(() => useQuickReply(true))).not.toThrow();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  /**
   * The box keeps the typed text on failure so it can be retried — which only
   * works if the failure is actually reported back.
   */
  it('reports the server message when the send fails', async () => {
    sendMessage.mockRejectedValue({ response: { data: { message: 'Conversation not found' } } });
    renderHook(() => useQuickReply(true));

    handler?.({ requestId: 3, threadType: 'direct', threadId: 42, text: 'Hello' });

    await waitFor(() =>
      expect(sendQuickReplyResult).toHaveBeenCalledWith({
        requestId: 3,
        ok: false,
        error: 'Conversation not found',
      })
    );
  });

  it('refuses an empty reply without calling the API', async () => {
    renderHook(() => useQuickReply(true));

    handler?.({ requestId: 4, threadType: 'direct', threadId: 42, text: '   ' });

    await waitFor(() =>
      expect(sendQuickReplyResult).toHaveBeenCalledWith({ requestId: 4, ok: false, error: 'Nothing to send' })
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
