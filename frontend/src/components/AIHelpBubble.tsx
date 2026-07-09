import { useEffect, useRef, useState } from 'react';
import { Bot, Send, Sparkles, X, HelpCircle, Clock, BarChart3, FileText } from 'lucide-react';
import { aiChatApi } from '@/services/api';

type ChatRole = 'user' | 'assistant';

type ChatMessage = {
  role: ChatRole;
  content: string;
};

const QUICK_ACTIONS = [
  { icon: <FileText className="h-3.5 w-3.5" />, text: 'How do I submit a leave request?' },
  { icon: <Clock className="h-3.5 w-3.5" />, text: 'Where can I see my attendance and time?' },
  { icon: <BarChart3 className="h-3.5 w-3.5" />, text: 'How do I track my time / start the timer?' },
  { icon: <HelpCircle className="h-3.5 w-3.5" />, text: 'Where are reports and analytics?' },
];

export default function AIHelpBubble() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        "Hi! I'm your CareVance assistant. Ask me how to navigate the app, use a feature, or about HR policies.",
    },
  ]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const send = async (rawText: string) => {
    const content = rawText.trim();
    if (!content || isLoading) {
      return;
    }

    const history = messages
      .filter((m) => m.content.trim() !== '')
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, { role: 'user', content }]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await aiChatApi.chat({ message: content, history });
      setMessages((prev) => [...prev, { role: 'assistant', content: response.data.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: "Sorry, I couldn't reach the assistant just now. Please try again.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Open AI Assistant"
          className="fixed bottom-6 right-6 z-50 group"
        >
          <div className="relative flex items-center gap-2 rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-3 text-white shadow-lg shadow-teal-500/30 transition-all duration-300 hover:shadow-xl hover:shadow-teal-500/40 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">AI Assistant</span>
            <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-amber-900 shadow-sm">
              ?
            </div>
          </div>
        </button>
      )}

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 flex w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20">
          {/* Header */}
          <div className="relative bg-gradient-to-r from-teal-500 to-emerald-500 px-5 py-4 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold">AI Assistant</p>
                  <p className="text-xs text-white/80">Ask me anything about the app</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close AI Assistant"
                className="rounded-full p-1.5 transition hover:bg-white/20"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Decorative dots */}
            <div className="absolute right-20 top-2 h-1 w-1 rounded-full bg-white/30" />
            <div className="absolute right-24 top-4 h-1.5 w-1.5 rounded-full bg-white/20" />
            <div className="absolute right-16 bottom-2 h-1 w-1 rounded-full bg-white/20" />
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50/50 p-4" style={{ maxHeight: '380px' }}>
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.role === 'assistant' && (
                  <div className="mr-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-500">
                    <Bot className="h-3.5 w-3.5 text-white" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    message.role === 'user'
                      ? 'bg-gradient-to-r from-teal-500 to-emerald-500 text-white shadow-sm'
                      : 'bg-white text-slate-700 shadow-sm border border-slate-100'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="mr-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-500">
                  <Bot className="h-3.5 w-3.5 text-white" />
                </div>
                <div className="flex items-center gap-1.5 rounded-2xl bg-white px-4 py-3 shadow-sm border border-slate-100">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-teal-400" style={{ animationDelay: '0s' }} />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-teal-400" style={{ animationDelay: '0.15s' }} />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-teal-400" style={{ animationDelay: '0.3s' }} />
                </div>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="border-t border-slate-100 bg-white px-4 pt-3 pb-2">
            <p className="mb-2 text-[11px] font-medium text-slate-400 uppercase tracking-wider">Quick questions</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.text}
                  type="button"
                  disabled={isLoading}
                  onClick={() => void send(action.text)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 disabled:opacity-50"
                >
                  {action.icon}
                  {action.text}
                </button>
              ))}
            </div>
          </div>

          {/* Input */}
          <div className="border-t border-slate-100 bg-white p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                placeholder="Ask anything about the app..."
                className="max-h-24 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-teal-400 focus:bg-white focus:ring-2 focus:ring-teal-100"
              />
              <button
                type="button"
                onClick={() => void send(input)}
                disabled={isLoading || input.trim() === ''}
                aria-label="Send message"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 text-white shadow-sm transition-all hover:shadow-md hover:from-teal-600 hover:to-emerald-600 disabled:opacity-50 disabled:shadow-none"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
