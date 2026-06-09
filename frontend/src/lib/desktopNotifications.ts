import type { AppNotificationItem, User } from '@/types';
import { isChatNotification } from '@/lib/chatNotifications';
import { isApprovalNotification } from '@/lib/notificationDisplay';
import { decodeHtmlEntities } from '@/lib/formatters';

export type NotificationSoundType = 'chat' | 'approval' | 'announcement' | 'default';

const notificationSounds: Map<NotificationSoundType, HTMLAudioElement | null> = new Map();

const getSoundUrl = (type: NotificationSoundType): string => {
  const soundFiles: Record<NotificationSoundType, string> = {
    chat: '/sounds/chat-notification.mp3',
    approval: '/sounds/approval-notification.mp3',
    announcement: '/sounds/announcement-notification.mp3',
    default: '/sounds/default-notification.mp3',
  };
  return soundFiles[type];
};

export const playNotificationSound = (soundType: NotificationSoundType = 'default'): void => {
  if (typeof window === 'undefined') return;

  try {
    let audio = notificationSounds.get(soundType);
    
    if (!audio) {
      audio = new Audio(getSoundUrl(soundType));
      audio.volume = 0.5;
      notificationSounds.set(soundType, audio);
    }

    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Autoplay may be blocked by browser policy
    });
  } catch {
    // Sound playback failed
  }
};

export const getNotificationSoundType = (notification: AppNotificationItem): NotificationSoundType => {
  if (isChatNotification(notification)) {
    return 'chat';
  }
  if (isApprovalNotification(notification)) {
    return 'approval';
  }
  if (notification.type === 'announcement' || notification.type === 'news') {
    return 'announcement';
  }
  return 'default';
};

export const formatNotificationTitle = (
  notification: AppNotificationItem,
  user: Pick<User, 'role' | 'hierarchy_level'> | null | undefined
): string => {
  if (isChatNotification(notification)) {
    const senderName = notification.sender?.name || notification.meta?.sender_name || notification.meta?.employee_name;
    if (senderName) {
      return `New message from ${senderName}`;
    }
    return notification.title || 'New message';
  }

  if (isApprovalNotification(notification)) {
    const senderName = notification.meta?.employee_name || notification.sender?.name;
    const isLeaveRequest = notification.type === 'leave_request' || 
      notification.meta?.approval_kind === 'leave_request' ||
      notification.title?.toLowerCase().includes('leave');
    const isTimeEdit = notification.type === 'time_edit' || 
      notification.meta?.approval_kind === 'time_edit' ||
      notification.title?.toLowerCase().includes('time edit');

    const requestType = isLeaveRequest ? 'Leave' : isTimeEdit ? 'Time Edit' : 'Approval';
    const userLevel = user?.hierarchy_level ?? (user?.role === 'admin' ? 10 : user?.role === 'manager' ? 50 : 100);
    const actionRequired = userLevel < 100 ? 'Action Required' : 'Submitted';
    
    if (senderName) {
      return `${requestType} Request from ${senderName}`;
    }
    return `${requestType} Request ${actionRequired}`;
  }

  if (notification.type === 'announcement') {
    const priority = notification.meta?.priority;
    const priorityIndicator = priority === 'urgent' ? '🔴' : priority === 'high' ? '🟠' : priority === 'medium' ? '🟡' : '';
    return `${priorityIndicator} 📢 ${notification.title || 'Announcement'}`;
  }

  if (notification.type === 'news') {
    return `📰 ${notification.title || 'News Update'}`;
  }

  if (notification.type === 'salary_credited') {
    return '💰 Salary Credited';
  }

  return notification.title || 'Notification';
};

export const formatNotificationMessage = (
  notification: AppNotificationItem
): string => {
  if (isChatNotification(notification)) {
    const messagePreview = notification.message || notification.meta?.message_preview;
    if (messagePreview) {
      const maxLength = 120;
      const decodedPreview = decodeHtmlEntities(messagePreview);
      return decodedPreview.length > maxLength 
        ? `${decodedPreview.substring(0, maxLength)}...` 
        : decodedPreview;
    }
    return 'Click to view conversation';
  }

  if (isApprovalNotification(notification)) {
    const meta = notification.meta;
    const isLeaveRequest = notification.type === 'leave_request' || meta?.approval_kind === 'leave_request';
    
    if (isLeaveRequest && meta?.leave_type && meta?.start_date) {
      const startDate = new Date(meta.start_date).toLocaleDateString();
      const endDate = meta.end_date ? new Date(meta.end_date).toLocaleDateString() : startDate;
      const leaveType = meta.leave_type.replace('_', ' ');
      return `${meta.employee_name || 'Employee'}: ${leaveType} leave from ${startDate} to ${endDate}`;
    }
    
    if (meta?.attendance_date && meta?.worked_seconds !== undefined) {
      const date = new Date(meta.attendance_date).toLocaleDateString();
      const worked = Math.round(meta.worked_seconds / 3600 * 10) / 10;
      const overtime = meta.overtime_seconds ? Math.round(meta.overtime_seconds / 3600 * 10) / 10 : 0;
      return `Date: ${date}, Worked: ${worked}h, Requested: ${overtime}h overtime`;
    }
    
    return notification.message || 'Click to review and take action';
  }

  if (notification.type === 'announcement' || notification.type === 'news') {
    const maxLength = 150;
    if (notification.message) {
      return notification.message.length > maxLength 
        ? `${notification.message.substring(0, maxLength)}...` 
        : notification.message;
    }
    return 'Click to view details';
  }

  return notification.message || '';
};

export const shouldShowDesktopNotification = (
  notification: AppNotificationItem,
  seenIds: Set<number>
): boolean => {
  if (notification.is_read) {
    return false;
  }

  const notificationId = Number(notification.id);
  if (!Number.isFinite(notificationId) || notificationId <= 0) {
    return false;
  }

  if (seenIds.has(notificationId)) {
    return false;
  }

  return true;
};
