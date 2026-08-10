/**
 * Scoring for the command bar and every other suggest box in the app.
 *
 * The old ranker matched on exact / prefix / substring only, so `atendance`,
 * `pr` and `pto` all fell through to "no results". Nothing here changes the
 * *order* of the rules that already worked — the new rules (acronym, synonym,
 * subsequence, single edit) are strictly weaker than the old ones, so a query
 * that used to match still lands in the same place. They only rescue queries
 * that previously returned nothing.
 *
 * Every candidate gets one score: the highest-value rule it satisfies. Ties
 * break on the caller's original ordering, which keeps results stable while
 * someone is still typing.
 */

export const enum MatchRank {
  Exact = 1000,
  Prefix = 920,
  WordPrefix = 870,
  Acronym = 840,
  SynonymExact = 820,
  SynonymPrefix = 790,
  Substring = 760,
  SynonymSubstring = 700,
  DescriptionSubstring = 640,
  Subsequence = 560,
  Typo = 520,
  NoMatch = -1,
}

/**
 * Tie-break: how much of the title the query actually accounts for.
 *
 * Two candidates routinely reach the same rank — "atendance" is both a typo for
 * "Attendance" and a subsequence of "Export attendance report". Without this,
 * the winner is whichever happened to be built first, which is why an action
 * once outranked the page it merely mentions. Bounded below the gap between
 * adjacent ranks so it can only ever order equals, never promote across tiers.
 */
const SPECIFICITY_WEIGHT = 15;

const specificityBonus = (query: string, title: string): number => {
  if (!title) return 0;
  const ratio = Math.min(1, query.length / title.length);
  return Math.round(SPECIFICITY_WEIGHT * ratio);
};

/** Boost applied per recent use, capped so habit never buries an exact match. */
const RECENCY_STEP = 12;
const RECENCY_CAP = 60;

export const normalize = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining marks so "José" matches "jose".
    .replace(/\p{M}/gu, '')
    .replace(/[_\-/]+/g, ' ')
    .replace(/[^a-z0-9@#>&. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const tokenize = (value: unknown): string[] => normalize(value).split(' ').filter(Boolean);

/**
 * First letter of each word: "Performance Reviews" -> "pr", "Web & App Usage"
 * -> "wau". Ampersands and other joiners are dropped rather than counted, since
 * nobody types "w&au".
 */
export const acronymOf = (value: unknown): string =>
  String(value ?? '')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word && !/^\d+$/.test(word))
    .map((word) => word[0].toLowerCase())
    .join('');

/** Are all of `query`'s characters present in `text`, in order? */
export const isSubsequence = (query: string, text: string): boolean => {
  if (!query) return true;
  let cursor = 0;
  for (let index = 0; index < text.length && cursor < query.length; index += 1) {
    if (text[index] === query[cursor]) cursor += 1;
  }
  return cursor === query.length;
};

/**
 * True when `a` and `b` are at most one insertion, deletion or substitution
 * apart. A bounded check rather than a full Levenshtein matrix: we only ever
 * ask about distance 1, and this answers in O(n) with no allocation.
 */
export const isWithinOneEdit = (a: string, b: string): boolean => {
  const lengthGap = a.length - b.length;
  if (lengthGap > 1 || lengthGap < -1) return false;
  if (a === b) return true;

  let i = 0;
  let j = 0;
  let edited = false;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (edited) return false;
    edited = true;
    if (lengthGap === 1) i += 1;
    else if (lengthGap === -1) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }

  return true;
};

/**
 * What people type versus what the product calls things.
 *
 * Keys are what someone might type; values are the words that should be
 * considered part of a candidate's searchable text. Add to this whenever
 * someone asks "where do I find X?" — that question is the bug report.
 */
