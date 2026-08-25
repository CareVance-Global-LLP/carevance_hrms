import { useEffect } from 'react';
import { chatApi } from '@/services/api';
import { reportSilentError } from '@/lib/reportSilentError';

/**
 * Sending a reply typed into the desktop shell's quick-reply box.
 *
 * The shell puts the box on screen because Windows cannot put a text field in
 * a toast — Electron's `hasReply` and toast action buttons are both macOS-only.
 * But the shell has no session: no bearer token, no axios instance, none of the
 * interceptors that handle a 401 or a lapsed subscription. So it collects the
 * string and asks the renderer to send it.
 *
 * That split is the point. A second send path living in the main process, with
 * its own copy of authentication, would drift from this one the first time
 * anything about auth changed — and would do so silently, in a window nobody
 * looks at until they need it.
 */

type QuickReplyRequest = {
  requestId: number;
  threadType: 'direct' | 'group';
  threadId: number;
  text: string;
};

export function useQuickReply(isAuthenticated: boolean) {
  useEffect(() => {
    const bridge = window.desktopTracker;
    if (!bridge?.onQuickReplySend || !bridge.sendQuickReplyResult) {
      // Web, or an older installed shell that predates the reply box. Both are
      // fine: the box simply never opens, and nothing here is needed.
      return;
    }

    if (!isAuthenticated) {
      // A reply sent while signed out would 401 and, worse, could be sent as
      // whoever signs in next. Not listening at all is the honest state.
      return;
    }

    const unsubscribe = bridge.onQuickReplySend(async (request: QuickReplyRequest) => {
      const text = String(request?.text || '').trim();
      const threadId = Number(request?.threadId || 0);

      if (!text || !threadId) {
        bridge.sendQuickReplyResult?.({ requestId: request?.requestId, ok: false, error: 'Nothing to send' });
        return;
      }

      try {
        if (request.threadType === 'group') {
          await chatApi.sendGroupMessage(threadId, { body: text });
        } else {
          await chatApi.sendMessage(threadId, { body: text });
        }

        bridge.sendQuickReplyResult?.({ requestId: request.requestId, ok: true });
      } catch (error) {
        const message =
          (error as { response?: { data?: { message?: string } } })?.response?.data?.message
          || 'Could not send';

        // Reported back rather than swallowed: the box keeps the typed text on
        // a failure so it can be retried, which only works if it is told.
        bridge.sendQuickReplyResult?.({ requestId: request.requestId, ok: false, error: message });
        reportSilentError('useQuickReply: reply failed', error);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [isAuthenticated]);
}
