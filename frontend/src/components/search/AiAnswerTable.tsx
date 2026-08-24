import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Copy, ExternalLink } from 'lucide-react';
import { reportSilentError } from '@/lib/reportSilentError';
import type { AskColumn, AskPlan, AskRow } from '@/services/api';

/** Where each entity's own screen lives, for "Open full view". */
const ENTITY_ROUTES: Record<string, string> = {
  employees: '/employees',
  payroll: '/payroll',
  attendance: '/attendance',
  leave: '/leave',
  assets: '/assets',
  work: '/tasks',
};

interface AiAnswerTableProps {
  columns: AskColumn[];
  rows: AskRow[];
  notes: string[];
  truncated: boolean;
  plan: AskPlan | null;
  summary: string | null;
  loading: boolean;
}

/** Amounts are decimal strings from the server; format once, here, at the boundary. */
function formatCell(value: string | number | null, type: AskColumn['type']): string {
  if (value === null || value === '') return '—';

  if (type === 'money') {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: 'INR', minimumFractionDigits: 2,
    }).format(Number(value));
  }

  if (type === 'number') {
    return new Intl.NumberFormat('en-IN').format(Number(value));
  }

  return String(value);
}

/**
 * CSV of the RAW values, not the formatted ones — a spreadsheet should get
 * 91575.93 to compute with, not "₹91,575.93" as text. Any cell carrying a
 * comma, quote or newline is quoted, or a department called "Sales, EMEA"
 * silently becomes two columns.
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

export default function AiAnswerTable({
  columns, rows, notes, truncated, plan, summary, loading,
}: AiAnswerTableProps) {
  const [showPlan, setShowPlan] = useState(false);

  if (loading) {
    return (
      <div className="space-y-2 p-4" role="status" aria-label="Working out the answer">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-slate-100" />
        ))}
      </div>
    );
  }

  /*
   * "No records match" and "0" are different facts. An empty aggregate rendered
   * as a zero reads as a real measurement, which is how "your leave balance is
   * 0 days" gets said to somebody whose ledger simply has no rows.
   */
  if (rows.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-sm text-slate-600">No records match that question.</p>
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

      {/* Wide tables scroll inside their own box; the overlay never scrolls sideways. */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 ${
                    column.type === 'text' ? 'text-left' : 'text-right'
                  }`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-slate-200 last:border-0">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-2 text-slate-900 ${
                      column.type === 'text' ? 'text-left' : 'text-right tabular-nums'
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

      {notes.map((note) => (
        <p key={note} className="mt-2 px-1 text-xs text-slate-600">
          {note}
        </p>
      ))}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard
              .writeText(toCsv(columns, rows))
              .catch((error) => reportSilentError('ai-answer-csv', error));
          }}
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-700"
        >
          <Copy className="h-3 w-3" aria-hidden="true" />
          Copy as CSV
        </button>

        {plan && ENTITY_ROUTES[plan.entity] ? (
          <Link
            to={ENTITY_ROUTES[plan.entity]}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            Open full view
          </Link>
        ) : null}

        {plan ? (
          <button
            type="button"
            onClick={() => setShowPlan((open) => !open)}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700"
            aria-expanded={showPlan}
          >
            <ChevronDown
              className={`h-3 w-3 transition-transform ${showPlan ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
            How this was calculated
          </button>
        ) : null}
      </div>

      {plan && showPlan ? (
        <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-[11px] text-slate-600">
          {JSON.stringify(plan, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
