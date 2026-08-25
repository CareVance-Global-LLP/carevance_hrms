/**
 * The command bar: one keyboard-first surface for finding and doing anything.
 *
 * Local results (pages, actions, settings) are ranked synchronously and render
 * on the first keystroke with no latency. Server results (people, records)
 * arrive behind a debounce and merge into their own groups underneath, so a
 * slow network never delays the thing someone was most likely reaching for.
 *
 * Accessibility follows the ARIA combobox-with-listbox pattern: DOM focus stays
 * in the input at all times and the highlighted row is communicated with
 * `aria-activedescendant`, because moving real focus into the list would break
 * typing.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, Loader2, Search, Sparkles, X } from 'lucide-react';
import { COMMAND_GROUPS, type CommandGroup, type CommandItem } from '@/lib/commandRegistry';
import { highlightSegments, rankCandidates, suggestCorrection } from '@/lib/searchRanking';
import type { AskResponse } from '@/services/api';
import { cn } from '@/utils/cn';
import AiAnswerTable from './AiAnswerTable';

/** Scope prefixes. Typing one of these as the first character narrows the search. */
const SCOPES = {
  '@': { kinds: ['person', 'department'], label: 'People' },
  '>': { kinds: ['action', 'setting'], label: 'Actions' },
  '#': { kinds: ['task', 'project', 'leave', 'asset', 'announcement'], label: 'Records' },
} as const;

type ScopeKey = keyof typeof SCOPES;

const isScopeKey = (value: string): value is ScopeKey => value === '@' || value === '>' || value === '#';

/** Per-group cap, so one noisy group can't push every other group off-screen. */
const PER_GROUP_LIMIT = 5;

export interface CommandBarProps {
  open: boolean;
  onClose: () => void;
  /** Pages, actions and settings — already permission-filtered. */
  localCommands: CommandItem[];
  /** Server results for the current query, or [] before any have arrived. */
  remoteCommands?: CommandItem[];
  remoteLoading?: boolean;
  /** Fires on every query change; the caller debounces and cancels. */
  onQueryChange?: (query: string) => void;
  onSelect: (item: CommandItem) => void;
  recentIds: string[];
  usesOf: (id: string) => number;
  /** Shown before anyone types, under "Recent". */
  recentDisplayCount?: number;
  /** AI mode: natural-language data questions answered as a table. */
  aiMode?: boolean;
  onAiModeChange?: (on: boolean) => void;
  aiAnswer?: AskResponse | null;
  aiLoading?: boolean;
  /** The reason a question was refused. Refusing is a normal outcome. */
  aiError?: string | null;
  onAskAi?: (question: string) => void;
  /**
   * Runs one of the example questions the empty AI panel offers. Separate from
   * `onAskAi` because this one also has to put the question in the field:
   * without it the answer arrives under a blank prompt with nothing on screen
   * saying what was asked. Left unwired, the examples render as plain text.
   */
  onAiExample?: (question: string) => void;
}

interface RenderRow {
  type: 'header' | 'option';
  key: string;
  group: CommandGroup;
  count?: number;
  item?: CommandItem;
  /** Index within the flat list of selectable options. */
  optionIndex?: number;
}