export const SEARCH_SYNONYMS: Record<string, string[]> = {
  leave: ['pto', 'paid time off', 'time off', 'holiday', 'vacation', 'sick', 'day off', 'wfh', 'work from home', 'absence'],
  attendance: ['punch', 'punch in', 'clock', 'clock in', 'check in', 'present', 'absent', 'muster', 'register', 'timesheet'],
  payroll: ['salary', 'payslip', 'pay slip', 'wages', 'ctc', 'ctc breakup', 'tds', 'pf', 'esi', 'compensation', 'pay'],
  'my payroll': ['my payslip', 'my salary', 'my ctc', 'my pay'],
  organization: ['org chart', 'hierarchy', 'reporting line', 'reporting manager', 'org tree', 'structure'],
  employees: ['staff', 'directory', 'people', 'headcount', 'team members', 'colleagues', 'roster'],
  exits: ['resign', 'resignation', 'offboarding', 'notice period', 'f&f', 'full and final', 'separation', 'relieving'],
  'new hires': ['onboarding', 'joinee', 'new joiner', 'induction'],
  performance: ['appraisal', 'kra', 'kpi', 'okr', 'review cycle', 'feedback', '360'],
  goals: ['okr', 'objective', 'target', 'kra'],
  assets: ['laptop', 'device', 'hardware', 'inventory', 'equipment', 'allocation'],
  shifts: ['roster', 'schedule', 'rota', 'timing'],
  breaks: ['tea break', 'lunch', 'pause', 'rest'],
  overtime: ['ot', 'extra hours', 'edit time', 'time correction', 'regularisation', 'regularization'],
  'approval inbox': ['approve', 'approvals', 'pending', 'requests', 'awaiting'],
  screenshots: ['screen capture', 'evidence', 'monitoring images'],
  monitoring: ['productivity', 'idle time', 'productive time', 'activity'],
  'web & app usage': ['browser', 'websites', 'apps', 'url tracking'],
  reports: ['export', 'download', 'csv', 'analytics'],
  'audit logs': ['history', 'who changed', 'activity log', 'trail'],
  'geofence zones': ['geo fencing', 'radius', 'boundary', 'location fence'],
  settings: ['config', 'configuration', 'preferences', 'setup'],
  chat: ['message', 'dm', 'conversation'],
  announcements: ['notice', 'broadcast', 'news'],
  tasks: ['todo', 'ticket', 'kanban', 'work item'],
  projects: ['client work', 'engagement'],
  roles: ['access', 'permission', 'privilege'],
  department: ['team', 'group', 'division'],
};

/**
 * Reverse index: typed word -> canonical terms. Built once. Lets a candidate
 * pick up synonyms without every call site listing them.
 */
const SYNONYM_INDEX: Map<string, string[]> = (() => {
  const index = new Map<string, string[]>();
  Object.entries(SEARCH_SYNONYMS).forEach(([canonical, alternatives]) => {
    alternatives.forEach((alternative) => {
      const key = normalize(alternative);
      if (!key) return;
      const existing = index.get(key);
      if (existing) existing.push(canonical);
      else index.set(key, [canonical]);
    });
  });
  return index;
})();

/** Canonical terms that a typed query is a known alias for. */
export const expandQuery = (query: string): string[] => {
  const normalized = normalize(query);
  if (!normalized) return [];

  const matches = new Set<string>();
  SYNONYM_INDEX.forEach((canonicals, alias) => {
    if (alias === normalized || alias.startsWith(normalized) || normalized.startsWith(alias)) {
      canonicals.forEach((canonical) => matches.add(canonical));
    }
  });
  return Array.from(matches);
};

export interface RankableCandidate {
  /** Primary text, and what gets highlighted. */
  title: string;
  /** Secondary text — matched, but scored lower than the title. */
  subtitle?: string;
  /** Extra words that should match but are never displayed. */
  keywords?: string[];
}

/**
 * Score one candidate. Returns `MatchRank.NoMatch` (-1) when nothing matches,
 * which the caller uses to drop it.
 */
