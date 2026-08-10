import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CalendarClock, Users, Wallet } from 'lucide-react';
import CommandBar from './CommandBar';
import type { CommandItem } from '@/lib/commandRegistry';

const items: CommandItem[] = [
  { id: 'page:attendance', title: 'Attendance', subtitle: 'Attendance', kind: 'page', group: 'Go to', icon: CalendarClock, to: '/attendance', effect: 'open' },
  { id: 'page:leave', title: 'Leave', subtitle: 'Attendance', kind: 'page', group: 'Go to', icon: CalendarClock, to: '/leave', effect: 'open' },
  { id: 'page:employees', title: 'Employees', subtitle: 'People', kind: 'page', group: 'Go to', icon: Users, to: '/employees', effect: 'open' },
  { id: 'page:payroll', title: 'Payroll', subtitle: 'Payroll', kind: 'page', group: 'Go to', icon: Wallet, to: '/payroll', effect: 'open' },
  { id: 'action:leave-request', title: 'Apply for leave', subtitle: 'Opens the leave request form', keywords: ['pto'], kind: 'action', group: 'Actions', icon: CalendarClock, to: '/leave?compose=leave-request', effect: 'compose' },
  { id: 'action:logout', title: 'Log out', subtitle: 'End your session', kind: 'action', group: 'Actions', icon: Users, effect: 'run', run: () => {} },
];

function setup(overrides: Partial<React.ComponentProps<typeof CommandBar>> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const usesOf = () => 0;

  render(
    <CommandBar
      open
      onClose={onClose}
      localCommands={items}
      onSelect={onSelect}
      recentIds={[]}
      usesOf={usesOf}
      {...overrides}
    />
  );

  return { onSelect, onClose, user: userEvent.setup() };
}

/** Title text only — the row also contains a subtitle and an effect hint. */
const optionTitles = () =>
  screen.getAllByRole('option').map((option) => option.querySelector('.font-medium')?.textContent?.trim() || '');

/** Group headings live inside the listbox; the scope chip reuses the same words. */
const groupHeadings = () =>
  Array.from(screen.getByRole('listbox').querySelectorAll('.uppercase')).map((node) => node.textContent?.trim());

const activeOption = () => screen.getAllByRole('option').find((option) => option.getAttribute('aria-selected') === 'true');

