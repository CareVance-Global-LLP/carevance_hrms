import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatDateTime } from '@/lib/dateTime';
import { DEFAULT_APP_TIMEZONE } from '@/lib/timezones';
import { useAuth } from '@/contexts/AuthContext';
import type { ChatConversation, ChatGroup, ChatGroupMessage, ChatMessage, ChatTypingUser } from '@/types';
import DateSeparator from './DateSeparator';
import MessageBubble from './MessageBubble';
import MessageComposer from './MessageComposer';
import ChatEmptyState from './ChatEmptyState';

type ThreadSelection = { type: 'direct' | 'group'; id: number } | null;
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

type ImageViewerState = {
  url: string;
  fileName: string;
  revokeOnClose: boolean;
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

const getInlineAttachmentKey = (message: ChatFeedMessage, isGroup: boolean) =>
  `${isGroup ? 'group' : 'direct'}:${message.id}`;

interface MessageAreaProps {
  selectedThread: ThreadSelection;
  selectedConversation: ChatConversation | null;
  selectedGroup: ChatGroup | null;
  messages: ChatFeedMessage[];
  typingUsers: ChatTypingUser[];
  messageText: string;
  setMessageText: (text: string) => void;
  attachmentFiles: File[];
  setAttachmentFiles: React.Dispatch<React.SetStateAction<File[]>>;
  editingMessageId: number | null;
  setEditingMessageId: (id: number | null) => void;
  editingMessageText: string;
  setEditingMessageText: (text: string) => void;
  isSavingEdit: boolean;
  setIsSavingEdit: (saving: boolean) => void;
  error: string;
  setError: (error: string) => void;
  inlineAttachmentUrls: Record<string, string>;
  setInlineAttachmentUrls: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  imageViewer: ImageViewerState | null;
  setImageViewer: (state: ImageViewerState | null | ((prev: ImageViewerState | null) => ImageViewerState | null)) => void;
  onSendMessage: (e: React.FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleMessageChange: (value: string) => void;
  handleComposerPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  applyAttachmentFiles: (files: FileList | null) => void;
  removeAttachmentFile: (index: number) => void;
  getFilePreviewUrl: (file: File) => string | null;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  onOpenAttachment: (message: ChatFeedMessage) => void;
  onDownloadAttachment: (message: ChatFeedMessage) => void;
  onReactToMessage: (message: ChatFeedMessage, emoji: string) => Promise<void>;
  onCopyMessage: (message: ChatFeedMessage) => Promise<void>;
  onDeleteMessage: (message: ChatFeedMessage) => Promise<void>;
  isDeletingMessage: boolean;
  onNewConversation: () => void;
}

const isGroupMessage = (message: ChatFeedMessage): message is ChatGroupMessage => 'group_id' in message;

export default function MessageArea({
  selectedThread,
  selectedConversation,
  selectedGroup,
  messages,
  typingUsers,
  messageText,
  setMessageText,
  attachmentFiles,
  setAttachmentFiles,
  editingMessageId,
  setEditingMessageId,
  editingMessageText,
  setEditingMessageText,
  isSavingEdit,
  setIsSavingEdit,
  error,
  setError,
  inlineAttachmentUrls,
  setInlineAttachmentUrls,
  imageViewer,
  setImageViewer,
  onSendMessage,
  onKeyDown,
  handleMessageChange,
  handleComposerPaste,
  applyAttachmentFiles,
  removeAttachmentFile,
  getFilePreviewUrl,
  handleDragEnter,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  onOpenAttachment,
  onDownloadAttachment,
  onReactToMessage,
  onCopyMessage,
  onDeleteMessage,
  isDeletingMessage,
  onNewConversation,
}: MessageAreaProps) {
  const { user } = useAuth();
  const viewerTimezone = (user?.settings as any)?.timezone || DEFAULT_APP_TIMEZONE;
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messageContextMenuRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const previewUrlsRef = useRef<Map<File, string>>(new Map());

  const [messageContextMenu, setMessageContextMenu] = useState<MessageContextMenuState | null>(null);
  const [messageContextMenuLayout, setMessageContextMenuLayout] = useState<MessageContextMenuLayout | null>(null);

  const selectedThreadLabel = selectedThread?.type === 'group' ? 'group' : 'conversation';

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 80;
  };

  useEffect(() => {
    if (shouldStickToBottomRef.current) {
      scrollToBottom();
    }
  }, [messages.length]);

  useEffect(() => {
    if (!messageContextMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (messageContextMenuRef.current?.contains(target)) return;
      setMessageContextMenu(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMessageContextMenu(null);
    };

    const handleViewportResize = () => setMessageContextMenu(null);
    const handleViewportScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && messageContextMenuRef.current?.contains(target)) return;
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
    if (!messageContextMenu || !messageContextMenuRef.current) return;
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
    if (!messageContextMenu) setMessageContextMenuLayout(null);
  }, [messageContextMenu]);

  useEffect(() => {
    if (editingMessageId && !messages.some((m) => m.id === editingMessageId)) {
      setEditingMessageId(null);
      setEditingMessageText('');
    }
    if (messageContextMenu && !messages.some((m) => m.id === messageContextMenu.message.id)) {
      setMessageContextMenu(null);
    }
  }, [editingMessageId, messageContextMenu, messages]);

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
    if (!selectedThread || editingMessageId !== message.id) return;
    const nextBody = editingMessageText.trim();
    if (!nextBody) {
      setError('Message cannot be empty.');
      return;
    }
    // Delegate to parent - this is handled in Chat.tsx
  };

  const closeImageViewer = () => {
    setImageViewer((current) => {
      if (current?.revokeOnClose) URL.revokeObjectURL(current.url);
      return null;
    });
  };

  const downloadImageFromViewer = () => {
    if (!imageViewer) return;
    const anchor = document.createElement('a');
    anchor.href = imageViewer.url;
    anchor.download = imageViewer.fileName || `chat-image-${Date.now()}`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  useEffect(() => {
    return () => {
      if (imageViewer?.revokeOnClose) URL.revokeObjectURL(imageViewer.url);
    };
  }, [imageViewer]);

  useEffect(() => {
    if (!imageViewer) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeImageViewer();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [imageViewer]);

  if (!selectedThread) {
    return (
      <div className="flex h-full flex-col bg-gray-50">
        <ChatEmptyState onNewConversation={onNewConversation} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
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
                ? ` \u2022 Last seen ${formatDateTime(selectedConversation.other_user.last_seen_at, viewerTimezone)}`
                : ''}
            </p>
          </>
        ) : selectedGroup ? (
          <>
            <p className="font-semibold text-gray-900">{selectedGroup.name}</p>
            <p className="text-xs text-gray-500">
              {(selectedGroup.member_count || selectedGroup.members?.length || 0)} members
              {selectedGroup.members?.length
                ? ` \u2022 ${selectedGroup.members.slice(0, 4).map((m) => m.name).join(', ')}${selectedGroup.members.length > 4 ? '...' : ''}`
                : ''}
            </p>
          </>
        ) : null}
      </div>

      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="relative flex-1 min-h-0 space-y-3 overflow-y-auto bg-gray-50 p-4"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-gray-500">No messages yet.</p>
        ) : (
          messages.map((message, index) => {
            const showDateSeparator = index === 0 ||
              new Date(message.created_at).toDateString() !== new Date(messages[index - 1].created_at).toDateString();
            const mine = Number(message.sender_id) === Number(user?.id);
            const groupMsg = isGroupMessage(message);
            const messageInlineAttachmentUrl = inlineAttachmentUrls[getInlineAttachmentKey(message, groupMsg)] || null;

            return (
              <Fragment key={`${groupMsg ? 'group' : 'direct'}-${message.id}`}>
                {showDateSeparator ? <DateSeparator date={message.created_at} /> : null}
                <MessageBubble
                  message={message}
                  mine={mine}
                  isGroupMessage={groupMsg}
                  isEditing={editingMessageId === message.id}
                  editingText={editingMessageText}
                  onEditingTextChange={setEditingMessageText}
                  onSaveEdit={() => handleSaveEditedMessage(message)}
                  onCancelEdit={cancelEditingMessage}
                  isSavingEdit={isSavingEdit}
                  onContextMenu={(e) => {
                    if (editingMessageId === message.id) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setMessageContextMenuLayout(calculateContextMenuLayout(e.clientX, e.clientY, 336, 520));
                    setMessageContextMenu({ message, mine, x: e.clientX, y: e.clientY });
                  }}
                  inlineAttachmentUrl={messageInlineAttachmentUrl}
                  onOpenAttachment={() => onOpenAttachment(message)}
                  onDownloadAttachment={() => onDownloadAttachment(message)}
                  viewerTimezone={viewerTimezone}
                />
              </Fragment>
            );
          })
        )}
        {typingUsers.length > 0 && (
          <p className="text-xs italic text-gray-500">
            {typingUsers.map((u) => u.name).join(', ')} typing...
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
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">React</p>
              <div className="flex flex-wrap gap-2">
                {NORMALIZED_QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => void onReactToMessage(messageContextMenu.message, emoji)}
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
                          onClick={() => void onReactToMessage(messageContextMenu.message, emoji)}
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
              onClick={() => void onCopyMessage(messageContextMenu.message)}
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
                onClick={() => void onDeleteMessage(messageContextMenu.message)}
                disabled={isDeletingMessage}
                className="flex w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-60"
              >
                {isDeletingMessage ? 'Deleting...' : 'Delete message'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {imageViewer ? (
        <div
          className="fixed inset-0 z-[80] flex flex-col bg-black/90"
          role="dialog"
          aria-modal="true"
          onClick={closeImageViewer}
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/20 px-4 py-3 text-white">
            <p className="truncate text-sm font-medium">{imageViewer.fileName}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={downloadImageFromViewer}
                className="rounded-md border border-white/30 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
              >
                Download
              </button>
              <button
                type="button"
                onClick={closeImageViewer}
                className="rounded-md border border-white/30 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
              >
                Close
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={closeImageViewer}
            className="flex min-h-0 flex-1 items-center justify-center p-4"
          >
            <img
              src={imageViewer.url}
              alt={imageViewer.fileName || 'Opened screenshot'}
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full object-contain"
            />
          </button>
        </div>
      ) : null}

      <MessageComposer
        messageText={messageText}
        onMessageChange={handleMessageChange}
        onSendMessage={() => onSendMessage({ preventDefault: () => {} } as React.FormEvent)}
        onKeyDown={onKeyDown}
        attachmentFiles={attachmentFiles}
        onAddAttachments={applyAttachmentFiles}
        onRemoveAttachment={removeAttachmentFile}
        disabled={!selectedThread}
        placeholder={
          attachmentFiles.length > 0
            ? 'Add a caption (optional)'
            : selectedThread
              ? `Type a message to this ${selectedThreadLabel}...`
              : 'Select chat first'
        }
        getFilePreviewUrl={getFilePreviewUrl}
        onPaste={handleComposerPaste}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
      {error && <p className="px-3 pb-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}


