import { useEffect, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
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

type ChatRole = 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };

const QUICK_ACTIONS = [
  "What does it cost?",
  "How's it different?",
  'Book a demo',
];

/** Names the job, so the header is not two lines saying the same thing. */
const SUBTITLE = 'Ask about pricing, features or setup';


const CTA_KEYWORDS = ['pricing', 'cost', 'price', 'plan', 'trial', '$', 'per employee'];
// /checkout is the paid path. A button labelled "Start free trial" belongs on
// the trial signup, which is what every other trial CTA on the landing page uses.
const CTA_BUTTON = { label: 'Start free trial', href: '/start-trial' };

function shouldShowCTA(reply: string): boolean {
  const lower = reply.toLowerCase();
  return CTA_KEYWORDS.some((kw) => lower.includes(kw));
}

export default function LandingPageChatBubble() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "Hi! Curious about CareVance? Ask me anything about pricing, features, or setup." },
  ]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || isLoading) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content }]);
    setInput('');
    setIsLoading(true);
    try {
      const res = await aiChatApi.chat({ message: content, history, context: 'landing' });
      setMessages((prev) => [...prev, { role: 'assistant', content: res.data.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "I'm having trouble connecting. Please try again or contact support at " + CHAT_SUPPORT.email },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Open CareVance Assistant"
          className={CHAT_LAUNCHER_CLASS}
          // Pinned to the corner. The in-app launcher is draggable and supplies
          // its own left/top instead; that is the only difference between them.
          style={{ bottom: '1.25rem', right: '1.25rem' }}
        >
          <SparkleMark size={26} />
        </button>
      )}

      {isOpen && (
        <div data-testid="chat-panel" className={`${CHAT_PANEL_CLASS} bottom-5 right-5 w-full max-w-[360px]`}>
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

          <div ref={scrollRef} className={CHAT_TRANSCRIPT_CLASS} style={{ maxHeight: '320px' }}>
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && <BotAvatar className="mr-2 mt-0.5" />}
                <div className={`max-w-[78%] ${msg.role === 'user' ? CHAT_USER_BUBBLE_CLASS : CHAT_ASSISTANT_BUBBLE_CLASS}`}>
                  {msg.content}
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
                {QUICK_ACTIONS.map((q) => (
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

          {messages.length > 1 && !isLoading && shouldShowCTA(messages[messages.length - 1]?.content ?? '') && (
            <div className={`${CHAT_FOOTER_CLASS} px-3 pt-2.5 pb-2`}>
              {/*
                * text-on-brand, not text-white: the accent ramp inverts, so in
                * dark mode this fill is a pale gold and white type on it is
                * unreadable. The hover was a literal #C8923A, which is the
                * light-mode value of accent-500 and therefore wrong in dark.
                */}
              <a
                href={CTA_BUTTON.href}
                className="block w-full rounded-xl bg-accent-500 px-4 py-2.5 text-center text-[13px] font-semibold text-on-brand transition hover:bg-accent-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                {CTA_BUTTON.label}
              </a>
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
                placeholder="Ask about pricing, features…"
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
            <p className="mt-2 text-center text-[10px] text-slate-400">{CHAT_DISCLAIMER}</p>
          </div>
        </div>
      )}
    </>
  );
}
