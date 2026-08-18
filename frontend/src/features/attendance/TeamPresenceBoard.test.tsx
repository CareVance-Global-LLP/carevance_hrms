import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import TeamPresenceBoard, {
  type PresencePerson,
  type OffSoonEntry,
} from '@/features/attendance/TeamPresenceBoard';

const person = (over: Partial<PresencePerson> = {}): PresencePerson => ({
  id: 1,
  name: 'Zara Khan',
  designation: 'Engineer',
  status: 'not_in',
  checked_in_at: null,
  ...over,
});

const renderBoard = (
  people: PresencePerson[],
  offSoon: OffSoonEntry[] = [],
  props: Partial<React.ComponentProps<typeof TeamPresenceBoard>> = {}
) =>
  render(
    <TeamPresenceBoard
      people={people}
      offSoon={offSoon}
      departmentName="Engineering"
      isLoading={false}
      // Pinned so the rendered clock time does not depend on the machine
      // running the suite.
      timeZone="Asia/Kolkata"
      {...props}
    />
  );

describe('TeamPresenceBoard', () => {
  it('splits people into In, Not in and On leave with a count on each', () => {
    renderBoard([
      person({ id: 1, name: 'In Person', status: 'in', checked_in_at: '2026-08-18T09:42:00+05:30' }),
      person({ id: 2, name: 'Out Person', status: 'not_in' }),
      person({ id: 3, name: 'Leave Person', status: 'on_leave' }),
      person({ id: 4, name: 'Break Person', status: 'on_break' }),
    ]);

    const inSection = screen.getByRole('group', { name: /^In/ });
    expect(within(inSection).getByText('In Person')).toBeInTheDocument();
    expect(within(inSection).getByText('Break Person')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /^In/ })).toHaveAccessibleName(/2/);

    const outSection = screen.getByRole('group', { name: /Not in/ });
    expect(within(outSection).getByText('Out Person')).toBeInTheDocument();

    const leaveSection = screen.getByRole('group', { name: /On leave/ });
    expect(within(leaveSection).getByText('Leave Person')).toBeInTheDocument();
  });

  it('shows a check-in time only for people who are in', () => {
    renderBoard([
      person({ id: 1, name: 'In Person', status: 'in', checked_in_at: '2026-08-18T09:42:00+05:30' }),
      person({ id: 2, name: 'Out Person', status: 'not_in', checked_in_at: null }),
    ]);

    expect(screen.getByText(/09:42/)).toBeInTheDocument();

    const outRow = screen.getByText('Out Person').closest('li');
    expect(outRow).not.toBeNull();
    expect(within(outRow as HTMLElement).queryByText(/:\d{2}/)).toBeNull();
  });

  it('never renders attendance percentages or worked hours', () => {
    renderBoard([
      person({ id: 1, name: 'In Person', status: 'in', checked_in_at: '2026-08-18T09:42:00+05:30' }),
    ]);

    // The whole point of the presence board: it answers "who is around",
    // not "who is underperforming".
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.queryByText(/\d+h\s*\d*m?/)).toBeNull();
  });

  it('filters by name as you search', async () => {
    renderBoard([
      person({ id: 1, name: 'Meera Iyer', status: 'in', checked_in_at: '2026-08-18T09:42:00+05:30' }),
      person({ id: 2, name: 'Rohit Sharma', status: 'not_in' }),
    ]);

    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'meera');

    expect(screen.getByText('Meera Iyer')).toBeInTheDocument();
    expect(screen.queryByText('Rohit Sharma')).toBeNull();
  });

  it('lists who is off in the next two weeks', () => {
    renderBoard(
      [person({ id: 1, name: 'Someone' })],
      [{ id: 9, name: 'Away Colleague', from: '2026-08-20', to: '2026-08-22' }]
    );

    const strip = screen.getByRole('group', { name: /next two weeks/i });
    expect(within(strip).getByText('Away Colleague')).toBeInTheDocument();
  });

  it('says nobody is off only when nobody is off', () => {
    renderBoard([person({ id: 1, name: 'Someone' })], []);

    expect(screen.getByText(/nobody is off in the next two weeks/i)).toBeInTheDocument();
  });

  it('explains an empty board rather than rendering nothing', () => {
    renderBoard([], []);

    expect(screen.getByText(/not assigned to a department/i)).toBeInTheDocument();
  });
});
