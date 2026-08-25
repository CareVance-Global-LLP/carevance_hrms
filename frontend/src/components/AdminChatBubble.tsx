import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { aiChatApi } from '@/services/api';
import { SparkleMark, SparkleTile, BotAvatar } from '@/components/ui/ChatIcons';
import {
  CHAT_ASSISTANT_BUBBLE_CLASS,
  CHAT_ASSISTANT_NAME,
  CHAT_EYEBROW_CLASS,
  CHAT_TRANSCRIPT_CLASS,
  CHAT_CHIP_CLASS,
  CHAT_DISCLAIMER,
  CHAT_DOT_CLASS,
  CHAT_FOOTER_CLASS,
  CHAT_HEADER_CLASS,
  CHAT_INPUT_CLASS,
  CHAT_LAUNCHER_CLASS,
  CHAT_PANEL_CLASS,
  CHAT_SEND_CLASS,
  CHAT_SUPPORT,
  CHAT_USER_BUBBLE_CLASS,
} from '@/components/ui/chatChrome';
import { useAnyDialogOpen } from '@/components/ui/dialog';
import { ADMIN_QUICK_ACTIONS } from '@/lib/aiKnowledge';

type ChatRole = 'user' | 'assistant';

/**
 * Where a figure in this reply came from. Assembled server-side from the tools
 * that actually ran (see AiToolRegistry), never parsed out of the model's
 * prose — a citation the model writes is a citation the model can invent.
 */
type ChatSource = { label: string; route: string };

type ChatMessage = { role: ChatRole; content: string; sources?: ChatSource[] };

const FOLLOW_UP_MAP: Record<string, string[]> = {
  clocked: ['Send them a reminder', 'View attendance log'],
  approval: ['View all pending', 'Send reminder'],
  payroll: ['Run payroll now', 'View pay runs'],
  report: ['Download report', 'Schedule weekly'],
  default: ['Ask another question', 'Talk to support'],
};

function getFollowUps(reply: string): string[] {
  const lower = reply.toLowerCase();
  for (const [keyword, chips] of Object.entries(FOLLOW_UP_MAP)) {
    if (keyword !== 'default' && lower.includes(keyword)) return chips;
  }
  return FOLLOW_UP_MAP.default;
}

/** Names the job, so the header is not two lines saying the same thing. */
const SUBTITLE = 'Reads your live workspace data';

/*
 * The opener earns the first question. It used to restate the panel title and
 * then list the topics that the chips underneath already list. What an admin
 * cannot tell by looking is the part worth saying: these are real figures, and
 * each one comes back with the record it was read from.
 */
const GREETING =
  'Ask me about approvals, attendance, headcount or payroll. Every figure I give you links back to the record it came from.';

const STORAGE_KEY = 'carevance-chat-position';
const ICON_SIZE = 56;
const DRAG_THRESHOLD = 5;
const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 480;
const PANEL_GAP = 8;
const MOBILE_BREAKPOINT = 768;

function computePanelPos(icon: { left: number; top: number }, vw: number, vh: number) {
  const iconRight = icon.left + ICON_SIZE;
  const iconBottom = icon.top + ICON_SIZE;
  const openLeft = iconRight + PANEL_GAP + PANEL_WIDTH > vw - 8;
  const openUp = iconBottom + PANEL_GAP + PANEL_HEIGHT > vh - 8;
  let left = openLeft ? icon.left - PANEL_GAP - PANEL_WIDTH : iconRight + PANEL_GAP;
  let top = openUp ? icon.top - PANEL_GAP - PANEL_HEIGHT : iconBottom + PANEL_GAP;
  left = Math.max(8, Math.min(left, vw - PANEL_WIDTH - 8));
  top = Math.max(8, Math.min(top, vh - 240 - 8));
  return { left, top };
}

function loadPosition(): { left: number; top: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const pos = JSON.parse(raw) as { left: number; top: number };
    if (typeof pos.left === 'number' && typeof pos.top === 'number') return pos;
    return null;
  } catch {
    return null;
  }
}

function savePosition(left: number, top: number) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ left, top }));
}

function getDefaultPosition(): { left: number; top: number } {
  return {
    left: window.innerWidth - ICON_SIZE - 20,
    top: window.innerHeight - ICON_SIZE - 20,
  };
}

