import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { groupApi, notificationApi, userApi } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { CHAT_NOTIFICATION_TYPES, isChatNotification } from '@/lib/chatNotifications';
import { canOpenNotificationFromCenter, resolveNotificationRoute } from '@/lib/notificationDisplay';
import { hasAdminAccess } from '@/lib/permissions';
import { DEFAULT_APP_TIMEZONE } from '@/lib/timezones';
import { matchesSearchFilter } from '@/lib/searchSuggestions';
import type { AppNotificationItem } from '@/types';
import Button from '@/components/ui/Button';
import { SelectInput } from '@/components/ui/FormField';
import { FeedbackBanner, PageEmptyState, PageLoadingState } from '@/components/ui/PageState';
import AnnouncementRow from '@/features/announcements/AnnouncementRow';
import ComposeDrawer, { emptyCompose, type ComposeState } from '@/features/announcements/ComposeDrawer';
import PollPanel from '@/features/announcements/PollPanel';
import type { DeliveryStat } from '@/features/announcements/announcementUtils';
import { LIST_PAGE_SIZE } from '@/lib/pagination';

const PAGE_SIZE = LIST_PAGE_SIZE;

/**
 * Announcements — what the nav has always called this page, and what people
 * call the thing. It described itself as "Notifications Center", which names
 * the table it reads from rather than the job it does.
 */
