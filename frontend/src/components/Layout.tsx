import { reportSilentError } from '@/lib/reportSilentError';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import WorkspaceRenewalBanner from '@/features/billing/WorkspaceRenewalBanner';
import { resolveTrackerPolicy } from '@/lib/trackerPolicy';
import { useDesktopTracker } from '@/hooks/useDesktopTracker';
import { useDesktopUpdater } from '@/hooks/useDesktopUpdater';
import { CHAT_NOTIFICATION_TYPES, isChatNotification } from '@/lib/chatNotifications';
import { usePlan } from '@/hooks/usePlan';
import { hasAdminAccess, hasPayrollAdminAccess, hasStrictAdminAccess, hasSuperAdminAccess, hasEmployeeOrManagerAccess, isEmployeeUser, resolveUserRoleLabel, canAccess } from '@/lib/permissions';
import { getNotificationDisplay, resolveNotificationRoute, isApprovalNotification } from '@/lib/notificationDisplay';
import { webAppUrl, payrollEnabled } from '@/lib/runtimeConfig';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { attendanceTimeEditApi, chatApi, leaveApi, notificationApi, payrollApi } from '@/services/api';
import type { AppNotificationItem } from '@/types';
import { formatNotificationTitle, formatNotificationMessage, getNotificationSoundType, playNotificationSound, shouldShowDesktopNotification } from '@/lib/desktopNotifications';
import { connectRealtime, disconnectRealtime, type RealtimeStatus } from '@/lib/realtime';
import { clearAuthStorage } from '@/lib/authStorage';
import { resolveNotificationThumbnail } from '@/lib/notificationThumbnail';
import { useQuickReply } from '@/hooks/useQuickReply';
import DashboardTopbar from '@/components/dashboard/DashboardTopbar';
import DesktopUpdatePanel from '@/components/desktop/DesktopUpdatePanel';
import IdleReturnPrompt from '@/components/desktop/IdleReturnPrompt';
import IdleStopWarning from '@/components/desktop/IdleStopWarning';
import AdminChatBubble from '@/components/AdminChatBubble';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';
import StatusBadge from '@/components/ui/StatusBadge';
import BrandLogo from '@/components/branding/BrandLogo';
import ThemeToggle from '@/components/ui/ThemeToggle';
import CommandBarTrigger from '@/components/search/CommandBarTrigger';
import GlobalCommandBar from '@/components/search/GlobalCommandBar';
import Sidebar from '@/components/navigation/Sidebar';
import SidebarUser from '@/components/navigation/SidebarUser';
import SidebarDrawer from '@/components/navigation/SidebarDrawer';
import { useSidebarState } from '@/hooks/useSidebarState';
import { useRecentCommands } from '@/hooks/useRecentCommands';
import { topNavigation } from '@/navigation/dashboardNavigation';
import { condensedNavigation } from '@/navigation/condensedNavigation';
import { devModeNavigation } from '@/lib/runtimeConfig';
import { cn } from '@/utils/cn';
import {
  Bell,
  CalendarClock,
  ChevronRight,
  Clock,
  LifeBuoy,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Settings,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BRAND } from '@/config/brand';

