import { ClipboardEvent, FormEvent, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import SearchSuggestInput from '@/components/ui/SearchSuggestInput';
import { useAuth } from '@/contexts/AuthContext';
import { buildEmployeeSearchSuggestions, getSuggestionDisplayValue, normalizeSearchValue, rankSearchSuggestions } from '@/lib/searchSuggestions';
import { chatApi } from '@/services/api';
import type { ChatConversation, ChatGroup, ChatGroupMessage, ChatMessage, ChatTypingUser } from '@/types';

type ThreadSelection =
  | { type: 'direct'; id: number }
  | { type: 'group'; id: number }
  | null;

type ChatFeedMessage = ChatMessage | ChatGroupMessage;
type MessageContextMenuState = {
  message: ChatFeedMessage;
  mine: boolean;
  x: number;
  y: number;
};


type MessageContextMenuLayout = {
  left: number;
  top: number;
  maxHeight: number;
};

const NORMALIZED_QUICK_REACTIONS = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F389}', '\u{1F62E}'];
const EMOJI_PICKER_GROUPS = [
  {
    label: 'Smileys',
    emojis: ['\u{1F600}', '\u{1F604}', '\u{1F601}', '\u{1F602}', '\u{1F923}', '\u{1F60A}', '\u{1F60D}', '\u{1F618}', '\u{1F60E}', '\u{1F914}', '\u{1F62D}', '\u{1F62E}'],
  },
  {
    label: 'Gestures',
    emojis: ['\u{1F44D}', '\u{1F44E}', '\u{1F44F}', '\u{1F64C}', '\u{1F64F}', '\u{1F44C}', '\u270C\uFE0F', '\u{1F91D}', '\u{1F4AA}', '\u{1F525}', '\u2705', '\u{1F440}'],
  },
  {
    label: 'Hearts',
    emojis: ['\u2764\uFE0F', '\u{1F9E1}', '\u{1F49B}', '\u{1F49A}', '\u{1F499}', '\u{1F49C}', '\u{1F90D}', '\u{1F5A4}', '\u{1F496}', '\u{1F4AF}', '\u2728', '\u{1F389}'],
  },
  {
    label: 'Work',
    emojis: ['\u{1F4CC}', '\u{1F4CE}', '\u{1F4E3}', '\u{1F4DD}', '\u{1F4AC}', '\u{1F4C5}', '\u23F0', '\u{1F680}', '\u{1F3AF}', '\u{1F91D}', '\u{1F4C8}', '\u{1F3C6}'],
  },
];

const calculateContextMenuLayout = (
  anchorX: number,
  anchorY: number,
  menuWidth: number,
  menuHeight: number
): MessageContextMenuLayout => {
  const margin = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const safeWidth = Math.min(menuWidth, viewportWidth - margin * 2);
  const safeHeight = Math.min(menuHeight, viewportHeight - margin * 2);
  const spaceAbove = anchorY - margin;
  const spaceBelow = viewportHeight - anchorY - margin;
  const shouldOpenBelow = spaceBelow >= safeHeight || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(260, shouldOpenBelow ? spaceBelow : spaceAbove);
  const left = Math.max(margin, Math.min(anchorX, viewportWidth - safeWidth - margin));
  const unclampedTop = shouldOpenBelow ? anchorY : anchorY - safeHeight;
  const top = Math.max(margin, Math.min(unclampedTop, viewportHeight - safeHeight - margin));

  return {
    left,
    top,
    maxHeight: Math.min(viewportHeight - margin * 2, maxHeight),
  };
};

const getThreadKey = (thread: ThreadSelection) => (thread ? `${thread.type}:${thread.id}` : '');

const MAX_CHAT_ATTACHMENT_BYTES = 200 * 1024 * 1024;
const EMAIL_TOKEN_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const URL_TOKEN_PATTERN = /^(https?:\/\/|www\.)[^\s<]+$/i;
const URL_OR_EMAIL_PATTERN = /((?:https?:\/\/|www\.)[^\s<]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;

const resolveLinkTarget = (token: string) => {
  if (EMAIL_TOKEN_PATTERN.test(token)) {
    return {
      href: `mailto:${token}`,
      label: token,
    };
  }

  const sanitized = token.replace(/[),.;!?]+$/, '');

  return {
    href: sanitized.startsWith('http://') || sanitized.startsWith('https://')
      ? sanitized
      : `https://${sanitized}`,
    label: sanitized,
  };
};

const isSameThread = (left: ThreadSelection, right: ThreadSelection) => (
  left?.type === right?.type && left?.id === right?.id
);

