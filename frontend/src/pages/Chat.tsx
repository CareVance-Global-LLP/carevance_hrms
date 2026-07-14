import { ClipboardEvent, FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { formatDateTime } from '@/lib/dateTime';
import { DEFAULT_APP_TIMEZONE } from '@/lib/timezones';
import { chatApi } from '@/services/api';
import type { ChatConversation, ChatGroup, ChatGroupMessage, ChatMessage, ChatTypingUser } from '@/types';
import ChatSidebar from '@/components/chat/ChatSidebar';
import MessageArea from '@/components/chat/MessageArea';
import NewConversationModal from '@/components/chat/NewConversationModal';
import CreateGroupModal from '@/components/chat/CreateGroupModal';

type ThreadSelection =
  | { type: 'direct'; id: number }
  | { type: 'group'; id: number }
  | null;

type ChatFeedMessage = ChatMessage | ChatGroupMessage;

type ImageViewerState = {
  url: string;
  fileName: string;
  revokeOnClose: boolean;
};

const getThreadKey = (thread: ThreadSelection) => (thread ? `${thread.type}:${thread.id}` : '');

const MAX_CHAT_ATTACHMENT_BYTES = 200 * 1024 * 1024;

const isSameThread = (left: ThreadSelection, right: ThreadSelection) => (
  left?.type === right?.type && left?.id === right?.id
);

const isGroupMessage = (message: ChatFeedMessage): message is ChatGroupMessage => 'group_id' in message;
const getInlineAttachmentKey = (message: ChatFeedMessage) => `${isGroupMessage(message) ? 'group' : 'direct'}:${message.id}`;
const isImageAttachment = (message: ChatFeedMessage) => (
  Boolean(message.has_attachment)
  && String(message.attachment_mime || '').toLowerCase().startsWith('image/')
);

export default function Chat() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const viewerTimezone = (user?.settings as any)?.timezone || DEFAULT_APP_TIMEZONE;
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [availableUsers, setAvailableUsers] = useState<Array<{ id: number; name: string; email: string; role: string }>>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadSelection>(null);
  const [messages, setMessages] = useState<ChatFeedMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<ChatTypingUser[]>([]);
  const [messageText, setMessageText] = useState('');
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingMessageText, setEditingMessageText] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeletingMessage, setIsDeletingMessage] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [inlineAttachmentUrls, setInlineAttachmentUrls] = useState<Record<string, string>>({});
  const [imageViewer, setImageViewer] = useState<ImageViewerState | null>(null);
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const lastTypingSentAtRef = useRef<number>(0);
  const shouldStickToBottomRef = useRef(true);
  const pendingThreadRef = useRef<ThreadSelection>(null);
  const activeThreadKeyRef = useRef('');
  const openDirectRequestRef = useRef(0);
  const previewUrlsRef = useRef<Map<File, string>>(new Map());

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

  const getFilePreviewUrl = (file: File) => {
    if (!file.type.startsWith('image/')) return null;
    let url = previewUrlsRef.current.get(file);
    if (!url) {
      url = URL.createObjectURL(file);
      previewUrlsRef.current.set(file, url);
    }
    return url;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 80;
  };

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

      if (activeThreadKeyRef.current !== threadKey) return;

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
    const interval = setInterval(loadThreads, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (user?.id) loadAvailableUsers();
  }, [user?.id]);

  useEffect(() => {
    const threadType = searchParams.get('threadType');
    const threadId = Number(searchParams.get('threadId') || 0);
    const requestedThread = threadType === 'direct' || threadType === 'group'
      ? { type: threadType, id: threadId }
      : null;

    setSelectedThread((currentThread) => {
      if (threadType === 'direct' && threadId > 0 && conversations.some((c) => c.id === threadId)) {
        const nextThread = { type: 'direct' as const, id: threadId };
        activeThreadKeyRef.current = getThreadKey(nextThread);
        return isSameThread(currentThread, nextThread) ? currentThread : nextThread;
      }

      if (threadType === 'group' && threadId > 0 && groups.some((g) => g.id === threadId)) {
        const nextThread = { type: 'group' as const, id: threadId };
        activeThreadKeyRef.current = getThreadKey(nextThread);
        return isSameThread(currentThread, nextThread) ? currentThread : nextThread;
      }

      if (currentThread) {
        const exists = currentThread.type === 'direct'
          ? conversations.some((c) => c.id === currentThread.id)
          : groups.some((g) => g.id === currentThread.id);

        if (exists) {
          activeThreadKeyRef.current = getThreadKey(currentThread);
          return currentThread;
        }

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
    setAttachmentFiles([]);
    setEditingMessageId(null);
    setEditingMessageText('');
    setIsSavingEdit(false);
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
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (shouldStickToBottomRef.current) scrollToBottom();
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
    if (missingMessages.length === 0) return;

    let cancelled = false;

    Promise.all(missingMessages.map(async (message) => {
      try {
        const response = isGroupMessage(message)
          ? await chatApi.getGroupAttachment(message.id)
          : await chatApi.getAttachment(message.id);
        const contentType = (response.headers?.['content-type'] as string) || message.attachment_mime || 'image/*';
        const blob = new Blob([response.data], { type: contentType });
        return { key: getInlineAttachmentKey(message), objectUrl: URL.createObjectURL(blob) };
      } catch {
        return null;
      }
    })).then((results) => {
      if (cancelled) {
        results.forEach((result) => {
          if (result?.objectUrl) URL.revokeObjectURL(result.objectUrl);
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

    return () => { cancelled = true; };
  }, [inlineAttachmentUrls, messages]);

  useEffect(() => {
    return () => {
      Object.values(inlineAttachmentUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [inlineAttachmentUrls]);

  useEffect(() => {
    return () => {
      const urls = Array.from(previewUrlsRef.current.values());
      urls.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
    };
  }, [attachmentFiles]);

  const openDirectConversation = async (email: string) => {
    setError('');
    const nextEmail = email.trim();
    if (!nextEmail) return;

    const requestId = openDirectRequestRef.current + 1;
    openDirectRequestRef.current = requestId;

    try {
      const response = await chatApi.startConversation(nextEmail);
      if (requestId !== openDirectRequestRef.current) return;

      const created = response.data;
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

  const applyAttachmentFiles = (nextFiles: FileList | null) => {
    if (!nextFiles || nextFiles.length === 0) return;

    const valid: File[] = [];
    for (const file of Array.from(nextFiles)) {
      if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
        setError(`"${file.name}" exceeds the 200 MB limit and was skipped.`);
        continue;
      }
      valid.push(file);
    }

    if (valid.length === 0) return;
    setAttachmentFiles((prev) => [...prev, ...valid]);
    setError('');
  };

  const removeAttachmentFile = (index: number) => {
    setAttachmentFiles((prev) => {
      const file = prev[index];
      if (file && previewUrlsRef.current.has(file)) {
        URL.revokeObjectURL(previewUrlsRef.current.get(file)!);
        previewUrlsRef.current.delete(file);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const clearAttachmentFiles = () => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current.clear();
    setAttachmentFiles([]);
  };

  const handleComposerPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!selectedThread) return;
    const clipboardItems = Array.from(event.clipboardData?.items || []);
    const imageItem = clipboardItems.find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;
    const pastedFile = imageItem.getAsFile();
    if (!pastedFile) return;
    event.preventDefault();
    if (pastedFile.size > MAX_CHAT_ATTACHMENT_BYTES) {
      setError('Pasted image exceeds the 200 MB limit.');
      return;
    }
    setAttachmentFiles((prev) => [...prev, pastedFile!]);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    if (!selectedThread) {
      setError('Select a chat first before attaching files.');
      return;
    }

    const droppedFiles = e.dataTransfer?.files;
    if (droppedFiles && droppedFiles.length > 0) {
      applyAttachmentFiles(droppedFiles);
    }
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selectedThread || (!messageText.trim() && attachmentFiles.length === 0)) return;

    const body = messageText.trim();
    const filesToSend = attachmentFiles.length > 0 ? attachmentFiles : [];
    const responses: ChatFeedMessage[] = [];

    try {
      if (filesToSend.length === 0) {
        const response = selectedThread.type === 'direct'
          ? await chatApi.sendMessage(selectedThread.id, { body })
          : await chatApi.sendGroupMessage(selectedThread.id, { body });
        responses.push(response.data);
      } else {
        for (let i = 0; i < filesToSend.length; i++) {
          const file = filesToSend[i];
          const messageBody = i === 0 ? body : '';
          const response = selectedThread.type === 'direct'
            ? await chatApi.sendMessage(selectedThread.id, { body: messageBody, attachment: file })
            : await chatApi.sendGroupMessage(selectedThread.id, { body: messageBody, attachment: file });
          responses.push(response.data);
        }
      }

      setMessageText('');
      clearAttachmentFiles();

      if (selectedThread.type === 'direct') {
        await chatApi.setTyping(selectedThread.id, false);
      } else {
        await chatApi.setGroupTyping(selectedThread.id, false);
      }

      setMessages((prev) => [...prev, ...responses]);
      await loadThreads();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not send message');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage(e as any);
    }
  };

  const handleMessageChange = (value: string) => {
    setMessageText(value);
    if (!selectedThread) return;

    const isTyping = value.trim().length > 0;
    const now = Date.now();
    const shouldSendTyping = isTyping && (now - lastTypingSentAtRef.current > 2000);

    if (shouldSendTyping) {
      lastTypingSentAtRef.current = now;
      const updateTyping = selectedThread.type === 'direct'
        ? chatApi.setTyping(selectedThread.id, true)
        : chatApi.setGroupTyping(selectedThread.id, true);
      updateTyping.catch(() => {});
    }

    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = window.setTimeout(() => {
      const clearTyping = selectedThread.type === 'direct'
        ? chatApi.setTyping(selectedThread.id, false)
        : chatApi.setGroupTyping(selectedThread.id, false);
      clearTyping.catch(() => {});
    }, 1800);
  };

  const handleSaveEditedMessage = async (message: ChatFeedMessage) => {
    if (!selectedThread || editingMessageId !== message.id) return;

    const nextBody = editingMessageText.trim();
    if (!nextBody) {
      setError('Message cannot be empty.');
      return;
    }

    try {
      setError('');
      setIsSavingEdit(true);
      const response = selectedThread.type === 'direct'
        ? await chatApi.updateMessage(selectedThread.id, message.id, { body: nextBody })
        : await chatApi.updateGroupMessage(selectedThread.id, message.id, { body: nextBody });

      setMessages((prev) => prev.map((candidate) => (candidate.id === message.id ? response.data : candidate)));
      setEditingMessageId(null);
      setEditingMessageText('');
      setIsSavingEdit(false);
      await loadThreads();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not edit message');
      setIsSavingEdit(false);
    }
  };

  const openAttachment = async (message: ChatFeedMessage) => {
    if (isImageAttachment(message)) {
      const existingInlineUrl = inlineAttachmentUrls[getInlineAttachmentKey(message)];
      if (existingInlineUrl) {
        setImageViewer({
          url: existingInlineUrl,
          fileName: message.attachment_name || `chat-image-${message.id}.png`,
          revokeOnClose: false,
        });
        return;
      }

      try {
        const response = isGroupMessage(message)
          ? await chatApi.getGroupAttachment(message.id)
          : await chatApi.getAttachment(message.id);
        const contentType = (response.headers?.['content-type'] as string) || message.attachment_mime || 'image/*';
        const blob = new Blob([response.data], { type: contentType });
        const objectUrl = URL.createObjectURL(blob);
        setImageViewer({
          url: objectUrl,
          fileName: message.attachment_name || `chat-image-${message.id}.png`,
          revokeOnClose: true,
        });
      } catch (err: any) {
        setError(err?.response?.data?.message || 'Could not open image.');
      }
      return;
    }

    try {
      const response = isGroupMessage(message)
        ? await chatApi.getGroupAttachment(message.id)
        : await chatApi.getAttachment(message.id);
      const contentType = (response.headers?.['content-type'] as string) || message.attachment_mime || 'application/octet-stream';
      const blob = new Blob([response.data], { type: contentType });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not open attachment');
    }
  };

  const downloadAttachment = async (message: ChatFeedMessage) => {
    try {
      const response = isGroupMessage(message)
        ? await chatApi.getGroupAttachment(message.id)
        : await chatApi.getAttachment(message.id);
      const contentType = (response.headers?.['content-type'] as string) || message.attachment_mime || 'application/octet-stream';
      const blob = new Blob([response.data], { type: contentType });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = message.attachment_name || `attachment-${message.id}`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not download attachment');
    }
  };

  const handleReactToMessage = async (message: ChatFeedMessage, emoji: string) => {
    if (!selectedThread) return;
    try {
      const response = selectedThread.type === 'direct'
        ? await chatApi.reactToMessage(selectedThread.id, message.id, { emoji })
        : await chatApi.reactToGroupMessage(selectedThread.id, message.id, { emoji });
      setMessages((prev) => prev.map((candidate) => (candidate.id === message.id ? response.data : candidate)));
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not add reaction');
    }
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
      setError('Could not copy message');
    }
  };

  const handleDeleteMessage = async (message: ChatFeedMessage) => {
    if (!selectedThread) return;
    const confirmed = window.confirm('Delete this message? This cannot be undone.');
    if (!confirmed) return;

    try {
      setIsDeletingMessage(true);
      setError('');

      if (selectedThread.type === 'direct') {
        await chatApi.deleteMessage(selectedThread.id, message.id);
      } else {
        await chatApi.deleteGroupMessage(selectedThread.id, message.id);
      }

      setMessages((prev) => prev.filter((candidate) => candidate.id !== message.id));
      if (editingMessageId === message.id) {
        setEditingMessageId(null);
        setEditingMessageText('');
      }
      await loadThreads();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not delete message');
    } finally {
      setIsDeletingMessage(false);
    }
  };

  const handleConversationCreated = async (threadId: number) => {
    const nextThread = { type: 'direct' as const, id: threadId };
    pendingThreadRef.current = nextThread;
    selectThread(nextThread);
    await loadThreads();
  };

  const handleGroupCreated = async (groupId: number) => {
    selectThread({ type: 'group', id: groupId });
    await loadThreads();
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100vh-10rem)] grid-cols-1 overflow-hidden rounded-xl border border-gray-200 bg-white lg:grid-cols-3">
      <ChatSidebar
        conversations={conversations}
        groups={groups}
        selectedThread={selectedThread}
        onSelectThread={(type, id) => selectThread({ type, id })}
        onNewConversation={() => setShowNewConversationModal(true)}
        onCreateGroup={() => setShowCreateGroupModal(true)}
      />
      <div className="min-h-0 lg:col-span-2">
        <MessageArea
          selectedThread={selectedThread}
          selectedConversation={selectedConversation}
          selectedGroup={selectedGroup}
          messages={messages}
          typingUsers={typingUsers}
          messageText={messageText}
          setMessageText={setMessageText}
          attachmentFiles={attachmentFiles}
          setAttachmentFiles={setAttachmentFiles}
          editingMessageId={editingMessageId}
          setEditingMessageId={setEditingMessageId}
          editingMessageText={editingMessageText}
          setEditingMessageText={setEditingMessageText}
          isSavingEdit={isSavingEdit}
          setIsSavingEdit={setIsSavingEdit}
          error={error}
          setError={setError}
          inlineAttachmentUrls={inlineAttachmentUrls}
          setInlineAttachmentUrls={setInlineAttachmentUrls}
          imageViewer={imageViewer}
          setImageViewer={setImageViewer}
          onSendMessage={handleSendMessage}
          onKeyDown={handleKeyDown}
          handleMessageChange={handleMessageChange}
          handleComposerPaste={handleComposerPaste}
          applyAttachmentFiles={applyAttachmentFiles}
          removeAttachmentFile={removeAttachmentFile}
          getFilePreviewUrl={getFilePreviewUrl}
          handleDragEnter={handleDragEnter}
          handleDragOver={handleDragOver}
          handleDragLeave={handleDragLeave}
          handleDrop={handleDrop}
          onOpenAttachment={openAttachment}
          onDownloadAttachment={downloadAttachment}
          onReactToMessage={handleReactToMessage}
          onCopyMessage={handleCopyMessage}
          onDeleteMessage={handleDeleteMessage}
          isDeletingMessage={isDeletingMessage}
          onNewConversation={() => setShowNewConversationModal(true)}
        />
      </div>

      <NewConversationModal
        isOpen={showNewConversationModal}
        onClose={() => setShowNewConversationModal(false)}
        onConversationCreated={handleConversationCreated}
        availableUsers={availableUsers}
      />

      <CreateGroupModal
        isOpen={showCreateGroupModal}
        onClose={() => setShowCreateGroupModal(false)}
        onGroupCreated={handleGroupCreated}
        availableUsers={availableUsers}
      />
    </div>
  );
}
