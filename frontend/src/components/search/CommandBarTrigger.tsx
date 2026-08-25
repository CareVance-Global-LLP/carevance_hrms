/**
 * The visible affordance for the command bar.
 *
 * Looks like a search field but is a button: clicking anywhere on it opens the
 * palette. A real input here would mean maintaining two inputs and syncing
 * them, and would leave a focused field behind the modal.
 */

import { Search, Sparkles } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface CommandBarTriggerProps {
  onOpen: () => void;
  className?: string;
  /** Compact form for narrow headers — icon only. */
  compact?: boolean;
  /**
   * Opens the palette already in AI mode.
   *
   * Reaching AI mode used to take two deliberate actions — open the palette,
   * then find and click the toggle — which is two too many for the thing
   * somebody came to the search bar to do. This puts it one click from the
   * header, and the toggle inside stays for switching back.
   *
   * Optional: without it the chip is not rendered at all, so a surface that
   * has no AI mode does not advertise one.
   */
  onOpenAi?: () => void;
}

/** macOS gets ⌘, everything else Ctrl. */
const shortcutLabel = () => {
  if (typeof navigator === 'undefined') return 'Ctrl K';
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';
};

export default function CommandBarTrigger({
  onOpen,
  className,
  compact = false,
  onOpenAi,
}: CommandBarTriggerProps) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label="Search — press Control K"
        aria-keyshortcuts="Control+K Meta+K"
        className={cn(
          'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80',
          className
        )}
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>
    );
  }

  /*
   * A div, not a button, once the AI chip is present — a button inside a
   * button is invalid HTML and browsers resolve it by dropping the inner one,
   * which would make the chip unclickable. The outer element keeps the
   * button's role and keyboard behaviour explicitly.
   */
  return (
    <div
      className={cn(
        'flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-border-strong bg-white pl-3 pr-1.5 text-left text-[13px] text-slate-500 shadow-sm transition focus-within:ring-2 focus-within:ring-sky-300/80 hover:border-slate-300',
        className
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label="Search or jump to — press Control K"
        aria-keyshortcuts="Control+K Meta+K"
        className="flex min-w-0 flex-1 items-center gap-2 bg-transparent text-left focus-visible:outline-none"
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Search or jump to…</span>
      </button>

      {onOpenAi ? (
        <button
          type="button"
          onClick={onOpenAi}
          aria-label="Ask AI about your data"
          className="ai-trigger-chip inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80"
        >
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          AI
        </button>
      ) : null}

      <kbd className="hidden shrink-0 rounded border border-border-strong bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-500 sm:inline-flex">
        {shortcutLabel()}
      </kbd>
    </div>
  );
}
