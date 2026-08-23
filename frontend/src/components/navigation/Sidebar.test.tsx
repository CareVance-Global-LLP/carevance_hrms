import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CalendarClock, LayoutDashboard, Users, Wallet } from 'lucide-react';
import Sidebar from './Sidebar';
import type { NavGroup } from '@/navigation/dashboardNavigation';

vi.mock('@/services/api', () => ({
  timeEntryApi: {
    active: vi.fn().mockResolvedValue({ data: null }),
    stop: vi.fn().mockResolvedValue({}),
  },
}));

const NAV: NavGroup[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  {
    label: 'Attendance',
    icon: CalendarClock,
    items: [
      { label: 'Attendance', to: '/attendance', icon: CalendarClock },
      { label: 'Leave', to: '/leave', icon: CalendarClock },
      { label: 'Approval Inbox', to: '/approval-inbox?section=leave', icon: CalendarClock },
    ],
  },
  {
    label: 'People',
    icon: Users,
    items: [{ label: 'Employees', to: '/employees', icon: Users }],
  },
  {
    label: 'Payroll',
    icon: Wallet,
    items: [{ label: 'Payroll', to: '/payroll', icon: Wallet }],
  },
];

function setup(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}, route = '/attendance') {
  const onToggleCollapsed = vi.fn();
  const onToggleGroup = vi.fn();
  const onExpandInto = vi.fn();
  const onOpenCommandBar = vi.fn();

  const props: React.ComponentProps<typeof Sidebar> = {
    navigation: NAV,
    collapsed: false,
    onToggleCollapsed,
    isGroupOpen: () => true,
    onToggleGroup,
    onExpandInto,
    usesOf: () => 0,
    pendingApprovals: 0,
    onOpenCommandBar,
    showTimer: false,
    ...overrides,
  };

  render(
    <MemoryRouter initialEntries={[route]}>
      <Sidebar {...props} />
    </MemoryRouter>
  );

  return { onToggleCollapsed, onToggleGroup, onExpandInto, onOpenCommandBar, user: userEvent.setup() };
}

const rail = () => screen.getByRole('navigation', { name: 'Main' });

describe('Sidebar structure', () => {
  beforeEach(() => vi.clearAllMocks());

  it('names the navigation landmark', () => {
    setup();
    expect(rail()).toBeInTheDocument();
  });

  it('marks the current page with aria-current', () => {
    setup({}, '/attendance');
    const current = within(rail()).getAllByRole('link', { name: /attendance/i }).find((link) => link.getAttribute('aria-current'));
    expect(current).toHaveAttribute('aria-current', 'page');
  });

  it('gives group toggles aria-expanded and aria-controls when expanded', () => {
    setup();
    const toggle = screen.getByRole('button', { name: /^attendance/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const controls = toggle.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls as string)).toBeInTheDocument();
  });

  it('renders only the groups it is given', () => {
    setup();
    expect(screen.getByRole('button', { name: /^payroll/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^monitoring/i })).not.toBeInTheDocument();
  });
});

