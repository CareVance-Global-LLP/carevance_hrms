import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AttendanceRoster, { type AttendanceRow } from '@/features/attendance/AttendanceRoster';

const row = (over: Partial<AttendanceRow> & { name?: string; dept?: string } = {}): AttendanceRow => {
  const { name = 'Zara Khan', dept = 'Engineering', ...rest } = over;
  return {
    user: { id: 1, name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, department: dept },
    days_present: 18,
    leave_days: 0,
    attendance_rate: 90,
    calendar_days_in_range: 20,
    worked_seconds: 3600,
    total_break_seconds: 600,
    is_working: true,
    work_time_breakdown: { track_time: 5400, work_time: 3600, idle_time: 1200 },
    ...rest,
  };
};

const renderRoster = (rows: AttendanceRow[], props: Partial<React.ComponentProps<typeof AttendanceRoster>> = {}) =>
  render(
    <AttendanceRoster
      rows={rows}
      isLoading={false}
      selectedUserId={null}
      onOpenPerson={vi.fn()}
      {...props}
    />
  );

describe('AttendanceRoster', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts with departments collapsed so first paint does not scale with headcount', () => {
    renderRoster([
      row({ user: { id: 1, name: 'A One', department: 'Engineering' } }),
      row({ user: { id: 2, name: 'B Two', department: 'Design' } }),
    ]);

    // Group bars render; people do not until a group is opened.
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.queryByText('A One')).not.toBeInTheDocument();
  });

  it('expands a department on click and shows its rows', () => {
    renderRoster([row({ user: { id: 1, name: 'A One', department: 'Engineering' } })]);

    fireEvent.click(screen.getByRole('button', { name: /Engineering/ }));
    expect(screen.getByText('A One')).toBeInTheDocument();
  });

  it('groups people with no department explicitly instead of dropping them', () => {
    renderRoster([row({ user: { id: 1, name: 'Lost Person', department: '' } })]);

    expect(screen.getByText('No department')).toBeInTheDocument();
  });

  it('tile counts summarise the range and clicking one filters to those people', () => {
    renderRoster([
      row({ user: { id: 1, name: 'Low Person', department: 'Engineering' }, attendance_rate: 40, is_working: false }),
      row({ user: { id: 2, name: 'Fine Person', department: 'Engineering' }, attendance_rate: 95 }),
    ]);

    const lowTile = screen.getByRole('button', { name: /Below 75%/ });
    expect(within(lowTile).getByText('1')).toBeInTheDocument();

    fireEvent.click(lowTile);

    // Filter auto-expands groups and shows only matching people.
    expect(screen.getByText('Low Person')).toBeInTheDocument();
    expect(screen.queryByText('Fine Person')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });

  it('clicking the active tile again clears the filter', () => {
    renderRoster([
      row({ user: { id: 1, name: 'Low Person', department: 'Engineering' }, attendance_rate: 40 }),
      row({ user: { id: 2, name: 'Fine Person', department: 'Engineering' }, attendance_rate: 95 }),
    ]);

    const lowTile = screen.getByRole('button', { name: /Below 75%/ });
    fireEvent.click(lowTile);
    fireEvent.click(lowTile);

    // Back to collapsed everyone-view.
    expect(screen.queryByText('Low Person')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Everyone/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('search cuts across all groups and expands them', () => {
    renderRoster([
      row({ user: { id: 1, name: 'Zara Khan', department: 'Design' } }),
      row({ user: { id: 2, name: 'Amit Kulkarni', department: 'Engineering' } }),
    ]);

    fireEvent.change(screen.getByLabelText('Search attendance'), { target: { value: 'zara' } });

    expect(screen.getByText('Zara Khan')).toBeInTheDocument();
    expect(screen.queryByText('Amit Kulkarni')).not.toBeInTheDocument();
    // A group with no matches disappears rather than sitting empty.
    expect(screen.queryByText('Engineering')).not.toBeInTheDocument();
  });

  it('flags people below 75% inside expanded groups', () => {
    renderRoster([row({ user: { id: 1, name: 'Low Person', department: 'Engineering' }, attendance_rate: 61 })]);

    fireEvent.click(screen.getByRole('button', { name: /Engineering/ }));
    expect(screen.getByTitle('Attendance below 75%')).toBeInTheDocument();
  });

  it('shows the worked/idle/break split as a titled proportional bar', () => {
    renderRoster([row({ user: { id: 1, name: 'A One', department: 'Engineering' } })]);

    fireEvent.click(screen.getByRole('button', { name: /Engineering/ }));
    expect(screen.getByTitle(/^Worked/)).toBeInTheDocument();
    expect(screen.getByTitle(/^Idle/)).toBeInTheDocument();
    expect(screen.getByTitle(/^Break/)).toBeInTheDocument();
  });

  it('opens the person drawer when a row is clicked', () => {
    const onOpenPerson = vi.fn();
    renderRoster([row({ user: { id: 7, name: 'A One', department: 'Engineering' } })], { onOpenPerson });

    fireEvent.click(screen.getByRole('button', { name: /Engineering/ }));
    fireEvent.click(screen.getByText('A One'));

    expect(onOpenPerson).toHaveBeenCalledWith(7);
  });

  it('sorts by lowest attendance within a group', () => {
    renderRoster([
      row({ user: { id: 1, name: 'High Person', department: 'Engineering' }, attendance_rate: 98 }),
      row({ user: { id: 2, name: 'Low Person', department: 'Engineering' }, attendance_rate: 40 }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Lowest attendance' }));
    fireEvent.click(screen.getByRole('button', { name: /Engineering/ }));

    const people = screen.getAllByText(/Person$/);
    expect(people[0]).toHaveTextContent('Low Person');
  });

  it('explains an empty result instead of rendering nothing', () => {
    renderRoster([row({ user: { id: 1, name: 'A One', department: 'Engineering' } })]);

    fireEvent.change(screen.getByLabelText('Search attendance'), { target: { value: 'nobody' } });

    expect(screen.getByText('Nobody matches')).toBeInTheDocument();
  });
});
