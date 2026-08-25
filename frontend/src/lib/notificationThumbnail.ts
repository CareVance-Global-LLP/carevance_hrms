import { chatApi } from '@/services/api';
import { reportSilentError } from '@/lib/reportSilentError';
import type { AppNotificationItem } from '@/types';

/**
 * The picture on a chat notification.
 *
 * Notifications used to read "Sent an attachment" with no indication of what
 * had been sent. The body now says "📷 Photo"; this supplies the photo itself,
 * which is what makes the toast look like the one people already expect.
 *
 * Delivered as a data URL rather than a blob URL or a link, because the target
 * is an OS notification, not the page: Windows and macOS render the image
 * outside the browser's origin, where a blob: URL means nothing and an
 * authenticated https: URL cannot send a bearer token.
 */

type AttachmentMeta = {
  message_id?: number;
  thread?: string;
  kind?: string;
  has_thumbnail?: boolean;
};

const readAttachmentMeta = (notification: AppNotificationItem): AttachmentMeta | null => {
  const meta = (notification?.meta as { attachment?: AttachmentMeta } | undefined)?.attachment;
  return meta && typeof meta === 'object' ? meta : null;
};

/**
 * Cache by message id.
 *
 * A refresh can re-announce the same notification, and the bytes for a given
 * message never change. Without this, every poll that re-surfaced an unread
 * message would re-download its preview.
 */
const cache = new Map<number, string>();

/** Exported so tests can start from a known state. */
export const resetThumbnailCache = () => cache.clear();

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read thumbnail'));
    reader.readAsDataURL(blob);
  });

/**
 * The preview for a notification, or null when there is none.
 *
 * Null is an ordinary outcome, not a failure: most notifications are not chat,
 * most chat messages have no attachment, and most attachments are not images.
 * Every caller treats null as "show the icon instead", so a missing preview can
 * never stop a notification being raised.
 */
export const resolveNotificationThumbnail = async (
  notification: AppNotificationItem
): Promise<string | null> => {
  const attachment = readAttachmentMeta(notification);
  if (!attachment?.has_thumbnail) return null;

  const messageId = Number(attachment.message_id || 0);
  if (!Number.isFinite(messageId) || messageId <= 0) return null;

  const cached = cache.get(messageId);
  if (cached) return cached;

  try {
    const response = attachment.thread === 'group'
      ? await chatApi.getGroupThumbnail(messageId)
      : await chatApi.getThumbnail(messageId);

    const blob = response.data as unknown as Blob;
    if (!blob || blob.size === 0) return null;

    const dataUrl = await blobToDataUrl(blob);
    if (!dataUrl.startsWith('data:image/')) return null;

    cache.set(messageId, dataUrl);
    return dataUrl;
  } catch (error) {
    // A 404 here is the normal answer for a non-image, and a network failure
    // is not worth interrupting anyone over. The notification still goes out.
    reportSilentError('notificationThumbnail: no preview available', error);
    return null;
  }
};
