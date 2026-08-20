import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DataTable from '@/components/dashboard/DataTable';

/**
 * The page must stop growing with the data.
 *
 * A record list that renders every row into the page pushes its own controls —
 * the column headers above it and the pager below it — off the bottom of the
 * screen. Finding anything then means scrolling to it and scrolling back, which
 * is what made these screens feel endless even after they were paginated.
 *
 * `scrollBody` moves the scrolling inside the table: the body is capped and the
 * header pinned, so the headers and the pager stay put at any row count.
 */
describe('DataTable scrollBody', () => {
  const columns = [
    { key: 'name', header: 'Name', render: (row: { name: string }) => row.name },
  ];
  const rows = Array.from({ length: 15 }, (_, i) => ({ name: `Row ${i + 1}` }));

  const bodyOf = (container: HTMLElement) =>
    container.querySelector('table')?.parentElement as HTMLElement;

  it('caps the body height and lets it scroll', () => {
    const { container } = render(
      <DataTable title="Events" columns={columns} rows={rows} emptyMessage="none" scrollBody />
    );

    const body = bodyOf(container);
    expect(body.className).toContain('overflow-y-auto');
    // Viewport-relative, so a big monitor shows the whole page without
    // scrolling and a laptop scrolls a little inside the table.
    expect(body.className).toContain('max-h-[60vh]');
  });

  it('pins the header, because a capped body with a scrolling header is worse than neither', () => {
    const { container } = render(
      <DataTable title="Events" columns={columns} rows={rows} emptyMessage="none" scrollBody />
    );

    expect(container.querySelector('thead')?.className).toContain('sticky');
  });

  it('leaves the table alone when scrollBody is not asked for', () => {
    const { container } = render(
      <DataTable title="Events" columns={columns} rows={rows} emptyMessage="none" />
    );

    const body = bodyOf(container);
    expect(body.className).not.toContain('overflow-y-auto');
    expect(body.className).not.toContain('max-h-');
    expect(container.querySelector('thead')?.className).not.toContain('sticky');
  });

  it('still renders every row it was given', () => {
    // The cap is visual. Nothing is dropped — the row the admin is looking for
    // must still be in the DOM, and findable by search and by screen readers.
    render(<DataTable title="Events" columns={columns} rows={rows} emptyMessage="none" scrollBody />);

    expect(screen.getByText('Row 1')).toBeInTheDocument();
    expect(screen.getByText('Row 15')).toBeInTheDocument();
  });
});
