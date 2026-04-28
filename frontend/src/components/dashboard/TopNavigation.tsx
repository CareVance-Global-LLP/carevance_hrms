import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import type { NavGroup, NavLinkItem } from '@/navigation/dashboardNavigation';
import { cn } from '@/utils/cn';

interface TopNavigationProps {
  groups: NavGroup[];
  mobile?: boolean;
  onNavigate?: () => void;
  onOpenExternal?: (path: string) => void;
}

const OVERFLOW_MENU_KEY = '__overflow__';
const REGULAR_GAP_PX = 8;
const COMPACT_GAP_PX = 6;
const REGULAR_MORE_BUTTON_WIDTH = 88;
const COMPACT_MORE_BUTTON_WIDTH = 80;
const WIDTH_EPSILON = 0.5;

function Badge({ count, active }: { count?: number; active: boolean }) {
  if (!count || count <= 0) return null;

  return (
    <span
      className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        active ? 'bg-white/20 text-white' : 'bg-rose-600 text-white'
      }`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

const isPathMatch = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

const getBestMatchedItemTo = (pathname: string, items: NavLinkItem[] = []) =>
  items
    .filter((item) => isPathMatch(pathname, item.to))
    .sort((left, right) => right.to.length - left.to.length)[0]?.to;

const isItemActive = (pathname: string, item: NavLinkItem, siblings?: NavLinkItem[]) => {
  const bestMatchedItemTo = getBestMatchedItemTo(pathname, siblings);
  return bestMatchedItemTo ? bestMatchedItemTo === item.to : isPathMatch(pathname, item.to);
};

const hasActivePath = (pathname: string, group: NavGroup) =>
  group.to
    ? isPathMatch(pathname, group.to)
    : (group.items || []).some((item) => isPathMatch(pathname, item.to));

const getItemDescription = (groupLabel: string, itemLabel: string) => {
  if (groupLabel === 'Reports') {
    return 'Detailed analytics and exports';
  }

  if (groupLabel === 'Attendance') {
    return itemLabel === 'Monitoring'
      ? 'Live time and activity tracking'
      : itemLabel === 'Screenshots'
        ? 'Captured screenshot gallery'
      : 'Attendance and time workflows';
  }

  return 'Workspace and admin controls';
};

const areWidthsEqual = (left: Record<string, number>, right: Record<string, number>) => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => Math.abs(left[key] - right[key]) < WIDTH_EPSILON);
};

function MenuItemRow({
  item,
  groupLabel,
  active,
  onSelect,
  onOpenExternal,
}: {
  item: NavLinkItem;
  groupLabel: string;
  active: boolean;
  onSelect: () => void;
  onOpenExternal?: (path: string) => void;
}) {
  const description = getItemDescription(groupLabel, item.label);
  const itemClassName = cn(
    'flex items-start gap-3 rounded-lg px-3 py-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    active ? 'bg-sky-50 text-sky-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
  );

  const content = (
    <>
      <item.icon className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-sky-700' : 'text-slate-400')} />
      <div className="min-w-0">
        <p className="whitespace-nowrap font-medium">{item.label}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <div className="ml-auto flex items-center self-center">
        <Badge count={item.unreadCount} active={active} />
      </div>
    </>
  );

  if (item.external) {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onOpenExternal?.(item.externalPath || item.to);
          onSelect();
        }}
        className={`${itemClassName} w-full text-left`}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      to={item.to}
      role="menuitem"
      aria-current={active ? 'page' : undefined}
      onClick={onSelect}
      className={itemClassName}
    >
      {content}
    </Link>
  );
}

export default function TopNavigation({
  groups,
  mobile = false,
  onNavigate,
  onOpenExternal,
}: TopNavigationProps) {
  const location = useLocation();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [dropdownStyle, setDropdownStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const [desktopViewportWidth, setDesktopViewportWidth] = useState(0);
  const [measuredWidths, setMeasuredWidths] = useState<Record<string, number>>({});
  const navRef = useRef<HTMLDivElement | null>(null);
  const desktopViewportRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const measureRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const isCompactDesktopNav = !mobile && desktopViewportWidth > 0 && desktopViewportWidth < 900;
  const desktopGapPx = isCompactDesktopNav ? COMPACT_GAP_PX : REGULAR_GAP_PX;
  const desktopGapClassName = isCompactDesktopNav ? 'gap-1.5' : 'gap-2';
  const desktopPillBaseClassName = cn(
    'inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-full border text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-white/80',
    isCompactDesktopNav ? 'gap-1.5 px-3.5' : 'gap-2 px-4'
  );
  const desktopPillActiveClassName = 'border-blue-600 bg-blue-600 text-white shadow-sm';
  const desktopPillInactiveClassName = 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-950';
  const mobilePillBaseClassName =
    'w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

  useLayoutEffect(() => {
    if (mobile) {
      setDesktopViewportWidth(0);
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.round(desktopViewportRef.current?.getBoundingClientRect().width || 0);
      setDesktopViewportWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    updateWidth();

    const viewportElement = desktopViewportRef.current;
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && viewportElement
        ? new ResizeObserver(() => updateWidth())
        : null;

    if (resizeObserver && viewportElement) {
      resizeObserver.observe(viewportElement);
    }

    window.addEventListener('resize', updateWidth);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, [mobile]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (navRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return;
      }

      if (!navRef.current?.contains(target)) {
        setOpenGroup(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenGroup(null);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    setOpenGroup(null);
  }, [location.pathname]);

  useLayoutEffect(() => {
    if (mobile) {
      setMeasuredWidths({});
      return;
    }

    const measure = () => {
      const nextMeasuredWidths = groups.reduce<Record<string, number>>((widths, group) => {
        const width = measureRefs.current[group.label]?.getBoundingClientRect().width || 0;

        if (width > 0) {
          widths[group.label] = Number(width.toFixed(2));
        }

        return widths;
      }, {});

      if (Object.keys(nextMeasuredWidths).length !== groups.length) {
        return;
      }

      setMeasuredWidths((current) => (areWidthsEqual(current, nextMeasuredWidths) ? current : nextMeasuredWidths));
    };

    const frame = window.requestAnimationFrame(measure);

    return () => window.cancelAnimationFrame(frame);
  }, [groups, isCompactDesktopNav, mobile]);

  useEffect(() => {
    if (mobile) return;

    const handleScroll = () => {
      setOpenGroup(null);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [mobile]);

  useEffect(() => {
    if (mobile || !openGroup) {
      setDropdownStyle(null);
      return;
    }

    const updateDropdownPosition = () => {
      const trigger = triggerRefs.current[openGroup];
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const width = Math.min(openGroup === OVERFLOW_MENU_KEY ? 360 : 320, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8));

      setDropdownStyle({
        top: rect.bottom + 12,
        left,
        width,
      });
    };

    updateDropdownPosition();
    window.addEventListener('resize', updateDropdownPosition);
    return () => window.removeEventListener('resize', updateDropdownPosition);
  }, [mobile, openGroup]);

  const activeGroup = useMemo(
    () => groups.find((group) => hasActivePath(location.pathname, group))?.label ?? null,
    [groups, location.pathname]
  );

  const { visibleGroups, overflowGroups } = useMemo(() => {
    if (mobile || desktopViewportWidth <= 0) {
      return { visibleGroups: groups, overflowGroups: [] as NavGroup[] };
    }

    const groupWidths = groups.map((group, index) => ({
      group,
      index,
      width: measuredWidths[group.label] || 0,
    }));

    if (groupWidths.some((entry) => entry.width <= 0)) {
      return { visibleGroups: groups, overflowGroups: [] as NavGroup[] };
    }

    const totalWidth = groupWidths.reduce((sum, entry) => sum + entry.width, 0)
      + Math.max(0, groupWidths.length - 1) * desktopGapPx;

    if (totalWidth <= desktopViewportWidth) {
      return { visibleGroups: groups, overflowGroups: [] as NavGroup[] };
    }

    const selectedLabels = new Set(groups.map((group) => group.label));

    for (const entry of [...groupWidths].reverse()) {
      if (selectedLabels.size <= 1) {
        break;
      }

      selectedLabels.delete(entry.group.label);

      const nextVisibleGroups = groups.filter((group) => selectedLabels.has(group.label));
      const nextOverflowGroups = groups.filter((group) => !selectedLabels.has(group.label));
      const nextVisibleWidth = nextVisibleGroups.reduce((sum, group) => sum + (measuredWidths[group.label] || 0), 0);
      const nextWidth = nextVisibleWidth
        + nextVisibleGroups.length * desktopGapPx
        + (isCompactDesktopNav ? COMPACT_MORE_BUTTON_WIDTH : REGULAR_MORE_BUTTON_WIDTH);

      if (nextWidth <= desktopViewportWidth && nextOverflowGroups.length > 0) {
        return {
          visibleGroups: nextVisibleGroups,
          overflowGroups: nextOverflowGroups,
        };
      }
    }

    const primaryGroup = groups[0] ? [groups[0]] : [];
    return {
      visibleGroups: primaryGroup,
      overflowGroups: groups.slice(primaryGroup.length),
    };
  }, [desktopGapPx, desktopViewportWidth, groups, isCompactDesktopNav, measuredWidths, mobile]);

  useEffect(() => {
    if (mobile || !openGroup || openGroup === OVERFLOW_MENU_KEY) {
      return;
    }

    if (!visibleGroups.some((group) => group.label === openGroup)) {
      setOpenGroup(null);
    }
  }, [mobile, openGroup, visibleGroups]);

  const overflowIsActive = overflowGroups.some((group) => hasActivePath(location.pathname, group));
  const overflowHasUnread = overflowGroups.some((group) => {
    if (group.unreadCount && group.unreadCount > 0) {
      return true;
    }
    return (group.items || []).some((item) => item.unreadCount && item.unreadCount > 0);
  });
  const renderedGroups = mobile ? groups : visibleGroups;

  const renderMeasurementItem = (group: NavGroup) => {
    const isActive = activeGroup === group.label;

    return (
      <div
        key={`measure-${group.label}`}
        ref={(element) => {
          measureRefs.current[group.label] = element;
        }}
        className={cn(
          desktopPillBaseClassName,
          isActive ? desktopPillActiveClassName : desktopPillInactiveClassName
        )}
      >
        <group.icon className="h-4 w-4 shrink-0" />
        <span className="whitespace-nowrap">{group.label}</span>
        <Badge count={group.unreadCount} active={isActive} />
        {group.items?.length ? <ChevronDown className="h-4 w-4 shrink-0" /> : null}
      </div>
    );
  };

  return (
    <div ref={navRef} className={mobile ? 'w-full' : 'relative hidden w-full min-w-0 lg:block'}>
      <nav
        aria-label="Primary"
        className={
          mobile
            ? 'flex w-full flex-col gap-2'
            : 'rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm'
        }
      >
        {mobile ? (
          groups.map((group) => {
            const isActive = activeGroup === group.label;

            if (group.items?.length) {
              const expanded = openGroup === group.label;

              return (
                <div key={group.label} className="w-full">
                  <button
                    ref={(element) => {
                      triggerRefs.current[group.label] = element;
                    }}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={expanded}
                    onClick={() => setOpenGroup((current) => (current === group.label ? null : group.label))}
                    className={cn(
                      'inline-flex items-center gap-2 whitespace-nowrap justify-between',
                      mobilePillBaseClassName,
                      isActive || expanded
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-white hover:text-slate-950'
                    )}
                  >
                    <group.icon className="h-4 w-4" />
                    <span>{group.label}</span>
                    <Badge count={group.unreadCount} active={isActive || expanded} />
                    <ChevronDown className={cn('h-4 w-4 transition', expanded ? 'rotate-180' : '')} />
                  </button>

                  {expanded ? (
                    <div role="menu" className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
                      {group.items.map((item) => (
                        <MenuItemRow
                          key={item.to}
                          item={item}
                          groupLabel={group.label}
                          active={isItemActive(location.pathname, item, group.items)}
                          onOpenExternal={onOpenExternal}
                          onSelect={() => {
                            setOpenGroup(null);
                            onNavigate?.();
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            }

            const actionContent = (
              <>
                <group.icon className="h-4 w-4" />
                <span>{group.label}</span>
                <Badge count={group.unreadCount} active={isActive} />
              </>
            );

            return group.external ? (
              <button
                key={group.label}
                type="button"
                onClick={() => {
                  onOpenExternal?.(group.externalPath || group.to || '/dashboard');
                  onNavigate?.();
                }}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap justify-start',
                  mobilePillBaseClassName,
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-white hover:text-slate-950'
                )}
              >
                {actionContent}
              </button>
            ) : (
              <Link
                key={group.label}
                to={group.to || '/dashboard'}
                aria-current={isActive ? 'page' : undefined}
                onClick={onNavigate}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap justify-start',
                  mobilePillBaseClassName,
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-white hover:text-slate-950'
                )}
              >
                {actionContent}
              </Link>
            );
          })
        ) : (
          <div ref={desktopViewportRef} className="w-full">
            <div className="flex w-full justify-center overflow-hidden">
              <div className={cn('inline-flex max-w-full items-center overflow-hidden whitespace-nowrap', desktopGapClassName)}>
                {renderedGroups.map((group) => {
                  const isActive = activeGroup === group.label;

                  if (group.items?.length) {
                    const expanded = openGroup === group.label;

                    return (
                      <div key={group.label} className="relative shrink-0">
                        <button
                          ref={(element) => {
                            triggerRefs.current[group.label] = element;
                          }}
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={expanded}
                          onClick={() => setOpenGroup((current) => (current === group.label ? null : group.label))}
                          className={cn(
                            desktopPillBaseClassName,
                            isActive || expanded ? desktopPillActiveClassName : desktopPillInactiveClassName
                          )}
                        >
                          <group.icon className="h-4 w-4 shrink-0" />
                          <span className="whitespace-nowrap">{group.label}</span>
                          <Badge count={group.unreadCount} active={isActive || expanded} />
                          <ChevronDown className={cn('h-4 w-4 shrink-0 transition', expanded ? 'rotate-180' : '')} />
                        </button>
                      </div>
                    );
                  }

                  const actionContent = (
                    <>
                      <group.icon className="h-4 w-4 shrink-0" />
                      <span className="whitespace-nowrap">{group.label}</span>
                      <Badge count={group.unreadCount} active={isActive} />
                    </>
                  );

                  return group.external ? (
                    <button
                      key={group.label}
                      type="button"
                      onClick={() => {
                        onOpenExternal?.(group.externalPath || group.to || '/dashboard');
                        onNavigate?.();
                      }}
                      className={cn(
                        desktopPillBaseClassName,
                        isActive ? desktopPillActiveClassName : desktopPillInactiveClassName
                      )}
                    >
                      {actionContent}
                    </button>
                  ) : (
                    <Link
                      key={group.label}
                      to={group.to || '/dashboard'}
                      aria-current={isActive ? 'page' : undefined}
                      onClick={onNavigate}
                      className={cn(
                        desktopPillBaseClassName,
                        isActive ? desktopPillActiveClassName : desktopPillInactiveClassName
                      )}
                    >
                      {actionContent}
                    </Link>
                  );
                })}

                {overflowGroups.length > 0 ? (
                  <div className="relative shrink-0">
                    <button
                      ref={(element) => {
                        triggerRefs.current[OVERFLOW_MENU_KEY] = element;
                      }}
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={openGroup === OVERFLOW_MENU_KEY}
                      onClick={() => setOpenGroup((current) => (current === OVERFLOW_MENU_KEY ? null : OVERFLOW_MENU_KEY))}
                      className={cn(
                        desktopPillBaseClassName,
                        overflowHasUnread ? 'relative' : '',
                        overflowIsActive || openGroup === OVERFLOW_MENU_KEY ? desktopPillActiveClassName : desktopPillInactiveClassName
                      )}
                    >
                      <span className="whitespace-nowrap">More</span>
                      {overflowHasUnread ? (
                        <span className="absolute left-1/2 top-3 h-2.5 w-2.5 translate-x-0.5 -translate-y-1/2 rounded-full border-2 border-white bg-rose-500" />
                      ) : null}
                      <ChevronDown className={cn('h-4 w-4 shrink-0 transition', openGroup === OVERFLOW_MENU_KEY ? 'rotate-180' : '')} />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </nav>

      {!mobile ? (
        <div aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 h-0 overflow-hidden">
          <div className={cn('inline-flex items-center whitespace-nowrap', desktopGapClassName)}>
            {groups.map((group) => renderMeasurementItem(group))}
          </div>
        </div>
      ) : null}

      {!mobile && openGroup && dropdownStyle
        ? createPortal(
            <div
              ref={dropdownRef}
              role="menu"
              className="fixed z-[120] max-h-[min(70vh,32rem)] overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white p-2 shadow-sm"
              style={{
                top: `${dropdownStyle.top}px`,
                left: `${dropdownStyle.left}px`,
                width: `${dropdownStyle.width}px`,
              }}
            >
              {openGroup === OVERFLOW_MENU_KEY ? (
                <div className="space-y-3">
                  {overflowGroups.map((group, index) => {
                    const directGroupActive = hasActivePath(location.pathname, group);

                    if (!group.items?.length) {
                      const directGroupClassName = cn(
                  'flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
                        directGroupActive ? 'bg-sky-50 text-sky-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                      );

                      return group.external ? (
                        <button
                          key={group.label}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onOpenExternal?.(group.externalPath || group.to || '/dashboard');
                            setOpenGroup(null);
                            onNavigate?.();
                          }}
                          className={`${directGroupClassName} w-full text-left`}
                        >
                          <group.icon className={cn('h-4 w-4 shrink-0', directGroupActive ? 'text-sky-700' : 'text-slate-400')} />
                          <span className="whitespace-nowrap font-medium">{group.label}</span>
                          <div className="ml-auto flex items-center">
                            <Badge count={group.unreadCount} active={directGroupActive} />
                          </div>
                        </button>
                      ) : (
                        <Link
                          key={group.label}
                          to={group.to || '/dashboard'}
                          role="menuitem"
                          aria-current={directGroupActive ? 'page' : undefined}
                          onClick={() => {
                            setOpenGroup(null);
                            onNavigate?.();
                          }}
                          className={directGroupClassName}
                        >
                          <group.icon className={cn('h-4 w-4 shrink-0', directGroupActive ? 'text-sky-700' : 'text-slate-400')} />
                          <span className="whitespace-nowrap font-medium">{group.label}</span>
                          <div className="ml-auto flex items-center">
                            <Badge count={group.unreadCount} active={directGroupActive} />
                          </div>
                        </Link>
                      );
                    }

                    return (
                      <div key={group.label} className={cn(index > 0 ? 'border-t border-slate-100 pt-3' : '')}>
                        <div className="mb-2 flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          <group.icon className="h-3.5 w-3.5" />
                          <span className="whitespace-nowrap">{group.label}</span>
                        </div>
                        <div className="space-y-1">
                          {group.items.map((item) => (
                            <MenuItemRow
                              key={item.to}
                              item={item}
                              groupLabel={group.label}
                              active={isItemActive(location.pathname, item, group.items)}
                              onOpenExternal={onOpenExternal}
                              onSelect={() => {
                                setOpenGroup(null);
                                onNavigate?.();
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                groups
                  .find((group) => group.label === openGroup)
                  ?.items?.map((item) => (
                    <MenuItemRow
                      key={item.to}
                      item={item}
                      groupLabel={openGroup}
                      active={isItemActive(location.pathname, item, groups.find((group) => group.label === openGroup)?.items)}
                      onOpenExternal={onOpenExternal}
                      onSelect={() => {
                        setOpenGroup(null);
                        onNavigate?.();
                      }}
                    />
                  ))
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
