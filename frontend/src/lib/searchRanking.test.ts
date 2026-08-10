import { describe, expect, it } from 'vitest';
import {
  MatchRank,
  acronymOf,
  expandQuery,
  highlightSegments,
  isSubsequence,
  isWithinEdits,
  isWithinOneEdit,
  normalize,
  rankCandidates,
  scoreCandidate,
  suggestCorrection,
} from './searchRanking';

const page = (title: string, subtitle?: string, keywords?: string[]) => ({ title, subtitle, keywords });

const PAGES = [
  page('Dashboard', 'Home'),
  page('Attendance', 'Attendance'),
  page('Leave', 'Attendance / Leave'),
  page('Approval Inbox', 'Attendance / Pending approvals'),
  page('Employees', 'People'),
  page('Performance Reviews', 'Performance'),
  page('Goals', 'Performance / Goals'),
  page('Web & App Usage', 'Monitoring'),
  page('Payroll', 'Payroll'),
  page('Audit Logs', 'Settings'),
];

const titlesFor = (query: string, limit = 5) =>
  rankCandidates(PAGES, query, { limit }).map((result) => result.item.title);

describe('normalize', () => {
  it('folds case, punctuation and repeated whitespace', () => {
    expect(normalize('  Web & App   Usage ')).toBe('web & app usage');
    expect(normalize('performance-reviews')).toBe('performance reviews');
    expect(normalize('reports/timeline')).toBe('reports timeline');
  });

  it('strips accents so ascii queries match accented names', () => {
    expect(normalize('José Fernández')).toBe('jose fernandez');
  });

  it('survives null and undefined', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});

describe('acronymOf', () => {
  it('takes the initial of each word', () => {
    expect(acronymOf('Performance Reviews')).toBe('pr');
    expect(acronymOf('Web & App Usage')).toBe('wau');
    expect(acronymOf('Approval Inbox')).toBe('ai');
  });

  it('ignores pure-number words so "Reports 2024" is not "r2"', () => {
    expect(acronymOf('Reports 2024')).toBe('r');
  });
});

describe('isSubsequence', () => {
  it('accepts characters in order with gaps', () => {
    expect(isSubsequence('wbapp', 'webappusage')).toBe(true);
    expect(isSubsequence('atn', 'attendance')).toBe(true);
  });

  it('rejects out-of-order characters', () => {
    expect(isSubsequence('nat', 'attendance')).toBe(false);
  });
});

describe('isWithinOneEdit', () => {
  it('accepts a substitution, an insertion and a deletion', () => {
    expect(isWithinOneEdit('atendance', 'attendance')).toBe(true); // insertion
    expect(isWithinOneEdit('attendancee', 'attendance')).toBe(true); // deletion
    expect(isWithinOneEdit('attandance', 'attendance')).toBe(true); // substitution
  });

  it('rejects two or more edits', () => {
    expect(isWithinOneEdit('atendnce', 'attendance')).toBe(false);
    expect(isWithinOneEdit('payrol', 'attendance')).toBe(false);
  });

  it('treats identical strings as within one edit', () => {
    expect(isWithinOneEdit('leave', 'leave')).toBe(true);
  });
});

describe('scoreCandidate ranking order', () => {
  it('scores each rule in the documented order', () => {
    expect(scoreCandidate(page('Leave'), 'leave')).toBe(MatchRank.Exact);
    expect(scoreCandidate(page('Attendance'), 'atte')).toBe(MatchRank.Prefix);
    expect(scoreCandidate(page('Approval Inbox'), 'inbox')).toBe(MatchRank.WordPrefix);
    expect(scoreCandidate(page('Performance Reviews'), 'pr')).toBe(MatchRank.Acronym);
  });

  it('ranks an exact title above a page that merely contains the word', () => {
    const exact = scoreCandidate(page('Leave'), 'leave');
    const contains = scoreCandidate(page('Leave Encashment'), 'leave');
    expect(exact).toBeGreaterThan(contains);
  });

  it('returns NoMatch when nothing matches', () => {
    expect(scoreCandidate(page('Payroll'), 'zzzzz')).toBe(MatchRank.NoMatch);
  });

  it('returns 0 for an empty query so callers can render a default list', () => {
    expect(scoreCandidate(page('Payroll'), '')).toBe(0);
  });
});

describe('typo tolerance', () => {
  it('finds Attendance from a one-character typo', () => {
    expect(titlesFor('atendance')).toContain('Attendance');
  });

  it('finds Employees from a dropped trailing character', () => {
    expect(titlesFor('employee')).toContain('Employees');
  });

  it('does not typo-match queries shorter than four characters', () => {
    // "levе" style noise on a 3-char query would match far too much.
    expect(scoreCandidate(page('Goals'), 'oal')).not.toBe(MatchRank.Typo);
  });
});

/*
 * Regression: "atendance" surfaced "Export attendance report" above the
 * Attendance page. Both reached the same rank — a typo for one, a subsequence
 * for the other — so the winner was just whichever was built first.
 */
describe('specificity tie-breaking', () => {
  it('puts the page first for a misspelled page name', () => {
    const items = [page('Export attendance report'), page('Attendance'), page('Attendance Report')];
    expect(rankCandidates(items, 'atendance')[0].item.title).toBe('Attendance');
  });

  it('prefers the title the query accounts for most of', () => {
    const items = [page('Leave encashment settings'), page('Leave')];
    expect(rankCandidates(items, 'leave')[0].item.title).toBe('Leave');
  });

  it('orders equals without ever promoting across a rank boundary', () => {
    // A prefix match on a long title must still beat a substring match on a
    // short one — specificity orders ties, it does not overrule the rank.
    const prefixOnLongTitle = page('Attendance report for the month');
    const substringOnShortTitle = page('My attendance');
    const ranked = rankCandidates([substringOnShortTitle, prefixOnLongTitle], 'attendance');
    expect(ranked[0].item.title).toBe('Attendance report for the month');
  });
});

describe('acronym matching', () => {
  it('resolves pr to Performance Reviews', () => {
    expect(titlesFor('pr')[0]).toBe('Performance Reviews');
  });

  it('resolves wau to Web & App Usage', () => {
    expect(titlesFor('wau')).toContain('Web & App Usage');
  });
});

describe('synonyms', () => {
  it('maps pto, holiday and vacation to Leave', () => {
    expect(titlesFor('pto')).toContain('Leave');
    expect(titlesFor('holiday')).toContain('Leave');
    expect(titlesFor('vacation')).toContain('Leave');
  });

  it('maps payslip and salary to Payroll', () => {
    expect(titlesFor('payslip')).toContain('Payroll');
    expect(titlesFor('salary')).toContain('Payroll');
  });

  it('maps punch and clock to Attendance', () => {
    expect(titlesFor('punch')).toContain('Attendance');
    expect(titlesFor('clock in')).toContain('Attendance');
  });

  it('does not let an alias match every page', () => {
    const results = titlesFor('pto', 10);
    expect(results).toContain('Leave');
    expect(results).not.toContain('Payroll');
    expect(results).not.toContain('Dashboard');
  });

  /*
   * Regression: "pto" is a subsequence of "Post an announcement", "Export
   * attendance report" and several other unrelated titles, which pushed the
   * one page the alias actually means down the list.
   */
  it('does not let a three-letter query match on subsequence alone', () => {
    const items = [page('Post an announcement'), page('Leave'), page('Copy link to this page')];
    expect(rankCandidates(items, 'pto').map((r) => r.item.title)).toEqual(['Leave']);
  });

  it('still allows subsequence matching from four characters', () => {
    expect(titlesFor('wbapp')).toContain('Web & App Usage');
  });

  it('expandQuery resolves an alias to its canonical term', () => {
    expect(expandQuery('pto')).toContain('leave');
    expect(expandQuery('org chart')).toContain('organization');
  });
});

describe('rankCandidates', () => {
  it('drops non-matches entirely', () => {
    expect(rankCandidates(PAGES, 'zzzzzz')).toHaveLength(0);
  });

  it('preserves input order for equal scores', () => {
    const items = [page('Report A'), page('Report B'), page('Report C')];
    expect(rankCandidates(items, 'report').map((r) => r.item.title)).toEqual(['Report A', 'Report B', 'Report C']);
  });

  it('returns the unfiltered list for an empty query', () => {
    expect(rankCandidates(PAGES, '  ')).toHaveLength(PAGES.length);
  });

  it('honours the limit', () => {
    expect(rankCandidates(PAGES, 'a', { limit: 3 })).toHaveLength(3);
  });

  it('lets recency lift a weaker match above a stronger one', () => {
    const items = [page('Leave Encashment'), page('Leave')];
    const withoutBoost = rankCandidates(items, 'leave').map((r) => r.item.title);
    expect(withoutBoost[0]).toBe('Leave');

    const withBoost = rankCandidates(items, 'leave', {
      recencyOf: (item) => (item.title === 'Leave Encashment' ? 5 : 0),
    }).map((r) => r.item.title);
    // Exact match still wins: the boost is capped below the gap between ranks.
    expect(withBoost[0]).toBe('Leave');
  });

  it('lets recency break a tie between equally-scoring items', () => {
    const items = [page('Report A'), page('Report B')];
    const ranked = rankCandidates(items, 'report', {
      recencyOf: (item) => (item.title === 'Report B' ? 3 : 0),
    }).map((r) => r.item.title);
    expect(ranked[0]).toBe('Report B');
  });
});

describe('isWithinEdits', () => {
  it('measures up to the given budget', () => {
    expect(isWithinEdits('employees', 'emplayeez', 2)).toBe(true);
    expect(isWithinEdits('employees', 'emplayeez', 1)).toBe(false);
    expect(isWithinEdits('leave', 'leave', 0)).toBe(true);
  });

  it('rejects on a length gap larger than the budget without scanning', () => {
    expect(isWithinEdits('a', 'abcdefgh', 2)).toBe(false);
  });

  it('agrees with the single-edit check across a range of pairs', () => {
    const pairs: Array<[string, string]> = [
      ['attendance', 'atendance'],
      ['attendance', 'attandance'],
      ['attendance', 'attendancee'],
      ['attendance', 'payroll'],
      ['leave', 'leaves'],
      ['leave', 'leav'],
    ];
    pairs.forEach(([a, b]) => {
      expect(isWithinEdits(a, b, 1)).toBe(isWithinOneEdit(a, b));
    });
  });
});

describe('suggestCorrection', () => {
  it('suggests the nearest title for a failed query', () => {
    expect(suggestCorrection(PAGES, 'atendance')?.title).toBe('Attendance');
  });

  /*
   * The whole point of the suggestion is to catch what the ranker refuses. At
   * distance 1 the ranker already returns the item, so a suggester with the
   * same tolerance could never actually render — this guards that regression.
   */
  it('reaches further than the ranker does, so the suggestion can actually appear', () => {
    expect(rankCandidates(PAGES, 'emplayeez')).toHaveLength(0);
    expect(suggestCorrection(PAGES, 'emplayeez')?.title).toBe('Employees');
  });

  it('returns null when nothing is close', () => {
    expect(suggestCorrection(PAGES, 'zzzzzzzz')).toBeNull();
  });

  it('ignores short queries, where a two-edit budget would match almost anything', () => {
    expect(suggestCorrection(PAGES, 'zz')).toBeNull();
    expect(suggestCorrection(PAGES, 'goal')).toBeNull();
  });

  it('prefers the closer of two candidates', () => {
    const items = [page('Payroll'), page('Payrol Reports')];
    expect(suggestCorrection(items, 'payrxll')?.title).toBe('Payroll');
  });
});

describe('highlightSegments', () => {
  it('marks a contiguous substring', () => {
    expect(highlightSegments('Attendance', 'tend')).toEqual([
      { text: 'At', match: false },
      { text: 'tend', match: true },
      { text: 'ance', match: false },
    ]);
  });

  it('marks acronym initials when there is no substring match', () => {
    const segments = highlightSegments('Performance Reviews', 'pr');
    expect(segments.filter((segment) => segment.match).map((segment) => segment.text)).toEqual(['P', 'R']);
    expect(segments.map((segment) => segment.text).join('')).toBe('Performance Reviews');
  });

  it('marks nothing for a typo match rather than lying about which characters matched', () => {
    const segments = highlightSegments('Attendance', 'atendance');
    expect(segments).toEqual([{ text: 'Attendance', match: false }]);
  });

  it('always reconstructs the original text exactly', () => {
    for (const query of ['a', 'pr', 'tend', 'zzz', '']) {
      for (const title of ['Attendance', 'Web & App Usage', 'Performance Reviews']) {
        expect(highlightSegments(title, query).map((segment) => segment.text).join('')).toBe(title);
      }
    }
  });
});
