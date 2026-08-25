import { ClipboardEvent, FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { formatDateTime } from '@/lib/dateTime';
import { DEFAULT_APP_TIMEZONE } from '@/lib/timezones';
import { chatApi } from '@/services/api';
import {
  getUploadLimits,
  uploadFileInChunks,
  UploadCancelledError,
  type UploadLimits,
  type UploadProgress,
} from '@/lib/chunkedUpload';
import { attachmentKey } from '@/components/chat/MessageComposer';
import { reportSilentError } from '@/lib/reportSilentError';
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

/**
 * Fallback ceiling, used only until the server states its own.
 *
 * This number used to be the whole story, and it was a lie: PHP discarded any
 * body over upload_max_filesize before Laravel ran — 2 MB on a dev box, 10 MB
 * in production — so a 50 MB file was accepted by this check, sent, and then
 * reported back as "no attachment". The real limits now come from
 * `/uploads/limits`, and anything above the server's chunk size goes up in
 * pieces instead of in one request.
 */
const MAX_CHAT_ATTACHMENT_BYTES = 200 * 1024 * 1024;

const isSameThread = (left: ThreadSelection, right: ThreadSelection) => (
  left?.type === right?.type && left?.id === right?.id
);

/** Sizes in the units people actually think in, for limits and progress. */
const formatFileSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

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
  // What this server actually accepts. Asked once; until it answers, the
  // fallback ceiling above applies.
  const [uploadLimits, setUploadLimits] = useState<UploadLimits | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, UploadProgress>>({});
  const [isSending, setIsSending] = useState(false);
  // Lets the composer's X button actually stop a transfer rather than just
  // hiding it while it carries on to the server.
  const uploadAbortRef = useRef<AbortController | null>(null);
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
  /** Newest message id held for the open thread — the cursor for incremental polling. */
  const latestMessageIdRef = useRef(0);
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
        setMessages((prev) => {
          // A full sync can overlap an in-flight incremental fetch, so drop
          // anything already held rather than showing it twice.
          const seen = new Set(prev.map((message) => `${isGroupMessage(message) ? 'g' : 'd'}:${message.id}`));
          const fresh = incoming.filter(
            (message) => !seen.has(`${isGroupMessage(message) ? 'g' : 'd'}:${message.id}`)
          );
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      }

      if (incoming.length > 0) {
        latestMessageIdRef.current = Math.max(
          latestMessageIdRef.current,
          ...incoming.map((message) => Number(message.id) || 0)
        );
      }

      // Only tell the server we have read the thread when we opened it or when
      // something new actually arrived. This used to fire on every poll, so an
      // open conversation issued a write request every 2.5 seconds.
      if (sinceId && incoming.length === 0) return;

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

  /*
   * Ask the server what it can take, once.
   *
   * Until this answers, the fallback ceiling applies and nothing is chunked —
   * which is the old behaviour, so a failure here degrades to what the product
   * did before rather than blocking attachments entirely.
   */
  useEffect(() => {
    let active = true;

    void getUploadLimits()
      .then((limits) => {
        if (active) setUploadLimits(limits);
      })
      .catch((error) => {
        reportSilentError('Chat: could not read upload limits; falling back to single-request uploads', error);
      });

    return () => {
      active = false;
    };
  }, []);

  // An upload must not outlive the screen that started it.
  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort();
    };
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

    latestMessageIdRef.current = 0;
    loadMessages(selectedThread);
    loadTyping(selectedThread);

    // The timer used to call loadMessages with no `since_id`, so every tick
    // re-downloaded the thread's entire history — 24 times a minute, whether or
    // not anything had changed. It passes the newest id it holds now.
    //
    // Every FULL_SYNC_EVERY ticks it still does a complete fetch, because edits
    // and deletions to older messages cannot arrive through an incremental one.
    let tick = 0;
    const FULL_SYNC_EVERY = 12; // ~30s

    const interval = setInterval(() => {
      // Nothing to poll for a conversation nobody is looking at.
      if (typeof document !== 'undefined' && document.hidden) return;

      tick += 1;
      const wantsFullSync = tick % FULL_SYNC_EVERY === 0;
      const sinceId = wantsFullSync ? undefined : latestMessageIdRef.current || undefined;

      loadMessages(selectedThread, sinceId);
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

    const ceiling = uploadLimits?.maxUploadBytes || MAX_CHAT_ATTACHMENT_BYTES;

    const valid: File[] = [];
    for (const file of Array.from(nextFiles)) {
      if (file.size > ceiling) {
        // Names the real ceiling rather than a hardcoded one, so the message
        // cannot disagree with what the server will actually accept.
        setError(`"${file.name}" is ${formatFileSize(file.size)}, over the ${formatFileSize(ceiling)} limit. It was skipped.`);
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
    const pasteCeiling = uploadLimits?.maxUploadBytes || MAX_CHAT_ATTACHMENT_BYTES;
    if (pastedFile.size > pasteCeiling) {
      setError(`Pasted image is ${formatFileSize(pastedFile.size)}, over the ${formatFileSize(pasteCeiling)} limit.`);
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
    // A second send while a large upload is in flight would start the same
    // files again alongside the first attempt.
    if (isSending) return;

    const body = messageText.trim();
    const filesToSend = attachmentFiles.length > 0 ? attachmentFiles : [];
    const responses: ChatFeedMessage[] = [];
    let appendedResponses = false;

    setIsSending(true);

    try {
      if (filesToSend.length === 0) {
        const response = selectedThread.type === 'direct'
          ? await chatApi.sendMessage(selectedThread.id, { body })
          : await chatApi.sendGroupMessage(selectedThread.id, { body });
        responses.push(response.data);
      } else {
        const controller = new AbortController();
        uploadAbortRef.current = controller;

        for (let i = 0; i < filesToSend.length; i++) {
          const file = filesToSend[i];
          const messageBody = i === 0 ? body : '';

          /*
           * Two routes, chosen by what a single request can actually carry.
           *
           * Below the server's chunk size the file rides along with the
           * message, exactly as before — one round trip, nothing to clean up.
           * Above it the file goes up in pieces first and the message quotes
           * the resulting key. That boundary is the server's, not ours: it is
           * derived from that machine's php.ini, and it is the number this
           * feature previously got wrong in both environments.
           */
          const mustChunk = Boolean(uploadLimits?.chunkSize) && file.size > uploadLimits!.chunkSize;

          if (mustChunk) {
            const key = attachmentKey(file, i);

            const uploadKey = await uploadFileInChunks(file, {
              signal: controller.signal,
              onProgress: (progress) =>
                setUploadProgress((previous) => ({ ...previous, [key]: progress })),
            });

            const response = selectedThread.type === 'direct'
              ? await chatApi.sendMessage(selectedThread.id, { body: messageBody, uploadKey })
              : await chatApi.sendGroupMessage(selectedThread.id, { body: messageBody, uploadKey });
            responses.push(response.data);
          } else {
            const response = selectedThread.type === 'direct'
              ? await chatApi.sendMessage(selectedThread.id, { body: messageBody, attachment: file })
              : await chatApi.sendGroupMessage(selectedThread.id, { body: messageBody, attachment: file });
            responses.push(response.data);
          }
        }
      }

      setMessageText('');
      clearAttachmentFiles();
      setUploadProgress({});

      if (selectedThread.type === 'direct') {
        await chatApi.setTyping(selectedThread.id, false);
      } else {
        await chatApi.setGroupTyping(selectedThread.id, false);
      }

      setMessages((prev) => [...prev, ...responses]);
      appendedResponses = true;
      await loadThreads();
    } catch (err: any) {
      // A cancellation is the user's own doing, not a failure to report at
      // them. Anything already sent stays sent — the files are separate
      // messages — so the composer keeps what has not gone yet.
      if (err instanceof UploadCancelledError) {
        setUploadProgress({});
      } else {
        setError(err?.response?.data?.message || 'Could not send message');
      }

      // Whatever DID send stays on screen — each file is its own message, so
      // a failure on the third does not un-send the first two. Guarded by the
      // flag because the throw may have come from loadThreads(), AFTER these
      // were already appended, and adding them twice would show duplicates.
      if (responses.length > 0 && !appendedResponses) {
        setMessages((prev) => [...prev, ...responses]);
      }
    } finally {
      uploadAbortRef.current = null;
      setIsSending(false);
      setUploadProgress({});
    }
  };

  /** Stop an upload in flight. The composer's X becomes this while sending. */
  const cancelUpload = () => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    setUploadProgress({});
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
          uploadProgress={uploadProgress}
          onCancelUpload={cancelUpload}
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
