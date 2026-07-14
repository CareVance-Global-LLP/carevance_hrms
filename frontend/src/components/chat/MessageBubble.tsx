import { Fragment } from 'react';
import { formatDateTime } from '@/lib/dateTime';
import { decodeHtmlEntities } from '@/lib/formatters';
import type { ChatMessage, ChatGroupMessage } from '@/types';

type ChatFeedMessage = ChatMessage | ChatGroupMessage;

const EMAIL_TOKEN_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const URL_TOKEN_PATTERN = /^(https?:\/\/|www\.)[^\s<]+$/i;
const URL_OR_EMAIL_PATTERN = /((?:https?:\/\/|www\.)[^\s<]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;

const resolveLinkTarget = (token: string) => {
  if (EMAIL_TOKEN_PATTERN.test(token)) {
    return { href: `mailto:${token}`, label: token };
  }
  const sanitized = token.replace(/[),.;!?]+$/, '');
  return {
    href: sanitized.startsWith('http://') || sanitized.startsWith('https://') ? sanitized : `https://${sanitized}`,
    label: sanitized,
  };
};

const getFileExtension = (filename?: string | null) => {
  if (!filename) return '?';
  const parts = filename.split('.');
  const ext = parts.length > 1 ? parts.pop() : '';
  return ext ? ext.substring(0, 4).toUpperCase() : '?';
};

const formatBytes = (size?: number | null) => {
  if (!size || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

interface MessageBubbleProps {
  message: ChatFeedMessage;
  mine: boolean;
  isGroupMessage: boolean;
  isEditing: boolean;
  editingText: string;
  onEditingTextChange: (text: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  isSavingEdit: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
  inlineAttachmentUrl?: string | null;
  onOpenAttachment: () => void;
  onDownloadAttachment: () => void;
  viewerTimezone: string;
}

export default function MessageBubble({
  message,
  mine,
  isGroupMessage: isGroupMsg,
  isEditing,
  editingText,
  onEditingTextChange,
  onSaveEdit,
  onCancelEdit,
  isSavingEdit,
  onContextMenu,
  inlineAttachmentUrl,
  onOpenAttachment,
  onDownloadAttachment,
  viewerTimezone,
}: MessageBubbleProps) {
  const hasReactions = (message.reactions || []).length > 0;
  const messageHasImageAttachment = Boolean(
    message.has_attachment && String(message.attachment_mime || '').toLowerCase().startsWith('image/')
  );
  const hasBodyText = Boolean((message.body || '').trim());

  const renderMessageBody = (body: string) => {
    const decodedBody = decodeHtmlEntities(body);
    const lines = decodedBody.split('\n');

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

  return (
    <div
      className={`group flex ${mine ? 'justify-end' : 'justify-start'} ${hasReactions ? 'pt-6' : 'pt-4'}`}
    >
      <div className="relative max-w-[70%]" onContextMenu={onContextMenu}>
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
          {!mine && isGroupMsg && (
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary-700">
              {(message as ChatGroupMessage).sender?.name || 'Teammate'}
            </p>
          )}
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                value={editingText}
                onChange={(e) => onEditingTextChange(e.target.value)}
                rows={3}
                className="w-full resize-y rounded-lg border border-white/50 bg-white px-3 py-2 text-sm text-gray-900 focus:border-white focus:outline-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="rounded-md border border-white/50 px-2 py-1 text-xs text-white hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onSaveEdit}
                  disabled={isSavingEdit || !editingText.trim()}
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
                  onClick={onOpenAttachment}
                  type="button"
                  className={`block overflow-hidden rounded-lg border ${mine ? 'border-primary-400/50' : 'border-gray-200'} bg-black/5`}
                >
                  {inlineAttachmentUrl ? (
                    <img
                      src={inlineAttachmentUrl}
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
                  {renderMessageBody(message.body || '')}
                </p>
              ) : null}

              {message.has_attachment && !messageHasImageAttachment ? (
                <div className={`mt-2 flex items-center gap-2 rounded-lg border p-2 ${
                  mine ? 'border-primary-400/40 bg-primary-500/20' : 'border-gray-200 bg-gray-50'
                }`}>
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
                    mine ? 'bg-primary-500 text-white' : 'bg-primary-100 text-primary-700'
                  }`}>
                    {getFileExtension(message.attachment_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-xs font-medium ${mine ? 'text-primary-100' : 'text-gray-800'}`}>
                      {message.attachment_name || 'Attachment'}
                    </p>
                    {message.attachment_size ? (
                      <p className={`text-[10px] ${mine ? 'text-primary-200' : 'text-gray-500'}`}>
                        {formatBytes(message.attachment_size)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={onOpenAttachment}
                      type="button"
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                        mine ? 'bg-primary-500 text-white hover:bg-primary-400' : 'bg-primary-100 text-primary-700 hover:bg-primary-200'
                      }`}
                    >
                      Open
                    </button>
                    <button
                      onClick={onDownloadAttachment}
                      type="button"
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                        mine ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      Download
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
          <div className={`mt-1 flex items-center gap-2 text-[10px] ${mine ? 'text-primary-100' : 'text-gray-400'}`}>
            <span>{formatDateTime(message.created_at, viewerTimezone)}</span>
            {message.is_edited ? <span>Edited</span> : null}
            {!isGroupMsg && mine ? <span>{(message as ChatMessage).read_at ? 'Read' : 'Sent'}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
