/**
 * The navigation rail.
 *
 * Extracted from ~100 inline lines in `Layout`, and given the things a rail
 * that sits on screen all day should have: a collapsed state, the destinations
 * this particular person actually uses, and unread counts that survive a closed
 * group.
 *
 * The rail is dark in both themes, so its colours come from the `--sidebar-*`
 * tokens rather than the page-surface palette. Note those tokens are declared
 * in two places — light in `index.css`, dark in `styles/theme.css`.
 */

import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronLeft, Search } from 'lucide-react';
import BrandLogo from '@/components/branding/BrandLogo';
import SidebarTooltip from '@/components/navigation/SidebarTooltip';
import SidebarFlyout, { ROW_STAGGER_MS } from '@/components/navigation/SidebarFlyout';
import SidebarTimer from '@/components/navigation/SidebarTimer';
import { buildPageCommands } from '@/lib/commandRegistry';
import { blurbFor } from '@/lib/navigationBlurbs';
import { TOUR_ANCHOR_BY_ROUTE } from '@/features/tour/tourSteps';
import type { NavGroup, NavLinkItem } from '@/navigation/dashboardNavigation';
import { cn } from '@/utils/cn';

/** How many "Frequent" shortcuts to surface, once there is enough history. */
const FREQUENT_LIMIT = 4;
/** Below this many recorded uses the list is noise, so it stays hidden. */
const FREQUENT_MIN_USES = 2;

