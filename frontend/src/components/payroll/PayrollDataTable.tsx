import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { Loader2 } from 'lucide-react';

export interface PayrollDataTableColumn<Row = unknown> {
  key: string;
  header: ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Tailwind width class, e.g. 'w-32'. Optional. */
  width?: string;
  /** Class names for every cell body. Use for truncaction/colour. */
  cellClassName?: string;
  headerClassName?: string;
  render: (row: Row, index: number) => ReactNode;
}

interface PayrollDataTableProps<Row = unknown> {
  columns: PayrollDataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string | number;
  loading?: boolean;
  loadingLabel?: string;
  emptyState?: ReactNode;
  /** Click handler. If provided, rows become hoverable. */
  onRowClick?: (row: Row) => void;
  /** Optional class on each `<tr>` (e.g. to highlight a row). */
  rowClassName?: (row: Row) => string | undefined;
  /** Aria label for the table element. */
  ariaLabel?: string;
  /** Optional class for the wrapping card. */
  className?: string;
  /** Show the optional action footer (rendered above the table body). */
  toolbar?: ReactNode;
}

/**
 * Shared table primitive for every list in the Employee Pay sub-tabs.
 *
 * Replaces the ~7 hand-rolled `<table>` blocks that previously used
 * inconsistent `text-xs font-semibold text-slate-500 uppercase tracking-wider`
 * headers, `divide-y divide-slate-100` bodies, and per-page skeletons.
 *
 * Stays a plain HTML table — no virtualisation, no column resize — because
 * Employee Pay lists are short. The 500+ employee scroll pain in
 * EmployeePayrollCards / SalaryBreakdownCards is a ThreePanePicker problem,
 * not a table problem.
 */
export default function PayrollDataTable<Row = unknown>({
  columns,
  rows,
  rowKey,
  loading = false,
  loadingLabel = 'Loading…',
  emptyState,
  onRowClick,
  rowClassName,
  ariaLabel,
  className,
  toolbar,
}: PayrollDataTableProps<Row>) {
  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-blue-600" />
        {loadingLabel}
      </div>
    );
  }

  if (rows.length === 0) {
    return <>{emptyState}</>;
  }

  const alignClass = (align?: 'left' | 'right' | 'center') => {
    if (align === 'right') return 'text-right';
    if (align === 'center') return 'text-center';
    return 'text-left';
  };

  return (
    <div className={cn('overflow-x-auto', className)}>
      {toolbar ? <div className="border-b border-slate-200 px-4 py-3">{toolbar}</div> : null}
      <table className="w-full text-sm" aria-label={ariaLabel}>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  'px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider',
                  alignClass(col.align),
                  col.width,
                  col.headerClassName,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => {
            const key = rowKey(row, index);
            return (
              <tr
                key={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  onRowClick && 'cursor-pointer hover:bg-slate-50',
                  !onRowClick && 'hover:bg-slate-50/70',
                  'transition-colors',
                  rowClassName?.(row),
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-4 py-3 text-slate-900',
                      alignClass(col.align),
                      col.cellClassName,
                    )}
                  >
                    {col.render(row, index)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
