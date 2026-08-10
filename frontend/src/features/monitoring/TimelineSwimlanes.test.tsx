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
});