export default function CommandBar({
  open,
  onClose,
  localCommands,
  remoteCommands = [],
  remoteLoading = false,
  onQueryChange,
  onSelect,
  recentIds,
  usesOf,
  recentDisplayCount = 5,
  aiMode = false,
  onAiModeChange,
  aiAnswer = null,
  aiLoading = false,
  aiError = null,
  onAskAi,
  onAiExample,
}: CommandBarProps) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<ScopeKey | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const listboxId = useId();

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  /* ---------------------------------------------------------------- results */

  const scopedKinds = scope ? SCOPES[scope].kinds : null;

  const pool = useMemo(() => {
    const all = [...localCommands, ...remoteCommands];
    if (!scopedKinds) return all;
    return all.filter((item) => (scopedKinds as readonly string[]).includes(item.kind));
  }, [localCommands, remoteCommands, scopedKinds]);

  /** Before anyone types: their recents, then a few sensible defaults. */
  const idleItems = useMemo(() => {
    const byId = new Map(pool.map((item) => [item.id, item]));
    const recents = recentIds
      .map((id) => byId.get(id))
      .filter((item): item is CommandItem => Boolean(item))
      .slice(0, recentDisplayCount)
      .map((item) => ({ ...item, group: 'Recent' as CommandGroup }));

    const recentIdSet = new Set(recents.map((item) => item.id));
    // Actions first — the idle palette should advertise that it can *do*
    // things, which is the part nobody discovers on their own.
    const suggestions = pool
      .filter((item) => item.kind === 'action' && !recentIdSet.has(item.id))
      .slice(0, 4);

    return [...recents, ...suggestions];
  }, [pool, recentDisplayCount, recentIds]);

  const results = useMemo<Array<{ item: CommandItem; score: number }>>(() => {
    if (!hasQuery) return idleItems.map((item) => ({ item, score: 0 }));

    const ranked = rankCandidates(pool, trimmedQuery, { recencyOf: (item) => usesOf(item.id) });

    const perGroup = new Map<string, number>();
    const kept: Array<{ item: CommandItem; score: number }> = [];
    ranked.forEach(({ item, score }) => {
      const seen = (perGroup.get(item.group) || 0) + 1;
      perGroup.set(item.group, seen);
      if (seen <= PER_GROUP_LIMIT) kept.push({ item, score });
    });
    return kept;
  }, [hasQuery, idleItems, pool, trimmedQuery, usesOf]);

  /*
   * Groups are ordered by their strongest member once someone has typed.
   *
   * A fixed order looks tidy but reads as a bug: with Actions pinned above
   * pages, typing "atendance" put "Export attendance report" above the
   * Attendance page itself. Whichever group holds the best match goes first;
   * ties fall back to the declared order, which is also what the idle palette
   * uses so Recent stays pinned to the top before anything is typed.
   */
  const rows = useMemo<RenderRow[]>(() => {
    const grouped = new Map<CommandGroup, Array<{ item: CommandItem; score: number }>>();
    results.forEach((result) => {
      const bucket = grouped.get(result.item.group);
      if (bucket) bucket.push(result);
      else grouped.set(result.item.group, [result]);
    });

    const declaredIndex = (group: CommandGroup) => {
      const index = COMMAND_GROUPS.indexOf(group);
      return index === -1 ? COMMAND_GROUPS.length : index;
    };

    const order = Array.from(grouped.keys()).sort((left, right) => {
      if (hasQuery) {
        const bestLeft = Math.max(...(grouped.get(left) || []).map((entry) => entry.score));
        const bestRight = Math.max(...(grouped.get(right) || []).map((entry) => entry.score));
        if (bestLeft !== bestRight) return bestRight - bestLeft;
      }
      return declaredIndex(left) - declaredIndex(right);
    });

    const output: RenderRow[] = [];
    let optionIndex = 0;

    order.forEach((group) => {
      const bucket = grouped.get(group);
      if (!bucket || bucket.length === 0) return;

      output.push({ type: 'header', key: `header:${group}`, group, count: bucket.length });
      bucket.forEach(({ item }) => {
        output.push({ type: 'option', key: item.id, group, item, optionIndex });
        optionIndex += 1;
      });
    });

    return output;
  }, [hasQuery, results]);

  const options = useMemo(() => rows.filter((row) => row.type === 'option'), [rows]);
  const correction = useMemo(
    () => (hasQuery && options.length === 0 ? suggestCorrection(pool, trimmedQuery) : null),
    [hasQuery, options.length, pool, trimmedQuery]
  );

  /* ------------------------------------------------------------ open/close */

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setScope(null);
    setActiveIndex(0);

    // Focus after paint; focusing a just-mounted portal node is unreliable.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = overflow;
      // Returning focus is what makes Escape feel like "cancel" rather than
      // "lose your place".
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    onQueryChange?.(trimmedQuery);
  }, [onQueryChange, open, trimmedQuery]);

  // Clamp when the result set shrinks under the cursor.
  useEffect(() => {
    setActiveIndex((current) => (current >= options.length ? 0 : current));
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, rows]);

  /* -------------------------------------------------------------- handlers */

  const clearScope = useCallback(() => {
    setScope(null);
    setActiveIndex(0);
  }, []);

  const choose = useCallback(
    (item?: CommandItem) => {
      if (!item) return;
      onSelect(item);
      onClose();
    },
    [onClose, onSelect]
  );

  const handleChange = (value: string) => {
    // A scope prefix in the leading position becomes a chip rather than literal
    // text, so the field never contains a stray "@".
    //
    // Matched on the first character of whatever arrived, not on a
    // single-character value: pasting "@priya", or typing fast enough that the
    // browser coalesces the keystrokes, otherwise left the "@" in the query and
    // searched for it literally, which matches nothing.
    if (!scope && value.length > 0 && isScopeKey(value[0])) {
      setScope(value[0] as ScopeKey);
      setQuery(value.slice(1));
      setActiveIndex(0);
      return;
    }
    setQuery(value);
    setActiveIndex(0);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Tab into AI mode, but ONLY from an empty query — otherwise this steals the
    // key from anyone tabbing through results.
    if (!aiMode && event.key === 'Tab' && query.trim().length === 0 && !event.shiftKey) {
      event.preventDefault();
      onAiModeChange?.(true);
      return;
    }

    if (aiMode) {
      if (event.key === 'Enter' && query.trim().length > 0) {
        event.preventDefault();
        onAskAi?.(query.trim());
        return;
      }
      // Esc leaves AI mode first — closing outright would discard an answer the
      // user is still reading.
      if (event.key === 'Escape') {
        event.preventDefault();
        onAiModeChange?.(false);
        return;
      }
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (options.length) setActiveIndex((current) => (current + 1) % options.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (options.length) setActiveIndex((current) => (current - 1 + options.length) % options.length);
        break;
      case 'Home':
        if (options.length) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (options.length) {
          event.preventDefault();
          setActiveIndex(options.length - 1);
        }
        break;
      case 'Enter':
        event.preventDefault();
        choose(options[activeIndex]?.item);
        break;
      case 'Tab':
        // Accept the top result into the field without opening it, so someone
        // can keep refining instead of committing.
        if (options.length && !event.shiftKey) {
          event.preventDefault();
          setQuery(options[activeIndex]?.item?.title || '');
          setActiveIndex(0);
        }
        break;
      case 'Escape':
        event.preventDefault();
        // Peel one layer at a time: text, then scope, then the dialog.
        if (query) {
          setQuery('');
          setActiveIndex(0);
        } else if (scope) {
          clearScope();
        } else {
          onClose();
        }
        break;
      case 'Backspace':
        if (!query && scope) {
          event.preventDefault();
          clearScope();
        }
        break;
      default:
        break;
    }
  };

  if (!open) return null;

  const activeOptionId = options[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined;
  const statusMessage = hasQuery
    ? options.length === 0
      ? `No results for ${trimmedQuery}`
      : `${options.length} result${options.length === 1 ? '' : 's'}. ${
          options[activeIndex]?.item?.title || ''
        }, ${options[activeIndex]?.item?.kind || ''}, ${activeIndex + 1} of ${options.length}`
    : `${options.length} suggestion${options.length === 1 ? '' : 's'}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-[10vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/*
        The glow lives on a wrapper OUTSIDE the panel, not inside it. The panel
        is `overflow-hidden` so that its rounded corners clip the results list,
        and a ring drawn at a negative inset within that box gets clipped away
        entirely — leaving only the sliver that overlapped the input's bottom
        border, which read as a stray line rather than a border.
      */}
      <div
        className={`w-full rounded-xl transition-[max-width] duration-200 ${
          aiMode ? 'ai-glow max-w-4xl' : 'max-w-xl'
        }`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command bar"
          className="flex w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        >
        {/* ------------------------------------------------------- input row */}
        <div>
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            {remoteLoading ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" aria-hidden="true" />
            ) : (
              <Search className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
            )}

            {/*
              Chip fill is blue-700, not blue-600: the brand mid-tone only reaches
              3.33:1 against its own foreground in light mode. Do not reach for
              800+ — the dark ramp is inverted and those collapse to 1.09:1 there.
            */}
            {scope ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-blue-700 px-1.5 py-0.5 text-[11px] font-semibold text-on-brand">
                {SCOPES[scope].label}
                <button
                  type="button"
                  onClick={() => {
                    clearScope();
                    inputRef.current?.focus();
                  }}
                  aria-label={`Clear ${SCOPES[scope].label} filter`}
                  className="rounded-sm hover:opacity-75"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ) : null}

            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeOptionId}
              aria-label="Search CareVance"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => handleChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                aiMode
                  ? 'Ask about your data…'
                  : scope
                    ? `Search ${SCOPES[scope].label.toLowerCase()}…`
                    : 'Search or jump to…'
              }
              className="min-w-0 flex-1 bg-transparent text-[15px] text-slate-900 outline-none placeholder:text-slate-600"
            />

            {/*
              The glow is decorative and aria-hidden, so this button carries the state
              for anyone who cannot see it: a real pressed state and a real label.
            */}
            <button
              type="button"
              onClick={() => onAiModeChange?.(!aiMode)}
              aria-pressed={aiMode}
              aria-label="AI mode"
              className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold transition ${
                aiMode ? 'bg-blue-700 text-on-brand' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              AI
            </button>

            <kbd className="hidden shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 sm:inline-flex">
              Esc
            </kbd>
          </div>
        </div>

        {/* --------------------------------------------------------- results */}
        <div ref={listRef} id={listboxId} role="listbox" aria-label="Results" className="max-h-[19rem] overflow-y-auto p-1.5">
          {aiMode ? (
            aiError ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-slate-900">I can't answer that from your HR data.</p>
                <p className="mt-1 text-xs text-slate-600">{aiError}</p>
              </div>
            ) : (
              <AiAnswerTable
                columns={aiAnswer?.columns ?? []}
                rows={aiAnswer?.rows ?? []}
                notes={aiAnswer?.notes ?? []}
                truncated={aiAnswer?.truncated ?? false}
                plan={aiAnswer?.plan ?? null}
                summary={aiAnswer?.summary ?? null}
                // Absent `kind` means a table — that is what every response was
                // before prose existed, so an answer cached from before the
                // merge still renders as the table it is.
                kind={aiAnswer?.kind ?? 'table'}
                reply={aiAnswer?.reply}
                sources={aiAnswer?.sources}
                loading={aiLoading}
                onExampleClick={
                  onAiExample
                    ? (question) => {
                        setQuery(question);
                        setActiveIndex(0);
                        onAiExample(question);
                      }
                    : undefined
                }
              />
            )
          ) : (
            options.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-slate-600">
                  {hasQuery ? (
                    <>
                      No results for <span className="font-semibold text-slate-900">{trimmedQuery}</span>
                    </>
                  ) : (
                    'Start typing to search.'
                  )}
                </p>
                {correction ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery(correction.title);
                      setActiveIndex(0);
                      inputRef.current?.focus();
                    }}
                    className="mt-3 rounded-md border border-blue-600 px-2.5 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-50"
                  >
                    Did you mean {correction.title}?
                  </button>
                ) : hasQuery ? (
                  <p className="mt-2 text-xs text-slate-600">
                    Try <span className="font-mono">@</span> for people or <span className="font-mono">&gt;</span> for actions.
                  </p>
                ) : null}
              </div>
            ) : (
              rows.map((row) => {
                if (row.type === 'header') {
                  return (
                    <div
                      key={row.key}
                      className="flex items-center justify-between px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-600"
                    >
                      <span>{row.group}</span>
                      <span aria-hidden="true">{row.count}</span>
                    </div>
                  );
                }

                const item = row.item as CommandItem;
                const index = row.optionIndex as number;
                const isActive = index === activeIndex;
                const Icon = item.icon;
                const segments = highlightSegments(item.title, hasQuery ? trimmedQuery : '');

                return (
                  <div
                    key={row.key}
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    aria-selected={isActive}
                    onMouseMove={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(item)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors',
                      isActive ? 'bg-blue-50' : 'hover:bg-slate-50'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                        isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {/*
                          A wash, not a fill, and the text colour is inherited.
                          A solid `bg-amber-200 text-slate-900` pairing looks fine
                          in light mode but inverts in dark — slate-900 becomes
                          near-white and lands on a light amber at 4.24:1. Letting
                          the row's own colour through means the highlight can
                          never introduce a contrast failure of its own.
                        */}
                        {segments.map((segment, segmentIndex) =>
                          segment.match ? (
                            <mark key={segmentIndex} className="rounded-sm bg-amber-400/30 font-semibold text-inherit">
                              {segment.text}
                            </mark>
                          ) : (
                            <span key={segmentIndex}>{segment.text}</span>
                          )
                        )}
                      </span>
                      {item.subtitle ? (
                        <span className="block truncate text-xs text-slate-600">{item.subtitle}</span>
                      ) : null}
                    </span>

                    {/* Never colour-only: the active row also gains the ↵ glyph. */}
                    <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                      {isActive ? (
                        <>
                          <span className="text-blue-700">{item.effect === 'run' ? 'Run' : 'Open'}</span>
                          <CornerDownLeft className="h-3 w-3 text-blue-700" aria-hidden="true" />
                        </>
                      ) : (
                        <span>{item.effect === 'run' ? 'Run' : ''}</span>
                      )}
                    </span>
                  </div>
                );
              })
            )
          )}
        </div>

        {/* ---------------------------------------------------------- footer */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-[10px]">↑</kbd>
            <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-[10px]">↓</kbd>
            move
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-[10px]">↵</kbd>
            open
          </span>
          <span className="hidden items-center gap-1 sm:inline-flex">
            <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-[10px]">@</kbd>
            people
          </span>
          <span className="hidden items-center gap-1 sm:inline-flex">
            <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-[10px]">&gt;</kbd>
            actions
          </span>
          <span className="hidden items-center gap-1 sm:inline-flex">
            <kbd className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-[10px]">#</kbd>
            records
          </span>
        </div>
        </div>
      </div>

      {/* Announces result counts and the highlighted row without stealing focus. */}
      <div role="status" aria-live="polite" className="sr-only">
        {statusMessage}
      </div>
    </div>,
    document.body
  );
}
