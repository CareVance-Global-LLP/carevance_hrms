import { Loader2 } from 'lucide-react';
import { decodeHtmlEntities } from '@/lib/formatters';
import type { ChatMessageSearchHit } from '@/types';

interface MessageSearchResultsProps {
  term: string;
  results: ChatMessageSearchHit[];
  isSearching: boolean;
  onSelect: (hit: ChatMessageSearchHit) => void;
}

/** Wraps each occurrence of the term so a hit is visible in the excerpt. */
function highlight(body: string, term: string) {
  const needle = term.trim();
  if (!needle) return body;

  const parts = body.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return parts.map((part, index) =>
    part.toLowerCase() === needle.toLowerCase() ? (
      <mark key={index} className="rounded-sm bg-amber-200 px-0.5 text-slate-900">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

/**
 * Message hits across every thread the viewer belongs to. The old search could
 * only filter the threads already in memory by name and last-message text, so
 * anything older than the most recent post was unreachable.
 */
export default function MessageSearchResults({ term, results, isSearching, onSelect }: MessageSearchResultsProps) {
  if (isSearching && results.length === 0) {
    return (
      <p className="flex items-center gap-2 px-3 py-4 text-sm text-slate-600">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Searching messages...
      </p>
    );
  }

  if (results.length === 0) {
    return <p className="px-3 py-4 text-sm text-slate-600">No messages match &ldquo;{term}&rdquo;.</p>;
  }

  return (
    <ul className="space-y-1">
      <li className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
        Messages · {results.length}
      </li>
      {results.map((hit) => (
        <li key={`${hit.thread_type}-${hit.thread_id}-${hit.message_id}`}>
          <button
            type="button"
            onClick={() => onSelect(hit)}
            className="w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            <span className="block truncate text-xs font-semibold text-slate-900">{hit.thread_name}</span>
            <span className="mt-0.5 block truncate text-[11px] text-slate-600">
              {hit.sender_name ? `${hit.sender_name}: ` : ''}
              {/* Bodies are stored HTML-escaped, so an excerpt rendered raw
                  shows "what&apos;s up" — and the highlighter never matches. */}
              {highlight(decodeHtmlEntities(hit.body), term)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
