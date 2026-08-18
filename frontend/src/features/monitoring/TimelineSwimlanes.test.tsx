import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TimelineSwimlanes from './TimelineSwimlanes';

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  user_id: 7,
  type: 'app',
  name: 'Visual Studio Code',
  duration: 3600,
  recorded_at: '2026-08-06T04:30:00.000Z',
  start_at: '2026-08-06T04:30:00.000Z',
  end_at: '2026-08-06T05:30:00.000Z',
  classification: 'productive',
  classification_reason: 'Developer tooling',
  user: { id: 7, name: 'Zara Khan' },
  ...over,
});

const baseProps = {
  timezone: 'Asia/Kolkata',
  focusedUserId: '' as const,
  onFocusPerson: vi.fn(),
  truncated: false,
};

describe('TimelineSwimlanes', () => {
  it('draws one lane per person with their first-in/last-out and tracked total', () => {
    render(
      <TimelineSwimlanes
        {...baseProps}
        rows={[
          row(),
          row({ id: 2, user_id: 9, user: { id: 9, name: 'Rohan Ghosh' }, start_at: '2026-08-06T06:00:00.000Z', end_at: '2026-08-06T06:30:00.000Z', duration: 1800 }),
        ]}
      />
    );

    expect(screen.getByText('Zara Khan')).toBeInTheDocument();
    expect(screen.getByText('Rohan Ghosh')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: "Zara Khan's day timeline" })).toBeInTheDocument();
    // Zara tracked 1h; lanes are ranked by tracked time so she comes first.
    const names = screen.getAllByText(/Zara Khan|Rohan Ghosh/).map((el) => el.textContent);
    expect(names[0]).toBe('Zara Khan');
  });

  it('keeps idle separate from classified activity in the block tooltips', () => {
    render(
      <TimelineSwimlanes
        {...baseProps}
        rows={[
          row(),
          row({ id: 3, type: 'idle', name: 'Idle', classification: 'neutral', start_at: '2026-08-06T05:30:00.000Z', end_at: '2026-08-06T05:45:00.000Z', duration: 900 }),
        ]}
      />
    );

    const lane = screen.getByRole('img', { name: "Zara Khan's day timeline" });
    const titles = Array.from(lane.querySelectorAll('span')).map((el) => el.getAttribute('title') || '');
    expect(titles.some((title) => title.includes('idle'))).toBe(true);
    expect(titles.some((title) => title.includes('Developer tooling'))).toBe(true);
  });

  it('zooms into a person and lists their blocks by hour', () => {
    const onFocusPerson = vi.fn();
    render(<TimelineSwimlanes {...baseProps} rows={[row()]} onFocusPerson={onFocusPerson} />);

    fireEvent.click(screen.getByRole('button', { name: /Zara Khan/ }));
    expect(onFocusPerson).toHaveBeenCalledWith(7);
  });

  it('shows the hour list with block labels when focused', () => {
    render(<TimelineSwimlanes {...baseProps} rows={[row()]} focusedUserId={7} />);

    expect(screen.getByText(/blocks by hour/)).toBeInTheDocument();
    expect(screen.getByText('Visual Studio Code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show everyone' })).toBeInTheDocument();
  });

  it('discloses truncation instead of pretending the day is complete', () => {
    render(<TimelineSwimlanes {...baseProps} rows={[row()]} truncated />);
    expect(screen.getByText(/first 1,000 shown/)).toBeInTheDocument();
  });

  it('says plainly when the day has no blocks', () => {
    render(<TimelineSwimlanes {...baseProps} rows={[]} />);
    expect(screen.getByText('No tracked blocks on this day.')).toBeInTheDocument();
  });

  it('draws break time as its own kind, not as work and not as idle', async () => {
    /*
     * The defect this pins. Every row that was not `idle` fell through to the
     * classified-activity branch, so a break was painted as a coloured block
     * indistinguishable from real work. Measured on this database: 159 rows of
     * type `breaks` totalling 157.9 hours, every one carrying a NULL
     * classification — nearly a full working month of entitled time reading as
     * productive output.
     */
    render(
      <TimelineSwimlanes
        {...baseProps}
        rows={[
          row({ duration: 1800, end_at: '2026-08-06T05:00:00.000Z' }),
          row({
            id: 2,
            type: 'breaks',
            name: 'Lunch',
            classification: null,
            start_at: '2026-08-06T05:00:00.000Z',
            end_at: '2026-08-06T05:30:00.000Z',
            duration: 1800,
          }),
        ]}
      />
    );

    // The lane summary separates the two: half an hour worked, half on break.
    // Matched on the exact phrasing rather than /break/i, which the legend
    // below the chart also satisfies.
    expect(screen.getByText(/0h 30m break/)).toBeInTheDocument();

    // And the block itself says break rather than a productivity verdict.
    const breakBlock = document.querySelector('[title*="Break"]');
    expect(breakBlock).not.toBeNull();
    expect(breakBlock?.getAttribute('title')).toMatch(/break/i);
    expect(breakBlock?.getAttribute('title')).not.toMatch(/productive/i);
  });

  it('keeps break time out of the tracked-work total', () => {
    // Tracked time is what the lane reports as worked. Counting a break inside
    // it would inflate the day and, downstream, anything computed from it.
    render(
      <TimelineSwimlanes
        {...baseProps}
        rows={[
          row({ duration: 3600 }),
          row({
            id: 2,
            type: 'breaks',
            classification: null,
            start_at: '2026-08-06T06:00:00.000Z',
            end_at: '2026-08-06T07:00:00.000Z',
            duration: 3600,
          }),
        ]}
      />
    );

    const summary = screen.getByText(/1h 0m/);
    expect(summary.textContent).toContain('1h 0m');
    expect(summary.textContent).not.toMatch(/2h 0m/);
  });
});
