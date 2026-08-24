import type { ReactNode } from 'react';
import SurfaceCard from './SurfaceCard';
import { LIST_MAX_BODY_HEIGHT } from '@/lib/pagination';

interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  title: string;
  description?: string;
  columns: Column<T>[];
  rows: T[];
  emptyMessage: string;
  headerAction?: ReactNode;
  bodyClassName?: string;
  stickyHeader?: boolean;
  /**
   * Cap the table's height and pin its header, so the PAGE stops growing with
   * the data and scrolling happens inside the table instead.
   *
   * The point is what stays put: the column headers and whatever sits below the
   * table — normally the pager — remain on screen at any row count. Without it
   * a long list pushes its own controls off the bottom, which is what made
   * these screens feel like an endless scroll.
   *
   * Implies stickyHeader: `position: sticky` only resolves against a scrolling
   * ancestor, so a pinned header without this container silently does nothing.
   */
  scrollBody?: boolean;
}

export default function DataTable<T>({
  title,
  description,
  columns,
  rows,
  emptyMessage,
  headerAction,
  bodyClassName,
  stickyHeader = false,
  scrollBody = false,
}: DataTableProps<T>) {
  const pinHeader = stickyHeader || scrollBody;
  return (
    <SurfaceCard className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-950">{title}</h2>
          {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
        </div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>
      <div
        className={`overflow-x-auto ${scrollBody ? `${LIST_MAX_BODY_HEIGHT} overflow-y-auto` : ''} ${bodyClassName || ''}`.replace(/\s+/g, ' ').trim()}
      >
        <table className="min-w-full text-left text-xs">
          <thead className={pinHeader ? 'sticky top-0 z-10 bg-slate-50' : 'bg-slate-50'}>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`whitespace-nowrap px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500 ${column.className || ''}`.trim()}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-slate-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column.key} className={`px-4 py-3 align-top text-slate-700 ${column.className || ''}`.trim()}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </SurfaceCard>
  );
}
