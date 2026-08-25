/**
 * The visible affordance for the command bar.
 *
 * Looks like a search field but is a button: clicking anywhere on it opens the
 * palette. A real input here would mean maintaining two inputs and syncing
 * them, and would leave a focused field behind the modal.
 */

import { Search } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface CommandBarTriggerProps {
  onOpen: () => void;
  className?: string;
  /** Compact form for narrow headers — icon only. */
  compact?: boolean;
}

/** macOS gets ⌘, everything else Ctrl. */
const shortcutLabel = () => {
  if (typeof navigator === 'undefined') return 'Ctrl K';
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';
};

export default function CommandBarTrigger({ onOpen, className, compact = false }: CommandBarTriggerProps) {
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

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Search or jump to — press Control K"
      aria-keyshortcuts="Control+K Meta+K"
      className={cn(
        'flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-border-strong bg-white px-3 text-left text-[13px] text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80',
        className
      )}
    >
      <Search className="h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">Search or jump to…</span>
      <kbd className="hidden shrink-0 rounded border border-border-strong bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-500 sm:inline-flex">
        {shortcutLabel()}
      </kbd>
    </button>
  );
}
