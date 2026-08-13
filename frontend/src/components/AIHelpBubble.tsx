import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Send, X } from 'lucide-react';
import { aiChatApi } from '@/services/api';
import { useAnyDialogOpen } from '@/components/ui/dialog';
import { getQuickActionsForRole } from '@/lib/aiKnowledge';

type ChatRole = 'user' | 'assistant';
type ChatMessage = { role: ChatRole; content: string };

const SUPPORT = { email: 'support@carevance.com', phone: '+91 800-123-4567' };

export default function AIHelpBubble({ userRole, showOnLanding: _showOnLanding = false }: { userRole?: string; showOnLanding?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "Hi! I'm CareVance Assistant. Ask me anything about the app, HR policies, payroll, leave, or attendance." },
  ]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const dialogOpen = useAnyDialogOpen();

  const quickActions = useMemo(() => getQuickActionsForRole(userRole), [userRole]);

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
      const res = await aiChatApi.chat({ message: content, history });
      setMessages((prev) => [...prev, { role: 'assistant', content: res.data.reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: "I'm having trouble connecting. Please try again or contact support at " + SUPPORT.email }]);
    } finally {
      setIsLoading(false);
    }
  };

  /*
   * Step aside for modal surfaces. The bubble is pinned to bottom-right at
   * z-[100] and dialogs start at z-index 50, so it sat on top of the footer of
   * every Modal and SlideOver — the corner that holds the primary button. It
   * covered "Save settings" on the employee settings drawer. Unmounting rather
   * than dimming also keeps it out of the dialog's focus trap.
   */
  if (dialogOpen) return null;

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Open AI Assistant"
          className="fixed bottom-5 right-5 z-[100] flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 text-white shadow-lg shadow-teal-500/25 transition-all duration-200 hover:scale-110 hover:shadow-xl"
        >
          <Bot className="h-5 w-5" />
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-5 right-5 z-[100] flex w-[360px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-3 text-white">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                <Bot className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">CareVance Assistant</p>
                <p className="text-[11px] text-white/70">Always here to help</p>
              </div>
            </div>
            <button type="button" onClick={() => setIsOpen(false)} className="rounded-full p-1 hover:bg-white/20">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto bg-slate-50/50 p-3" style={{ maxHeight: '320px' }}>
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="mr-1.5 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-500">
                    <Bot className="h-3 w-3 text-white" />
                  </div>
                )}
                <div className={`max-w-[75%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-teal-500 to-emerald-500 text-white'
                    : 'bg-white text-slate-700 border border-slate-100 shadow-sm'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="mr-1.5 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-500">
                  <Bot className="h-3 w-3 text-white" />
                </div>
                <div className="flex items-center gap-1 rounded-xl bg-white px-3 py-2.5 border border-slate-100">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400" style={{ animationDelay: '0s' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400" style={{ animationDelay: '0.15s' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400" style={{ animationDelay: '0.3s' }} />
                </div>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          {messages.length <= 1 && quickActions.length > 0 && (
            <div className="border-t border-slate-100 bg-white px-3 pt-2 pb-1.5">
              <div className="flex flex-wrap gap-1">
                {quickActions.map((q) => (
                  <button key={q} type="button" disabled={isLoading} onClick={() => void send(q)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 disabled:opacity-50">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="border-t border-slate-100 bg-white p-2.5">
            <div className="flex items-end gap-1.5">
              <textarea ref={inputRef} value={input} rows={1}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
                placeholder="Ask anything..."
                className="max-h-20 min-h-[2rem] flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-teal-400 focus:bg-white" />
              <button type="button" onClick={() => void send(input)} disabled={isLoading || !input.trim()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-teal-500 to-emerald-500 text-white disabled:opacity-50">
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
