import type { ReactNode } from 'react';
import type { AppNotificationItem, User } from '@/types';
import {
  Bell,
  Briefcase,
  CalendarClock,
  CreditCard,
  MessageSquare,
  Newspaper,
} from 'lucide-react';

type NotificationDisplay = {
  label: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  icon: ReactNode;
};

const createIcon = (node: ReactNode) => <span className="inline-flex h-4 w-4 items-center justify-center">{node}</span>;
const APPROVAL_NOTIFICATION_TYPES = new Set(['leave_request', 'time_edit']);
const APPROVAL_NOTIFICATION_TITLES = ['leave request submitted', 'time edit request submitted'];

export const getNotificationDisplay = (type: string): NotificationDisplay => {
  switch (String(type || '').trim()) {
    case 'chat_direct_message':
    case 'chat_group_message':
      return {
        label: 'Chat',
        tone: 'info',
        icon: createIcon(<MessageSquare className="h-4 w-4" />),
      };
    case 'salary_credited':
      return {
        label: 'Payroll',
        tone: 'success',
        icon: createIcon(<CreditCard className="h-4 w-4" />),
      };
    case 'news':
      return {
        label: 'News',
        tone: 'neutral',
        icon: createIcon(<Newspaper className="h-4 w-4" />),
      };
    case 'leave_request':
      return {
        label: 'Leave',
        tone: 'warning',
        icon: createIcon(<Briefcase className="h-4 w-4" />),
      };
    case 'time_edit':
      return {
        label: 'Time Edit',
        tone: 'warning',
        icon: createIcon(<CalendarClock className="h-4 w-4" />),
      };
    case 'announcement':
    default:
      return {
        label: 'Announcement',
        tone: 'info',
        icon: createIcon(<Bell className="h-4 w-4" />),
      };
  }
};

export const isApprovalNotification = (notification: AppNotificationItem | null | undefined): boolean => {
  const type = String(notification?.type || '').trim().toLowerCase();
  if (APPROVAL_NOTIFICATION_TYPES.has(type)) {
    return true;
  }

  const title = String(notification?.title || '').trim().toLowerCase();
  if (APPROVAL_NOTIFICATION_TITLES.some((candidate) => title.startsWith(candidate))) {
    return true;
  }

  return String(notification?.meta?.route || '').trim().startsWith('/approval-inbox');
};

export const resolveNotificationRoute = (
  notification: AppNotificationItem,
  user: Pick<User, 'role'> | null | undefined
): string => {
  if ((user?.role === 'admin' || user?.role === 'manager') && isApprovalNotification(notification)) {
    const type = String(notification?.type || '').trim().toLowerCase();
    const title = String(notification?.title || '').trim().toLowerCase();

    if (type === 'time_edit' || title.startsWith('time edit request submitted')) {
      return '/approval-inbox?section=time-edit&view=pending';
    }

    return '/approval-inbox?section=leave&view=pending&leave_window=today';
  }

  return String(notification.meta?.route || '/notifications').trim() || '/notifications';
};

export const canOpenNotificationFromCenter = (
  notification: AppNotificationItem,
  user: Pick<User, 'role'> | null | undefined
): boolean => (user?.role === 'admin' || user?.role === 'manager') && isApprovalNotification(notification);