export default function NotificationsCenter() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const viewerTimezone = (user?.settings as any)?.timezone || DEFAULT_APP_TIMEZONE;
  const isAdmin = hasAdminAccess(user);

  const [notifications, setNotifications] = useState<AppNotificationItem[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [users, setUsers] = useState<Array<{ id: number; name: string; email: string; groups?: Array<{ id: number; name: string }> }>>([]);
  const [groups, setGroups] = useState<Array<{ id: number; name: string }>>([]);
  const [delivery, setDelivery] = useState<Record<string, DeliveryStat>>({});

  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);

  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeState>(emptyCompose);
  const [isPublishing, setIsPublishing] = useState(false);
  const [openPoll, setOpenPoll] = useState<AppNotificationItem | null>(null);

  const notifyError = useCallback((message: string) => setFeedback({ tone: 'error', message }), []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [notificationResponse, usersResponse, groupsResponse] = await Promise.all([
        notificationApi.list({
          limit,
          type: typeFilter || undefined,
          exclude_types: CHAT_NOTIFICATION_TYPES,
          unread_only: statusFilter === 'unread' ? true : undefined,
        }),
        isAdmin ? userApi.getAll({ period: 'all' }) : Promise.resolve({ data: [] }),
        isAdmin ? groupApi.getAll() : Promise.resolve({ data: [] }),
      ]);

      const rows = (notificationResponse.data?.data || []).filter(
        (item: AppNotificationItem) => !isChatNotification(item)
      );

      setHasMore(rows.length >= limit);
      setNotifications(statusFilter === 'read' ? rows.filter((item) => item.is_read) : rows);
      // The server counts unread across everything, not just the page in view.
      // Deriving it from the filtered list made the total drop while you typed.
      setUnreadTotal(Number(notificationResponse.data?.unread_count || 0));

      setUsers(
        (usersResponse.data || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          email: item.email,
          groups: item.groups || [],
        }))
      );
      setGroups(((groupsResponse as any).data?.data || []).map((item: any) => ({ id: item.id, name: item.name })));
    } catch (error: any) {
      notifyError(error?.response?.data?.message || 'Failed to load announcements.');
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin, limit, notifyError, statusFilter, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Read-through counts for announcements this viewer sent. Rows published
  // before broadcast ids existed carry none and simply show no meter.
  useEffect(() => {
    if (!isAdmin || !user?.id) return;
    const ids = Array.from(
      new Set(
        notifications
          .filter((item) => item.broadcast_id && item.sender?.id === user.id)
          .map((item) => String(item.broadcast_id))
      )
    ).slice(0, 100);

    if (ids.length === 0) return;

    let cancelled = false;
    notificationApi
      .deliveryStats(ids)
      .then((response) => {
        if (cancelled) return;
        const next: Record<string, DeliveryStat> = {};
        (response.data?.data || []).forEach((row) => {
          next[row.broadcast_id] = { total: row.total, read: row.read };
        });
        setDelivery(next);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [notifications, isAdmin, user?.id]);

  const visible = useMemo(
    () => notifications.filter((item) => matchesSearchFilter(query, [item.title, item.message, item.type, item.poll?.question])),
    [notifications, query]
  );

  const markRead = async (id: number) => {
    try {
      await notificationApi.markRead(id);
      setNotifications((previous) => previous.map((item) => (item.id === id ? { ...item, is_read: true } : item)));
      setUnreadTotal((current) => Math.max(0, current - 1));
    } catch (error: any) {
      notifyError(error?.response?.data?.message || 'Failed to mark as read.');
    }
  };

  const markAllRead = async () => {
    try {
      await notificationApi.markAllRead({ exclude_types: CHAT_NOTIFICATION_TYPES });
      setNotifications((previous) => previous.map((item) => ({ ...item, is_read: true })));
      setUnreadTotal(0);
      setFeedback({ tone: 'success', message: 'Everything marked as read.' });
    } catch (error: any) {
      notifyError(error?.response?.data?.message || 'Failed to mark as read.');
    }
  };

  const openRoute = (item: AppNotificationItem) => {
    navigate(resolveNotificationRoute(item, user));
    if (!item.is_read) void markRead(item.id);
  };

  const openPollPanel = (item: AppNotificationItem) => {
    setOpenPoll(item);
    if (!item.is_read) void markRead(item.id);
  };

  const publish = async () => {
    if (isPublishing) return;
    setIsPublishing(true);
    try {
      if (compose.type === 'poll') {
        await notificationApi.publish({
          type: 'poll',
          title: '',
          message: '',
          question: compose.question.trim(),
          options: compose.options.map((option) => option.trim()).filter(Boolean),
          is_multiple_choice: compose.isMultipleChoice,
          recipient_user_ids: compose.recipientIds.length > 0 ? compose.recipientIds : undefined,
        });
      } else {
        await notificationApi.publish({
          type: compose.type,
          title: compose.title.trim(),
          message: compose.message.trim(),
          priority: compose.type === 'announcement' ? compose.priority : undefined,
          recipient_user_ids: compose.recipientIds.length > 0 ? compose.recipientIds : undefined,
        });
      }
      setCompose(emptyCompose());
      setComposeOpen(false);
      setFeedback({ tone: 'success', message: 'Published.' });
      await load();
    } catch (error: any) {
      notifyError(error?.response?.data?.message || 'Failed to publish.');
    } finally {
      setIsPublishing(false);
    }
  };

  const pollCount = visible.filter((item) => item.type === 'poll').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">Announcements</h1>
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-700">{visible.length}</span> shown
          {unreadTotal > 0 ? (
            <>
              {' · '}
              <span className="font-medium text-blue-700">{unreadTotal}</span> unread
            </>
          ) : null}
          {pollCount > 0 ? <> · {pollCount} poll{pollCount === 1 ? '' : 's'}</> : null}
        </p>
      </div>

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search announcements"
            placeholder="Search announcements..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-10 w-full rounded-lg border border-slate-200 bg-surface-card pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-600 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </div>

        <SelectInput className="w-36" aria-label="Filter by type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="">All types</option>
          <option value="announcement">Announcement</option>
          <option value="news">News</option>
          <option value="poll">Poll</option>
        </SelectInput>

        <SelectInput
          className="w-32"
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as 'all' | 'unread' | 'read')}
        >
          <option value="all">All</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </SelectInput>

        {unreadTotal > 0 ? (
          <Button variant="ghost" size="sm" onClick={markAllRead}>
            Mark all read
          </Button>
        ) : null}

        {isAdmin ? (
          <Button
            size="sm"
            iconLeft={<Plus className="h-4 w-4" />}
            onClick={() => {
              setCompose(emptyCompose());
              setComposeOpen(true);
            }}
          >
            New announcement
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <PageLoadingState label="Loading announcements..." />
      ) : visible.length === 0 ? (
        <PageEmptyState
          title="Nothing here"
          description={query.trim() ? 'No announcement matches that search.' : 'Nothing has been published yet.'}
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-surface-card">
            {visible.map((item) => (
              <AnnouncementRow
                key={item.id}
                item={item}
                viewerTimezone={viewerTimezone}
                delivery={item.broadcast_id ? delivery[String(item.broadcast_id)] : undefined}
                onOpenPoll={openPollPanel}
                onMarkRead={(id) => void markRead(id)}
                onOpenRoute={openRoute}
                canOpenRoute={canOpenNotificationFromCenter(item, user) && item.type !== 'poll'}
              />
            ))}
          </div>

          {/* The limit used to be a hardcoded 100 with no way past it — older
              announcements simply stopped existing. */}
          {hasMore && !query.trim() ? (
            <div className="flex justify-center">
              <Button variant="secondary" size="sm" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                Load older
              </Button>
            </div>
          ) : null}
        </>
      )}

      {composeOpen && isAdmin ? (
        <ComposeDrawer
          state={compose}
          onChange={(patch) => setCompose((current) => ({ ...current, ...patch }))}
          onClose={() => setComposeOpen(false)}
          onPublish={() => void publish()}
          isPublishing={isPublishing}
          users={users}
          groups={groups}
        />
      ) : null}

      {openPoll ? (
        <PollPanel
          item={openPoll}
          onClose={() => setOpenPoll(null)}
          onVoted={() => void load()}
          notifyError={notifyError}
        />
      ) : null}
    </div>
  );
}