export default function AdminChatBubble() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: GREETING },
  ]);
  const quickActions = ADMIN_QUICK_ACTIONS;
  const dialogOpen = useAnyDialogOpen();

  const [pos, setPos] = useState<{ left: number; top: number }>(() => loadPosition() ?? getDefaultPosition());
  const [isDragging, setIsDragging] = useState(false);
  const [viewport, setViewport] = useState({ w: typeof window !== 'undefined' ? window.innerWidth : 1280, h: typeof window !== 'undefined' ? window.innerHeight : 800 });

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const panelPos = useMemo(
    () => (isOpen ? computePanelPos(pos, viewport.w, viewport.h) : null),
    [isOpen, pos, viewport],
  );

  const dragRef = useRef({
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
    moved: false,
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    const saved = loadPosition();
    if (saved) {
      setPos(saved);
    } else {
      setPos(getDefaultPosition());
    }
  }, []);

  const clampToViewport = useCallback((left: number, top: number) => {
    const maxLeft = window.innerWidth - ICON_SIZE;
    const maxTop = window.innerHeight - ICON_SIZE;
    return {
      left: Math.max(0, Math.min(left, maxLeft)),
      top: Math.max(0, Math.min(top, maxTop)),
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-chatbot-panel]')) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: pos.left,
      startTop: pos.top,
      moved: false,
    };
    setIsDragging(true);
  }, [pos.left, pos.top]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > DRAG_THRESHOLD) dragRef.current.moved = true;
    setPos(clampToViewport(dragRef.current.startLeft + dx, dragRef.current.startTop + dy));
  }, [isDragging, clampToViewport]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setIsDragging(false);
    if (dragRef.current.moved) {
      savePosition(pos.left, pos.top);
    } else {
      setIsOpen((prev) => !prev);
    }
  }, [isDragging, pos.left, pos.top]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || isLoading) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content }]);
    setInput('');
    setIsLoading(true);
    try {
      const res = await aiChatApi.chat({ message: content, history, context: 'admin' });
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: res.data.reply, sources: res.data.sources ?? [] },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "I'm having trouble connecting. Please try again or contact support at " + CHAT_SUPPORT.email },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const followUps = messages.length > 1 && !isLoading ? getFollowUps(messages[messages.length - 1]?.content ?? '') : [];

  /*
   * Step aside for modal surfaces. The bubble is pinned at z-[100] and dialogs
   * start at z-index 50, so it sat on top of the footer of every Modal and
   * SlideOver — the corner that holds the primary button. It covered "Save
   * settings" on the employee settings drawer. Unmounting rather than dimming
   * also keeps it out of the dialog's focus trap.
   */
  if (dialogOpen) return null;

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          aria-label="Open CareVance Assistant"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className={CHAT_LAUNCHER_CLASS}
          // Position is the one thing this launcher does not share: it is
          // draggable, so its corner is wherever the admin last left it.
          style={{ left: pos.left, top: pos.top }}
        >
          <SparkleMark size={26} />
        </button>
      )}

      {isOpen && (
        <div
          data-chatbot-panel
          data-testid="chat-panel"
          ref={panelRef}
          className={`${CHAT_PANEL_CLASS} w-full sm:w-[360px]`}
          style={
            viewport.w < MOBILE_BREAKPOINT
              ? { maxHeight: '100vh' }
              : { left: panelPos?.left, top: panelPos?.top, maxHeight: 'min(480px, calc(100vh - 40px))' }
          }
        >
          <div data-testid="chat-header" className={CHAT_HEADER_CLASS}>
            <div className="flex items-center gap-2.5">
              <SparkleTile size={34} radius="rounded-lg" />
              <div>
                <p className="text-sm font-semibold">{CHAT_ASSISTANT_NAME}</p>
                <p className="text-[11px] leading-tight text-white/70">{SUBTITLE}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close assistant"
              className="-mr-1 rounded-lg p-1.5 text-white/70 transition hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className={CHAT_TRANSCRIPT_CLASS} style={{ maxHeight: '300px' }}>
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && <BotAvatar className="mr-2 mt-0.5" />}
                <div className="flex max-w-[78%] flex-col gap-1.5">
                  <div className={msg.role === 'user' ? CHAT_USER_BUBBLE_CLASS : CHAT_ASSISTANT_BUBBLE_CLASS}>
                    {msg.content}
                  </div>

                  {/*
                    * Every figure the assistant states is one click from the
                    * record it was read from. Rendered only when a tool
                    * actually ran — an answer from the assistant's own
                    * knowledge has nothing to point at, and a "Sources" label
                    * over an empty list would imply otherwise.
                    */}
                  {msg.role === 'assistant' && (msg.sources?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={CHAT_EYEBROW_CLASS}>Source</span>
                      {msg.sources!.map((source) => (
                        <Link
                          key={source.route}
                          to={source.route}
                          onClick={() => setIsOpen(false)}
                          className={`${CHAT_CHIP_CLASS} px-2 py-0.5`}
                        >
                          {source.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <BotAvatar className="mr-2 mt-0.5" />
                <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-black/5 bg-surface-raised px-3 py-3 shadow-sm">
                  <span className={CHAT_DOT_CLASS} style={{ animationDelay: '0s' }} />
                  <span className={CHAT_DOT_CLASS} style={{ animationDelay: '0.15s' }} />
                  <span className={CHAT_DOT_CLASS} style={{ animationDelay: '0.3s' }} />
                </div>
              </div>
            )}
          </div>

          {messages.length <= 1 && (
            <div className={`${CHAT_FOOTER_CLASS} px-3 pt-2.5 pb-2`}>
              <p className={`mb-2 ${CHAT_EYEBROW_CLASS}`}>Quick questions</p>
              <div className="flex flex-wrap gap-1.5">
                {quickActions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={isLoading}
                    onClick={() => void send(q)}
                    className={CHAT_CHIP_CLASS}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {followUps.length > 0 && messages.length > 1 && !isLoading && (
            <div className={`${CHAT_FOOTER_CLASS} px-3 pt-2.5 pb-2`}>
              <div className="flex flex-wrap gap-1.5">
                {followUps.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void send(q)}
                    className={CHAT_CHIP_CLASS}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`${CHAT_FOOTER_CLASS} px-3 pb-2.5 pt-2.5`}>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder="Ask about approvals, attendance, payroll…"
                className={CHAT_INPUT_CLASS}
              />
              <button
                type="button"
                onClick={() => void send(input)}
                disabled={isLoading || !input.trim()}
                aria-label="Send message"
                className={CHAT_SEND_CLASS}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-500">{CHAT_DISCLAIMER}</p>
          </div>
        </div>
      )}
    </>
  );
}