export default function Layout() {
  const { user, organization, logout, token, desktopHandoffToken } = useAuth();
  useDesktopTracker();
  // Sends replies typed into the desktop shell's quick-reply box.
  useQuickReply(Boolean(user?.id));
  const { hasFeature } = usePlan();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotificationItem[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadChatMessages, setUnreadChatMessages] = useState(0);
  const [reimbursementInboxCount, setReimbursementInboxCount] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  /*
   * Set when the palette is opened by the header's AI chip rather than by the
   * search field. Reaching AI mode used to take two deliberate actions — open,
   * then find the toggle — which is two too many for the thing somebody came
   * to the search bar to do.
   *
   * A counter rather than a boolean: opening in AI mode twice in a row has to
   * be two distinct events, and a boolean that is already `true` produces no
   * change for the palette to react to.
   */
  const [aiRequestedAt, setAiRequestedAt] = useState(0);
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [updatePanelOpen, setUpdatePanelOpen] = useState(false);
  const [seenDesktopUpdateKey, setSeenDesktopUpdateKey] = useState<string | null>(null);
  const sidebar = useSidebarState(user?.id);
  // The command bar records what this person actually opens; the rail reads the
  // same counts to surface their Frequent shortcuts.
  const { usesOf: commandUsesOf } = useRecentCommands(user?.id);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const desktopNotificationByIdRef = useRef<Map<number, AppNotificationItem>>(new Map());
  const seenNotificationIdsRef = useRef<Set<number>>(new Set());
  const isInitialLoadRef = useRef(true);

  /*
   * Real-time delivery state.
   *
   * `realtimeStatus` drives a small header affordance; `realtimeStatusRef`
   * exists because the polling interval's closure would otherwise capture the
   * status from the render that created it and keep polling forever after the
   * socket came up.
   *
   * The watermark is the highest notification id this client has already seen.
   * It is what a reconnect uses to ask for the exact gap rather than guessing,
   * and it stays a ref rather than state because changing it must never
   * re-render anything.
   */
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('disabled');
  const realtimeStatusRef = useRef<RealtimeStatus>('disabled');
  const notificationWatermarkRef = useRef(0);
  // The alerts loader and the catch-up routine both live inside effects that
  // close over state the realtime effect must not depend on. Holding them in
  // refs lets the socket call the current version without re-subscribing every
  // time a badge count changes.
  const loadAlertsRef = useRef<(() => Promise<void>) | null>(null);
  const catchUpRef = useRef<(() => Promise<void>) | null>(null);
  const isAdminView = hasAdminAccess(user);
  const isPayrollAdminView = hasPayrollAdminAccess(user);
  const isStrictAdminView = hasStrictAdminAccess(user);
  const isSuperAdminView = hasSuperAdminAccess(user);
  const isEmployeeOrManagerView = hasEmployeeOrManagerAccess(user);
  const isEmployeeView = isEmployeeUser(user);
  const canAccessAttendance = isAdminView || user?.settings?.attendance_monitoring !== false;
  const canAccessEditTime = isAdminView || user?.settings?.can_edit_time !== false;
  const isDesktopShell = Boolean(window.desktopTracker) && !isSuperAdminView;
  // Self-view is an organization opt-in, so the nav entry is gated on the
  // server-resolved policy rather than on a role.
  const trackerPolicy = resolveTrackerPolicy(user as any);
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
    // In the desktop shell the in-memory token is a cookie-auth placeholder; use the
    // cached real bearer so the system browser can complete the handoff.
    const handoffToken = desktopHandoffToken ?? token;
    if (handoffToken) {
      nextUrl.searchParams.set('desktop_token', handoffToken);
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

  /**
   * Record what this client has already seen.
   *
   * Two things at once, and they answer different questions. The id set is
   * "have I already raised a toast for this", which is what stops a refresh
   * re-announcing everything on screen. The watermark is "how far have I got",
   * which is what a reconnect sends as since_id to fetch precisely the
   * notifications that arrived while the socket was down.
   */
  const rememberNotifications = (items: AppNotificationItem[]) => {
    items.forEach((item) => {
      const id = Number(item.id);
      if (!Number.isFinite(id) || id <= 0) return;
      seenNotificationIdsRef.current.add(id);
      if (id > notificationWatermarkRef.current) {
        notificationWatermarkRef.current = id;
      }
    });
  };

  /**
   * Where a reply to this notification would go, or null if nowhere.
   *
   * Read from the meta the server already sends for routing, so there is one
   * source of truth for which conversation a notification belongs to rather
   * than a second one parsed out of the route string.
   */
  const resolveReplyTarget = (
    notification: AppNotificationItem
  ): { threadType: 'direct' | 'group'; threadId: number; title: string } | null => {
    const meta = notification.meta as { conversation_id?: number; group_id?: number; group_name?: string; sender_name?: string } | undefined;

    const conversationId = Number(meta?.conversation_id || 0);
    if (notification.type === 'chat_direct_message' && conversationId > 0) {
      return {
        threadType: 'direct',
        threadId: conversationId,
        title: meta?.sender_name || notification.sender?.name || 'Reply',
      };
    }

    const groupId = Number(meta?.group_id || 0);
    if (notification.type === 'chat_group_message' && groupId > 0) {
      return { threadType: 'group', threadId: groupId, title: meta?.group_name || 'Reply' };
    }

    return null;
  };

  const showDesktopNotification = async (notification: AppNotificationItem) => {
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

    /*
     * The picture, when the message carried one.
     *
     * Awaited before the notification is raised rather than added afterwards,
     * because neither Windows nor macOS lets a toast change its image once it
     * is on screen. Resolves to null for everything that is not an image
     * attachment — which is most notifications — and never throws, so a
     * missing preview costs the picture and never the notification.
     */
    const thumbnail = await resolveNotificationThumbnail(notification);

    if (window.desktopTracker?.showNotification) {
      void window.desktopTracker.showNotification({
        id: notificationId,
        title: formattedTitle,
        body: formattedMessage,
        route: resolveNotificationRoute(notification, user),
        type: notification.type,
        image: thumbnail ?? undefined,
        // Only chat can be replied to. Its presence is what tells the shell to
        // open the reply box rather than raise the window.
        reply: resolveReplyTarget(notification) ?? undefined,
      });
      playNotificationSound(soundType);
      return;
    }

    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }
    const systemNotification = new Notification(formattedTitle, {
      body: formattedMessage,
      tag: `app-notification-${notification.id}`,
      // The preview takes precedence over the app icon: showing what was sent
      // is the entire point, and the app icon is already implied by the toast.
      icon: thumbnail
        ?? (BRAND.enabled && notification.type === 'announcement' ? BRAND.logoMark : undefined),
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
      const baseNavigation = devModeNavigation ? condensedNavigation : topNavigation;
      
      const navigationGroups = isSuperAdminView
        ? baseNavigation.filter((group) => group.superAdminOnly)
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
              label: 'Chat',
              to: '/chat',
              icon: MessageSquare,
            },

            /*
             * Payroll opens in the browser rather than the tracker window, the
             * same handoff Home uses: the payroll screens assume a full-width
             * viewport, and the desktop shell's in-memory token is a cookie-auth
             * placeholder, so the cached bearer goes across in the URL.
             *
             * Without this entry a payroll admin working in the tracker has no
             * route to payroll at all - they have to know to open a browser and
             * sign in again.
             */
            ...(isStrictAdminView && hasFeature('payroll')
              ? [
                  {
                    label: 'Payroll',
                    to: '/desktop-web-payroll',
                    externalPath: '/payroll',
                    external: true,
                    icon: Wallet,
                  },
                ]
              : []),
          ]
        : baseNavigation;

      return navigationGroups
        .filter((group) => {
          if (group.planFeature && !hasFeature(group.planFeature)) return false;
          if (group.permission && !canAccess(user, group.permission)) return false;
          if (group.payrollAdminOnly) return isPayrollAdminView;
          if (group.strictAdminOnly) return isStrictAdminView;
          if (group.superAdminOnly) return isSuperAdminView;
          if (group.adminOnly) return isAdminView;
          if (group.employeeAndManagerOnly) return isEmployeeOrManagerView;
          if (group.employeeOnly) return isEmployeeView;
          return true;
        })
        .map((group) => {
          let filteredItems = group.items?.filter((item) => {
            if (item.planFeature && !hasFeature(item.planFeature)) return false;
            if (item.trackerPolicyFlag && !trackerPolicy[item.trackerPolicyFlag]) return false;
            if (item.permission && !canAccess(user, item.permission)) return false;
            if (item.to === '/attendance' && !canAccessAttendance) return false;
            if (item.to === '/edit-time' && !canAccessEditTime) return false;
            if (item.payrollAdminOnly) return isPayrollAdminView;
            if (item.strictAdminOnly) return isStrictAdminView;
            if (item.superAdminOnly) return isSuperAdminView;
            if (item.adminOnly) return isAdminView;
            if (item.employeeAndManagerOnly) return isEmployeeOrManagerView;
            if (item.employeeOnly) return isEmployeeView;
            return true;
          });

          filteredItems = filteredItems?.map((item) =>
            item.to === '/chat'
              ? { ...item, unreadCount: unreadChatMessages }
              : item.to === '/reimbursements'
                ? { ...item, unreadCount: reimbursementInboxCount }
                : item
          );

          if ((group.label === 'Attendance' || group.label === 'Monitoring') && filteredItems?.length === 1) {
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
    [canAccessAttendance, canAccessEditTime, isAdminView, isDesktopShell, isStrictAdminView, isSuperAdminView, isEmployeeOrManagerView, pendingApprovals, unreadChatMessages, reimbursementInboxCount, hasFeature, user, devModeNavigation]
  );

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

      <div className="relative z-[70] min-w-0 w-full lg:mx-auto lg:w-[32rem] lg:max-w-[32rem] xl:w-[36rem] xl:max-w-[36rem]">
        <CommandBarTrigger
          onOpen={() => setCommandBarOpen(true)}
          onOpenAi={() => {
            setAiRequestedAt(Date.now());
            setCommandBarOpen(true);
          }}
        />
      </div>
    </div>
  );

  // One instance for the whole app. It owns the ⌘K/Ctrl+K shortcut, so it has
  // to stay mounted while closed — it renders nothing until then.
  const commandBar = (
    <GlobalCommandBar
      open={commandBarOpen}
      aiRequestedAt={aiRequestedAt}
      onOpen={() => {
        setCommandBarOpen(true);
        setNotificationsOpen(false);
        setProfileOpen(false);
        setMobileNavigationOpen(false);
      }}
      onClose={() => setCommandBarOpen(false)}
      navigation={primaryNavigation}
      isAdminView={isAdminView}
      isStrictAdminView={isStrictAdminView}
      isSuperAdminView={isSuperAdminView}
      isEmployeeOrManagerView={isEmployeeOrManagerView}
      isDesktopShell={isDesktopShell}
      openWebDashboard={openWebDashboard}
    />
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

        /*
         * Chat is excluded SERVER-side, not just filtered out of the response.
         * The limit applies before the filter, so fetching 20 unfiltered and
         * dropping chat locally means a busy chat thread returns a page that is
         * entirely chat - and the panel renders empty while approvals sit
         * waiting. The local filter below stays as a backstop for a server that
         * does not honour the parameter.
         */
        const [notificationResponse, chatNotificationResponse, chatUnreadResponse, approvalResponses, reimbursementResponse] = await Promise.all([
          notificationApi.list({ limit: 20, exclude_types: CHAT_NOTIFICATION_TYPES }),
          /*
           * Chat notifications, fetched SEPARATELY and only to raise alerts.
           *
           * They cannot come from the request above, which excludes them
           * server-side for the reason given there. The consequence went
           * unnoticed for a long time: `nextChat` was derived by filtering a
           * response chat had already been removed from, so it was ALWAYS
           * empty and a chat message could never raise a desktop notification
           * at all. The badge updated, the toast never fired.
           *
           * A second small request is the honest fix. Merging the two into one
           * unfiltered call would re-create the original problem — a busy
           * thread would fill the 20-row page with chat and push approvals out
           * of the panel entirely.
           */
          notificationApi.list({ limit: 10, types: CHAT_NOTIFICATION_TYPES }),
          chatApi.getUnreadSummary(),
          approvalPromise,
          payrollApi.reimbursementInboxCount(),
        ]);

        if (!active) return;

        const allItems = (notificationResponse.data?.data || []) as AppNotificationItem[];
        const chatItems = (chatNotificationResponse.data?.data || []) as AppNotificationItem[];
        // The local filter stays as a backstop for a server that does not
        // honour exclude_types; chat alerts now come from their own request.
        const nextNonChat = allItems.filter((item) => !isChatNotification(item));
        const nextChat = chatItems;

        // Calculate unread count only for non-chat notifications
        const unreadNonChatCount = nextNonChat.filter((item) => !item.is_read).length;

        setNotifications(nextNonChat);
        setUnreadNotifications(unreadNonChatCount);
        setUnreadChatMessages(Number(chatUnreadResponse.data?.unread_messages || 0));

        // Reimbursement inbox badge — only pending *unread* claims for the
        // current user's role (admin sees admin_inbox, others see manager_inbox).
        const reim = reimbursementResponse.data || { manager_inbox: 0, admin_inbox: 0 };
        setReimbursementInboxCount(isStrictAdminView ? reim.admin_inbox : reim.manager_inbox);

        if (approvalResponses) {
          const [leaveResponse, timeEditResponse] = approvalResponses;
          // Count the whole pending set, not the returned page. The list
          // endpoint caps at 10 by default, so measuring `data.length` showed
          // "10 pending" while 28 were waiting — and clearing the badge left
          // the remainder unseen. `total` falls back to the page length for
          // any endpoint that does not report it yet.
          const countOf = (response: any) =>
            Number(response?.data?.total ?? response?.data?.data?.length ?? 0);
          setPendingApprovals(countOf(leaveResponse) + countOf(timeEditResponse));
        } else {
          setPendingApprovals(0);
        }

        if (isInitialLoadRef.current) {
          rememberNotifications([...allItems, ...chatItems]);
          isInitialLoadRef.current = false;
          return;
        }

        // Show desktop notifications for new items (both chat and non-chat)
        const newNonChat = nextNonChat.filter((item) => {
          const id = Number(item.id);
          return !item.is_read && !seenNotificationIdsRef.current.has(id);
        });
        const newChat = nextChat.filter((item) => {
          const id = Number(item.id);
          return !item.is_read && !seenNotificationIdsRef.current.has(id);
        });

        newNonChat.forEach((item) => void showDesktopNotification(item));
        newChat.forEach((item) => void showDesktopNotification(item));

        rememberNotifications([...allItems, ...chatItems]);
      } catch (error) {
        // Every badge used to be reset to zero here. A single dropped poll —
        // a flaky connection, a redeploy, a 502 — told the user they had no
        // unread messages, no notifications and no pending approvals, which is
        // worse than showing a stale count: they stop checking. Keep the last
        // known values and let the next poll correct them.
        reportSilentError('Layout: notification poll failed; keeping last known badge counts', error);
      }
    };

    loadAlertsRef.current = loadAlerts;
    loadAlerts();

    // Five endpoints every 8 seconds, on every authenticated page, whether or
    // not anyone was looking — a backgrounded tab kept 37 requests a minute
    // going all day. Poll only while the tab is visible, and refresh once on
    // the way back so returning to the tab still shows current badges.
    //
    // The interval is now a FALLBACK rather than the delivery mechanism. While
    // the socket is connected it is pure waste — events already refresh these
    // badges the moment anything changes — so it stands down and costs nothing.
    //
    // It stays at 30s, deliberately unchanged. An earlier draft slowed it to
    // 60s on the reasoning that a backstop should be cheap, which would have
    // meant that on the day Reverb was down users got notifications LATER than
    // before any of this existed. A degraded path must never be worse than the
    // thing it replaced.
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (realtimeStatusRef.current === 'connected') return;
      loadAlerts();
    };

    const interval = setInterval(tick, 30000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadAlerts();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isAdminView]);

  /**
   * Recover the notifications that arrived while the socket was down.
   *
   * `loadAlerts` fetches the newest 20, which is fine for badges but not for
   * toasts: somebody who was disconnected through a busy afternoon can have
   * more than that waiting, and the ones past the page boundary would never be
   * announced at all. This asks for everything above the watermark instead and
   * drains it, so "you were offline, here is what you missed" is complete
   * rather than approximately complete.
   *
   * Bounded at 20 pages. A client returning after weeks should not fire an
   * unbounded number of requests before the interface settles, and the page
   * itself will show the backlog regardless.
   */
  const catchUpOnMissedNotifications = async () => {
    if (notificationWatermarkRef.current <= 0) return;

    try {
      let watermark = notificationWatermarkRef.current;

      for (let page = 0; page < 20; page += 1) {
        const response = await notificationApi.list({ since_id: watermark, limit: 100 });
        const rows = (response.data?.data || []) as AppNotificationItem[];
        if (rows.length === 0) break;

        rows.forEach((item) => {
          if (shouldShowDesktopNotification(item, seenNotificationIdsRef.current)) {
            void showDesktopNotification(item);
          }
        });

        rememberNotifications(rows);

        const nextWatermark = Number(response.data?.latest_id ?? watermark);
        // Refuse to loop on a watermark that did not move. Without this a
        // server that stopped advancing latest_id would spin here.
        if (nextWatermark <= watermark) break;
        watermark = nextWatermark;

        if (!response.data?.has_more) break;
      }
    } catch (error) {
      reportSilentError('Layout: notification catch-up failed; the fallback poll will reconcile', error);
    }
  };

  // Kept current on every render rather than in a dependency array: the socket
  // effect must not re-subscribe every time a badge count changes.
  catchUpRef.current = catchUpOnMissedNotifications;

  /**
   * The real-time connection.
   *
   * Keyed on the user id alone. Re-running this on anything else would tear
   * down and re-establish the socket — and re-authorize the channel — for
   * reasons as trivial as an unread count changing.
   */
  useEffect(() => {
    const userId = Number(user?.id || 0);
    if (!userId) return;

    const teardown = connectRealtime(userId, {
      // The event is only a signal that something arrived; the rows come from
      // the API. That keeps one rendering path for notifications instead of
      // two that have to be kept in step, and it means mark-read works because
      // real ids are present.
      onNotification: () => {
        void loadAlertsRef.current?.();
      },

      // Access was taken away while this tab was open. Channel authorization
      // happened once, at subscribe time, so without this the socket would
      // outlive the credentials that opened it.
      onSessionRevoked: () => {
        disconnectRealtime();
        clearAuthStorage();
        window.dispatchEvent(new Event('app:auth-cleared'));
      },

      onStatusChange: (status) => {
        realtimeStatusRef.current = status;
        setRealtimeStatus(status);

        if (status !== 'connected') return;

        // Order matters. Catch-up reads the OLD watermark to find what was
        // missed; loadAlerts advances it to the newest. Run them the other way
        // round and the catch-up finds nothing, silently losing every toast
        // past the first page.
        void (async () => {
          await catchUpRef.current?.();
          await loadAlertsRef.current?.();
        })();
      },
    });

    return () => {
      teardown();
    };
  }, [user?.id]);

  // The employee directory used to be downloaded in full here on every mount,
  // for every admin, whether or not they ever searched. People search is now a
  // scoped query against /api/search, issued only while the command bar is open.

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window) || !desktopPushEnabled) {
      return;
    }

    if (Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, [desktopPushEnabled]);

  /**
   * Which group owns the current route. Longest matching path wins, so
   * /reports/attendance resolves to Reports rather than to a shorter sibling.
   *
   * Derived rather than computed inside the effect below because the effect
   * must not re-run every time a badge count changes — `primaryNavigation` is
   * rebuilt on each poll, and re-running would slam shut any group the user had
   * just opened by hand. A plain string is stable across those rebuilds.
   */
  const activeGroupLabel = useMemo(() => {
    let bestLabel: string | null = null;
    let bestLength = 0;

    for (const group of primaryNavigation) {
      if (!group.items?.length) continue;
      for (const item of group.items) {
        if (!item.to) continue;
        const normalized = String(item.to).split('?')[0] || item.to;
        if (
          (location.pathname === normalized ||
            (normalized !== '/dashboard' && location.pathname.startsWith(`${normalized}/`))) &&
          normalized.length > bestLength
        ) {
          bestLength = normalized.length;
          bestLabel = group.label;
        }
      }
    }

    return bestLabel;
  }, [primaryNavigation, location.pathname]);

  /*
   * Open the group holding the current route, and close the ones you've left.
   *
   * This previously only ever called `add`, so visiting Attendance, then
   * Reports, then Payroll left all three open and the rail grew until it
   * scrolled, with no way back. `focusGroup` replaces the open set rather than
   * accumulating into it, and persists the result.
   *
   * Keyed on the resolved label, not on the pathname: navigation is empty on
   * the first render or two while the user loads, so a pathname-only effect
   * computed no match, never ran again, and left whatever group was persisted
   * from a previous session open on the wrong page.
   */
  useEffect(() => {
    // A route with no owning group (Dashboard, Organization) leaves whatever
    // the user last opened alone rather than collapsing the rail under them.
    if (activeGroupLabel) sidebar.focusGroup(activeGroupLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupLabel]);

  // Navigating from anywhere (including the command bar) closes the drawer.
  useEffect(() => {
    setNavDrawerOpen(false);
  }, [location.pathname, location.search]);

  // "[" toggles the rail, matching the convention in editors and Linear. Guarded
  // so it never eats the character while someone is typing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '[' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

      event.preventDefault();
      sidebar.toggleCollapsed();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebar]);

  // Note: Removed auto-mark-as-read when opening notification dropdown
  // Notifications should only be marked as read when user actually clicks on them
  // This prevents notifications from disappearing just by opening the dropdown

  // Active-route matching moved into Sidebar, which is the only thing that
  // needed it — Layout kept three helpers to compute it for the inline rail.


  // The sidebar is always a dark rail, so its states come from the --sidebar-*
  // tokens. It previously borrowed --text-primary / --border, which are
  // page-surface colours: on hover that put near-black text on the near-black
  // rail and the label disappeared.
  // Hide sidebar for Super Admin users
  const showSidebar = !isSuperAdminView;

  // One definition, rendered twice: as the sticky rail at lg and up, and as the
  // drawer below it. Previously there was no second surface at all, so a tablet
  // had zero navigation.
  const sidebarContent = (variant: 'rail' | 'drawer') => (
    <Sidebar
      variant={variant}
      navigation={primaryNavigation}
      collapsed={sidebar.collapsed}
      onToggleCollapsed={sidebar.toggleCollapsed}
      isGroupOpen={sidebar.isGroupOpen}
      onToggleGroup={sidebar.toggleGroup}
      onExpandInto={(label) => {
        sidebar.setCollapsed(false);
        sidebar.focusGroup(label);
      }}
      usesOf={commandUsesOf}
      pendingApprovals={pendingApprovals}
      onOpenCommandBar={() => setCommandBarOpen(true)}
      showTimer={isEmployeeOrManagerView}
      onNavigate={variant === 'drawer' ? () => setNavDrawerOpen(false) : undefined}
      footer={
        <SidebarUser
          name={user?.name}
          roleLabel={resolveUserRoleLabel(user)}
          avatar={user?.avatar}
          collapsed={sidebar.collapsed && variant === 'rail'}
          onNavigate={variant === 'drawer' ? () => setNavDrawerOpen(false) : undefined}
        />
      }
    />
  );

  if (!isDesktopShell) {
    return (
      <div
        className={'min-h-screen bg-surface-base ' + (showSidebar ? 'lg:grid' : '')}
        style={showSidebar ? { gridTemplateColumns: (sidebar.collapsed ? '4.5rem' : '15.5rem') + ' minmax(0,1fr)' } : undefined}
      >
        {showSidebar && (
          <aside className="hidden h-screen lg:sticky lg:top-0 lg:block">
            {sidebarContent('rail')}
          </aside>
        )}

        {showSidebar ? (
          <SidebarDrawer open={navDrawerOpen} onClose={() => setNavDrawerOpen(false)}>
            {sidebarContent('drawer')}
          </SidebarDrawer>
        ) : null}


        <main className={`min-w-0 px-4 py-4 lg:pr-5 lg:py-4 xl:pr-6 ${!showSidebar ? 'lg:col-span-full' : ''}`}>
          <div className="flex items-center justify-between gap-4 mb-5">
            {/*
              The full wordmark used to render here as well as in the rail, so
              two identical CareVance logos sat centimetres apart. The rail owns
              the brand now; this slot becomes the drawer trigger, which is the
              only navigation that exists below lg.
            */}
            <div className="flex items-center gap-3 shrink-0">
              {showSidebar ? (
                <button
                  type="button"
                  onClick={() => setNavDrawerOpen(true)}
                  aria-label="Open navigation"
                  aria-expanded={navDrawerOpen}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border-strong bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 lg:hidden"
                >
                  <Menu className="h-5 w-5" aria-hidden="true" />
                </button>
              ) : null}
              <BrandLogo variant="full" size="sm" className="max-w-[9.75rem] lg:hidden" />
            </div>

            <div className="relative flex-1 min-w-0 max-w-[36rem]">
              <CommandBarTrigger
          onOpen={() => setCommandBarOpen(true)}
          onOpenAi={() => {
            setAiRequestedAt(Date.now());
            setCommandBarOpen(true);
          }}
        />
            </div>

            <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
              <ThemeToggle className="h-11 w-11" />
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
                      : 'border-border-strong bg-white text-slate-500 hover:bg-white'
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
                    <div className="flex items-center justify-between border-b border-border-strong/40 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold contrast-text-primary">Notifications</p>
                        {/*
                          * Whether these are arriving live or on a timer.
                          *
                          * Shown here rather than as a header badge because
                          * this is where somebody wonders about it, and only
                          * when real-time is configured at all — announcing
                          * "offline" in an environment that never had a socket
                          * would describe a fault that does not exist.
                          *
                          * The degraded label names the actual interval. "We
                          * are checking every 30 seconds" is something a user
                          * can act on; a bare warning triangle is not.
                          */}
                        {realtimeStatus === 'connected' ? (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600"
                            title="Notifications are arriving in real time"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Live
                          </span>
                        ) : realtimeStatus !== 'disabled' ? (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600"
                            title="The live connection is down. Notifications are still arriving, but on a 30-second refresh."
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            {realtimeStatus === 'unavailable' ? 'Every 30s' : 'Reconnecting'}
                          </span>
                        ) : null}
                      </div>
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
                      : 'border-border-strong bg-white hover:bg-white',
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
                    <p className="hidden text-xs capitalize text-slate-500 sm:block">{resolveUserRoleLabel(user)}</p>
                  </div>
                </button>

                {profileOpen && (
                  <AdaptiveSurface
                    className="fixed right-4 top-4 z-50 w-64 overflow-hidden rounded-[24px] border border-white/80 bg-white/95 p-2 shadow-[0_32px_90px_-48px_rgba(15,23,42,0.55)] backdrop-blur-2xl"
                    tone="light"
                    backgroundColor="rgba(255,255,255,0.95)"
                  >
                    <div className="border-b border-border-strong/40 px-3 py-3">
                      <p className="text-sm font-semibold text-slate-900">{user?.name || 'Admin'}</p>
                      <p className="text-xs capitalize text-slate-500">{resolveUserRoleLabel(user)}</p>
                    </div>
                    <div className="space-y-1 p-2">
                      <Link
                        to="/settings"
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
                      >
                        <Settings className="h-4 w-4 text-slate-500" />
                        Settings
                      </Link>
                      <Link
                        to="/settings?tab=help"
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
                      >
                        <LifeBuoy className="h-4 w-4 text-slate-500" />
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
            <WorkspaceRenewalBanner />
            <Outlet />
          </div>
        </main>
        {isStrictAdminView && <AdminChatBubble />}
        {commandBar}
        <IdleReturnPrompt />
        <IdleStopWarning />
      </div>
    );
  }

  return (
    // Same `bg-surface-base` token as the web shell above. This used to be a
    // literal `linear-gradient(#f8fbff…#f8fafc)`, which no theme rule can
    // repaint — so the desktop shell kept a white page under the dark cards
    // and showed it wherever a route did not paint its own full background.
    // The radial wash stays: it is translucent, so it composites over either
    // theme rather than replacing it.
    <div className="min-h-screen bg-surface-base">
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
          notificationsRef={notificationsRef}
          notificationPanel={
            <>
            {notificationsOpen && (
              <AdaptiveSurface
                className="absolute right-0 top-full z-50 mt-3 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[24px] border border-white/80 bg-white/95 shadow-[0_32px_90px_-48px_rgba(15,23,42,0.55)] backdrop-blur-2xl"
                tone="light"
                backgroundColor="rgba(255,255,255,0.95)"
              >
                <div className="flex items-center justify-between border-b border-border-strong/40 px-4 py-3">
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
                        className={`w-full border-b border-border-strong/40 px-4 py-3 text-left transition hover:bg-slate-50/80 ${n.is_read ? '' : 'bg-sky-50/70'}`}
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
            </>
          }
          profilePanel={
            <div ref={profileRef}>
              {profileOpen && (
                <AdaptiveSurface
                  className="fixed right-4 top-4 z-50 w-64 overflow-hidden rounded-[24px] border border-white/80 bg-white/95 p-2 shadow-[0_32px_90px_-48px_rgba(15,23,42,0.55)] backdrop-blur-2xl"
                  tone="light"
                  backgroundColor="rgba(255,255,255,0.95)"
                >
                  <div className="border-b border-border-strong/40 px-3 py-3">
                    <p className="text-sm font-semibold contrast-text-primary">{user?.name || 'Admin'}</p>
                    <p className="text-xs capitalize contrast-text-muted">{resolveUserRoleLabel(user)}</p>
                  </div>
                  <div className="space-y-1 p-2">
                    <Link
                      to="/settings"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
                    >
                      <Settings className="h-4 w-4 text-slate-500" />
                      Settings
                    </Link>
                    <Link
                      to="/settings?tab=help"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
                    >
                      <LifeBuoy className="h-4 w-4 text-slate-500" />
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
                        <Sparkles className="h-4 w-4 text-slate-500" />
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
          <WorkspaceRenewalBanner />
          <Outlet />
        </main>
        {isStrictAdminView && <AdminChatBubble />}
        {commandBar}
        <IdleReturnPrompt />
        <IdleStopWarning />

        {isDesktopShell && updatePanelOpen ? (
          <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/28 px-4 py-20 backdrop-blur-sm sm:px-6">
            <div className="relative w-full max-w-4xl">
              <button
                type="button"
                onClick={() => setUpdatePanelOpen(false)}
                aria-label="Close updates dialog"
                className="absolute -top-14 right-0 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/35 bg-black/65 text-white shadow-lg transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/80"
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