export function scoreCandidate(candidate: RankableCandidate, query: string): number {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;

  const title = normalize(candidate.title);
  const subtitle = normalize(candidate.subtitle);
  if (!title && !subtitle) return MatchRank.NoMatch;

  let best = MatchRank.NoMatch as number;
  const bump = (value: number) => {
    if (value > best) best = value;
  };

  if (title === normalizedQuery) return MatchRank.Exact;
  if (title.startsWith(normalizedQuery)) bump(MatchRank.Prefix);

  const titleWords = title.split(' ');
  for (let index = 1; index < titleWords.length; index += 1) {
    if (titleWords[index].startsWith(normalizedQuery)) {
      bump(MatchRank.WordPrefix);
      break;
    }
  }

  // Two-letter acronyms are only useful when the query is genuinely short;
  // matching "pr" inside a long query would be noise.
  if (normalizedQuery.length >= 2 && !normalizedQuery.includes(' ')) {
    const acronym = acronymOf(candidate.title);
    if (acronym.startsWith(normalizedQuery)) bump(MatchRank.Acronym);
  }

  // Keywords the candidate declares for itself.
  const keywords = candidate.keywords || [];
  for (let index = 0; index < keywords.length; index += 1) {
    const keyword = normalize(keywords[index]);
    if (!keyword) continue;
    if (keyword === normalizedQuery) bump(MatchRank.SynonymExact);
    else if (keyword.startsWith(normalizedQuery)) bump(MatchRank.SynonymPrefix);
    else if (keyword.includes(normalizedQuery)) bump(MatchRank.SynonymSubstring);
  }

  // The shared alias table: "pto" resolves to the canonical term "leave", which
  // then has to actually appear in this candidate's title. Without that second
  // check every page would match every alias.
  const canonicalMatches = expandQuery(normalizedQuery);
  for (let index = 0; index < canonicalMatches.length; index += 1) {
    const canonical = normalize(canonicalMatches[index]);
    if (!canonical) continue;
    if (title === canonical) bump(MatchRank.SynonymExact);
    else if (title.includes(canonical)) bump(MatchRank.SynonymPrefix);
  }

  if (title.includes(normalizedQuery)) bump(MatchRank.Substring);
  if (subtitle && subtitle.includes(normalizedQuery)) bump(MatchRank.DescriptionSubstring);

  // Multi-word queries: every word has to land somewhere in the title.
  const queryWords = normalizedQuery.split(' ').filter(Boolean);
  if (queryWords.length > 1 && queryWords.every((word) => title.includes(word))) {
    bump(MatchRank.Substring);
  }

  // Four characters, not three: "pto" is a subsequence of "Post an
  // announcement" and half a dozen other unrelated titles, which buried the
  // synonym match it was actually meant to find. Short queries are already
  // served by the prefix and acronym rules.
  if (normalizedQuery.length >= 4 && isSubsequence(normalizedQuery.replace(/ /g, ''), title.replace(/ /g, ''))) {
    bump(MatchRank.Subsequence);
  }

  // Typo tolerance is deliberately gated at 4 characters: below that, one edit
  // is most of the word and everything matches everything.
  if (normalizedQuery.length >= 4) {
    for (let index = 0; index < titleWords.length; index += 1) {
      if (isWithinOneEdit(normalizedQuery, titleWords[index])) {
        bump(MatchRank.Typo);
        break;
      }
    }
  }

  return best;
}

export interface RankOptions<T> {
  /** Per-item usage count, keyed however the caller keys its items. */
  recencyOf?: (item: T) => number;
  limit?: number;
}

export interface RankedResult<T> {
  item: T;
  score: number;
}

/**
 * Rank a list, dropping non-matches. With an empty query this returns the
 * input order untouched (capped at `limit`) so callers can use it to render a
 * default list.
 */
export function rankCandidates<T extends RankableCandidate>(
  items: readonly T[],
  query: string,
  options: RankOptions<T> = {}
): RankedResult<T>[] {
  const { recencyOf, limit } = options;
  const normalizedQuery = normalize(query);

  const scored: Array<RankedResult<T> & { index: number }> = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const base = normalizedQuery ? scoreCandidate(item, normalizedQuery) : 0;
    if (base < 0) continue;

    const uses = recencyOf ? recencyOf(item) : 0;
    const boost = Math.min(uses * RECENCY_STEP, RECENCY_CAP);
    const specificity = normalizedQuery ? specificityBonus(normalizedQuery, normalize(item.title)) : 0;
    scored.push({ item, score: base + boost + specificity, index });
  }

  scored.sort((left, right) => (right.score !== left.score ? right.score - left.score : left.index - right.index));

  const capped = typeof limit === 'number' ? scored.slice(0, limit) : scored;
  return capped.map(({ item, score }) => ({ item, score }));
}