describe('Sidebar collapse', () => {
  it('shows the wordmark when expanded', () => {
    setup({ collapsed: false });
    expect(screen.getByAltText('CareVance')).toHaveAttribute('src', '/carevance-logo-full.png');
  });

  it('swaps to the circle mark when collapsed', () => {
    setup({ collapsed: true });
    expect(screen.getByAltText('CareVance')).toHaveAttribute('src', '/carevance-logo-icon.png');
  });

  /*
   * The SVGs in public/ are far smaller but are not the same artwork — their
   * monogram is an approximation, and the favicon uses the PNG, so switching
   * only the app makes the tab and the rail disagree. Guarding the asset here
   * so the file-size argument can't quietly win again.
   */
  it('uses the same artwork the favicon does', () => {
    setup({ collapsed: true });
    expect(screen.getByAltText('CareVance').getAttribute('src')).toMatch(/\.png$/);
  });

  it('toggles from the chevron', async () => {
    const { onToggleCollapsed, user } = setup({ collapsed: false });
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('flips the toggle label when collapsed', () => {
    setup({ collapsed: true });
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('keeps every label available to screen readers when collapsed', () => {
    setup({ collapsed: true });
    // Clipped, not removed — the accessible name must survive.
    expect(within(rail()).getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /attendance/i })).toBeInTheDocument();
  });

  /*
   * A group is a disclosure in both states — expanded it opens its children
   * below itself, collapsed it opens the same children in a flyout beside
   * itself. So aria-expanded stays, and gains aria-haspopup.
   */
  it('keeps the group button a disclosure when collapsed', () => {
    setup({ collapsed: true });
    const toggle = screen.getByRole('button', { name: /attendance/i });
    expect(toggle).toHaveAttribute('aria-haspopup', 'true');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands the rail into the group when a collapsed group icon is clicked', async () => {
    const { onExpandInto, onToggleGroup, user } = setup({ collapsed: true });
    await user.click(screen.getByRole('button', { name: /^people/i }));
    expect(onExpandInto).toHaveBeenCalledWith('People');
    expect(onToggleGroup).not.toHaveBeenCalled();
  });

  it('toggles the group normally when expanded', async () => {
    const { onExpandInto, onToggleGroup, user } = setup({ collapsed: false });
    await user.click(screen.getByRole('button', { name: /^people/i }));
    expect(onToggleGroup).toHaveBeenCalledWith('People');
    expect(onExpandInto).not.toHaveBeenCalled();
  });

  it('has no collapse toggle in the drawer, which is never narrow', () => {
    setup({ variant: 'drawer', collapsed: true });
    expect(screen.queryByRole('button', { name: /collapse sidebar|expand sidebar/i })).not.toBeInTheDocument();
    // And it shows full labels regardless of the collapsed flag.
    expect(screen.getByAltText('CareVance')).toHaveAttribute('src', '/carevance-logo-full.png');
  });
});

describe('Sidebar badge roll-up', () => {
  /*
   * The regression this guards: counts lived only on child links, so closing a
   * group hid the pending approvals that were the reason to look at it.
   */
  it('rolls child counts up to a closed group', () => {
    setup({ pendingApprovals: 7, isGroupOpen: () => false });
    const toggle = screen.getByRole('button', { name: /attendance.*7 pending/i });
    expect(toggle).toBeInTheDocument();
  });

  it('hides the rolled-up count when the group is open, since the child shows it', () => {
    setup({ pendingApprovals: 7, isGroupOpen: () => true });
    const toggle = screen.getByRole('button', { name: /^attendance$/i });
    expect(within(toggle).queryByText('7')).not.toBeInTheDocument();
    expect(within(rail()).getByRole('link', { name: /approval inbox/i })).toBeInTheDocument();
  });

  it('keeps the rolled-up count on the collapsed rail', () => {
    setup({ pendingApprovals: 7, collapsed: true });
    expect(screen.getByRole('button', { name: /attendance.*7 pending/i })).toBeInTheDocument();
  });

  it('shows no badge when there is nothing pending', () => {
    setup({ pendingApprovals: 0, isGroupOpen: () => false });
    expect(screen.getByRole('button', { name: /^attendance$/i })).toBeInTheDocument();
  });
});

describe('Sidebar frequent shortcuts', () => {
  it('stays hidden until there is enough history to be useful', () => {
    setup({ usesOf: () => 0 });
    expect(screen.queryByText('Frequent')).not.toBeInTheDocument();
  });

  it('surfaces the most-used pages once they cross the threshold', () => {
    setup({ usesOf: (id) => (id.includes('Payroll') ? 9 : id.includes('Employees') ? 4 : 0) });
    expect(screen.getByText('Frequent')).toBeInTheDocument();

    const frequentLinks = screen.getAllByRole('link', { name: /payroll|employees/i });
    expect(frequentLinks.length).toBeGreaterThan(0);
  });

  it('orders shortcuts by how often they are used', () => {
    setup({ usesOf: (id) => (id.includes('Payroll') ? 9 : id.includes('Employees') ? 4 : 0) });
    const heading = screen.getByText('Frequent');
    const section = heading.parentElement as HTMLElement;
    const labels = within(section).getAllByRole('link').map((link) => link.textContent?.trim());
    expect(labels[0]).toContain('Payroll');
  });

  it('never surfaces a page that is not in the navigation it was given', () => {
    setup({ usesOf: () => 9, navigation: [NAV[0]] });
    const heading = screen.queryByText('Frequent');
    if (!heading) return;
    const section = heading.parentElement as HTMLElement;
    within(section)
      .getAllByRole('link')
      .forEach((link) => expect(link.textContent).toContain('Dashboard'));
  });
});

/**
 * The search row belongs to the COLLAPSED rail only.
 *
 * Expanded, it sat under a header that already carries a wider
 * "Search or jump to…" trigger for the same command bar with the same
 * shortcut - two entry points, one function, a couple of hundred pixels apart,
 * on every screen. Narrow, the header trigger still exists but this is the
 * only affordance inside the nav itself, so it stays.
 */
describe('Sidebar command bar row', () => {
  it('is absent when the rail is expanded, where the header already offers it', () => {
    setup();
    expect(screen.queryByRole('button', { name: /search.*(ctrl|⌘)/i })).not.toBeInTheDocument();
  });

  it('opens the command bar from the collapsed rail', async () => {
    const { onOpenCommandBar, user } = setup({ collapsed: true });
    await user.click(screen.getByRole('button', { name: /search/i }));
    expect(onOpenCommandBar).toHaveBeenCalledTimes(1);
  });

  it('keeps an accessible name when collapsed', () => {
    setup({ collapsed: true });
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
  });
});

describe('Sidebar tooltips', () => {
  it('shows no tooltip while expanded', async () => {
    const { user } = setup({ collapsed: false });
    await user.hover(within(rail()).getByRole('link', { name: /dashboard/i }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('reveals the label on keyboard focus when collapsed', async () => {
    setup({ collapsed: true });
    const link = within(rail()).getByRole('link', { name: /dashboard/i });
    link.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Dashboard');
  });

  it('wires the tooltip to its trigger with aria-describedby', async () => {
    setup({ collapsed: true });
    const link = within(rail()).getByRole('link', { name: /dashboard/i });
    link.focus();
    const tip = await screen.findByRole('tooltip');
    expect(link.getAttribute('aria-describedby')).toBe(tip.id);
  });

  it('never shows a tooltip and a flyout together', async () => {
    setup({ collapsed: true });
    const link = within(rail()).getByRole('link', { name: /dashboard/i });
    const group = screen.getByRole('button', { name: /^people/i });

    link.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Dashboard');

    // Focusing a group opens its flyout, which must evict the tooltip.
    group.focus();
    await waitFor(() => {
      expect(screen.getByRole('group', { name: /people/i })).toBeInTheDocument();
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  it('drops the tooltip when the rail expands again', async () => {
    const { rerender } = (() => {
      const result = render(
        <MemoryRouter initialEntries={['/attendance']}>
          <Sidebar
            navigation={NAV}
            collapsed
            onToggleCollapsed={vi.fn()}
            isGroupOpen={() => true}
            onToggleGroup={vi.fn()}
            onExpandInto={vi.fn()}
            usesOf={() => 0}
            pendingApprovals={0}
            onOpenCommandBar={vi.fn()}
            showTimer={false}
          />
        </MemoryRouter>
      );
      return result;
    })();

    const link = within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link')[0];
    link.focus();
    await screen.findByRole('tooltip');

    rerender(
      <MemoryRouter initialEntries={['/attendance']}>
        <Sidebar
          navigation={NAV}
          collapsed={false}
          onToggleCollapsed={vi.fn()}
          isGroupOpen={() => true}
          onToggleGroup={vi.fn()}
          onExpandInto={vi.fn()}
          usesOf={() => 0}
          pendingApprovals={0}
          onOpenCommandBar={vi.fn()}
          showTimer={false}
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

/**
 * Which link lights up.
 *
 * This moved here from Layout.test.tsx, which asserted `bg-blue-600` on a flat
 * navigation that no longer exists. The rail resolves colour through CSS
 * variables now, so a class-name probe tested the theme rather than the
 * behaviour; `aria-current` is what the component actually promises, and it is
 * what a screen reader announces.
 *
 * Two rules are doing the work, and both are easy to regress:
 *   - longest match wins, so /reports/attendance beats /reports
 *   - /settings, /reports and /analytics match EXACTLY, so a landing page does
 *     not stay lit while you are three levels inside it
 */
describe('Sidebar active route', () => {
  const PRECEDENCE: NavGroup[] = [
    { label: 'Settings', to: '/settings', icon: LayoutDashboard },
    { label: 'Reports', to: '/reports', icon: LayoutDashboard },
    {
      label: 'People',
      icon: Users,
      items: [
        { label: 'Employees', to: '/employees', icon: Users },
        { label: 'Departments', to: '/employees/teams', icon: Users },
      ],
    },
    {
      label: 'Work',
      icon: Wallet,
      items: [
        { label: 'Projects', to: '/projects', icon: Wallet },
        { label: 'Tasks', to: '/tasks', icon: Wallet },
      ],
    },
    {
      label: 'Insight',
      icon: Wallet,
      items: [{ label: 'Attendance report', to: '/reports/attendance', icon: Wallet }],
    },
  ];

  const current = () =>
    screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
      .map((link) => link.textContent?.trim());

  it('lights the deepest match, not its parent section', () => {
    setup({ navigation: PRECEDENCE }, '/employees/teams');

    // Both /employees and /employees/teams match the path; only the longer one
    // is the page you are on.
    expect(current()).toEqual(['Departments']);
  });

  it('keeps sibling sections out of each other', () => {
    setup({ navigation: PRECEDENCE }, '/projects');

    expect(current()).toEqual(['Projects']);
  });

  it('does not keep a landing page lit inside its own subpage', () => {
    setup({ navigation: PRECEDENCE }, '/reports/attendance');

    /*
     * /reports is a real page in its own right rather than a prefix, so the
     * generic entry going dark is the point - two lit rows cannot both be
     * "where you are".
     */
    expect(current()).toEqual(['Attendance report']);
  });

  it('lights the landing page itself when that is where you are', () => {
    setup({ navigation: PRECEDENCE }, '/reports');

    expect(current()).toEqual(['Reports']);
  });
});
