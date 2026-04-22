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

export const resolveNotificationRoute = (notification: AppNotificationItem, _user?: User | null) =>
  String(notification.meta?.route || '/notifications').trim() || '/notifications';

export const canOpenNotificationFromCenter = (
  notification: AppNotificationItem,
  _user?: User | null,
) => {
  const route = resolveNotificationRoute(notification);

  return route !== '/notifications';
};

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
