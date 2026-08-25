import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Copy, ExternalLink } from 'lucide-react';
import { reportSilentError } from '@/lib/reportSilentError';
import AiThinking from './AiThinking';
import type { AskColumn, AskColumnType, AskPlan, AskRow } from '@/services/api';

/** Where each entity's own screen lives, for "Open full view". */
const ENTITY_ROUTES: Record<string, string> = {
  employees: '/employees',
  payroll: '/payroll',
  attendance: '/attendance',
  leave: '/leave',
  assets: '/assets',
  work: '/tasks',
};

/**
 * What the panel offers before anybody has asked anything — four of the §8
 * worked examples, each one exercising a different part of the grammar: a
 * HAVING threshold, a grouped aggregate, a list with a period filter, and a
 * ranked count.
 *
 * They are here rather than in a hint string because they are CLICKABLE: an
 * empty box that says "ask me anything" teaches nobody what this can do, and
 * the single commonest reason a question gets refused is that it was phrased
 * for a search box rather than for a question.
 */
export const AI_EXAMPLE_QUESTIONS: readonly string[] = [
  'Who was absent more than 3 days last month',
  'Compare average net pay by department',
  'List employees who joined this year',
  'Late arrivals by employee last 30 days',
];

/**
 * §12. A derived definition is naive BY CONSTRUCTION — `avg_net_pay` derived is
 * a plain AVG that answered ₹76,313.27 where the truth was ₹91,575.93 — so the
 * reader has to be able to tell one from a curated definition at a glance.
 * Never colour alone: the two badges say different words.
 */
const ORIGIN_BADGES: Record<'curated' | 'derived', { label: string; title: string; className: string }> = {
  curated: {
    label: 'Curated',
    title: 'Curated definition — checked against the live data, exclusions applied.',
    className: 'border-blue-600 text-blue-700',
  },
  derived: {
    label: 'Derived',
    title: 'Derived definition — read straight off the column, with no exclusions applied.',
    className: 'border-amber-500 text-amber-800',
  },
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2,
});

const COUNTS = new Intl.NumberFormat('en-IN');

/** Money and counts are the only things that read right-aligned. */
const isNumericType = (type: AskColumnType): boolean => type === 'money' || type === 'number';

/**
 * Parsed by hand, never through `new Date`: `new Date('2026-01-01')` is UTC
 * midnight, so in any timezone behind UTC it renders as 31 Dec 2025. A calendar
 * date is not an instant — the same trap the server's `date:Y-m-d` casts exist
 * to stop.
 *
 * `payroll_items.month_year` is a `YYYY-MM` string, so month granularity is
 * rendered as a month; inventing a day for it would claim a precision the
 * column does not have. Anything unrecognised is returned untouched, because a
 * date nobody can parse is not an invitation to guess one.
 */
function formatDate(value: string): string {
  const onDay = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (onDay) {
    const month = MONTH_NAMES[Number(onDay[2]) - 1];
    if (month) return `${Number(onDay[3])} ${month} ${onDay[1]}`;
  }

  const inMonth = /^(\d{4})-(\d{2})$/.exec(value);
  if (inMonth) {
    const month = MONTH_NAMES[Number(inMonth[2]) - 1];
    if (month) return `${month} ${inMonth[1]}`;
  }

  return value;
}

/** Amounts are decimal strings from the server; format once, here, at the boundary. */
function formatCell(value: string | number | null, type: AskColumnType): string {
  if (value === null || value === '') return '—';

  if (type === 'money' || type === 'number') {
    const numeric = Number(value);
    // A number that will not parse is shown as it arrived rather than as NaN:
    // the reader can see something is wrong, which "₹NaN" also says but a
    // silently dropped cell does not.
    if (!Number.isFinite(numeric)) return String(value);
    return type === 'money' ? RUPEES.format(numeric) : COUNTS.format(numeric);
  }

  if (type === 'date') return formatDate(String(value));

  return String(value);
}

