import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { aiChatApi } from '@/services/api';
import { SparkleIcon, DefaultBotAvatar } from '@/components/ui/ChatIcons';
import { getQuickActionsForRole } from '@/lib/aiKnowledge';

type ChatRole = 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };

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

const SUPPORT = { email: 'support@carevance.com', phone: '+91 800-123-4567' };
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
    { role: 'assistant', content: "Hi, I'm your admin assistant. Ask about approvals, attendance, or payroll status." },
  ]);
  const quickActions = useMemo(() => getQuickActionsForRole('admin'), []);

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
      setMessages((prev) => [...prev, { role: 'assistant', content: res.data.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "I'm having trouble connecting. Please try again or contact support at " + SUPPORT.email },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const followUps = messages.length > 1 && !isLoading ? getFollowUps(messages[messages.length - 1]?.content ?? '') : [];

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          aria-label="Open Admin Assistant"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="fixed z-[100] flex items-center justify-center rounded-full select-none touch-none"
          style={{ left: pos.left, top: pos.top, width: ICON_SIZE, height: ICON_SIZE }}
        >
          <SparkleIcon size={ICON_SIZE} className="drop-shadow-lg drop-shadow-teal-500/30" />
        </button>
      )}

      {isOpen && (
        <div
          data-chatbot-panel
          ref={panelRef}
          className="fixed z-[100] flex w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl max-md:inset-0 max-md:rounded-none sm:w-[360px]"
          style={
            viewport.w < MOBILE_BREAKPOINT
              ? { maxHeight: '100vh' }
              : { left: panelPos?.left, top: panelPos?.top, maxHeight: 'min(480px, calc(100vh - 40px))' }
          }
        >
          <div className="flex items-center justify-between bg-[#5D969D] px-4 py-3 text-white">
            <div className="flex items-center gap-2.5">
              <SparkleIcon size={30} />
              <div>
                <p className="text-sm font-semibold">Admin assistant</p>
                <p className="text-xs text-white/85">Online</p>
              </div>
            </div>
            <button type="button" onClick={() => setIsOpen(false)} className="rounded-full p-1 hover:bg-white/20">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto bg-slate-50/50 p-3" style={{ maxHeight: '300px' }}>
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && <DefaultBotAvatar className="mr-1.5 mt-0.5" />}
                <div
                  className={`max-w-[75%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-[#5D969D] text-white'
                      : 'bg-white text-slate-700 border border-slate-100 shadow-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <DefaultBotAvatar className="mr-1.5 mt-0.5" />
                <div className="flex items-center gap-1 rounded-xl border border-slate-100 bg-white px-3 py-2.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#5D969D]" style={{ animationDelay: '0s' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#5D969D]" style={{ animationDelay: '0.15s' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#5D969D]" style={{ animationDelay: '0.3s' }} />
                </div>
              </div>
            )}
          </div>

          {messages.length <= 1 && (
            <div className="border-t border-slate-100 bg-white px-3 pt-2 pb-1.5">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Quick questions</p>
              <div className="flex flex-wrap gap-1">
                {quickActions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={isLoading}
                    onClick={() => void send(q)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-[#085041] transition hover:border-[#5D969D] hover:bg-[#5D969D]/10 hover:text-[#085041] disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {followUps.length > 0 && messages.length > 1 && !isLoading && (
            <div className="border-t border-slate-100 bg-white px-3 pt-2 pb-1.5">
              <div className="flex flex-wrap gap-1">
                {followUps.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void send(q)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-[#085041] transition hover:border-[#5D969D] hover:bg-[#5D969D]/10 hover:text-[#085041]"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-slate-100 bg-white p-2.5">
            <div className="flex items-center gap-1.5">
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
                placeholder="Ask anything..."
                className="min-h-[2rem] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-[#5D969D] focus:bg-white"
              />
              <button
                type="button"
                onClick={() => void send(input)}
                disabled={isLoading || !input.trim()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#5D969D] text-white disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-slate-300">AI may be inaccurate. Verify important info.</p>
          </div>
        </div>
      )}
    </>
  );
}
