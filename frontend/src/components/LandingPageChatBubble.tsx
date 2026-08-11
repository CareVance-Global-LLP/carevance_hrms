import { useEffect, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { aiChatApi } from '@/services/api';
import { SparkleIcon, LandingBotAvatar } from '@/components/ui/ChatIcons';

type ChatRole = 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };

const QUICK_ACTIONS = [
  "What does it cost?",
  "How's it different?",
  'Book a demo',
];

const SUPPORT = { email: 'support@carevance.com', phone: '+91 800-123-4567' };

const CTA_KEYWORDS = ['pricing', 'cost', 'price', 'plan', 'trial', '$', 'per employee'];
const CTA_BUTTON = { label: 'Start free trial', href: '/checkout' };

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
        { role: 'assistant', content: "I'm having trouble connecting. Please try again or contact support at " + SUPPORT.email },
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
          className="fixed bottom-5 right-5 z-[100] flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-white shadow-lg shadow-teal-500/25 transition-all duration-200 hover:scale-110 hover:shadow-xl ring-1 ring-slate-200"
        >
          <SparkleIcon size={38} />
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-5 right-5 z-[100] flex w-full max-w-[360px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl max-md:inset-0 max-md:rounded-none">
          <div
            className="flex items-center justify-between px-4 py-3 text-white"
            style={{ background: 'linear-gradient(135deg, #5B9B8E 0%, #D89B3C 100%)' }}
          >
            <div className="flex items-center gap-2.5">
              <SparkleIcon size={30} />
              <div>
                <p className="text-sm font-semibold">CareVance assistant</p>
                <p className="text-xs text-white/90">Always here to help</p>
              </div>
            </div>
            <button type="button" onClick={() => setIsOpen(false)} className="rounded-full p-1 hover:bg-white/20">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto bg-slate-50/50 p-3" style={{ maxHeight: '320px' }}>
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && <LandingBotAvatar className="mr-1.5 mt-0.5" />}
                <div
                  className={`max-w-[75%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-primary-500 text-white'
                      : 'bg-white text-slate-700 border border-slate-100 shadow-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <LandingBotAvatar className="mr-1.5 mt-0.5" />
                <div className="flex items-center gap-1 rounded-xl border border-slate-100 bg-white px-3 py-2.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-500" style={{ animationDelay: '0s' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-500" style={{ animationDelay: '0.15s' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-500" style={{ animationDelay: '0.3s' }} />
                </div>
              </div>
            )}
          </div>

          {messages.length <= 1 && (
            <div className="border-t border-slate-100 bg-white px-3 pt-2 pb-1.5">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Quick questions</p>
              <div className="flex flex-wrap gap-1">
                {QUICK_ACTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={isLoading}
                    onClick={() => void send(q)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-[#633806] transition hover:border-[#D89B3C] hover:bg-accent-500/10 hover:text-[#633806] disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.length > 1 && !isLoading && shouldShowCTA(messages[messages.length - 1]?.content ?? '') && (
            <div className="border-t border-slate-100 bg-white px-3 pt-2 pb-1.5">
              <a
                href={CTA_BUTTON.href}
                className="block w-full rounded-lg bg-accent-500 px-4 py-2 text-center text-[13px] font-medium text-white transition hover:bg-[#C8923A]"
              >
                {CTA_BUTTON.label}
              </a>
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
                className="min-h-[2rem] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-[#5B9B8E] focus:bg-white"
              />
              <button
                type="button"
                onClick={() => void send(input)}
                disabled={isLoading || !input.trim()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-500 text-white disabled:opacity-50"
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
