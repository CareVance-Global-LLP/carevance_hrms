import { describe, expect, it, vi, beforeEach } from 'vitest';

const getThumbnail = vi.fn();
const getGroupThumbnail = vi.fn();

vi.mock('@/services/api', () => ({
  chatApi: {
    getThumbnail: (...a: unknown[]) => getThumbnail(...a),
    getGroupThumbnail: (...a: unknown[]) => getGroupThumbnail(...a),
  },
}));

import { resolveNotificationThumbnail, resetThumbnailCache } from '@/lib/notificationThumbnail';
import type { AppNotificationItem } from '@/types';

const notification = (attachment: Record<string, unknown> | null): AppNotificationItem =>
  ({ id: 1, type: 'chat_direct_message', title: 't', message: 'm', is_read: false, meta: attachment ? { attachment } : {} }) as unknown as AppNotificationItem;

// A 1x1 JPEG is enough: the resolver cares about the type prefix, not pixels.
const jpegBlob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

describe('notification thumbnails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetThumbnailCache();
    getThumbnail.mockResolvedValue({ data: jpegBlob() });
    getGroupThumbnail.mockResolvedValue({ data: jpegBlob() });
  });

  it('returns a data URL for an image attachment', async () => {
    const result = await resolveNotificationThumbnail(
      notification({ message_id: 12, thread: 'direct', kind: 'photo', has_thumbnail: true })
    );

    expect(result).toMatch(/^data:image\//);
    expect(getThumbnail).toHaveBeenCalledWith(12);
  });

  it('uses the group route for a group message', async () => {
    await resolveNotificationThumbnail(
      notification({ message_id: 5, thread: 'group', kind: 'photo', has_thumbnail: true })
    );

    expect(getGroupThumbnail).toHaveBeenCalledWith(5);
    expect(getThumbnail).not.toHaveBeenCalled();
  });

  /**
   * Most notifications are not chat, most chat has no attachment, and most
   * attachments are not images. Null must be cheap and silent — not a request.
   */
  it('does not call the API when there is no preview to fetch', async () => {
    expect(await resolveNotificationThumbnail(notification(null))).toBeNull();
    expect(await resolveNotificationThumbnail(
      notification({ message_id: 3, thread: 'direct', kind: 'document', has_thumbnail: false })
    )).toBeNull();

    expect(getThumbnail).not.toHaveBeenCalled();
  });

  /**
   * A failed preview must never stop the notification being raised — the
   * caller shows an icon instead.
   */
  it('returns null rather than throwing when the fetch fails', async () => {
    getThumbnail.mockRejectedValue(new Error('404'));

    const result = await resolveNotificationThumbnail(
      notification({ message_id: 9, thread: 'direct', kind: 'photo', has_thumbnail: true })
    );

    expect(result).toBeNull();
  });

  it('fetches a given message only once', async () => {
    const item = notification({ message_id: 77, thread: 'direct', kind: 'photo', has_thumbnail: true });

    await resolveNotificationThumbnail(item);
    await resolveNotificationThumbnail(item);

    expect(getThumbnail).toHaveBeenCalledTimes(1);
  });

  it('ignores an empty response rather than showing a blank image', async () => {
    getThumbnail.mockResolvedValue({ data: new Blob([], { type: 'image/jpeg' }) });

    const result = await resolveNotificationThumbnail(
      notification({ message_id: 21, thread: 'direct', kind: 'photo', has_thumbnail: true })
    );

    expect(result).toBeNull();
  });
});