export default function Chat() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [availableUsers, setAvailableUsers] = useState<Array<{ id: number; name: string; email: string; role: string }>>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadSelection>(null);
  const [messages, setMessages] = useState<ChatFeedMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<ChatTypingUser[]>([]);
  const [startEmail, setStartEmail] = useState('');
  const [selectedStartUserId, setSelectedStartUserId] = useState<number | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState<number[]>([]);
  const [messageText, setMessageText] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingMessageText, setEditingMessageText] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [messageContextMenu, setMessageContextMenu] = useState<MessageContextMenuState | null>(null);
  const [messageContextMenuLayout, setMessageContextMenuLayout] = useState<MessageContextMenuLayout | null>(null);
  const [isDeletingMessage, setIsDeletingMessage] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [inlineAttachmentUrls, setInlineAttachmentUrls] = useState<Record<string, string>>({});
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messageContextMenuRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const pendingThreadRef = useRef<ThreadSelection>(null);
  const activeThreadKeyRef = useRef('');
  const openDirectRequestRef = useRef(0);

  const selectThread = (thread: ThreadSelection) => {
    activeThreadKeyRef.current = getThreadKey(thread);
    setSelectedThread(thread);
  };

  const selectedConversation = useMemo(
    () => (selectedThread?.type === 'direct' ? conversations.find((c) => c.id === selectedThread.id) || null : null),
    [conversations, selectedThread]
  );

  const selectedGroup = useMemo(
    () => (selectedThread?.type === 'group' ? groups.find((group) => group.id === selectedThread.id) || null : null),
    [groups, selectedThread]
  );

  const selectedThreadLabel = selectedThread?.type === 'group' ? 'group' : 'conversation';
  const selectedStartUser = useMemo(
    () => availableUsers.find((candidate) => Number(candidate.id) === Number(selectedStartUserId)) || null,
    [availableUsers, selectedStartUserId]
  );
  const availableUserSuggestions = useMemo(
    () => buildEmployeeSearchSuggestions(availableUsers),
    [availableUsers]
  );
  const persistedQuickReactions = NORMALIZED_QUICK_REACTIONS;
  const attachmentPreviewUrl = useMemo(() => {
    if (!attachmentFile || !attachmentFile.type.startsWith('image/')) {
      return null;
    }

    return URL.createObjectURL(attachmentFile);
  }, [attachmentFile]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 80;
  };

  const isGroupMessage = (message: ChatFeedMessage): message is ChatGroupMessage => 'group_id' in message;
  const getInlineAttachmentKey = (message: ChatFeedMessage) => `${isGroupMessage(message) ? 'group' : 'direct'}:${message.id}`;
  const isImageAttachment = (message: ChatFeedMessage) => (
    Boolean(message.has_attachment)
    && String(message.attachment_mime || '').toLowerCase().startsWith('image/')
  );

  const loadThreads = async () => {
    try {
      const [conversationResponse, groupResponse] = await Promise.all([
        chatApi.getConversations(),
        chatApi.getGroups(),
      ]);

      const nextConversations = conversationResponse.data || [];
      const nextGroups = groupResponse.data || [];
      setConversations(nextConversations);
      setGroups(nextGroups);

      const pendingThread = pendingThreadRef.current;
      if (
        pendingThread &&
        (
          (pendingThread.type === 'direct' && nextConversations.some((conversation) => conversation.id === pendingThread.id)) ||
          (pendingThread.type === 'group' && nextGroups.some((group) => group.id === pendingThread.id))
        )
      ) {
        pendingThreadRef.current = null;
      }

      return { conversations: nextConversations, groups: nextGroups };
    } catch (e) {
      console.error('Failed to load chat threads', e);
      return { conversations, groups };
    } finally {
      setIsLoading(false);
    }
  };

  const loadAvailableUsers = async () => {
    try {
      const response = await chatApi.getAvailableUsers();
      setAvailableUsers((response.data || []).filter((candidate) => Number(candidate.id) !== Number(user?.id)));
    } catch (e) {
      console.error('Failed to load chat users', e);
    }
  };

  const loadMessages = async (thread: ThreadSelection, sinceId?: number) => {
    if (!thread) {
      setMessages([]);
      return;
    }

    const threadKey = getThreadKey(thread);

    try {
      const response = thread.type === 'direct'
        ? await chatApi.getMessages(thread.id, sinceId ? { since_id: sinceId } : undefined)
        : await chatApi.getGroupMessages(thread.id, sinceId ? { since_id: sinceId } : undefined);

      if (activeThreadKeyRef.current !== threadKey) {
        return;
      }

      const incoming = response.data || [];
      if (!sinceId) {
        setMessages(incoming);
      } else if (incoming.length > 0) {
        setMessages((prev) => [...prev, ...incoming]);
      }

      if (thread.type === 'direct') {
        await chatApi.markRead(thread.id);
        if (activeThreadKeyRef.current === threadKey) {
          setConversations((prev) => prev.map((conversation) => (
            conversation.id === thread.id ? { ...conversation, unread_count: 0 } : conversation
          )));
        }
      } else {
        await chatApi.markGroupRead(thread.id);
        if (activeThreadKeyRef.current === threadKey) {
          setGroups((prev) => prev.map((group) => (
            group.id === thread.id ? { ...group, unread_count: 0 } : group
          )));
        }
      }
    } catch (e) {
      console.error(`Failed to load ${thread.type} messages`, e);
    }
  };

  const loadTyping = async (thread: ThreadSelection) => {
    if (!thread) {
      setTypingUsers([]);
      return;
    }

    const threadKey = getThreadKey(thread);

    try {
      const response = thread.type === 'direct'
        ? await chatApi.getTyping(thread.id)
        : await chatApi.getGroupTyping(thread.id);
      if (activeThreadKeyRef.current === threadKey) {
        setTypingUsers(response.data || []);
      }
    } catch {
      if (activeThreadKeyRef.current === threadKey) {
        setTypingUsers([]);
      }
    }
  };

  useEffect(() => {
    loadThreads();

    const interval = setInterval(loadThreads, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (user?.id) {
      loadAvailableUsers();
    }
  }, [user?.id]);

  useEffect(() => {
    const threadType = searchParams.get('threadType');
    const threadId = Number(searchParams.get('threadId') || 0);
    const requestedThread = threadType === 'direct' || threadType === 'group'
      ? { type: threadType, id: threadId }
      : null;

    setSelectedThread((currentThread) => {
      if (threadType === 'direct' && threadId > 0 && conversations.some((conversation) => conversation.id === threadId)) {
        const nextThread = { type: 'direct' as const, id: threadId };
        activeThreadKeyRef.current = getThreadKey(nextThread);
        return isSameThread(currentThread, nextThread) ? currentThread : nextThread;
      }

      if (threadType === 'group' && threadId > 0 && groups.some((group) => group.id === threadId)) {
        const nextThread = { type: 'group' as const, id: threadId };
        activeThreadKeyRef.current = getThreadKey(nextThread);
        return isSameThread(currentThread, nextThread) ? currentThread : nextThread;
      }

      if (currentThread) {
        const exists = currentThread.type === 'direct'
          ? conversations.some((conversation) => conversation.id === currentThread.id)
          : groups.some((group) => group.id === currentThread.id);

        if (exists) {
          activeThreadKeyRef.current = getThreadKey(currentThread);
          return currentThread;
        }

        // Keep the current selection while thread data is catching up instead of
        // snapping back to the first conversation and causing the UI to flicker.
        if (
          requestedThread &&
          requestedThread.id > 0 &&
          requestedThread.type === currentThread.type &&
          requestedThread.id === currentThread.id
        ) {
          activeThreadKeyRef.current = getThreadKey(currentThread);
          return currentThread;
        }

        const pendingThread = pendingThreadRef.current;
        if (
          pendingThread &&
          pendingThread.type === currentThread.type &&
          pendingThread.id === currentThread.id
        ) {
          activeThreadKeyRef.current = getThreadKey(currentThread);
          return currentThread;
        }

        if (threadId <= 0 || currentThread.id > 0) {
          activeThreadKeyRef.current = getThreadKey(currentThread);
          return currentThread;
        }
      }

      if (conversations.length > 0) {
        const nextThread = { type: 'direct' as const, id: conversations[0].id };
        activeThreadKeyRef.current = getThreadKey(nextThread);
        return nextThread;
      }

      if (groups.length > 0) {
        const nextThread = { type: 'group' as const, id: groups[0].id };
        activeThreadKeyRef.current = getThreadKey(nextThread);
        return nextThread;
      }

      activeThreadKeyRef.current = '';
      return null;
    });
  }, [conversations, groups, searchParams]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);

    if (!selectedThread) {
      nextParams.delete('threadType');
      nextParams.delete('threadId');
    } else {
      nextParams.set('threadType', selectedThread.type);
      nextParams.set('threadId', String(selectedThread.id));
    }

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, selectedThread, setSearchParams]);

  useEffect(() => {
    if (!selectedThread) {
      activeThreadKeyRef.current = '';
      setMessages([]);
      setTypingUsers([]);
      return;
    }

    activeThreadKeyRef.current = getThreadKey(selectedThread);
    shouldStickToBottomRef.current = true;
    setAttachmentFile(null);
    setEditingMessageId(null);
    setEditingMessageText('');
    setIsSavingEdit(false);
    setMessageContextMenu(null);
    setError('');

    loadMessages(selectedThread);
    loadTyping(selectedThread);

    const interval = setInterval(() => {
      loadMessages(selectedThread);
      loadTyping(selectedThread);
    }, 2500);

    return () => clearInterval(interval);
  }, [selectedThread]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!messageContextMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (messageContextMenuRef.current?.contains(target)) {
        return;
      }

      setMessageContextMenu(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMessageContextMenu(null);
      }
    };

    const handleViewportResize = () => setMessageContextMenu(null);
    const handleViewportScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && messageContextMenuRef.current?.contains(target)) {
        return;
      }

      setMessageContextMenu(null);
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', handleViewportResize);
    window.addEventListener('scroll', handleViewportScroll, true);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', handleViewportResize);
      window.removeEventListener('scroll', handleViewportScroll, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [messageContextMenu]);

  useLayoutEffect(() => {
    if (!messageContextMenu || !messageContextMenuRef.current) {
      return;
    }

    const rect = messageContextMenuRef.current.getBoundingClientRect();
    const nextLayout = calculateContextMenuLayout(
      messageContextMenu.x,
      messageContextMenu.y,
      rect.width || 336,
      rect.height || 520
    );

    setMessageContextMenuLayout((current) => {
      if (
        current &&
        current.left === nextLayout.left &&
        current.top === nextLayout.top &&
        current.maxHeight === nextLayout.maxHeight
      ) {
        return current;
      }

      return nextLayout;
    });
  }, [messageContextMenu]);

  useEffect(() => {
    if (!messageContextMenu) {
      setMessageContextMenuLayout(null);
    }
  }, [messageContextMenu]);

  useEffect(() => {
    if (shouldStickToBottomRef.current) {
      scrollToBottom();
    }
  }, [messages.length]);

  useEffect(() => {
    const imageMessages = messages.filter((message) => isImageAttachment(message));
    const activeKeys = new Set(imageMessages.map((message) => getInlineAttachmentKey(message)));

    setInlineAttachmentUrls((previous) => {
      let changed = false;
      const next: Record<string, string> = {};

      Object.entries(previous).forEach(([key, value]) => {
        if (activeKeys.has(key)) {
          next[key] = value;
          return;
        }

        URL.revokeObjectURL(value);
        changed = true;
      });

      return changed ? next : previous;
    });

    const missingMessages = imageMessages.filter((message) => !inlineAttachmentUrls[getInlineAttachmentKey(message)]);
    if (missingMessages.length === 0) {
      return;
    }

    let cancelled = false;

    Promise.all(missingMessages.map(async (message) => {
      try {
        const response = isGroupMessage(message)
          ? await chatApi.getGroupAttachment(message.id)
          : await chatApi.getAttachment(message.id);

        const contentType = (response.headers?.['content-type'] as string) || message.attachment_mime || 'image/*';
        const blob = new Blob([response.data], { type: contentType });

        return {
          key: getInlineAttachmentKey(message),
          objectUrl: URL.createObjectURL(blob),
        };
      } catch {
        return null;
      }
    })).then((results) => {
      if (cancelled) {
        results.forEach((result) => {
          if (result?.objectUrl) {
            URL.revokeObjectURL(result.objectUrl);
          }
        });
        return;
      }

      setInlineAttachmentUrls((previous) => {
        const next = { ...previous };

        results.forEach((result) => {
          if (!result) return;

          if (next[result.key]) {
            URL.revokeObjectURL(result.objectUrl);
            return;
          }

          next[result.key] = result.objectUrl;
        });

        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [inlineAttachmentUrls, messages]);

  useEffect(() => {
    return () => {
      Object.values(inlineAttachmentUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [inlineAttachmentUrls]);

  useEffect(() => {
    return () => {
      if (attachmentPreviewUrl) {
        URL.revokeObjectURL(attachmentPreviewUrl);
      }
    };
  }, [attachmentPreviewUrl]);

  useEffect(() => {
    if (editingMessageId && !messages.some((message) => message.id === editingMessageId)) {
      cancelEditingMessage();
    }

    if (messageContextMenu && !messages.some((message) => message.id === messageContextMenu.message.id)) {
      setMessageContextMenu(null);
    }
  }, [editingMessageId, messageContextMenu, messages]);

  const openDirectConversation = async (email: string) => {
    setError('');
    const nextEmail = email.trim();
    if (!nextEmail) return;

    const requestId = openDirectRequestRef.current + 1;
    openDirectRequestRef.current = requestId;

    try {
      const response = await chatApi.startConversation(nextEmail);
      if (requestId !== openDirectRequestRef.current) {
        return;
      }

      const created = response.data;
      setStartEmail('');
      setSelectedStartUserId(null);
      if (created?.id) {
        const nextThread = { type: 'direct' as const, id: created.id };
        pendingThreadRef.current = nextThread;
        selectThread(nextThread);
      }
      await loadThreads();
    } catch (err: any) {
      if (requestId === openDirectRequestRef.current) {
        setError(err?.response?.data?.message || 'Could not start conversation');
      }
    }
  };

  const startConversationFromDraft = async () => {
    const typedValue = startEmail.trim();
    if (!typedValue) return;

    const normalizedTypedValue = normalizeSearchValue(typedValue);
    const rankedMatches = rankSearchSuggestions(availableUserSuggestions, typedValue, 2);
    const singleSuggestedUser = rankedMatches.length === 1
      ? availableUsers.find((candidate) => Number(candidate.id) === Number(rankedMatches[0].id)) || null
      : null;
    const matchedUser =
      selectedStartUser ||
      availableUsers.find((candidate) => (
        normalizeSearchValue(candidate.name) === normalizedTypedValue ||
        normalizeSearchValue(candidate.email) === normalizedTypedValue
      )) ||
      singleSuggestedUser ||
      null;

    await openDirectConversation(matchedUser?.email?.trim() || typedValue);
  };

  const handleStartConversation = async (e: FormEvent) => {
    e.preventDefault();
    await startConversationFromDraft();
  };

  const handleCreateGroup = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!groupName.trim() || groupMemberIds.length === 0) {
      setError('Group name and at least one member are required.');
      return;
    }

    try {
      const response = await chatApi.createGroup({
        name: groupName.trim(),
        user_ids: groupMemberIds,
      });
      setGroupName('');
      setGroupMemberIds([]);
      await loadThreads();
      if (response.data?.id) {
        selectThread({ type: 'group', id: response.data.id });
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not create group');
    }
  };

  const applyAttachmentFile = (nextFile: File | null) => {
    if (!nextFile) {
      setAttachmentFile(null);
      return;
    }

    if (nextFile.size > MAX_CHAT_ATTACHMENT_BYTES) {
      setError('Attachment must be 200 MB or smaller.');
      return;
    }

    setAttachmentFile(nextFile);
    setError('');
  };

  const handleComposerPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!selectedThread) {
      return;
    }

    const clipboardItems = Array.from(event.clipboardData?.items || []);
    const imageItem = clipboardItems.find((item) => item.type.startsWith('image/'));

    if (!imageItem) {
      return;
    }

    const pastedFile = imageItem.getAsFile();
    if (!pastedFile) {
      return;
    }

    event.preventDefault();
    applyAttachmentFile(pastedFile);
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selectedThread || (!messageText.trim() && !attachmentFile)) return;

    try {
      const response = selectedThread.type === 'direct'
        ? await chatApi.sendMessage(selectedThread.id, {
            body: messageText.trim(),
            attachment: attachmentFile,
          })
        : await chatApi.sendGroupMessage(selectedThread.id, {
            body: messageText.trim(),
            attachment: attachmentFile,
          });

      setMessageText('');
      applyAttachmentFile(null);

      if (selectedThread.type === 'direct') {
        await chatApi.setTyping(selectedThread.id, false);
      } else {
        await chatApi.setGroupTyping(selectedThread.id, false);
      }

      setMessages((prev) => [...prev, response.data]);
      await loadThreads();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not send message');
    }
  };

  const handleEditMessage = (message: ChatFeedMessage) => {
    setEditingMessageId(message.id);
    setEditingMessageText(message.body || '');
    setError('');
  };

  const cancelEditingMessage = () => {
    setEditingMessageId(null);
    setEditingMessageText('');
    setIsSavingEdit(false);
  };

  const handleSaveEditedMessage = async (message: ChatFeedMessage) => {
    if (!selectedThread || editingMessageId !== message.id) {
      return;
    }

    const nextBody = editingMessageText.trim();
    if (!nextBody) {
      setError('Message cannot be empty.');
      return;
    }

    try {
      setError('');
      setIsSavingEdit(true);
      setMessageContextMenu(null);
      const response = selectedThread.type === 'direct'
        ? await chatApi.updateMessage(selectedThread.id, message.id, { body: nextBody })
        : await chatApi.updateGroupMessage(selectedThread.id, message.id, { body: nextBody });

      setMessages((prev) => prev.map((candidate) => (candidate.id === message.id ? response.data : candidate)));
      cancelEditingMessage();
      await loadThreads();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not edit message');
      setIsSavingEdit(false);
    }
  };

  const handleMessageChange = (value: string) => {
    setMessageText(value);
    if (!selectedThread) {
      return;
    }

    const updateTyping = selectedThread.type === 'direct'
      ? chatApi.setTyping(selectedThread.id, value.trim().length > 0)
      : chatApi.setGroupTyping(selectedThread.id, value.trim().length > 0);

    updateTyping.catch(() => {});

    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      const clearTyping = selectedThread.type === 'direct'
        ? chatApi.setTyping(selectedThread.id, false)
        : chatApi.setGroupTyping(selectedThread.id, false);
      clearTyping.catch(() => {});
    }, 1800);
  };

  const openAttachment = async (message: ChatFeedMessage) => {
    try {
      const response = isGroupMessage(message)
        ? await chatApi.getGroupAttachment(message.id)
        : await chatApi.getAttachment(message.id);

      const contentType = (response.headers?.['content-type'] as string) || message.attachment_mime || 'application/octet-stream';
      const blob = new Blob([response.data], { type: contentType });
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not open attachment');
    }
  };

  const toggleGroupMember = (userId: number) => {
    setGroupMemberIds((prev) => (
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    ));
  };

  const formatBytes = (size?: number | null) => {
    if (!size || size <= 0) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderMessageBody = (body: string, mine: boolean) => {
    const lines = body.split('\n');

    return lines.map((line, lineIndex) => {
      const segments = line.split(URL_OR_EMAIL_PATTERN);

      return (
        <Fragment key={`line-${lineIndex}`}>
          {segments.map((segment, segmentIndex) => {
            const isLinkToken = EMAIL_TOKEN_PATTERN.test(segment) || URL_TOKEN_PATTERN.test(segment);

            if (!isLinkToken) {
              return <Fragment key={`text-${lineIndex}-${segmentIndex}`}>{segment}</Fragment>;
            }

            const { href, label } = resolveLinkTarget(segment);

            return (
              <a
                key={`link-${lineIndex}-${segmentIndex}`}
                href={href}
                target={href.startsWith('mailto:') ? undefined : '_blank'}
                rel={href.startsWith('mailto:') ? undefined : 'noopener noreferrer'}
                className={mine ? 'underline text-primary-100' : 'underline text-primary-700'}
              >
                {label}
              </a>
            );
          })}
          {lineIndex < lines.length - 1 ? <br /> : null}
        </Fragment>
      );
    });
  };

  const openMessageContextMenu = (event: React.MouseEvent<HTMLDivElement>, message: ChatFeedMessage, mine: boolean) => {
    if (editingMessageId === message.id) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setMessageContextMenuLayout(calculateContextMenuLayout(event.clientX, event.clientY, 336, 520));
    setMessageContextMenu({
      message,
      mine,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const handleCopyMessage = async (message: ChatFeedMessage) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message.body || '');
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = message.body || '';
        textArea.setAttribute('readonly', 'true');
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }

      setError('');
    } catch {
      setError('Could not copy message.');
    } finally {
      setMessageContextMenu(null);
    }
  };

  const handleReactToMessage = async (message: ChatFeedMessage, emoji: string) => {
    if (!selectedThread) {
      return;
    }

    try {
      const response = selectedThread.type === 'direct'
        ? await chatApi.reactToMessage(selectedThread.id, message.id, { emoji })
        : await chatApi.reactToGroupMessage(selectedThread.id, message.id, { emoji });

      setMessages((prev) => prev.map((candidate) => (candidate.id === message.id ? response.data : candidate)));
      setError('');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not react to message.');
    } finally {
      setMessageContextMenu(null);
    }
  };

  const handleDeleteMessage = async (message: ChatFeedMessage) => {
    if (!selectedThread || isDeletingMessage) {
      return;
    }

    const confirmed = window.confirm('Delete this message? This cannot be undone.');
    if (!confirmed) {
      return;
    }

    try {
      setIsDeletingMessage(true);
      setMessageContextMenu(null);
      setError('');

      if (selectedThread.type === 'direct') {
        await chatApi.deleteMessage(selectedThread.id, message.id);
      } else {
        await chatApi.deleteGroupMessage(selectedThread.id, message.id);
      }

      setMessages((prev) => prev.filter((candidate) => candidate.id !== message.id));
      if (editingMessageId === message.id) {
        cancelEditingMessage();
      }
      await loadThreads();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not delete message.');
    } finally {
      setIsDeletingMessage(false);
    }
  };

  const renderMessageTimestamp = (message: ChatFeedMessage, mine: boolean, groupMessage: boolean) => (
    <div className={`mt-1 flex items-center gap-2 text-[10px] ${mine ? 'text-primary-100' : 'text-gray-400'}`}>
      <span>{new Date(message.created_at).toLocaleString()}</span>
      {message.is_edited ? <span>Edited</span> : null}
      {!groupMessage && mine ? <span>{(message as ChatMessage).read_at ? 'Read' : 'Sent'}</span> : null}
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100vh-10rem)] grid-cols-1 overflow-hidden rounded-xl border border-gray-200 bg-white lg:grid-cols-3">
      <div className="min-h-0 space-y-4 overflow-y-auto border-r border-gray-200 p-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Chat</h1>
          <p className="text-sm text-gray-500">Private chats and group rooms for your organization</p>
        </div>

        <form onSubmit={handleStartConversation} className="space-y-2 rounded-lg border border-gray-200 p-3">
          <h2 className="text-sm font-semibold text-gray-900">Start private chat</h2>
          <SearchSuggestInput
            type="text"
            value={startEmail}
            onValueChange={(value) => {
              setStartEmail(value);

              if (!selectedStartUser) {
                return;
              }

              const normalizedValue = normalizeSearchValue(value);
              if (
                normalizedValue !== normalizeSearchValue(selectedStartUser.name) &&
                normalizedValue !== normalizeSearchValue(selectedStartUser.email)
              ) {
                setSelectedStartUserId(null);
              }
            }}
            onSuggestionSelect={(suggestion) => {
              const nextUserId = Number((suggestion.payload as { id?: number } | undefined)?.id || suggestion.id || 0);
              const nextUser = availableUsers.find((candidate) => Number(candidate.id) === nextUserId) || null;
              setStartEmail(getSuggestionDisplayValue(suggestion));
              setSelectedStartUserId(Number.isFinite(nextUserId) && nextUserId > 0 ? nextUserId : null);
              if (nextUser?.email) {
                void openDirectConversation(nextUser.email);
              }
            }}
            onCommit={() => {
              void startConversationFromDraft();
            }}
            suggestions={availableUserSuggestions}
            placeholder="Search teammate by name or enter email"
            emptyMessage="No teammate names match this search."
            autoComplete="off"
          />
          <button type="submit" className="w-full rounded-lg bg-primary-600 px-3 py-2 text-sm text-white hover:bg-primary-700">
            Start / Open Chat
          </button>
        </form>

        <form onSubmit={handleCreateGroup} className="space-y-3 rounded-lg border border-gray-200 p-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Create group chat</h2>
            <p className="text-xs text-gray-500">Pick teammates who should chat together</p>
          </div>
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group name"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
            {availableUsers.length === 0 ? (
              <p className="text-xs text-gray-500">No teammates available.</p>
            ) : (
              availableUsers.map((candidate) => (
                <label key={candidate.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={groupMemberIds.includes(candidate.id)}
                    onChange={() => toggleGroupMember(candidate.id)}
                  />
                  <span>{candidate.name}</span>
                  <span className="text-xs text-gray-400">{candidate.email}</span>
                </label>
              ))
            )}
          </div>
          <button type="submit" className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-800">
            Create Group
          </button>
        </form>

        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Private chats</h2>
              <span className="text-xs text-gray-400">{conversations.length}</span>
            </div>
            <div className="max-h-[24vh] space-y-2 overflow-y-auto pr-1">
              {conversations.length === 0 ? (
                <p className="text-sm text-gray-500">No conversations yet.</p>
              ) : (
                conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    onClick={() => selectThread({ type: 'direct', id: conversation.id })}
                    className={`w-full rounded-lg border p-3 text-left ${
                      selectedThread?.type === 'direct' && selectedThread.id === conversation.id
                        ? 'border-primary-300 bg-primary-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <p className="font-medium text-gray-900">{conversation.other_user?.name}</p>
                    <p className="text-xs text-gray-500">{conversation.other_user?.email}</p>
                    {conversation.last_message?.body && (
                      <p className="mt-1 truncate text-xs text-gray-600">{conversation.last_message.body}</p>
                    )}
                    {!!conversation.unread_count && conversation.unread_count > 0 && (
                      <span className="mt-1 inline-block rounded-full bg-primary-600 px-2 py-0.5 text-xs text-white">
                        {conversation.unread_count}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Group chats</h2>
              <span className="text-xs text-gray-400">{groups.length}</span>
            </div>
            <div className="max-h-[24vh] space-y-2 overflow-y-auto pr-1">
              {groups.length === 0 ? (
                <p className="text-sm text-gray-500">No groups yet.</p>
              ) : (
                groups.map((group) => (
                  <button
                    key={group.id}
                    onClick={() => selectThread({ type: 'group', id: group.id })}
                    className={`w-full rounded-lg border p-3 text-left ${
                      selectedThread?.type === 'group' && selectedThread.id === group.id
                        ? 'border-primary-300 bg-primary-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium text-gray-900">{group.name}</p>
                      <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary-700">
                        Group
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{group.member_count || 0} members</p>
                    {group.last_message?.body && (
                      <p className="mt-1 truncate text-xs text-gray-600">{group.last_message.body}</p>
                    )}
                    {!!group.unread_count && group.unread_count > 0 && (
                      <span className="mt-1 inline-block rounded-full bg-primary-600 px-2 py-0.5 text-xs text-white">
                        {group.unread_count}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-col lg:col-span-2">
        <div className="border-b border-gray-200 px-4 py-3">
          {selectedConversation ? (
            <>
              <p className="flex items-center gap-2 font-semibold text-gray-900">
                <span>{selectedConversation.other_user?.name}</span>
                <span className={`inline-flex h-2.5 w-2.5 rounded-full ${selectedConversation.other_user?.is_online ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                <span className="text-xs font-normal text-gray-500">
                  {selectedConversation.other_user?.is_online ? 'Online' : 'Offline'}
                </span>
              </p>
              <p className="text-xs text-gray-500">
                {selectedConversation.other_user?.email}
                {!selectedConversation.other_user?.is_online && selectedConversation.other_user?.last_seen_at
                  ? ` • Last seen ${new Date(selectedConversation.other_user.last_seen_at).toLocaleString()}`
                  : ''}
              </p>
            </>
          ) : selectedGroup ? (
            <>
              <p className="font-semibold text-gray-900">{selectedGroup.name}</p>
              <p className="text-xs text-gray-500">
                {(selectedGroup.member_count || selectedGroup.members?.length || 0)} members
                {selectedGroup.members?.length
                  ? ` • ${selectedGroup.members.slice(0, 4).map((member) => member.name).join(', ')}${selectedGroup.members.length > 4 ? '...' : ''}`
                  : ''}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-500">Select a conversation or group</p>
          )}
        </div>

        <div
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          className="flex-1 min-h-0 space-y-3 overflow-y-auto bg-gray-50 p-4"
        >
          {!selectedThread ? (
            <p className="text-sm text-gray-500">Choose or start a private chat, or create a group.</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-gray-500">No messages yet.</p>
          ) : (
            messages.map((message) => {
              const mine = Number(message.sender_id) === Number(user?.id);
              const groupMessage = isGroupMessage(message);
              const hasReactions = (message.reactions || []).length > 0;
              const messageInlineAttachmentUrl = inlineAttachmentUrls[getInlineAttachmentKey(message)] || null;
              const messageHasImageAttachment = isImageAttachment(message);
              const hasBodyText = Boolean((message.body || '').trim());

              return (
                <div
                  key={`${groupMessage ? 'group' : 'direct'}-${message.id}`}
                  className={`group flex ${mine ? 'justify-end' : 'justify-start'} ${hasReactions ? 'pt-6' : 'pt-4'}`}
                >
                  <div className="relative max-w-[70%]" onContextMenu={(event) => openMessageContextMenu(event, message, mine)}>
                    {hasReactions ? (
                      <div
                        className={`pointer-events-none absolute z-10 flex max-w-full flex-wrap gap-1 ${
                          mine ? '-left-3 -top-5 justify-start' : '-right-3 -top-5 justify-end'
                        }`}
                      >
                        {(message.reactions || []).map((reaction) => (
                          <span
                            key={`${message.id}-${reaction.emoji}`}
                            className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-sm leading-none shadow-[0_12px_24px_-14px_rgba(15,23,42,0.55)] ${
                              reaction.reacted_by_me
                                ? mine
                                  ? 'bg-white text-primary-700'
                                  : 'bg-primary-50 text-primary-800'
                                : mine
                                  ? 'bg-primary-500 text-white'
                                  : 'bg-white text-gray-700'
                            }`}
                          >
                            {reaction.emoji}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div
                      className={`rounded-xl px-3 py-2 text-sm ${mine ? 'bg-primary-600 text-white' : 'border border-gray-200 bg-white text-gray-800'}`}
                    >
                      {!mine && groupMessage && (
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary-700">
                          {message.sender?.name || 'Teammate'}
                        </p>
                      )}
                      {editingMessageId === message.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={editingMessageText}
                            onChange={(e) => setEditingMessageText(e.target.value)}
                            rows={3}
                            className="w-full resize-y rounded-lg border border-white/50 bg-white px-3 py-2 text-sm text-gray-900 focus:border-white focus:outline-none"
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={cancelEditingMessage}
                              className="rounded-md border border-white/50 px-2 py-1 text-xs text-white hover:bg-white/10"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveEditedMessage(message)}
                              disabled={isSavingEdit || !editingMessageText.trim()}
                              className="rounded-md bg-white px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-60"
                            >
                              {isSavingEdit ? 'Saving...' : 'Save'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {messageHasImageAttachment ? (
                            <button
                              onClick={() => openAttachment(message)}
                              type="button"
                              className={`block overflow-hidden rounded-lg border ${mine ? 'border-primary-400/50' : 'border-gray-200'} bg-black/5`}
                            >
                              {messageInlineAttachmentUrl ? (
                                <img
                                  src={messageInlineAttachmentUrl}
                                  alt={message.attachment_name || 'Shared image'}
                                  className="max-h-72 w-full max-w-[22rem] object-cover"
                                />
                              ) : (
                                <div className="flex h-32 w-56 items-center justify-center text-xs text-gray-500">
                                  Loading image...
                                </div>
                              )}
                            </button>
                          ) : null}

                          {hasBodyText ? (
                            <p className={`${messageHasImageAttachment ? 'mt-2' : ''} break-words whitespace-pre-wrap`}>
                              {renderMessageBody(message.body || '', mine)}
                            </p>
                          ) : null}

                          {message.has_attachment && !messageHasImageAttachment ? (
                            <button
                              onClick={() => openAttachment(message)}
                              type="button"
                              className={`mt-2 inline-flex items-center gap-1 text-xs underline ${mine ? 'text-primary-100' : 'text-primary-700'}`}
                            >
                              Open attachment
                              {message.attachment_name ? ` (${message.attachment_name}${message.attachment_size ? `, ${formatBytes(message.attachment_size)}` : ''})` : ''}
                            </button>
                          ) : null}
                        </>
                      )}
                      {renderMessageTimestamp(message, mine, groupMessage)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          {typingUsers.length > 0 && (
            <p className="text-xs italic text-gray-500">
              {typingUsers.map((typingUser) => typingUser.name).join(', ')} typing...
            </p>
          )}
          <div ref={messagesEndRef} />
        </div>
        {messageContextMenu ? (
          <div
            ref={messageContextMenuRef}
            className="fixed z-[70] flex w-[21rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-2 shadow-[0_18px_40px_-18px_rgba(15,23,42,0.45)]"
            style={{
              left: messageContextMenuLayout?.left ?? Math.max(12, Math.min(messageContextMenu.x, window.innerWidth - 360)),
              top: messageContextMenuLayout?.top ?? Math.max(12, Math.min(messageContextMenu.y, window.innerHeight - 420)),
              maxHeight: messageContextMenuLayout?.maxHeight ?? Math.max(260, window.innerHeight - 24),
            }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">React</p>
                <div className="flex flex-wrap gap-2">
                  {persistedQuickReactions.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => void handleReactToMessage(messageContextMenu.message, emoji)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg shadow-sm transition hover:bg-primary-50"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-gray-100 px-3 py-2">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Emoji panel</p>
                <div className="grid gap-3">
                  {EMOJI_PICKER_GROUPS.map((group) => (
                    <div key={group.label}>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{group.label}</p>
                      <div className="flex flex-wrap gap-2">
                        {group.emojis.map((emoji) => (
                          <button
                            key={`${group.label}-${emoji}`}
                            type="button"
                            onClick={() => void handleReactToMessage(messageContextMenu.message, emoji)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gray-50 text-lg transition hover:bg-primary-50"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-2 border-t border-gray-100 pt-2">
              <button
                type="button"
                onClick={() => void handleCopyMessage(messageContextMenu.message)}
                className="flex w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50"
              >
                Copy message
              </button>
              {messageContextMenu.mine ? (
                <button
                  type="button"
                  onClick={() => {
                    handleEditMessage(messageContextMenu.message);
                    setMessageContextMenu(null);
                  }}
                  className="flex w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50"
                >
                  Edit message
                </button>
              ) : null}
              {messageContextMenu.mine ? (
                <button
                  type="button"
                  onClick={() => void handleDeleteMessage(messageContextMenu.message)}
                  disabled={isDeletingMessage}
                  className="flex w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                >
                  {isDeletingMessage ? 'Deleting...' : 'Delete message'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <form onSubmit={handleSendMessage} className="border-t border-gray-200 p-3">
          <div className="space-y-3">
            {attachmentFile && (
              <div className="rounded-xl border border-gray-200 bg-white p-2">
                <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                  {attachmentPreviewUrl ? (
                    <img
                      src={attachmentPreviewUrl}
                      alt="Pasted screenshot preview"
                      className="max-h-80 w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-36 items-center justify-center text-xs text-gray-500">
                      {attachmentFile.name || 'Attachment selected'}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => applyAttachmentFile(null)}
                    className="absolute right-2 top-2 rounded-full bg-black/65 px-2 py-1 text-xs font-medium text-white hover:bg-black/75"
                  >
                    Remove
                  </button>
                </div>
                <p className="mt-2 truncate text-xs text-gray-600">
                  {attachmentFile.name || 'Pasted screenshot'}
                  {attachmentFile.size ? ` (${formatBytes(attachmentFile.size)})` : ''}
                </p>
              </div>
            )}

            <div className="flex items-end gap-2">
              <textarea
                value={messageText}
                onChange={(e) => handleMessageChange(e.target.value)}
                onPaste={handleComposerPaste}
                placeholder={attachmentFile
                  ? 'Add a caption (optional)'
                  : selectedThread
                    ? `Type a message to this ${selectedThreadLabel}...`
                    : 'Select chat first'}
                disabled={!selectedThread}
                rows={attachmentFile ? 2 : 2}
                className="w-full resize-y rounded-2xl border border-gray-300 px-4 py-2.5 text-sm disabled:bg-gray-100"
              />
              <button
                type="submit"
                disabled={!selectedThread || (!messageText.trim() && !attachmentFile)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary-600 text-base font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                aria-label="Send message"
              >
                ➤
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="file"
                disabled={!selectedThread}
                onChange={(e) => applyAttachmentFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-gray-600 file:mr-2 file:rounded-full file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-xs file:font-medium"
              />
              <span className="text-[11px] text-gray-500">Max 200 MB</span>
            </div>
          </div>
        </form>
        {error && <p className="px-3 pb-3 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