/**
 * CSV of the RAW values, not the formatted ones — a spreadsheet should get
 * 91575.93 to compute with, not "₹91,575.93" as text, and 2026-08-24 rather
 * than "24 Aug 2026". Any cell carrying a comma, quote or newline is quoted, or
 * a department called "Sales, EMEA" silently becomes two columns.
 */
function toCsv(columns: AskColumn[], rows: AskRow[]): string {
  const escape = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const header = columns.map((column) => escape(column.label)).join(',');
  const body = rows.map((row) =>
    columns.map((column) => escape(String(row[column.key] ?? ''))).join(','),
  );

  return [header, ...body].join('\n');
}

interface AiAnswerTableProps {
  columns: AskColumn[];
  rows: AskRow[];
  notes: string[];
  truncated: boolean;
  plan: AskPlan | null;
  summary: string | null;
  loading: boolean;
  /** Runs one of the example questions. Without it they render as plain text. */
  onExampleClick?: (question: string) => void;
  /**
   * One assistant, two answer shapes. `prose` means the question was not a data
   * question and the help assistant answered it instead of the panel refusing —
   * "how do I run payroll?" gets a walkthrough rather than "I can't answer that
   * from your HR data".
   */
  kind?: 'table' | 'prose';
  /** Prose only. */
  reply?: string;
  /** Prose only: pages backing the answer up, so a figure can be checked. */
  sources?: Array<{ label: string; route: string }>;
}

const ACTION_CLASS = 'inline-flex items-center gap-1 text-xs font-medium text-blue-700';