export interface SidebarProps {
  navigation: NavGroup[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  isGroupOpen: (label: string) => boolean;
  onToggleGroup: (label: string) => void;
  onExpandInto: (label: string) => void;
  /** Usage counts recorded by the command bar, keyed by its command ids. */
  usesOf: (id: string) => number;
  pendingApprovals: number;
  onOpenCommandBar: () => void;
  /** Rendered at the foot; the account menu itself stays in the header. */
  footer?: React.ReactNode;
  showTimer?: boolean;
  /** Mobile drawer: the rail is always expanded and the collapse toggle is hidden. */
  variant?: 'rail' | 'drawer';
  onNavigate?: () => void;
}

const shortcutLabel = () => {
  if (typeof navigator === 'undefined') return 'Ctrl K';
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';
};

export default function Sidebar({
  navigation,
  collapsed,
  onToggleCollapsed,
  isGroupOpen,
  onToggleGroup,
  onExpandInto,
  usesOf,
  pendingApprovals,
  onOpenCommandBar,
  footer,
  showTimer = true,
  variant = 'rail',
  onNavigate,
}: SidebarProps) {
  const location = useLocation();
  const isDrawer = variant === 'drawer';
  const narrow = collapsed && !isDrawer;

  const isRouteActive = (to?: string) => {
    if (!to) return false;
    const normalized = String(to).split('?')[0] || to;
    if (normalized === '/settings' || normalized === '/reports' || normalized === '/analytics') {
      return location.pathname === normalized;
    }
    return location.pathname === normalized || (normalized !== '/dashboard' && location.pathname.startsWith(`${normalized}/`));
  };

  /** Longest matching route wins, so /reports/attendance beats /reports. */
  const bestMatch = useMemo(() => {
    let best: { group: string | null; to: string } | null = null;
    navigation.forEach((group) => {
      const candidates: Array<{ group: string | null; to?: string }> = group.to
        ? [{ group: null, to: group.to }]
        : (group.items || []).map((item) => ({ group: group.label, to: item.to }));

      candidates.forEach((candidate) => {
        if (!candidate.to || !isRouteActive(candidate.to)) return;
        const normalized = String(candidate.to).split('?')[0];
        if (!best || normalized.length > String(best.to).split('?')[0].length) {
          best = { group: candidate.group, to: candidate.to };
        }
      });
    });
    return best as { group: string | null; to: string } | null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, location.pathname]);

  const withApprovalCount = (item: NavLinkItem): NavLinkItem =>
    String(item.to || '').startsWith('/approval-inbox') ? { ...item, unreadCount: pendingApprovals } : item;

  /**
   * The counts already exist on the child links; rolling them up to the parent
   * is what stops a closed group from hiding the seven approvals that were the
   * reason to look at it.
   */
  const rolledCount = (group: NavGroup) =>
    (group.items || []).reduce((sum, item) => sum + (withApprovalCount(item).unreadCount || 0), 0);

  /**
   * "Frequent" is measured, not configured. The command bar already records
   * per-user open counts against the same page ids, so this is a read of data
   * that already exists rather than a new preference to maintain.
   */
  const frequent = useMemo(() => {
    const pages = buildPageCommands(navigation);
    return pages
      .map((page) => ({ page, uses: usesOf(page.id) }))
      .filter((entry) => entry.uses >= FREQUENT_MIN_USES)
      .sort((left, right) => right.uses - left.uses)
      .slice(0, FREQUENT_LIMIT);
  }, [navigation, usesOf]);

  /**
   * `inFlyout` links live in a collapsed group's submenu, where there is room
   * for labels and no need for a tooltip — so they render in the expanded style
   * even though the rail itself is narrow.
   */
  const renderLink = (item: NavLinkItem, activeOverride?: boolean, inFlyout = false, index = 0) => {
    const resolved = withApprovalCount(item);
    const Icon = resolved.icon;
    const active = activeOverride ?? isRouteActive(resolved.to);
    const count = resolved.unreadCount || 0;
    const compact = narrow && !inFlyout;

    return (
      <SidebarTooltip
        key={`${resolved.label}-${resolved.to}`}
        label={resolved.label}
        detail={count ? `${count} pending` : undefined}
        enabled={compact}
      >
        {(tooltipProps) => (
          <Link
            ref={tooltipProps.ref as (node: HTMLAnchorElement | null) => void}
            to={resolved.to}
            onClick={onNavigate}
            // Anchor for the first-login product tour. Derived from the route so
            // it survives relabelling, and absent for routes the tour ignores —
            // a step with no anchor is dropped rather than pointing at nothing.
            data-tour={TOUR_ANCHOR_BY_ROUTE[String(resolved.to).split('?')[0]]}
            aria-current={active ? 'page' : undefined}
            aria-describedby={tooltipProps['aria-describedby']}
            onMouseEnter={tooltipProps.onMouseEnter}
            onMouseLeave={tooltipProps.onMouseLeave}
            onFocus={tooltipProps.onFocus}
            onBlur={tooltipProps.onBlur}
            // Rows arrive in sequence from the join, not all at once.
            style={inFlyout ? { animationDelay: `${index * ROW_STAGGER_MS}ms` } : undefined}
            className={cn(
              'group relative flex items-center gap-2.5 rounded-lg py-2 text-[13px] font-medium transition-all duration-150',
              compact ? 'justify-center px-2' : 'px-2.5',
              active
                // Accent bar plus a tint, not a solid fill. The old solid pill
                // was heavy next to the rolled-up counts, and in light mode its
                // white-on-teal only reached 3.3:1.
                ? 'bg-[var(--sidebar-active)]/40 text-white'
                : 'text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)] hover:text-white',
              !compact && !active && 'hover:pl-3.5',
              !compact && active && 'pl-3.5',
              // Inside a flyout the rows are roomier and hover is the gold
              // accent — teal stays reserved for "the page you are on".
              inFlyout &&
                'gap-2.5 rounded-md px-2 py-[0.5rem] text-[0.84rem] motion-safe:animate-[flyoutRowIn_.26s_cubic-bezier(.2,.9,.25,1)_both]',
              inFlyout && !active && 'hover:bg-[var(--sidebar-accent-wash)] hover:pl-2 hover:text-white'
            )}
          >
            {active ? (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--brand-primary-light)]"
              />
            ) : null}

            <Icon
              className={cn(
                'h-4 w-4 shrink-0',
                active ? 'text-[var(--brand-primary-light)]' : 'text-[var(--sidebar-text)]',
                inFlyout && !active && 'group-hover:text-[var(--sidebar-accent)]'
              )}
              aria-hidden="true"
            />

            {compact ? (
              <span className="sr-only">
                {resolved.label}
                {count ? `, ${count} pending` : ''}
              </span>
            ) : (
              <span className="truncate">{resolved.label}</span>
            )}

            {count ? (
              compact ? (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--sidebar-badge)] ring-2 ring-[var(--sidebar-bg)]"
                />
              ) : (
                <>
                  {/* A bare "7" reads as "seven" and means nothing on its own. */}
                  <span className="sr-only">, {count} pending</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                      active ? 'bg-white/25 text-white' : 'bg-[var(--sidebar-badge)] text-white'
                    )}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                </>
              )
            ) : null}
          </Link>
        )}
      </SidebarTooltip>
    );
  };

  return (
    // The flyout measures this to butt its panel against the rail's outer edge
    // rather than the trigger's, which is inset by the nav's padding.
    <div data-sidebar-rail className="flex h-full flex-col" style={{ background: 'var(--sidebar-bg)' }}>
      {/* ------------------------------------------------------------ head */}
      <div className={cn('relative flex h-16 shrink-0 items-center border-b border-white/10', narrow ? 'justify-center px-2' : 'px-5')}>
        {narrow ? <BrandLogo variant="mark" size="sm" className="h-8 w-8" /> : <BrandLogo variant="full" size="sm" className="max-w-[9.75rem]" />}

        {!isDrawer ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-keyshortcuts="["
            /*
             * Sits on the header's bottom seam, not level with the logo.
             * Collapsed, the rail is 72px wide, so a round button beside the
             * round brand mark reads as two overlapping circles. On the divider
             * it reads as a handle on the seam, and it needs no per-state
             * positioning to stay clear of the wordmark when expanded.
             */
            className="absolute -right-3 top-[3.25rem] z-30 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border-strong bg-white text-slate-600 shadow-md transition hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            <ChevronLeft className={cn('h-3.5 w-3.5 transition-transform duration-200', collapsed && 'rotate-180')} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* --------------------------------------------------------- command */}
      {/* pt-4, not pt-3: the toggle now overhangs the seam and would otherwise
          touch the search row. */}
      <div className={cn('shrink-0 pt-4', narrow ? 'px-2' : 'px-3')}>
        <SidebarTooltip label="Search" detail={shortcutLabel()} enabled={narrow}>
          {(tooltipProps) => (
            <button
              ref={tooltipProps.ref as (node: HTMLButtonElement | null) => void}
              type="button"
              onClick={onOpenCommandBar}
              aria-describedby={tooltipProps['aria-describedby']}
              onMouseEnter={tooltipProps.onMouseEnter}
              onMouseLeave={tooltipProps.onMouseLeave}
              onFocus={tooltipProps.onFocus}
              onBlur={tooltipProps.onBlur}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg border border-white/8 bg-white/6 py-2 text-[13px] text-[var(--sidebar-text)] transition hover:bg-white/12 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
                narrow ? 'justify-center px-2' : 'px-2.5'
              )}
            >
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              {narrow ? (
                <span className="sr-only">Search</span>
              ) : (
                <>
                  <span>Search</span>
                  <kbd className="ml-auto rounded border border-white/15 px-1 py-px font-mono text-[10px] text-[var(--sidebar-text)]">
                    {shortcutLabel()}
                  </kbd>
                </>
              )}
            </button>
          )}
        </SidebarTooltip>
      </div>

      {/* -------------------------------------------------------- frequent */}
      {frequent.length ? (
        <div className={cn('shrink-0 border-b border-white/8 pb-2.5 pt-3', narrow ? 'px-2' : 'px-3')}>
          {!narrow ? (
            <p className="px-2.5 pb-1 text-[10px] font-extrabold uppercase tracking-[0.11em] text-white/35">Frequent</p>
          ) : null}
          <div className="space-y-0.5">
            {frequent.map(({ page }) =>
              renderLink({
                label: page.title,
                to: page.to || '/dashboard',
                icon: page.icon,
              } as NavLinkItem)
            )}
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------------- nav */}
      <nav aria-label="Main" className={cn('flex-1 overflow-y-auto overflow-x-hidden py-3', narrow ? 'px-2' : 'px-3')}>
        {navigation.map((group) => {
          if (group.to) {
            return (
              <div key={group.label} className="mb-1.5">
                {renderLink(group as unknown as NavLinkItem)}
              </div>
            );
          }

          const groupId = `sidebar-group-${group.label.replace(/\W+/g, '-').toLowerCase()}`;
          const holdsActive = bestMatch?.group === group.label;
          const open = isGroupOpen(group.label);
          const rolled = rolledCount(group);
          const items = group.items ?? [];

          /*
           * The group button is the same control in both rail states — a
           * disclosure. Expanded it opens its children below itself; collapsed
           * SidebarFlyout opens the same children beside itself. Only the
           * position of the panel changes, so the ARIA story stays identical.
           */
          const groupButton = (triggerProps: {
            ref?: (node: HTMLElement | null) => void;
            'aria-haspopup'?: 'true';
            'aria-expanded'?: boolean;
            'aria-controls'?: string;
            onMouseEnter?: () => void;
            onMouseLeave?: () => void;
            onFocus?: () => void;
          } | null) => (
                  <button
                    ref={triggerProps?.ref as ((node: HTMLButtonElement | null) => void) | undefined}
                    type="button"
                    // Collapsed, a click still widens the rail into the group —
                    // hovering is the quick peek, clicking commits.
                    onClick={() => (narrow ? onExpandInto(group.label) : onToggleGroup(group.label))}
                    aria-haspopup={triggerProps?.['aria-haspopup']}
                    aria-expanded={narrow ? triggerProps?.['aria-expanded'] : open}
                    aria-controls={narrow ? triggerProps?.['aria-controls'] : groupId}
                    onMouseEnter={triggerProps?.onMouseEnter}
                    onMouseLeave={triggerProps?.onMouseLeave}
                    onFocus={triggerProps?.onFocus}
                    className={cn(
                      'relative flex items-center gap-2.5 rounded-md py-1.5 text-[11px] font-extrabold uppercase tracking-[0.09em] transition-all duration-150',
                      narrow ? 'justify-center px-2' : 'px-2.5',
                      holdsActive ? 'text-[var(--brand-primary-light)]' : 'text-white/50 hover:bg-white/6 hover:text-white/80',
                      /*
                       * Open: the icon takes the panel's surface, loses its
                       * right-hand rounding and grows to the rail's edge, so
                       * icon and panel read as one shape rather than two.
                       *
                       * The width is swapped rather than layered with a negative
                       * margin — a negative margin on a w-full element pulls the
                       * *following* content left without widening the element,
                       * which leaves an 8px strip of rail showing through the join.
                       */
                      narrow && triggerProps?.['aria-expanded']
                        ? 'w-[calc(100%+0.5rem)] rounded-r-none bg-[var(--sidebar-flyout-bg)] text-white'
                        : 'w-full'
                    )}
                  >
                    {narrow && holdsActive ? (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--brand-primary-light)]"
                      />
                    ) : null}

                    {narrow ? (
                      <>
                        <group.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="sr-only">
                          {group.label}
                          {rolled ? `, ${rolled} pending` : ''}
                        </span>
                        {rolled ? (
                          <span
                            aria-hidden="true"
                            className="absolute right-1 top-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--sidebar-badge)] px-1 text-[9px] font-bold text-white ring-2 ring-[var(--sidebar-bg)]"
                          >
                            {rolled > 9 ? '9+' : rolled}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="truncate">{group.label}</span>
                        {rolled && !open ? (
                          <>
                            <span className="sr-only">, {rolled} pending</span>
                            <span
                              aria-hidden="true"
                              className="ml-auto inline-flex min-w-4 items-center justify-center rounded-full bg-[var(--sidebar-badge)] px-1.5 py-0.5 text-[9px] font-bold tracking-normal text-white"
                            >
                              {rolled > 99 ? '99+' : rolled}
                            </span>
                          </>
                        ) : null}
                        <ChevronDown
                          className={cn('h-3.5 w-3.5 shrink-0 opacity-70 transition-transform duration-200', rolled && !open ? 'ml-1' : 'ml-auto', open && 'rotate-180')}
                          aria-hidden="true"
                        />
                      </>
                    )}
                  </button>
          );

          return (
            <div key={group.label} className="relative mb-1.5 space-y-0.5">
              {narrow ? (
                <SidebarFlyout
                  label={group.label}
                  icon={group.icon}
                  blurb={blurbFor(group.label)}
                  count={items.length}
                  trigger={groupButton}
                >
                  {items.map((item, index) => renderLink(item, bestMatch?.to === item.to, true, index))}
                </SidebarFlyout>
              ) : (
                <>
                  {groupButton(null)}
                  <div
                    id={groupId}
                    className="grid transition-all duration-200 ease-in-out motion-reduce:transition-none"
                    style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
                  >
                    <div className="overflow-hidden">
                      <div className="space-y-0.5 pt-0.5">
                        {items.map((item) => renderLink(item, bestMatch?.to === item.to))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </nav>

      {/* ------------------------------------------------------------ foot */}
      <div className={cn('shrink-0 space-y-1.5 border-t border-white/8 py-2.5', narrow ? 'px-2' : 'px-3')}>
        <SidebarTimer collapsed={narrow} enabled={showTimer} />
        {footer}
      </div>
    </div>
  );
}
