import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { groupApi, notificationApi, userApi } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { CHAT_NOTIFICATION_TYPES, isChatNotification } from '@/lib/chatNotifications';
import { canOpenNotificationFromCenter, getNotificationDisplay, resolveNotificationRoute } from '@/lib/notificationDisplay';
import { hasAdminAccess } from '@/lib/permissions';
import { formatDateTime } from '@/lib/dateTime';
import { DEFAULT_APP_TIMEZONE } from '@/lib/timezones';
import type { AppNotificationItem, PollResultsResponse } from '@/types';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import SearchSuggestInput from '@/components/ui/SearchSuggestInput';
import { FeedbackBanner, PageEmptyState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, TextInput, TextareaInput } from '@/components/ui/FormField';
import { buildSearchSuggestions, getSuggestionDisplayValue, matchesSearchFilter, normalizeSearchValue } from '@/lib/searchSuggestions';
import { BellRing, Check, Send } from 'lucide-react';

export default function NotificationsCenter() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const viewerTimezone = (user?.settings as any)?.timezone || DEFAULT_APP_TIMEZONE;
  const isAdmin = hasAdminAccess(user);
  const [notifications, setNotifications] = useState<AppNotificationItem[]>([]);
  const [users, setUsers] = useState<Array<{ id: number; name: string; email: string; groups?: Array<{ id: number; name: string }> }>>([]);
  const [groups, setGroups] = useState<Array<{ id: number; name: string; slug: string }>>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [query, setQuery] = useState('');
  const [selectedNotificationId, setSelectedNotificationId] = useState<number | null>(null);
  const [publishType, setPublishType] = useState<'announcement' | 'news' | 'poll'>('announcement');
  const [publishPriority, setPublishPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [publishTitle, setPublishTitle] = useState('');
  const [publishMessage, setPublishMessage] = useState('');
  const [publishPollQuestion, setPublishPollQuestion] = useState('');
  const [publishPollOptions, setPublishPollOptions] = useState<string[]>(['', '']);
  const [publishPollMultipleChoice, setPublishPollMultipleChoice] = useState(false);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<number[]>([]);
  const [recipientSearchQuery, setRecipientSearchQuery] = useState('');
  const [selectedPollNotificationId, setSelectedPollNotificationId] = useState<number | null>(null);
  const [pollResults, setPollResults] = useState<PollResultsResponse | null>(null);
  const [selectedOptionIds, setSelectedOptionIds] = useState<number[]>([]);
  const [isVotingLoading, setIsVotingLoading] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const [notificationResponse, usersResponse, groupsResponse] = await Promise.all([
        notificationApi.list({
          limit: 100,
          type: typeFilter || undefined,
          exclude_types: CHAT_NOTIFICATION_TYPES,
          unread_only: statusFilter === 'unread' ? true : undefined,
        }),
        isAdmin ? userApi.getAll({ period: 'all' }) : Promise.resolve({ data: [] }),
        isAdmin ? groupApi.getAll() : Promise.resolve({ data: [] }),
      ]);

      let nextNotifications = (notificationResponse.data?.data || []).filter((item: AppNotificationItem) => !isChatNotification(item));
      if (statusFilter === 'read') {
        nextNotifications = nextNotifications.filter((item) => item.is_read);
      }

      setNotifications(nextNotifications);
      setUsers((usersResponse.data || []).map((item: any) => ({ 
        id: item.id, 
        name: item.name, 
        email: item.email,
        groups: item.groups || []
      })));
      setGroups(((groupsResponse as any).data?.data || []).map((item: any) => ({ 
        id: item.id, 
        name: item.name, 
        slug: item.slug 
      })));
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to load notifications.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [typeFilter, statusFilter]);

  const filteredNotifications = useMemo(
    () =>
      notifications.filter((item) => {
        if (selectedNotificationId) {
          return Number(item.id) === Number(selectedNotificationId);
        }

        return matchesSearchFilter(query, [item.title, item.message, item.type]);
      }),
    [notifications, query, selectedNotificationId]
  );
  const unreadCount = useMemo(() => filteredNotifications.filter((item) => !item.is_read).length, [filteredNotifications]);
  const notificationSearchSuggestions = useMemo(
    () =>
      buildSearchSuggestions(notifications, (item) => ({
        id: item.id,
        label: item.title,
        description: item.message,
        keywords: [item.type],
        payload: item,
      })),
    [notifications]
  );
  const filteredRecipients = useMemo(() => {
    let filtered = users;
    
    // Filter by selected group/department
    if (selectedGroupId) {
      filtered = filtered.filter((recipient) => 
        recipient.groups?.some((group) => group.id === selectedGroupId)
      );
    }
    
    // Filter by search query
    const normalizedQuery = recipientSearchQuery.trim();
    if (normalizedQuery) {
      filtered = filtered.filter((recipient) => matchesSearchFilter(normalizedQuery, [recipient.name, recipient.email]));
    }
    
    return filtered;
  }, [recipientSearchQuery, users, selectedGroupId]);
  const selectedRecipientCount = selectedRecipientIds.length;

  const selectedPollNotification = useMemo(
    () => notifications.find((item) => Number(item.id) === Number(selectedPollNotificationId)) ?? null,
    [notifications, selectedPollNotificationId]
  );

  const markRead = async (id: number) => {
    try {
      await notificationApi.markRead(id);
      setNotifications((prev) => prev.map((item) => (item.id === id ? { ...item, is_read: true } : item)));
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to mark notification as read.' });
    }
  };

  const openNotification = async (item: AppNotificationItem) => {
    if (item.type === 'poll' && item.poll?.id) {
      setSelectedPollNotificationId(Number(item.id));
      setSelectedOptionIds([]);
      setPollResults(null);
      try {
        const res = await notificationApi.getPollResults(item.poll.id);
        setPollResults(res.data);
      } catch (error: any) {
        setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to load poll results.' });
      }
      if (!item.is_read) {
        await markRead(item.id);
      }
      return;
    }
    navigate(resolveNotificationRoute(item, user));
    if (!item.is_read) {
      await markRead(item.id);
    }
  };

  const closePoll = () => {
    setSelectedPollNotificationId(null);
    setPollResults(null);
    setSelectedOptionIds([]);
  };

  const togglePollOption = (optionId: number) => {
    setSelectedOptionIds((prev) => {
      const multiple = selectedPollNotification?.poll?.is_multiple_choice ?? false;
      if (multiple) {
        return prev.includes(optionId)
          ? prev.filter((id) => id !== optionId)
          : [...prev, optionId];
      }
      return [optionId];
    });
  };

  const submitVote = async () => {
    const poll = selectedPollNotification?.poll;
    if (!poll) return;
    if (selectedOptionIds.length === 0) {
      setFeedback({ tone: 'error', message: 'Please select an option before voting.' });
      return;
    }
    setIsVotingLoading(true);
    try {
      await notificationApi.votePoll(poll.id, selectedOptionIds);
      const res = await notificationApi.getPollResults(poll.id);
      setPollResults(res.data);
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === selectedPollNotification?.id && n.poll
            ? {
                ...n,
                poll: {
                  ...n.poll,
                  options: (n.poll.options ?? []).map((o) => ({
                    ...o,
                    has_voted: selectedOptionIds.includes(o.id) ? true : o.has_voted,
                  })),
                },
              }
            : n,
        ),
      );
      setFeedback({ tone: 'success', message: 'Vote recorded.' });
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to submit vote.' });
    } finally {
      setIsVotingLoading(false);
    }
  };

  const markAllRead = async () => {
    try {
      await notificationApi.markAllRead({ exclude_types: CHAT_NOTIFICATION_TYPES });
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
      setFeedback({ tone: 'success', message: 'All notifications marked as read.' });
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to mark notifications as read.' });
    }
  };

  const publish = async () => {
    if (publishType === 'poll') {
      if (!publishPollQuestion.trim()) {
        setFeedback({ tone: 'error', message: 'Question is required for polls.' });
        return;
      }
      const validOptions = publishPollOptions.filter(opt => opt.trim() !== '');
      if (validOptions.length < 2) {
        setFeedback({ tone: 'error', message: 'Polls must have at least 2 options.' });
        return;
      }
    } else {
      if (!publishTitle.trim() || !publishMessage.trim()) {
        setFeedback({ tone: 'error', message: 'Title and message are required to publish a notification.' });
        return;
      }
    }

    try {
      if (publishType === 'poll') {
        await notificationApi.publish({
          type: 'poll',
          title: '',
          message: '',
          question: publishPollQuestion.trim(),
          options: publishPollOptions.filter(opt => opt.trim()),
          is_multiple_choice: publishPollMultipleChoice,
          recipient_user_ids: selectedRecipientIds.length > 0 ? selectedRecipientIds : undefined,
        });
        setPublishPollQuestion('');
        setPublishPollOptions(['', '']);
        setPublishPollMultipleChoice(false);
      } else {
        await notificationApi.publish({
          type: publishType,
          title: publishTitle.trim(),
          message: publishMessage.trim(),
          priority: publishType === 'announcement' ? publishPriority : undefined,
          recipient_user_ids: selectedRecipientIds.length > 0 ? selectedRecipientIds : undefined,
        });
        setPublishTitle('');
        setPublishMessage('');
      }
      setSelectedRecipientIds([]);
      setFeedback({ tone: 'success', message: 'Notification published successfully.' });
      await load();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to publish notification.' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Communication"
        title="Notifications Center"
        description="Track salary alerts, announcements, and internal updates with proper read state and search."
        actions={
          <div className="flex gap-2">
            <Button onClick={markAllRead} variant="secondary">Mark all read</Button>
            <Button onClick={load} variant="secondary">Refresh</Button>
          </div>
        }
      />

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SurfaceCard className="p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-sky-100 p-3 text-sky-700"><BellRing className="h-5 w-5" /></div>
            <div>
              <p className="text-sm text-slate-500">Visible notifications</p>
              <p className="text-2xl font-semibold text-slate-950">{filteredNotifications.length}</p>
            </div>
          </div>
        </SurfaceCard>
        <SurfaceCard className="p-5">
          <p className="text-sm text-slate-500">Unread</p>
          <p className="text-2xl font-semibold text-slate-950">{unreadCount}</p>
        </SurfaceCard>
        <SurfaceCard className="p-5">
          <p className="text-sm text-slate-500">Filters</p>
          <p className="text-sm font-medium text-slate-950">
            {statusFilter === 'all' ? 'All statuses' : statusFilter === 'unread' ? 'Unread only' : 'Read only'}
            {typeFilter ? ` - ${typeFilter}` : ''}
          </p>
        </SurfaceCard>
      </div>

      <SurfaceCard className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <FieldLabel>Search</FieldLabel>
            <SearchSuggestInput
              value={query}
              onValueChange={(value) => {
                setQuery(value);

                const selectedNotificationTitle =
                  notifications.find((item) => Number(item.id) === Number(selectedNotificationId))?.title || '';

                if (!value.trim() || normalizeSearchValue(value) !== normalizeSearchValue(selectedNotificationTitle)) {
                  setSelectedNotificationId(null);
                }
              }}
              onSuggestionSelect={(suggestion) => {
                const nextNotificationId = Number((suggestion.payload as AppNotificationItem | undefined)?.id || suggestion.id || 0);
                setQuery(getSuggestionDisplayValue(suggestion));
                setSelectedNotificationId(Number.isFinite(nextNotificationId) && nextNotificationId > 0 ? nextNotificationId : null);
              }}
              suggestions={notificationSearchSuggestions}
              placeholder="Search title or message"
              emptyMessage="No notification titles match this search."
            />
          </div>
          <div>
            <FieldLabel>Type</FieldLabel>
            <SelectInput value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="">All types</option>
              <option value="announcement">Announcement</option>
              <option value="news">News</option>
              <option value="poll">Poll</option>
            </SelectInput>
          </div>
          <div>
            <FieldLabel>Status</FieldLabel>
            <SelectInput value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | 'unread' | 'read')}>
              <option value="all">All</option>
              <option value="unread">Unread</option>
              <option value="read">Read</option>
            </SelectInput>
          </div>
        </div>
      </SurfaceCard>

      {isAdmin ? (
        <SurfaceCard className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Publish update</h2>
              <p className="text-sm text-slate-500">Send organization-wide news or a targeted announcement.</p>
            </div>
            <Button onClick={publish}>
              <Send className="h-4 w-4" />
              Publish
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div>
              <FieldLabel>Type</FieldLabel>
              <SelectInput value={publishType} onChange={(event) => setPublishType(event.target.value as 'announcement' | 'news' | 'poll')}>
                <option value="announcement">Announcement</option>
                <option value="news">News</option>
                <option value="poll">Poll</option>
              </SelectInput>
            </div>
            {publishType === 'announcement' && (
              <div>
                <FieldLabel>Priority</FieldLabel>
                <SelectInput value={publishPriority} onChange={(event) => setPublishPriority(event.target.value as 'low' | 'medium' | 'high' | 'urgent')}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </SelectInput>
              </div>
            )}
            <div>
              <FieldLabel>Title</FieldLabel>
              <TextInput value={publishTitle} onChange={(event) => setPublishTitle(event.target.value)} placeholder="Title" />
            </div>
          </div>

          {publishType === 'poll' ? (
            <div className="mt-4">
              <FieldLabel>Question</FieldLabel>
              <TextInput
                value={publishPollQuestion}
                onChange={(event) => setPublishPollQuestion(event.target.value)}
                placeholder="What would you like to ask?"
                maxLength={255}
              />
            </div>
          ) : (
            <div className="mt-4">
              <FieldLabel>Message</FieldLabel>
              <TextareaInput value={publishMessage} onChange={(event) => setPublishMessage(event.target.value)} rows={4} placeholder="Write the update you want employees to receive." />
            </div>
          )}

          {publishType === 'poll' && (
            <>
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <FieldLabel>Options</FieldLabel>
                  {publishPollOptions.length < 12 && (
                    <button
                      type="button"
                      onClick={() => setPublishPollOptions([...publishPollOptions, ''])}
                      className="text-sm text-blue-600 font-medium"
                    >
                      + Add Option
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {publishPollOptions.map((opt, index) => (
                    <div key={index} className="flex gap-2">
                      <TextInput
                        value={opt}
                        onChange={(event) => setPublishPollOptions(publishPollOptions.map((o, i) => i === index ? event.target.value : o))}
                        placeholder={`Option ${index + 1}`}
                        maxLength={255}
                      />
                      {publishPollOptions.length > 2 && (
                        <button
                          type="button"
                          onClick={() => setPublishPollOptions(publishPollOptions.filter((_, i) => i !== index))}
                          className="px-2 text-red-600"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <label className="flex items-center gap-2 mt-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={publishPollMultipleChoice}
                    onChange={(event) => setPublishPollMultipleChoice(event.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-slate-600">Allow multiple selections</span>
                </label>
              </div>
            </>
          )}

          <div className="mt-4">
            <FieldLabel>Recipients</FieldLabel>
            <div className="space-y-3 rounded-lg border border-slate-200 p-3">
              {groups.length > 0 && (
                <div>
                  <SelectInput 
                    value={selectedGroupId || ''} 
                    onChange={(event) => {
                      const value = event.target.value;
                      setSelectedGroupId(value ? Number(value) : null);
                    }}
                  >
                    <option value="">All departments</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>{group.name}</option>
                    ))}
                  </SelectInput>
                </div>
              )}
              
              <TextInput
                value={recipientSearchQuery}
                onChange={(event) => setRecipientSearchQuery(event.target.value)}
                placeholder="Search recipient by name or email"
              />
              
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  Showing <span className="font-semibold text-slate-700">{filteredRecipients.length}</span> of {users.length}
                </span>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                  Selected <span className="font-semibold">{selectedRecipientCount}</span>
                </span>
                {filteredRecipients.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedRecipientIds((prev) => Array.from(new Set([...prev, ...filteredRecipients.map((recipient) => recipient.id)])));
                    }}
                    className="rounded-full border border-slate-200 px-3 py-1 font-medium text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
                  >
                    Select shown
                  </button>
                ) : null}
                {selectedRecipientCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSelectedRecipientIds([])}
                    className="rounded-full border border-slate-200 px-3 py-1 font-medium text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
                  >
                    Clear selected
                  </button>
                ) : null}
              </div>
              
              <div className="max-h-44 overflow-auto">
              {users.length === 0 ? (
                <p className="text-sm text-slate-500">All users in your organization will receive this update.</p>
              ) : !selectedGroupId && !recipientSearchQuery ? (
                <p className="text-sm text-slate-500 text-center py-4">
                  Select a department or search by name/email to see recipients.<br />
                  <span className="text-xs">Leave empty to publish to the entire organization.</span>
                </p>
              ) : filteredRecipients.length === 0 ? (
                <p className="text-sm text-slate-500">No recipients match your filters. Try a different department or search term.</p>
              ) : (
                filteredRecipients.map((recipient) => (
                  <label key={recipient.id} className="flex items-center gap-2 py-1 text-sm text-slate-700 hover:bg-slate-50 px-2 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedRecipientIds.includes(recipient.id)}
                      onChange={(event) => {
                        setSelectedRecipientIds((prev) =>
                          event.target.checked ? [...prev, recipient.id] : prev.filter((id) => id !== recipient.id)
                        );
                      }}
                    />
                    <span className="flex-1">{recipient.name}</span>
                    <span className="text-xs text-slate-400">{recipient.email}</span>
                    {recipient.groups && recipient.groups.length > 0 && (
                      <span className="text-xs text-slate-400">{recipient.groups.map(g => g.name).join(', ')}</span>
                    )}
                  </label>
                ))
              )}
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {selectedRecipientCount > 0 
                ? `Will be sent to ${selectedRecipientCount} selected recipient${selectedRecipientCount === 1 ? '' : 's'}.`
                : 'Will be sent to all users in your organization.'
              }
            </p>
          </div>
        </SurfaceCard>
      ) : null}

      {isLoading ? (
        <PageLoadingState label="Loading notifications..." />
      ) : filteredNotifications.length === 0 ? (
        <PageEmptyState title="No notifications found" description="Try a different filter or wait for the next update." />
      ) : (
        <div className="space-y-3">
          {filteredNotifications.map((item) => (
            <Fragment key={item.id}>
            <SurfaceCard
              className={`p-5 ${item.is_read ? '' : 'border-sky-200 bg-sky-50/40'} ${canOpenNotificationFromCenter(item, user) ? 'cursor-pointer transition hover:border-sky-200 hover:bg-sky-50/50' : ''}`}
              onClick={canOpenNotificationFromCenter(item, user) ? () => void openNotification(item) : undefined}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  {(() => {
                    const notificationDisplay = getNotificationDisplay(item.type);

                    return (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-500">{notificationDisplay.icon}</span>
                        <StatusBadge tone={notificationDisplay.tone} className="gap-1 tracking-[0.14em]">
                          {notificationDisplay.label}
                        </StatusBadge>
                        {!item.is_read ? (
                          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700">Unread</span>
                        ) : null}
                        <span className="text-xs text-slate-500">{formatDateTime(item.created_at, viewerTimezone)}</span>
                      </div>
                    );
                  })()}
                  <h2 className="text-lg font-semibold text-slate-950">{item.title}</h2>
                  {item.type !== 'poll' && <p className="text-sm text-slate-600">{item.message}</p>}
                  {item.sender ? (
                    <p className="text-xs text-slate-500">Sent by {item.sender.name}</p>
                  ) : null}
                </div>

                <div className="flex gap-2">
                  {canOpenNotificationFromCenter(item, user) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        void openNotification(item);
                      }}
                    >
                      Review
                    </Button>
                  ) : null}
                  {!item.is_read ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        void markRead(item.id);
                      }}
                    >
                      Mark read
                    </Button>
                  ) : null}
                </div>
              </div>
            </SurfaceCard>
            {selectedPollNotificationId === Number(item.id) && selectedPollNotification?.poll && (() => {
              const poll = selectedPollNotification.poll!;
              const options = pollResults?.data ?? poll.options ?? [];
              const totalVotes =
                pollResults?.total_votes ??
                options.reduce((sum, o) => sum + (o.vote_count || 0), 0);
              const isMultiple = pollResults?.is_multiple_choice ?? poll.is_multiple_choice ?? false;
              const isExpired = pollResults?.has_expired ?? false;
              const hasVoted = options.some((o) => o.has_voted);
              const closed = isExpired || hasVoted;

              return (
                <SurfaceCard className="mt-4 border-teal-200 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Poll</p>
                      <h2 className="mt-0.5 text-base font-semibold text-slate-950">{poll.question}</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          isExpired ? 'bg-slate-100 text-slate-500' : hasVoted ? 'bg-teal-100 text-teal-700' : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {isExpired ? 'Closed' : hasVoted ? 'Voted' : 'Open'}
                      </span>
                      <Button size="sm" variant="ghost" onClick={closePoll}>Close</Button>
                    </div>
                  </div>

                  {selectedPollNotification.message && (
                    <p className="mt-2 text-sm text-slate-600">{selectedPollNotification.message}</p>
                  )}

                  <div className="mt-4 space-y-2">
                    {options.map((option) => {
                      const isSelected = selectedOptionIds.includes(option.id);
                      const pct = totalVotes > 0 ? Math.round(((option.vote_count || 0) / totalVotes) * 100) : 0;
                      if (closed) {
                        return (
                          <div key={option.id} className="rounded-lg border border-slate-200 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                                {option.has_voted && <Check className="h-4 w-4 text-teal-600" />}
                                {option.option_text}
                              </span>
                              <span className="text-xs text-slate-400">{option.vote_count || 0} · {pct}%</span>
                            </div>
                            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      }
                      return (
                        <label
                          key={option.id}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm text-slate-800 transition ${
                            isSelected ? 'border-teal-400 bg-teal-50' : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <input
                            type={isMultiple ? 'checkbox' : 'radio'}
                            name={`poll-${poll.id}`}
                            checked={isSelected}
                            onChange={() => togglePollOption(option.id)}
                            className="h-4 w-4"
                          />
                          <span className="flex-1">{option.option_text}</span>
                        </label>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs text-slate-400">
                      {totalVotes} vote{totalVotes === 1 ? '' : 's'}
                      {isMultiple ? ' · multiple choice' : ''}
                      {poll.expires_at ? ` · closes ${new Date(poll.expires_at).toLocaleString()}` : ''}
                    </p>
                    {!closed && (
                      <Button onClick={submitVote} disabled={isVotingLoading || selectedOptionIds.length === 0}>
                        {isVotingLoading ? 'Submitting…' : 'Vote'}
                      </Button>
                    )}
                  </div>
                </SurfaceCard>
              );
            })()}
            </Fragment>
          ))}
        </div>
      )}

    </div>
  );
}