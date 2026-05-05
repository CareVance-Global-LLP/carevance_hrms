import type { AppNotificationItem } from '@/types';

export const CHAT_NOTIFICATION_TYPES = [
  'chat_direct_message',
  'chat_group_message',
  'chat_message',
  'direct_message',
  'group_message',
];

const CHAT_NOTIFICATION_TYPE_SET = new Set(CHAT_NOTIFICATION_TYPES);

export const isChatNotification = (
  notification: Pick<AppNotificationItem, 'type' | 'title' | 'meta'> | null | undefined
): boolean => {
  const type = String(notification?.type || '').trim().toLowerCase();
  if (CHAT_NOTIFICATION_TYPE_SET.has(type) || type.startsWith('chat_')) {
    return true;
  }

  const route = String(notification?.meta?.route || '').trim().toLowerCase();
  if (route === '/chat' || route.startsWith('/chat?') || route.startsWith('/chat/')) {
    return true;
  }

  const title = String(notification?.title || '').trim().toLowerCase();
  return title.startsWith('new message from ') || title.includes(' sent a message in ');
};
