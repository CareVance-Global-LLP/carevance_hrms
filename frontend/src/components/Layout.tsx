import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useDesktopTracker } from '@/hooks/useDesktopTracker';
import { useDesktopUpdater } from '@/hooks/useDesktopUpdater';
import { hasAdminAccess, hasStrictAdminAccess } from '@/lib/permissions';
import { getNotificationDisplay, resolveNotificationRoute } from '@/lib/notificationDisplay';
import { webAppUrl } from '@/lib/runtimeConfig';
import { attendanceTimeEditApi, chatApi, leaveApi, notificationApi } from '@/services/api';
import type { AppNotificationItem } from '@/types';
import DashboardTopbar from '@/components/dashboard/DashboardTopbar';
import DesktopUpdatePanel from '@/components/desktop/DesktopUpdatePanel';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import StatusBadge from '@/components/ui/StatusBadge';
import BrandLogo from '@/components/branding/BrandLogo';
import { topNavigation } from '@/navigation/dashboardNavigation';
import {
  CalendarClock,
  Clock,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Settings,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

const CHAT_NOTIFICATION_TYPES = ['chat_direct_message', 'chat_group_message'];

const isChatNotificationType = (type: string | null | undefined) =>
  CHAT_NOTIFICATION_TYPES.includes(String(type || '').trim());

export default function Layout() {
  const { user, logout, token } = useAuth();
  useDesktopTracker();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotificationItem[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadChatMessages, setUnreadChatMessages] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [updatePanelOpen, setUpdatePanelOpen] = useState(false);
  const [seenDesktopUpdateKey, setSeenDesktopUpdateKey] = useState<string | null>(null);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const seenNotificationIdsRef = useRef<Set<number>>(new Set());
  const desktopNotificationByIdRef = useRef<Map<number, AppNotificationItem>>(new Map());
  const hasLoadedNotificationsRef = useRef(false);
  const isAdminView = hasAdminAccess(user);
  const isStrictAdminView = hasStrictAdminAccess(user);
  const canAccessAttendance = isAdminView || user?.settings?.attendance_monitoring !== false;
  const canAccessEditTime = isAdminView || user?.settings?.can_edit_time !== false;
  const isDesktopShell = Boolean(window.desktopTracker);
  const webAppBaseUrl = webAppUrl.replace(/\/+$/, '');
  const notificationSettings = (user?.settings?.notifications || {}) as Record<string, boolean | undefined>;
  const desktopPushEnabled = notificationSettings.desktop_push ?? true;
  const { state: desktopUpdateState } = useDesktopUpdater();
  const desktopUpdateKey = useMemo(() => {
    const updateVersion = desktopUpdateState.downloadedVersion || desktopUpdateState.availableVersion;
    if (!updateVersion || !['available', 'downloading', 'downloaded'].includes(desktopUpdateState.status)) {
      return '';
    }

    return [updateVersion, desktopUpdateState.releaseDate || 'no-date'].join(':');
  }, [desktopUpdateState.availableVersion, desktopUpdateState.downloadedVersion, desktopUpdateState.releaseDate, desktopUpdateState.status]);
  const desktopUpdateSeenStorageKey = useMemo(
    () => (user?.id ? `carevance.desktopUpdate.seen.${user.id}` : ''),
    [user?.id]
  );
  const hasUnreadDesktopUpdate = Boolean(isDesktopShell && desktopUpdateKey && seenDesktopUpdateKey !== desktopUpdateKey);

  const openWebDashboard = (path: string) => {
    const target = path.startsWith('/') ? path : `/${path}`;
    const nextUrl = new URL(`${webAppBaseUrl}${target}`);
    if (token) {
      nextUrl.searchParams.set('desktop_token', token);
    }
    window.open(nextUrl.toString(), '_blank', 'noopener,noreferrer');
  };

  const openNotification = async (notification: AppNotificationItem) => {
    if (!notification.is_read) {
      try {
        await notificationApi.markRead(notification.id);
      } catch {
        // Keep navigation working even if mark-read fails.
      }

      setNotifications((prev) => prev.map((item) => item.id === notification.id ? { ...item, is_read: true } : item));
      if (isChatNotificationType(notification.type)) {
        setUnreadChatMessages((prev) => Math.max(0, prev - 1));
      } else {
        setUnreadNotifications((prev) => Math.max(0, prev - 1));
      }
    }

    setNotificationsOpen(false);
    setProfileOpen(false);
    setMobileNavigationOpen(false);
    navigate(resolveNotificationRoute(notification, user));
  };

  const showDesktopNotification = (notification: AppNotificationItem) => {
    if (!desktopPushEnabled || typeof window === 'undefined') {
      return;
    }

    const notificationId = Number(notification.id);
    if (Number.isFinite(notificationId) && notificationId > 0) {
      desktopNotificationByIdRef.current.set(notificationId, notification);
    }

    if (window.desktopTracker?.showNotification) {
      void window.desktopTracker.showNotification({
        id: notificationId,
        title: notification.title,
        body: notification.message,
        route: resolveNotificationRoute(notification, user),
        type: notification.type,
      });
      return;
    }

    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    const systemNotification = new Notification(notification.title, {
      body: notification.message,
      tag: `app-notification-${notification.id}`,
    });

    systemNotification.onclick = () => {
      window.focus();
      void openNotification(notification);
      systemNotification.close();
    };
  };

  const primaryNavigation = useMemo(
    () => {
      const navigationGroups = isDesktopShell
        ? [
            {
              label: 'Timer',
              to: '/dashboard',
              icon: Clock,
            },
            {
              label: 'Attendance',
              icon: CalendarClock,
              items: [
                { label: 'Attendance Overview', to: '/attendance', icon: CalendarClock },
                { label: 'Edit Time', to: '/edit-time', icon: CalendarClock },
              ],
            },
            {
              label: 'Home',
              to: '/desktop-web-dashboard',
              externalPath: '/dashboard',
              external: true,
              icon: LayoutDashboard,
            },
            {
              label: 'Payroll',
              to: '/desktop-web-payroll',
              externalPath: '/payroll',
              external: true,
              icon: Wallet,
              adminOnly: true,
            },
            {
              label: 'Chat',
              to: '/chat',
              icon: MessageSquare,
            },
          ]
        : topNavigation;

      return navigationGroups
        .filter((group) => {
          if (group.strictAdminOnly) return isStrictAdminView;
          if (group.adminOnly) return isAdminView;
          return true;
        })
        .map((group) => {
          let filteredItems = group.items?.filter((item) => {
            if (item.to === '/attendance' && !canAccessAttendance) return false;
            if (item.to === '/edit-time' && !canAccessEditTime) return false;
            if (item.strictAdminOnly) return isStrictAdminView;
            if (item.adminOnly) return isAdminView;
            return true;
          });

          filteredItems = filteredItems?.map((item) =>
            item.to === '/chat'
              ? { ...item, unreadCount: unreadChatMessages }
              : item
          );

          if (group.label === 'Attendance' && filteredItems?.length === 1) {
            const singleItem = filteredItems[0];

            return {
              ...group,
              label: singleItem.to === '/attendance' ? 'Attendance' : singleItem.label,
              to: singleItem.to,
              icon: singleItem.icon,
              unreadCount: singleItem.unreadCount,
              external: singleItem.external,
              externalPath: singleItem.externalPath,
              items: undefined,
            };
          }

          if (group.label === 'Chat') {
            return {
              ...group,
              unreadCount: unreadChatMessages,
              items: filteredItems,
            };
          }

          if (group.label === 'Settings') {
            const itemsWithCounts = filteredItems?.map((item) =>
              item.to === '/approval-inbox'
                ? { ...item, unreadCount: pendingApprovals }
                : item
            );

            return {
              ...group,
              items: itemsWithCounts,
            };
          }

          return {
            ...group,
            items: filteredItems,
          };
        })
        .filter((group) => group.to || (group.items?.length || 0) > 0);
    },
    [canAccessAttendance, canAccessEditTime, isAdminView, isDesktopShell, isStrictAdminView, pendingApprovals, unreadChatMessages]
  );

  const handleLogout = async () => {
    await logout();
  };

  const handleOpenAddUser = () => {
    navigate('/add-user');
  };

  const markDesktopUpdateSeen = () => {
    if (!desktopUpdateKey) {
      return;
    }

    setSeenDesktopUpdateKey(desktopUpdateKey);
    if (desktopUpdateSeenStorageKey) {
      window.localStorage.setItem(desktopUpdateSeenStorageKey, desktopUpdateKey);
    }
  };

  useEffect(() => {
    if (!desktopUpdateSeenStorageKey) {
      setSeenDesktopUpdateKey(null);
      return;
    }

    setSeenDesktopUpdateKey(window.localStorage.getItem(desktopUpdateSeenStorageKey));
  }, [desktopUpdateSeenStorageKey]);

  useEffect(() => {
    if (!window.desktopTracker?.onNotificationClicked) {
      return;
    }

    const unsubscribe = window.desktopTracker.onNotificationClicked((payload) => {
      const notificationId = Number(payload?.id || 0);
      const notification = desktopNotificationByIdRef.current.get(notificationId);
      if (notification) {
        void openNotification(notification);
        return;
      }

      const route = String(payload?.route || '').trim();
      if (route) {
        setNotificationsOpen(false);
        setProfileOpen(false);
        setMobileNavigationOpen(false);
        navigate(route);
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigate]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (notificationsOpen && notificationsRef.current && !notificationsRef.current.contains(target)) {
        setNotificationsOpen(false);
      }

      if (profileOpen && profileRef.current && !profileRef.current.contains(target)) {
        setProfileOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);

    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [notificationsOpen, profileOpen]);

  useEffect(() => {
    let active = true;

    const loadAlerts = async () => {
      try {
        const approvalPromise = isAdminView
          ? Promise.all([
              leaveApi.list({ status: 'pending' }),
              attendanceTimeEditApi.list({ status: 'pending' }),
            ])
          : Promise.resolve(null);

        const [notificationResponse, desktopNotificationResponse, chatUnreadResponse, approvalResponses] = await Promise.all([
          notificationApi.list({ limit: 20, exclude_types: CHAT_NOTIFICATION_TYPES }),
          notificationApi.list({ limit: 20 }),
          chatApi.getUnreadSummary(),
          approvalPromise,
        ]);

        if (!active) return;
        const nextNotifications = (notificationResponse.data?.data || []) as AppNotificationItem[];
        const nextDesktopNotifications = (desktopNotificationResponse.data?.data || []) as AppNotificationItem[];
        setNotifications(nextNotifications);
        setUnreadNotifications(Number(notificationResponse.data?.unread_count || 0));
        setUnreadChatMessages(Number(chatUnreadResponse.data?.unread_messages || 0));
        if (approvalResponses) {
          const [leaveResponse, timeEditResponse] = approvalResponses;
          const leaveCount = Number(leaveResponse.data?.data?.length || 0);
          const timeEditCount = Number(timeEditResponse.data?.data?.length || 0);
          setPendingApprovals(leaveCount + timeEditCount);
        } else {
          setPendingApprovals(0);
        }

        const nextIds = new Set<number>(nextDesktopNotifications.map((item) => Number(item.id)).filter((id) => id > 0));
        if (!hasLoadedNotificationsRef.current) {
          seenNotificationIdsRef.current = nextIds;
          hasLoadedNotificationsRef.current = true;
        } else {
          nextDesktopNotifications
            .filter((item) => !item.is_read)
            .filter((item) => !seenNotificationIdsRef.current.has(Number(item.id)))
            .forEach((item) => showDesktopNotification(item));
          seenNotificationIdsRef.current = nextIds;
        }
      } catch {
        if (active) {
          setNotifications([]);
          setUnreadNotifications(0);
          setUnreadChatMessages(0);
          setPendingApprovals(0);
        }
      }
    };

    loadAlerts();
    const interval = setInterval(loadAlerts, 8000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isAdminView]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window) || !desktopPushEnabled) {
      return;
    }

    if (Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, [desktopPushEnabled]);

  const isRouteActive = (to?: string) => {
    if (!to) return false;
    if (to === '/settings') return location.pathname === to;
    if (to === '/reports' || to === '/analytics') return location.pathname === to;
    return location.pathname === to || (to !== '/dashboard' && location.pathname.startsWith(`${to}/`));
  };

  const getBestMatchedItemTo = (items: any[] = []) =>
    items
      .filter((item) => isRouteActive(item.to))
      .sort((left, right) => String(right.to || '').length - String(left.to || '').length)[0]?.to;

  const renderSidebarLink = (item: any, nested = false, activeOverride?: boolean) => {
    const Icon = item.icon;
    const active = activeOverride ?? isRouteActive(item.to);

    return (
      <Link
        key={`${item.label}-${item.to}`}
        to={item.to}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition ${
          active
            ? 'bg-blue-600 text-white shadow-sm'
            : nested
              ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
              : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
        }`}
      >
        <Icon className={`h-4 w-4 ${active ? 'text-white' : 'text-slate-500'}`} />
        <span className="truncate">{item.label}</span>
        {item.unreadCount ? (
          <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-blue-50 text-blue-700'}`}>
            {item.unreadCount > 99 ? '99+' : item.unreadCount}
          </span>
        ) : null}
      </Link>
    );
  };

  if (!isDesktopShell) {
    return (
      <div className="min-h-screen bg-[#f5f7fb] lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="hidden h-screen border-r border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:flex-col">
          <div className="flex h-16 items-center border-b border-slate-100 px-5">
            <BrandLogo variant="full" size="sm" className="max-w-[9.75rem]" />
          </div>

          <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
            {primaryNavigation.map((group) => {
              const activeItemTo = getBestMatchedItemTo(group.items);
              const groupActive = isRouteActive(group.to) || Boolean(activeItemTo);

              if (group.to) {
                return (
                  <div key={group.label}>
                    {renderSidebarLink(group)}
                  </div>
                );
              }

              return (
                <div key={group.label} className="space-y-1">
                  <p className={`px-3 text-[10px] font-semibold uppercase tracking-[0.18em] ${groupActive ? 'text-blue-600' : 'text-slate-400'}`}>
                    {group.label}
                  </p>
                  <div className="space-y-1">
                    {group.items?.map((item) => renderSidebarLink(
                      item.to === '/approval-inbox'
                        ? { ...item, unreadCount: pendingApprovals }
                        : item,
                      true,
                      activeItemTo === item.to
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="border-t border-slate-100 p-3">
            <button
              type="button"
              onClick={() => setProfileOpen((prev) => !prev)}
              className="flex w-full items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-left"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                {user?.name?.charAt(0).toUpperCase() || 'A'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{user?.name || 'Jane Cooper'}</p>
                <p className="truncate text-xs capitalize text-slate-500">{user?.role || 'HR Manager'}</p>
              </div>
              <MoreHorizontal className="h-4 w-4 text-slate-400" />
            </button>

            {profileOpen ? (
              <div className="mt-2 rounded-lg border border-slate-100 bg-white p-1 shadow-sm">
                <Link to="/settings" onClick={() => setProfileOpen(false)} className="block rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  Settings
                </Link>
                <button type="button" onClick={handleLogout} className="block w-full rounded-md px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50">
                  Sign Out
                </button>
              </div>
            ) : null}
          </div>
        </aside>

        <main className="min-w-0 px-4 py-4 lg:px-5 lg:py-4 xl:px-6">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#eef5ff_45%,#f8fafc_100%)]">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[320px] bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.2),transparent_60%)]" />
      <div className="relative">
        <DashboardTopbar
          user={user}
          groups={primaryNavigation}
          unreadNotifications={unreadNotifications}
          notificationsOpen={notificationsOpen}
          profileOpen={profileOpen}
          mobileNavigationOpen={mobileNavigationOpen}
          onToggleMobileNavigation={() => {
            setMobileNavigationOpen((prev) => !prev);
            setNotificationsOpen(false);
            setProfileOpen(false);
            setUpdatePanelOpen(false);
          }}
          onToggleNotifications={() => {
            setNotificationsOpen((prev) => !prev);
            setProfileOpen(false);
            setMobileNavigationOpen(false);
          }}
          onToggleProfile={() => {
            setProfileOpen((prev) => !prev);
            setNotificationsOpen(false);
            setMobileNavigationOpen(false);
          }}
          onCloseMobileNavigation={() => setMobileNavigationOpen(false)}
          onOpenExternal={openWebDashboard}
          onOpenAddUser={handleOpenAddUser}
          showAddUserButton={isStrictAdminView && !isDesktopShell}
          profileHasUnreadUpdate={hasUnreadDesktopUpdate}
          notificationPanel={
            <div ref={notificationsRef}>
            {notificationsOpen && (
              <AdaptiveSurface
                className="absolute right-0 top-full z-50 mt-3 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[24px] border border-white/80 bg-white/95 shadow-[0_32px_90px_-48px_rgba(15,23,42,0.55)] backdrop-blur-2xl"
                tone="light"
                backgroundColor="rgba(255,255,255,0.95)"
              >
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <p className="text-sm font-semibold contrast-text-primary">Notifications</p>
                  <div className="flex items-center gap-3">
                    <Link
                      to="/notifications"
                      onClick={() => setNotificationsOpen(false)}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                    >
                      View all
                    </Link>
                    <button
                      className="text-xs font-semibold text-sky-700 hover:underline"
                      onClick={async () => {
                        await notificationApi.markAllRead({ exclude_types: CHAT_NOTIFICATION_TYPES });
                        setUnreadNotifications(0);
                        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
                      }}
                    >
                      Mark all read
                    </button>
                  </div>
                </div>
                <div className="max-h-80 overflow-auto">
                  {notifications.length === 0 ? (
                    <p className="p-4 text-sm contrast-text-muted">No notifications</p>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => {
                          void openNotification(n);
                        }}
                        className={`w-full border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50/80 ${n.is_read ? '' : 'bg-sky-50/70'}`}
                      >
                        {(() => {
                          const notificationDisplay = getNotificationDisplay(String(n.type || ''));

                          return (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500">{notificationDisplay.icon}</span>
                              <StatusBadge tone={notificationDisplay.tone} className="gap-1 tracking-[0.14em]">
                                {notificationDisplay.label}
                              </StatusBadge>
                            </div>
                          );
                        })()}
                        <p className="mt-1 text-sm font-semibold contrast-text-primary">{n.title}</p>
                        <p className="mt-1 text-xs leading-6 contrast-text-secondary">{n.message}</p>
                      </button>
                    ))
                  )}
                </div>
              </AdaptiveSurface>
            )}
            </div>
          }
          profilePanel={
            <div ref={profileRef}>
              {profileOpen && (
                <AdaptiveSurface
                  className="absolute right-0 top-full z-50 mt-3 w-64 overflow-hidden rounded-[24px] border border-white/80 bg-white/95 p-2 shadow-[0_32px_90px_-48px_rgba(15,23,42,0.55)] backdrop-blur-2xl"
                  tone="light"
                  backgroundColor="rgba(255,255,255,0.95)"
                >
                  <div className="border-b border-slate-100 px-3 py-3">
                    <p className="text-sm font-semibold contrast-text-primary">{user?.name || 'Admin'}</p>
                    <p className="text-xs capitalize contrast-text-muted">{user?.role || 'user'}</p>
                  </div>
                  <div className="space-y-1 p-2">
                    <Link
                      to="/settings"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
                    >
                      <Settings className="h-4 w-4 text-slate-400" />
                      Settings
                    </Link>
                    {isDesktopShell ? (
                      <button
                        type="button"
                        onClick={() => {
                          setProfileOpen(false);
                          markDesktopUpdateSeen();
                          setUpdatePanelOpen(true);
                        }}
                        className="relative flex w-full items-center gap-3 rounded-[18px] px-3 py-2.5 text-left text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
                      >
                        <Sparkles className="h-4 w-4 text-slate-400" />
                        Updates
                        {hasUnreadDesktopUpdate ? (
                          <span className="ml-auto h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-500" />
                        ) : null}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={async () => {
                        setProfileOpen(false);
                        await handleLogout();
                      }}
                      className="flex w-full items-center gap-3 rounded-[18px] px-3 py-2.5 text-left text-sm font-medium text-rose-600 transition hover:bg-rose-50"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </button>
                  </div>
                </AdaptiveSurface>
              )}
            </div>
          }
        />

        <main className="px-4 py-6 sm:px-6 sm:py-8 lg:px-10 xl:px-12 animate-fade-in">
          <Outlet />
        </main>

        {isDesktopShell && updatePanelOpen ? (
          <div className="fixed inset-0 z-40 flex items-start justify-center bg-slate-950/28 px-4 py-20 backdrop-blur-sm sm:px-6">
            <div className="relative w-full max-w-4xl">
              <button
                type="button"
                onClick={() => setUpdatePanelOpen(false)}
                aria-label="Close updates dialog"
                className="absolute -top-14 right-0 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/35 bg-slate-950/65 text-white shadow-lg transition hover:bg-slate-950/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/80"
              >
                <X className="h-5 w-5" />
              </button>
              <DesktopUpdatePanel />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
