/**
 * Wires the command bar to the app: builds the command list from the caller's
 * navigation, fetches server results, tracks recents and performs selections.
 *
 * Layout renders this once and only has to own a boolean.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Building2,
  CalendarClock,
  FolderKanban,
  Package,
  SquareKanban,
  User as UserIcon,
} from 'lucide-react';
import CommandBar from '@/components/search/CommandBar';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { usePlan } from '@/hooks/usePlan';
import { RECENT_DISPLAY_COUNT, useRecentCommands } from '@/hooks/useRecentCommands';
import {
  buildLocalCommands,
  type CommandContext,
  type CommandItem,
  type CommandKind,
} from '@/lib/commandRegistry';
import { canAccess } from '@/lib/permissions';
import { reportSilentError } from '@/lib/reportSilentError';
import type { NavGroup } from '@/navigation/dashboardNavigation';
import { searchApi, searchAskApi, type AskResponse, type GlobalSearchHit } from '@/services/api';

/** Long enough to skip a keystroke burst, short enough to feel live. */
const DEBOUNCE_MS = 200;
/** Below this the server returns nothing, so don't spend the request. */
const MIN_REMOTE_QUERY = 2;

const REMOTE_ICONS: Record<GlobalSearchHit['type'], typeof UserIcon> = {
  person: UserIcon,
  department: Building2,
  task: SquareKanban,
  project: FolderKanban,
  leave: CalendarClock,
  asset: Package,
  announcement: Bell,
};

const REMOTE_GROUP: Record<GlobalSearchHit['type'], 'People' | 'Records'> = {
  person: 'People',
  department: 'People',
  task: 'Records',
  project: 'Records',
  leave: 'Records',
  asset: 'Records',
  announcement: 'Records',
};

/** Typing in one of these should insert a character, not open the palette. */
const isTypingTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
};

export interface GlobalCommandBarProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Already permission-filtered by Layout — the single source of truth. */
  navigation: NavGroup[];
  isAdminView: boolean;
  isStrictAdminView: boolean;
  isSuperAdminView: boolean;
  isEmployeeOrManagerView: boolean;
  isDesktopShell: boolean;
  /** Desktop shell: opens a path in the browser instead of routing in-shell. */
  openWebDashboard: (path: string) => void;
  onFeedback?: (message: string) => void;
}

