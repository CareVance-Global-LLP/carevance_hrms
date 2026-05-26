import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useDesktopTracker } from '@/hooks/useDesktopTracker';
import { useDesktopUpdater } from '@/hooks/useDesktopUpdater';
import { CHAT_NOTIFICATION_TYPES, isChatNotification } from '@/lib/chatNotifications';
import { buildSearchSuggestions, rankSearchSuggestions } from '@/lib/searchSuggestions';
import type { SearchSuggestionOption } from '@/lib/searchSuggestions';
import { usePlan } from '@/hooks/usePlan';
import { hasAdminAccess, hasStrictAdminAccess, hasSuperAdminAccess, hasEmployeeOrManagerAccess } from '@/lib/permissions';
import { getNotificationDisplay, resolveNotificationRoute, isApprovalNotification } from '@/lib/notificationDisplay';
import { webAppUrl, payrollEnabled } from '@/lib/runtimeConfig';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { attendanceTimeEditApi, chatApi, leaveApi, notificationApi, userApi } from '@/services/api';
import type { AppNotificationItem } from '@/types';
import { formatNotificationTitle, formatNotificationMessage, getNotificationSoundType, playNotificationSound } from '@/lib/desktopNotifications';
import DashboardTopbar from '@/components/dashboard/DashboardTopbar';
import DesktopUpdatePanel from '@/components/desktop/DesktopUpdatePanel';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import StatusBadge from '@/components/ui/StatusBadge';
import BrandLogo from '@/components/branding/BrandLogo';
import { topNavigation } from '@/navigation/dashboardNavigation';
import { cn } from '@/utils/cn';
import {
  Bell,
  CalendarClock,
  Clock,
  LifeBuoy,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Search,
  Settings,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

const resolveEmployeeDepartment = (employee: any) =>
  String(
    employee?.department
    || employee?.employee_work_info?.department?.name
    || employee?.employeeWorkInfo?.department?.name
    || employee?.groups?.[0]?.name
    || 'Unassigned'
  ).trim() || 'Unassigned';

type GlobalSuggestion = SearchSuggestionOption<any> & {
  to: string;
  externalPath?: string;
  category: string;
};

export default function Layout() {
  const { user, organization, logout, token } = useAuth();
  useDesktopTracker();
  const { hasFeature } = usePlan();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotificationItem[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadChatMessages, setUnreadChatMessages] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchDirectoryUsers, setSearchDirectoryUsers] = useState<any[]>([]);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [updatePanelOpen, setUpdatePanelOpen] = useState(false);
  const [seenDesktopUpdateKey, setSeenDesktopUpdateKey] = useState<string | null>(null);
  const globalSearchRef = useRef<HTMLDivElement | null>(null);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const desktopNotificationByIdRef = useRef<Map<number, AppNotificationItem>>(new Map());
  const seenNotificationIdsRef = useRef<Set<number>>(new Set());
  const isInitialLoadRef = useRef(true);
  const isAdminView = hasAdminAccess(user);
  const isStrictAdminView = hasStrictAdminAccess(user);
  const isSuperAdminView = hasSuperAdminAccess(user);
  const isEmployeeOrManagerView = hasEmployeeOrManagerAccess(user);
  const canAccessAttendance = isAdminView || user?.settings?.attendance_monitoring !== false;
  const canAccessEditTime = isAdminView || user?.settings?.can_edit_time !== false;
  const isDesktopShell = Boolean(window.desktopTracker) && !isSuperAdminView;
  const webAppBaseUrl = webAppUrl.replace(/\/+$/, '');
  const organizationName = organization?.name || '';
  const organizationLogoUrl = resolveMediaUrl((organization?.settings as any)?.branding?.logo_url);
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
      if (isChatNotification(notification)) {
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

    if (notification.is_read) {
      return;
    }

    const formattedTitle = formatNotificationTitle(notification, user);
    const formattedMessage = formatNotificationMessage(notification);
    const soundType = getNotificationSoundType(notification);

    const notificationId = Number(notification.id);
    if (Number.isFinite(notificationId) && notificationId > 0) {
      desktopNotificationByIdRef.current.set(notificationId, notification);
    }

    if (window.desktopTracker?.showNotification) {
      void window.desktopTracker.showNotification({
        id: notificationId,
        title: formattedTitle,
        body: formattedMessage,
        route: resolveNotificationRoute(notification, user),
        type: notification.type,
      });
      playNotificationSound(soundType);
      return;
    }

    if (!('Notification' in window) || Notification.permission !== 'granted') {
      console.log('[Notify] Permission not granted:', Notification.permission);
      return;
    }

    console.log('[Notify] Showing:', notification.type, formattedTitle);
    const systemNotification = new Notification(formattedTitle, {
      body: formattedMessage,
      tag: `app-notification-${notification.id}`,
      icon: notification.type === 'announcement' ? '/carevance-logo-icon.png' : undefined,
    });

    systemNotification.onclick = () => {
      window.focus();
      void openNotification(notification);
      systemNotification.close();
    };

    playNotificationSound(soundType);
  };

  const primaryNavigation = useMemo(
    () => {
      const navigationGroups = isSuperAdminView
        ? topNavigation.filter((group) => group.superAdminOnly)
        : isDesktopShell
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
          if (group.payroll && !payrollEnabled) return false;
          if (group.planFeature && !hasFeature(group.planFeature)) return false;
          if (group.strictAdminOnly) return isStrictAdminView;
          if (group.superAdminOnly) return isSuperAdminView;
          if (group.adminOnly) return isAdminView;
          if (group.employeeAndManagerOnly) return isEmployeeOrManagerView;
          return true;
        })
        .map((group) => {
          let filteredItems = group.items?.filter((item) => {
            if (item.planFeature && !hasFeature(item.planFeature)) return false;
            if (item.to === '/attendance' && !canAccessAttendance) return false;
            if (item.to === '/edit-time' && !canAccessEditTime) return false;
            if (item.strictAdminOnly) return isStrictAdminView;
            if (item.superAdminOnly) return isSuperAdminView;
            if (item.adminOnly) return isAdminView;
            if (item.employeeAndManagerOnly) return isEmployeeOrManagerView;
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
              String(item.to || '').startsWith('/approval-inbox')
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
    [canAccessAttendance, canAccessEditTime, isAdminView, isDesktopShell, isStrictAdminView, isSuperAdminView, isEmployeeOrManagerView, pendingApprovals, unreadChatMessages, hasFeature]
  );

  const globalSuggestions = useMemo<GlobalSuggestion[]>(
    () => {
      const panelSuggestions: GlobalSuggestion[] = primaryNavigation.flatMap((group) => {
        if (group.to) {
          return [{
            id: `group:${group.label}:${group.to}`,
            label: group.label,
            description: group.externalPath || group.to,
            category: 'Module',
            to: group.to,
            externalPath: group.externalPath,
            searchValues: [group.label, group.externalPath || group.to, 'module panel navigation'],
          }];
        }

        return (group.items || []).flatMap((item) => {
          const baseSuggestion = {
            id: `item:${group.label}:${item.label}:${item.to}`,
            label: item.label,
            description: `${group.label} | ${item.to}`,
            category: 'Module',
            to: item.to,
            externalPath: item.externalPath,
            searchValues: [item.label, group.label, item.to, item.externalPath, 'module panel navigation'],
          };

          if (item.to === '/approval-inbox?section=leave&view=pending&leave_window=today') {
            return [
              baseSuggestion,
              {
                id: 'approval-inbox:leave',
                label: 'Leave Approval',
                description: 'Approval Inbox | pending leave requests',
                category: 'Module',
                to: '/approval-inbox?section=leave&view=pending&leave_window=today',
                searchValues: ['leave approval', 'approval inbox', 'leave request', 'pending leave'],
              },
              {
                id: 'approval-inbox:time-edit',
                label: 'Edit Time Approval',
                description: 'Approval Inbox | pending time edit requests',
                category: 'Module',
                to: '/approval-inbox?section=time-edit&view=pending',
                searchValues: ['edit time approval', 'approval inbox', 'time edit', 'overtime approval'],
              },
            ];
          }

          return [baseSuggestion];
        });
      });

      const employeeSuggestions: GlobalSuggestion[] = isAdminView
        ? buildSearchSuggestions(searchDirectoryUsers, (employee) => {
            const employeeId = Number(employee?.id || 0);
            if (!employeeId) {
              return null;
            }

            const department = resolveEmployeeDepartment(employee);

            return {
              id: `employee:${employeeId}`,
              label: String(employee?.name || employee?.email || 'Employee'),
              description: [employee?.email, department].filter(Boolean).join(' | '),
              category: 'Employee',
              to: `/employees/${employeeId}`,
              searchValues: [employee?.name, employee?.email, department, employee?.role, 'employee people person'],
            };
          }) as GlobalSuggestion[]
        : [];

      const departmentSuggestions: GlobalSuggestion[] = isAdminView
        ? buildSearchSuggestions(
            Array.from(new Set(searchDirectoryUsers.map((employee) => resolveEmployeeDepartment(employee)).filter(Boolean))),
            (department) => ({
              id: `department:${department}`,
              label: String(department),
              description: 'Department directory',
              category: 'Department',
              to: `/employees?department=${encodeURIComponent(String(department))}`,
              searchValues: [department, 'department team employee group'],
            })
          ) as GlobalSuggestion[]
        : [];

      return [...panelSuggestions, ...employeeSuggestions, ...departmentSuggestions];
    },
    [isAdminView, primaryNavigation, searchDirectoryUsers]
  );

  const filteredGlobalSuggestions = useMemo(() => {
    const query = globalSearch.trim().toLowerCase();
    if (!query) {
      return [] as GlobalSuggestion[];
    }

    return rankSearchSuggestions<any>(globalSuggestions, query, 10) as GlobalSuggestion[];
  }, [globalSearch, globalSuggestions]);

  const openGlobalSuggestion = (suggestion?: GlobalSuggestion) => {
    if (!suggestion) {
      return;
    }

    if (suggestion.externalPath) {
      openWebDashboard(suggestion.externalPath);
    } else {
      navigate(suggestion.to);
    }

    setGlobalSearch(suggestion.label);
    setIsGlobalSearchOpen(false);
    setMobileNavigationOpen(false);
    setNotificationsOpen(false);
    setProfileOpen(false);
  };

  const hasGlobalSearchQuery = globalSearch.trim().length > 0;

  const globalPanelHeader = (
    <div className="relative z-[60] flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-start lg:gap-5 xl:gap-6">
      {organizationName ? (
        <div className="inline-flex w-full min-w-0 max-w-[12rem] flex-col items-center lg:shrink-0">
          {organizationLogoUrl ? (
            <span className="mb-1.5 flex h-16 w-full shrink-0 items-center justify-center overflow-hidden">
              <img src={organizationLogoUrl} alt={`${organizationName} logo`} className="h-full w-full object-contain" />
            </span>
          ) : (
            <div className="mb-1.5 flex h-16 w-full items-center justify-center rounded-md bg-slate-100 text-base font-semibold text-slate-600">
              {organizationName.charAt(0).toUpperCase()}
            </div>
          )}
          <p
            title={organizationName}
            className="w-full truncate px-1 text-center text-xs font-medium leading-tight text-slate-700"
          >
            {organizationName}
          </p>
        </div>
      ) : null}

      <div ref={globalSearchRef} className="relative z-[70] min-w-0 w-full lg:mx-auto lg:w-[32rem] lg:max-w-[32rem] xl:w-[36rem] xl:max-w-[36rem]">
        <label className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-400 shadow-sm">
          <Search className="h-3.5 w-3.5 shrink-0 text-blue-600" />
          <input
            aria-label="Universal search"
            value={globalSearch}
            onFocus={() => setIsGlobalSearchOpen(hasGlobalSearchQuery)}
            onChange={(event) => {
              const nextValue = event.target.value;
              setGlobalSearch(nextValue);
              setIsGlobalSearchOpen(nextValue.trim().length > 0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                openGlobalSuggestion(filteredGlobalSuggestions[0]);
              }
              if (event.key === 'Escape') {
                setIsGlobalSearchOpen(false);
              }
            }}
            className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-slate-400"
            placeholder="Search panels, employees, reports, settings, attendance..."
          />
          <span className="hidden rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 sm:inline">Enter</span>
        </label>

        {isGlobalSearchOpen ? (
          <div className="absolute left-0 right-0 top-12 z-[80] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            {filteredGlobalSuggestions.length ? (
              <div className="max-h-80 overflow-y-auto p-2">
                {filteredGlobalSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openGlobalSuggestion(suggestion)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-blue-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">{suggestion.label}</span>
                      <span className="block truncate text-xs text-slate-500">{suggestion.description}</span>
                    </span>
                    <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">{suggestion.category}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 text-sm text-slate-500">No matching panel found.</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );

  const handleLogout = async () => {
    await logout();
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

      if (isGlobalSearchOpen && globalSearchRef.current && !globalSearchRef.current.contains(target)) {
        setIsGlobalSearchOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);

    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [isGlobalSearchOpen, notificationsOpen, profileOpen]);

  useEffect(() => {
    setIsGlobalSearchOpen(false);
  }, [location.pathname, location.search]);

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

        const [notificationResponse, chatUnreadResponse, approvalResponses] = await Promise.all([
          notificationApi.list({ limit: 20, unread_only: true }),
          chatApi.getUnreadSummary(),
          approvalPromise,
        ]);

        if (!active) return;

        const allItems = (notificationResponse.data?.data || []) as AppNotificationItem[];
        const nextNonChat = allItems.filter((item) => !isChatNotification(item));
        const nextChat = allItems.filter((item) => isChatNotification(item));

        setNotifications(nextNonChat);
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

        if (isInitialLoadRef.current) {
          allItems.forEach((item) => seenNotificationIdsRef.current.add(Number(item.id)));
          isInitialLoadRef.current = false;
          return;
        }

        const newNonChat = nextNonChat.filter((item) => {
          const id = Number(item.id);
          return !item.is_read && !seenNotificationIdsRef.current.has(id);
        });
        const newChat = nextChat.filter((item) => {
          const id = Number(item.id);
          return !item.is_read && !seenNotificationIdsRef.current.has(id);
        });

        if (newNonChat.length > 0 || newChat.length > 0) {
          console.log('[Notify] New notifications:', { nonChat: newNonChat.length, chat: newChat.length });
        }

        newNonChat.forEach((item) => showDesktopNotification(item));
        newChat.forEach((item) => showDesktopNotification(item));

        allItems.forEach((item) => seenNotificationIdsRef.current.add(Number(item.id)));
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
    let active = true;

    const loadSearchDirectory = async () => {
      if (!isAdminView) {
        setSearchDirectoryUsers([]);
        return;
      }

      try {
        const response = await userApi.getAll({ period: 'all' });
        if (!active) return;
        setSearchDirectoryUsers(Array.isArray(response.data) ? response.data : []);
      } catch {
        if (active) {
          setSearchDirectoryUsers([]);
        }
      }
    };

    void loadSearchDirectory();

    return () => {
      active = false;
    };
  }, [isAdminView]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window) || !desktopPushEnabled) {
      return;
    }

    if (Notification.permission === 'default') {
      console.log('Requesting notification permission (current state):', Notification.permission);
        void Notification.requestPermission();
    }
  }, [desktopPushEnabled]);

  useEffect(() => {
    if (!notificationsOpen || unreadNotifications <= 0) {
      return;
    }

    let active = true;

    setUnreadNotifications(0);
    setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));

    notificationApi.markAllRead().catch(() => {
      if (active) {
        setUnreadNotifications(notifications.filter((item) => !item.is_read).length);
        setNotifications(notifications);
      }
    });

    return () => {
      active = false;
    };
  }, [notificationsOpen, unreadNotifications, notifications]);

  const isRouteActive = (to?: string) => {
    if (!to) return false;
    const normalizedTo = String(to).split('?')[0] || to;
    if (normalizedTo === '/settings') return location.pathname === normalizedTo;
    if (normalizedTo === '/reports' || normalizedTo === '/analytics') return location.pathname === normalizedTo;
    return location.pathname === normalizedTo || (normalizedTo !== '/dashboard' && location.pathname.startsWith(`${normalizedTo}/`));
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
          <span className={`ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? 'bg-white/20 text-white' : 'bg-rose-600 text-white'}`}>
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

          <nav className="flex-1 overflow-y-auto px-3 py-4">
            {primaryNavigation.map((group) => {
              const activeItemTo = getBestMatchedItemTo(group.items);
              const groupActive = isRouteActive(group.to) || Boolean(activeItemTo);

              if (group.to) {
                return (
                  <div key={group.label} className="mb-3">
                    {renderSidebarLink(group)}
                  </div>
                );
              }

              return (
                <div key={group.label} className="mb-5 space-y-1">
                  <p className={`px-3 text-[10px] font-semibold uppercase tracking-[0.18em] ${groupActive ? 'text-blue-600' : 'text-slate-400'}`}>
                    {group.label}
                  </p>
                  <div className="space-y-1">
                    {group.items?.map((item) => renderSidebarLink(
                      String(item.to || '').startsWith('/approval-inbox')
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
        </aside>

        <main className="min-w-0 px-4 py-4 lg:pr-5 lg:py-4 xl:pr-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-3 shrink-0">
              <BrandLogo variant="full" size="sm" className="max-w-[9.75rem]" />
            </div>

            <div ref={globalSearchRef} className="relative flex-1 min-w-0 max-w-[36rem]">
              <label className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-400 shadow-sm">
                <Search className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                <input
                  aria-label="Universal search"
                  value={globalSearch}
                  onFocus={() => setIsGlobalSearchOpen(hasGlobalSearchQuery)}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setGlobalSearch(nextValue);
                    setIsGlobalSearchOpen(nextValue.trim().length > 0);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      openGlobalSuggestion(filteredGlobalSuggestions[0]);
                    }
                    if (event.key === 'Escape') {
                      setIsGlobalSearchOpen(false);
                    }
                  }}
                  className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-slate-400"
                  placeholder="Search panels, employees, reports, settings, attendance..."
                />
                <kbd className="hidden shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 sm:inline-flex">Enter</kbd>
              </label>

              {isGlobalSearchOpen && (
                <div className="absolute left-0 right-0 top-12 z-[80] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                  {filteredGlobalSuggestions.length ? (
                    <div className="max-h-80 overflow-y-auto p-2">
                      {filteredGlobalSuggestions.map((suggestion) => (
                        <button
                          key={suggestion.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => openGlobalSuggestion(suggestion)}
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-blue-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-900">{suggestion.label}</span>
                            <span className="block truncate text-xs text-slate-500">{suggestion.description}</span>
                          </span>
                          <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">{suggestion.category}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-sm text-slate-500">No matching panel found.</div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
              <div ref={notificationsRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setNotificationsOpen((prev) => !prev);
                    setProfileOpen(false);
                  }}
                  aria-haspopup="menu"
                  aria-expanded={notificationsOpen}
                  aria-label="Notifications"
                  className={cn(
                    'relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-white/80',
                    notificationsOpen
                      ? 'border-sky-200 bg-sky-50 text-sky-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:bg-white'
                  )}
                >
                  <Bell className="h-5 w-5" />
                  {unreadNotifications > 0 ? (
                    <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {unreadNotifications > 99 ? '99+' : unreadNotifications}
                    </span>
                  ) : null}
                </button>

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
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.length ? (
                        notifications.slice(0, 10).map((n) => {
                          const notificationDisplay = getNotificationDisplay(n.type);
                          return (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => {
                                void openNotification(n);
                              }}
                              className="w-full border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50 last:border-b-0"
                            >
                              <div className="flex items-start gap-3">
                                <div className="mt-0.5">
                                  {(() => {
                                    if (isChatNotification(n)) {
                                      return <MessageSquare className="h-4 w-4 text-sky-600" />;
                                    }
                                    return notificationDisplay.icon;
                                  })()}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold contrast-text-primary">{n.title}</p>
                                    {!n.is_read ? <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" /> : null}
                                  </div>
                                  <p className="mt-0.5 text-xs leading-5 contrast-text-secondary">{n.message}</p>
                                  <div className="mt-1 flex items-center gap-2">
                                    {(() => {
                                      if (isChatNotification(n)) {
                                        return <StatusBadge tone="info" className="gap-1 tracking-[0.14em]">Chat</StatusBadge>;
                                      }
                                      return (
                                        <StatusBadge tone={notificationDisplay.tone} className="gap-1 tracking-[0.14em]">
                                          {notificationDisplay.label}
                                        </StatusBadge>
                                      );
                                    })()}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-4 py-8 text-center text-sm text-slate-500">No notifications yet.</div>
                      )}
                    </div>
                  </AdaptiveSurface>
                )}
              </div>

              <div className="relative" ref={profileRef}>
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen((prev) => !prev);
                    setNotificationsOpen(false);
                  }}
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                  aria-label={`${user?.name || 'Account'}`}
                  className={cn(
                    'relative flex h-11 shrink-0 items-center rounded-lg border shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-white/80',
                    profileOpen
                      ? 'border-sky-200 bg-sky-50 text-sky-900'
                      : 'border-slate-200 bg-white hover:bg-white',
                    'gap-2 px-2 sm:gap-3 sm:px-3'
                  )}
                >
                  {user?.avatar ? (
                    <img src={resolveMediaUrl(user.avatar)} alt={user.name || 'Profile'} className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#0f172a,#0284c7)] text-xs font-semibold text-white">
                      {user?.name?.charAt(0).toUpperCase() || 'A'}
                    </div>
                  )}
                  <div className="min-w-0 text-left">
                    <p className="max-w-[7rem] truncate text-sm font-semibold text-slate-900 sm:max-w-[9rem]">{user?.name || 'Admin'}</p>
                    <p className="hidden text-xs capitalize text-slate-500 sm:block">{user?.role || 'user'}</p>
                  </div>
                </button>

                {profileOpen && (
                  <AdaptiveSurface
                    className="fixed right-4 top-4 z-50 w-64 overflow-hidden rounded-[24px] border border-white/80 bg-white/95 p-2 shadow-[0_32px_90px_-48px_rgba(15,23,42,0.55)] backdrop-blur-2xl"
                    tone="light"
                    backgroundColor="rgba(255,255,255,0.95)"
                  >
                    <div className="border-b border-slate-100 px-3 py-3">
                      <p className="text-sm font-semibold text-slate-900">{user?.name || 'Admin'}</p>
                      <p className="text-xs capitalize text-slate-500">{user?.role || 'user'}</p>
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
                      <Link
                        to="/settings?tab=help"
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
                      >
                        <LifeBuoy className="h-4 w-4 text-slate-400" />
                        Help
                      </Link>
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
            </div>
          </div>

          <div className="space-y-5">
            <Outlet />
          </div>
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
          organizationName={organizationName}
          organizationLogoUrl={organizationLogoUrl}
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
                  className="fixed right-4 top-4 z-50 w-64 overflow-hidden rounded-[24px] border border-white/80 bg-white/95 p-2 shadow-[0_32px_90px_-48px_rgba(15,23,42,0.55)] backdrop-blur-2xl"
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
                    <Link
                      to="/settings?tab=help"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
                    >
                      <LifeBuoy className="h-4 w-4 text-slate-400" />
                      Help
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