describe('CommandBar keyboard navigation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens with the first result highlighted', async () => {
    const { user } = setup();
    await user.keyboard('leave');
    expect(activeOption()).toBeTruthy();
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('selects the THIRD result with arrow keys — the thing the old bar could not do', async () => {
    const { onSelect, user } = setup();
    await user.keyboard('e');

    const before = optionTitles();
    expect(before.length).toBeGreaterThanOrEqual(3);

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].title).toBe(before[2]);
  });

  it('wraps from the last result back to the first', async () => {
    const { user } = setup();
    await user.keyboard('leave');
    const count = screen.getAllByRole('option').length;

    for (let index = 0; index < count; index += 1) {
      await user.keyboard('{ArrowDown}');
    }
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('wraps backwards from the first result to the last', async () => {
    const { user } = setup();
    await user.keyboard('leave');
    const options = screen.getAllByRole('option');
    await user.keyboard('{ArrowUp}');
    expect(options[options.length - 1].getAttribute('aria-selected')).toBe('true');
  });

  it('Home and End jump to the first and last result', async () => {
    const { user } = setup();
    await user.keyboard('e');
    await user.keyboard('{End}');
    const options = screen.getAllByRole('option');
    expect(options[options.length - 1].getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{Home}');
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('Escape clears the query first, and only then closes', async () => {
    const { onClose, user } = setup();
    await user.keyboard('leave');
    expect(screen.getByRole('combobox')).toHaveValue('leave');

    await user.keyboard('{Escape}');
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab accepts the highlighted result into the field without selecting it', async () => {
    const { onSelect, user } = setup();
    await user.keyboard('atten');
    await user.tab();
    expect(screen.getByRole('combobox')).toHaveValue('Attendance');
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('CommandBar accessibility contract', () => {
  it('exposes the combobox/listbox roles and wires aria-controls', () => {
    setup();
    const input = screen.getByRole('combobox');
    const listbox = screen.getByRole('listbox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input.getAttribute('aria-controls')).toBe(listbox.getAttribute('id'));
  });

  it('tracks the highlighted option with aria-activedescendant and keeps DOM focus in the input', async () => {
    const { user } = setup();
    await user.keyboard('e');

    const input = screen.getByRole('combobox');
    expect(document.activeElement).toBe(input);

    const first = input.getAttribute('aria-activedescendant');
    expect(first).toBeTruthy();
    expect(document.getElementById(first as string)).toBe(activeOption());

    await user.keyboard('{ArrowDown}');
    const second = input.getAttribute('aria-activedescendant');
    expect(second).not.toBe(first);
    expect(document.getElementById(second as string)).toBe(activeOption());
    // Focus must never move into the list, or typing would break.
    expect(document.activeElement).toBe(input);
  });

  it('announces the result count and position in a live region', async () => {
    const { user } = setup();
    await user.keyboard('leave');

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    const count = screen.getAllByRole('option').length;
    expect(status.textContent).toContain(`${count} result`);
    expect(status.textContent).toContain(`1 of ${count}`);
  });

  it('announces when nothing matched', async () => {
    const { user } = setup();
    await user.keyboard('zzzzzz');
    expect(screen.getByRole('status').textContent).toContain('No results for zzzzzz');
  });
});

describe('CommandBar matching behaviour', () => {
  it('finds a page from a typo', async () => {
    const { user } = setup();
    await user.keyboard('atendance');
    expect(optionTitles().join(' ')).toContain('Attendance');
  });

  it('finds Leave from the synonym "pto"', async () => {
    const { user } = setup();
    await user.keyboard('pto');
    expect(optionTitles().join(' ')).toContain('Leave');
  });

  it('offers a correction when there are no results', async () => {
    const { user } = setup();
    await user.keyboard('payrol');
    // "payrol" is one edit from "payroll", so it should match outright…
    expect(optionTitles().join(' ')).toContain('Payroll');
  });

  it('offers a correction for a near-miss the ranker rejects', async () => {
    const { user } = setup();
    // Two edits from "Employees" — too far for the ranker, close enough to suggest.
    await user.keyboard('emplayeez');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /did you mean employees/i })).toBeInTheDocument();
  });

  it('applies the correction when it is clicked', async () => {
    const { user } = setup();
    await user.keyboard('emplayeez');
    await user.click(screen.getByRole('button', { name: /did you mean/i }));
    expect(screen.getByRole('combobox')).toHaveValue('Employees');
    expect(optionTitles()).toContain('Employees');
  });

  it('does not guess wildly for a query nothing resembles', async () => {
    const { user } = setup();
    await user.keyboard('qqqqqqqq');
    expect(screen.queryByRole('button', { name: /did you mean/i })).not.toBeInTheDocument();
  });
});

describe('CommandBar grouping and scopes', () => {
  /*
   * Regression: group order was fixed with Actions above pages, so typing a
   * misspelled page name surfaced an action that merely mentions it.
   */
  it('puts the group holding the best match first, not a fixed order', async () => {
    const { user } = setup({
      localCommands: [
        {
          id: 'action:export-attendance',
          title: 'Export attendance report',
          subtitle: 'Go to the attendance report',
          keywords: ['download attendance'],
          kind: 'action',
          group: 'Actions',
          icon: CalendarClock,
          to: '/reports/attendance',
          effect: 'open',
        },
        {
          id: 'page:attendance',
          title: 'Attendance',
          subtitle: 'Attendance',
          kind: 'page',
          group: 'Go to',
          icon: CalendarClock,
          to: '/attendance',
          effect: 'open',
        },
      ],
    });

    await user.keyboard('atendance');
    expect(optionTitles()[0]).toBe('Attendance');
    expect(groupHeadings()[0]).toContain('Go to');
  });

  it('keeps Recent pinned first before anything is typed', () => {
    setup({ recentIds: ['page:payroll'] });
    expect(groupHeadings()[0]).toContain('Recent');
  });

  it('groups results under headings', async () => {
    const { user } = setup();
    await user.keyboard('leave');
    expect(groupHeadings()).toEqual(expect.arrayContaining([expect.stringContaining('Actions')]));
    expect(groupHeadings()).toEqual(expect.arrayContaining([expect.stringContaining('Go to')]));
  });

  it('">" scopes to actions and hides pages', async () => {
    const { user } = setup();
    await user.keyboard('>');

    expect(groupHeadings().join(' ')).toContain('Actions');
    expect(groupHeadings().join(' ')).not.toContain('Go to');
    expect(optionTitles()).not.toContain('Attendance');
  });

  it('"@" scopes to people, which excludes every local command', async () => {
    const { user } = setup();
    await user.keyboard('@');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  /*
   * Regression: the prefix was only recognised when the field held exactly one
   * character, so pasting "@priya" (or typing fast enough that the browser
   * coalesced the keystrokes) left the "@" in the query and matched nothing.
   */
  it('recognises a scope prefix pasted together with its query', async () => {
    const { user } = setup({
      remoteCommands: [
        {
          id: 'person:7',
          title: 'Priya Nair',
          subtitle: 'priya@example.com',
          kind: 'person',
          group: 'People',
          icon: Users,
          to: '/employees/7',
          effect: 'open',
        },
      ],
    });

    await user.click(screen.getByRole('combobox'));
    await user.paste('@priya');

    expect(screen.getByRole('combobox')).toHaveValue('priya');
    expect(optionTitles()).toContain('Priya Nair');
    expect(groupHeadings().join(' ')).toContain('People');
  });

  it('strips the prefix from the query rather than searching for it literally', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('combobox'));
    await user.paste('>leave');
    expect(screen.getByRole('combobox')).toHaveValue('leave');
    expect(optionTitles()).toContain('Apply for leave');
  });

  it('Backspace on an empty query removes the scope', async () => {
    const { user } = setup();
    await user.keyboard('>');
    expect(groupHeadings().join(' ')).not.toContain('Go to');

    await user.keyboard('{Backspace}');
    await user.keyboard('leave');
    expect(groupHeadings().join(' ')).toContain('Go to');
  });

  it('shows recents before anything is typed', () => {
    setup({ recentIds: ['page:payroll'] });
    expect(groupHeadings().join(' ')).toContain('Recent');
    expect(optionTitles()[0]).toBe('Payroll');
  });

  it('merges server results into their own groups', async () => {
    const { user } = setup({
      remoteCommands: [
        {
          id: 'person:7',
          title: 'Priya Nair',
          subtitle: 'priya@example.com',
          kind: 'person',
          group: 'People',
          icon: Users,
          to: '/employees/7',
          effect: 'open',
        },
      ],
    });

    await user.keyboard('priya');
    expect(groupHeadings().join(' ')).toContain('People');
    expect(optionTitles()).toContain('Priya Nair');
  });
});

describe('CommandBar selection', () => {
  it('closes after selecting', async () => {
    const { onClose, onSelect, user } = setup();
    await user.keyboard('atten{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does nothing on Enter when there are no results', async () => {
    const { onSelect, onClose, user } = setup();
    await user.keyboard('zzzzzz{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders nothing at all when closed', () => {
    const { container } = render(
      <CommandBar
        open={false}
        onClose={vi.fn()}
        localCommands={items}
        onSelect={vi.fn()}
        recentIds={[]}
        usesOf={() => 0}
      />
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