export default function GlobalCommandBar({
  open,
  onOpen,
  onClose,
  navigation,
  isAdminView,
  isStrictAdminView,
  isSuperAdminView,
  isEmployeeOrManagerView,
  isDesktopShell,
  openWebDashboard,
  onFeedback,
}: GlobalCommandBarProps) {
  const { user, logout } = useAuth();
  const { hasFeature } = usePlan();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const { recentIds, usesOf, remember } = useRecentCommands(user?.id);

  const [remoteHits, setRemoteHits] = useState<GlobalSearchHit[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [aiMode, setAiMode] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<AskResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);

  const copyCurrentUrl = useCallback(() => {
    const url = window.location.href;
    const done = () => onFeedback?.('Link copied');

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => onFeedback?.('Could not copy the link'));
      return;
    }

    // Clipboard API needs a secure context; the desktop shell is not always one.
    const field = document.createElement('textarea');
    field.value = url;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      onFeedback?.('Could not copy the link');
    }
    document.body.removeChild(field);
  }, [onFeedback]);

  const commandContext = useMemo<CommandContext>(
    () => ({
      user,
      isAdminView,
      isStrictAdminView,
      isSuperAdminView,
      isEmployeeOrManagerView,
      isDesktopShell,
      hasFeature,
      canAccess,
      navigation,
      setTheme,
      resolvedTheme: theme,
      logout,
      copyCurrentUrl,
    }),
    [
      copyCurrentUrl,
      hasFeature,
      isAdminView,
      isDesktopShell,
      isEmployeeOrManagerView,
      isStrictAdminView,
      isSuperAdminView,
      logout,
      navigation,
      setTheme,
      theme,
      user,
    ]
  );

  const localCommands = useMemo(() => buildLocalCommands(commandContext), [commandContext]);

  const remoteCommands = useMemo<CommandItem[]>(
    () =>
      remoteHits.map((hit) => ({
        id: `${hit.type}:${hit.id}`,
        title: hit.title,
        subtitle: hit.subtitle,
        kind: hit.type as CommandKind,
        group: REMOTE_GROUP[hit.type],
        icon: REMOTE_ICONS[hit.type] || UserIcon,
        to: hit.url,
        effect: 'open' as const,
      })),
    [remoteHits]
  );

  /* --------------------------------------------------------- remote search */

  const runRemoteSearch = useCallback((query: string) => {
    abortRef.current?.abort();

    if (query.length < MIN_REMOTE_QUERY) {
      setRemoteHits([]);
      setRemoteLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRemoteLoading(true);

    searchApi
      .query({ q: query }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setRemoteHits(Array.isArray(response.data?.data) ? response.data.data : []);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // A failed server search degrades to local-only results rather than
        // blanking the palette someone is mid-keystroke in.
        setRemoteHits([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRemoteLoading(false);
      });
  }, []);

  const handleQueryChange = useCallback(
    (query: string) => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);

      if (query.length < MIN_REMOTE_QUERY) {
        abortRef.current?.abort();
        setRemoteHits([]);
        setRemoteLoading(false);
        return;
      }

      debounceRef.current = window.setTimeout(() => runRemoteSearch(query), DEBOUNCE_MS);
    },
    [runRemoteSearch]
  );

  // Closing must cancel in-flight work, or a late response repopulates a
  // palette that is no longer on screen.
  useEffect(() => {
    if (open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    setRemoteHits([]);
    setRemoteLoading(false);
  }, [open]);

  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    },
    []
  );

  /* ------------------------------------------------------------------- ask */

  const handleAskAi = useCallback(async (question: string) => {
    setAiLoading(true);
    setAiError(null);
    setAiAnswer(null);

    let answer: AskResponse;

    try {
      const response = await searchAskApi.ask(question);
      answer = response.data;
      setAiAnswer(answer);
    } catch (error) {
      const detail = (error as { response?: { status?: number; data?: { detail?: string } } }).response;
      setAiError(
        detail?.status === 422
          ? (detail.data?.detail ?? 'That question cannot be answered from your HR data.')
          : 'Something went wrong reaching the AI service.',
      );
      return;
    } finally {
      setAiLoading(false);
    }

    /*
     * Deliberately after the table is already on screen, and deliberately not
     * awaited by the render path: the summary is an enrichment that costs another
     * ~6s, and a failure must remove the sentence rather than the answer.
     */
    try {
      const summary = await searchAskApi.summary({
        question, columns: answer.columns, rows: answer.rows,
      });
      setAiAnswer((current) => (current ? { ...current, summary: summary.data.summary } : current));
    } catch (error) {
      reportSilentError('ai-mode-summary', error);
    }
  }, []);

  // A closed palette must not reopen holding the last answer: the next question
  // is a new one, and a stale table under a fresh prompt reads as a reply to it.
  useEffect(() => {
    if (!open) {
      setAiMode(false);
      setAiAnswer(null);
      setAiError(null);
    }
  }, [open]);

  /* -------------------------------------------------------------- shortcuts */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isPaletteChord = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      // "/" is the second shortcut people reach for, but only when they are not
      // already typing — otherwise it eats the character.
      const isSlash = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(event.target);

      if (!isPaletteChord && !isSlash) return;

      event.preventDefault();
      if (open) onClose();
      else onOpen();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, onOpen, open]);

  /* -------------------------------------------------------------- selection */

  const handleSelect = useCallback(
    (item: CommandItem) => {
      remember(item.id);

      if (item.run) {
        item.run();
        return;
      }

      if (item.externalPath) {
        openWebDashboard(item.externalPath);
        return;
      }

      if (item.to) navigate(item.to);
    },
    [navigate, openWebDashboard, remember]
  );

  return (
    <CommandBar
      open={open}
      onClose={onClose}
      localCommands={localCommands}
      remoteCommands={remoteCommands}
      remoteLoading={remoteLoading}
      onQueryChange={handleQueryChange}
      onSelect={handleSelect}
      recentIds={recentIds}
      usesOf={usesOf}
      recentDisplayCount={RECENT_DISPLAY_COUNT}
      aiMode={aiMode}
      onAiModeChange={setAiMode}
      aiAnswer={aiAnswer}
      aiLoading={aiLoading}
      aiError={aiError}
      onAskAi={handleAskAi}
      onAiExample={handleAskAi}
    />
  );
}
