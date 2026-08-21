import { SITE } from '@/lib/site';

/**
 * The wordmark, with a mark that is the argument in miniature: four nodes on
 * one unbroken line. Same shape as the hero chain, same shape as the pitch.
 *
 * Drawn rather than imported so it inherits `currentColor` and needs no dark
 * variant — a PNG logo would need two files and would still be wrong at the
 * moment someone edits the palette.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 text-n-900 ${className}`}>
      <svg
        viewBox="0 0 28 28"
        className="h-7 w-7 shrink-0"
        fill="none"
        aria-hidden="true"
      >
        <rect width="28" height="28" rx="7" className="fill-brand-600" />
        <path
          d="M7 18.5 11 13l3.5 3.5L21 9"
          stroke="white"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.95"
        />
        <circle cx="7" cy="18.5" r="1.9" fill="white" />
        <circle cx="21" cy="9" r="1.9" className="fill-accent-400" />
      </svg>
      <span className="font-display text-[17px] font-bold tracking-[-0.02em]">{SITE.name}</span>
    </span>
  );
}