export default function AiAnswerTable({
  columns, rows, notes, truncated, plan, summary, loading, onExampleClick,
  kind = 'table', reply, sources = [],
}: AiAnswerTableProps) {
  const [showPlan, setShowPlan] = useState(false);

  /*
   * A question has been asked once an answer came back carrying a plan — which
   * is what separates "nothing matched" from "you have not asked yet". They are
   * different states and they read completely differently: the hint under a
   * real answer looks like the system suggesting the answer is wrong.
   */
  const hasAnswer = plan !== null || columns.length > 0;

  /*
   * Footnotes, plural. There is usually more than one — the caveat a curated
   * metric carries, the period a token actually resolved to, and the warning
   * that a derived definition applied no exclusions. Keyed by position, so two
   * identical notes stay two notes.
   */
  const footnotes = notes.length > 0 ? (
    <ol data-testid="ai-notes" className="mt-2 ml-1 list-decimal space-y-0.5 pl-4 text-xs text-slate-600">
      {notes.map((note, index) => (
        <li key={`${index}-${note}`}>{note}</li>
      ))}
    </ol>
  ) : null;

  const planToggle = plan ? (
    <button
      type="button"
      onClick={() => setShowPlan((open) => !open)}
      className={ACTION_CLASS}
      aria-expanded={showPlan}
    >
      <ChevronDown
        className={`h-3 w-3 transition-transform ${showPlan ? 'rotate-180' : ''}`}
        aria-hidden="true"
      />
      How this was calculated
    </button>
  ) : null;

  const planBody = plan && showPlan ? (
    <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-[11px] text-slate-600">
      {JSON.stringify(plan, null, 2)}
    </pre>
  ) : null;

  if (loading) {
    return <AiThinking />;
  }

  /*
   * A prose answer, before the table paths — it has no columns and no plan, so
   * every check below it would read it as "nothing asked yet" and show the
   * examples instead of the answer.
   *
   * `whitespace-pre-wrap` because the assistant answers procedural questions as
   * numbered steps, and collapsing those into one paragraph is what makes a
   * walkthrough unreadable.
   */
  if (kind === 'prose') {
    return (
      <div data-testid="ai-prose" className="p-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{reply}</p>

        {sources.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2" data-testid="ai-prose-sources">
            {sources.map((source) => (
              <Link
                key={`${source.route}-${source.label}`}
                to={source.route}
                className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs font-medium text-blue-700"
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                {source.label}
              </Link>
            ))}
          </div>
        ) : null}

        {/*
          Said plainly rather than dressed up as a data answer. Somebody who
          asked for a figure and got a paragraph needs to know no query ran —
          otherwise a sentence containing a number reads as a measured result.
        */}
        <p className="mt-3 text-xs text-slate-500">
          Answered from product help — no data query ran.
        </p>
      </div>
    );
  }

  /* Nothing asked yet: show what this can be asked, not an empty result. */
  if (!hasAnswer) {
    return (
      <div className="px-4 py-6">
        <p className="text-sm font-medium text-slate-900">Ask a question about your HR data.</p>
        <p className="mt-1 text-xs text-slate-600">
          Every answer shows the plan behind it. For example:
        </p>
        <ul className="mt-3 space-y-1.5">
          {AI_EXAMPLE_QUESTIONS.map((question) => (
            <li key={question}>
              {onExampleClick ? (
                <button
                  type="button"
                  onClick={() => onExampleClick(question)}
                  className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-left text-sm text-blue-700 transition hover:bg-blue-50"
                >
                  {question}
                </button>
              ) : (
                <span className="block rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600">
                  {question}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  /*
   * "No records match" and "0" are different facts. An empty aggregate rendered
   * as a zero reads as a real measurement, which is how "your leave balance is
   * 0 days" gets said to somebody whose ledger simply has no rows.
   *
   * The notes and the plan stay on screen: an empty table beside an unreadable
   * plan is how a period that resolved to the wrong month passes for "there are
   * none of those".
   */
  if (rows.length === 0) {
    return (
      <div className="px-4 py-8">
        <p className="text-center text-sm text-slate-600">No records match that question.</p>
        {footnotes}
        {planToggle ? <div className="mt-3 flex justify-center">{planToggle}</div> : null}
        {planBody}
      </div>
    );
  }

  return (
    <div className="p-3">
      {summary ? (
        <p data-testid="ai-summary" className="mb-3 px-1 text-sm text-slate-900">
          {summary}
        </p>
      ) : null}

      {/*
        * Wide tables scroll inside their own box; the overlay never scrolls
        * sideways. `min-w-full`, not `w-full`: ten columns under `w-full` get
        * squeezed into unreadable slivers instead of overflowing into the
        * scroller that exists for exactly that.
        */}
      <div
        data-testid="ai-table-scroll"
        className="overflow-x-auto rounded-lg border border-slate-200"
      >
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {columns.map((column) => {
                const badge = column.origin ? ORIGIN_BADGES[column.origin] : null;

                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={`whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 ${
                      isNumericType(column.type) ? 'text-right' : 'text-left'
                    }`}
                  >
                    {column.label}
                    {badge ? (
                      <span
                        data-testid={`origin-${column.key}`}
                        title={badge.title}
                        className={`ml-1.5 inline-block rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-slate-200 last:border-0">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`whitespace-nowrap px-3 py-2 text-slate-900 ${
                      isNumericType(column.type) ? 'text-right tabular-nums' : 'text-left'
                    }`}
                  >
                    {formatCell(row[column.key] ?? null, column.type)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        * The cut-off is the plan's limit — the executor fetches limit + 1 and
        * keeps limit, so that is the number the sentence has to name. Falling
        * back to rows.length only covers a truncation reported with no plan.
        */}
      {truncated ? (
        <p className="mt-2 px-1 text-xs text-slate-600">
          Showing the first {plan?.limit ?? rows.length} rows — there are more.
        </p>
      ) : null}

      {footnotes}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard
              .writeText(toCsv(columns, rows))
              .catch((error) => reportSilentError('ai-answer-csv', error));
          }}
          className={ACTION_CLASS}
        >
          <Copy className="h-3 w-3" aria-hidden="true" />
          Copy as CSV
        </button>

        {plan && ENTITY_ROUTES[plan.entity] ? (
          <Link to={ENTITY_ROUTES[plan.entity]} className={ACTION_CLASS}>
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            Open full view
          </Link>
        ) : null}

        {planToggle}
      </div>

      {planBody}
    </div>
  );
}