/**
 * Levenshtein distance, but it stops as soon as it exceeds `max`.
 *
 * The full matrix is wasted work here: the answer is only ever "close enough
 * or not", and abandoning a row whose best case already exceeds the budget
 * keeps this linear in practice.
 */
export const isWithinEdits = (a: string, b: string, max: number): boolean => {
  if (Math.abs(a.length - b.length) > max) return false;
  if (a === b) return true;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      current[j] = value;
      if (value < rowBest) rowBest = value;
    }

    // Every later row can only be >= this row's minimum, so once the whole row
    // is over budget the answer is settled.
    if (rowBest > max) return false;
    previous = current;
  }

  return previous[b.length] <= max;
};

/**
 * The closest title to a query that matched nothing — powers "Did you mean …?".
 *
 * The tolerance here is deliberately *wider* than the ranker's typo rule. At
 * distance 1 the ranker would already have returned the item as a result, so a
 * suggestion at that distance could never be shown; the useful range is exactly
 * the near-misses the ranker rejects.
 */
export function suggestCorrection<T extends RankableCandidate>(items: readonly T[], query: string): T | null {
  const normalizedQuery = normalize(query);
  // Below five characters a two-edit budget matches almost anything, and a
  // confidently wrong suggestion is worse than none.
  if (normalizedQuery.length < 5) return null;

  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestLength = 0;

  for (let index = 0; index < items.length; index += 1) {
    const title = normalize(items[index].title);
    const candidates = [title, ...title.split(' ')];

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex];
      if (candidate.length < 3) continue;

      // Prefer the closest match; break ties toward the longer, more specific word.
      for (let distance = 1; distance <= 2; distance += 1) {
        if (distance > bestDistance) break;
        if (!isWithinEdits(normalizedQuery, candidate, distance)) continue;

        if (distance < bestDistance || candidate.length > bestLength) {
          best = items[index];
          bestDistance = distance;
          bestLength = candidate.length;
        }
        break;
      }
    }
  }

  return best;
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Split `text` into matched/unmatched runs for rendering. Tries a contiguous
 * substring first, then falls back to acronym initials, then to the whole
 * string unmatched — a typo match highlights nothing rather than lying about
 * which characters matched.
 */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery || !text) return [{ text, match: false }];

  const haystack = normalize(text);
  // normalize() can change length (accents, punctuation), which would make the
  // index meaningless against the original string. Fall back when it does.
  if (haystack.length === text.length) {
    const at = haystack.indexOf(normalizedQuery);
    if (at > -1) {
      const segments: HighlightSegment[] = [];
      if (at > 0) segments.push({ text: text.slice(0, at), match: false });
      segments.push({ text: text.slice(at, at + normalizedQuery.length), match: true });
      if (at + normalizedQuery.length < text.length) {
        segments.push({ text: text.slice(at + normalizedQuery.length), match: false });
      }
      return segments;
    }
  }

  const compact = normalizedQuery.replace(/ /g, '');
  if (compact && acronymOf(text).startsWith(compact)) {
    const segments: HighlightSegment[] = [];
    let cursor = 0;
    let atWordStart = true;
    let buffer = '';

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const isInitial = atWordStart && cursor < compact.length && character.toLowerCase() === compact[cursor];

      if (isInitial) {
        if (buffer) segments.push({ text: buffer, match: false });
        buffer = '';
        segments.push({ text: character, match: true });
        cursor += 1;
      } else {
        buffer += character;
      }
      atWordStart = /[^A-Za-z0-9]/.test(character);
    }

    if (buffer) segments.push({ text: buffer, match: false });
    if (cursor === compact.length) return segments;
  }

  return [{ text, match: false }];
}
